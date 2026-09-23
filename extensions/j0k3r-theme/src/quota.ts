import { fetchUsage, type AccountUsage } from "../../cpamc-usage/src/api.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:8317";
const TIMEOUT_MS = 8000;
export const QUOTA_REFRESH_MS = 30_000;

type ModelAccount = Pick<AccountUsage, "id" | "pools">;

export function selectQuotaAccount<T extends ModelAccount>(
	provider: string,
	modelId: string,
	accounts: T[],
	modelsByAccount: Map<string, string[]>,
): T | undefined {
	if (provider === "opencode-go") return accounts.find((account) => account.id === "opencode-go");
	if (provider !== "cliproxyapi") return undefined;
	const matches = accounts.filter((account) => modelsByAccount.get(account.id)?.includes(modelId));
	return matches.length === 1 ? matches[0] : undefined;
}

export function formatQuota(
	pools: Pick<AccountUsage["pools"][number], "label" | "windowLabel" | "availablePercentage" | "resetAt">[],
	now = Date.now(),
): string | undefined {
	const available = pools.filter((pool) => Number.isFinite(pool.availablePercentage));
	if (!available.length) return undefined;
	return `quota ${available.map((pool) => {
		const percentage = Math.max(0, Math.min(100, pool.availablePercentage));
		const filled = Math.round(percentage * 8 / 100);
		const reset = pool.resetAt ? Date.parse(pool.resetAt) : NaN;
		const remainingMinutes = Math.ceil((reset - now) / 60_000);
		let countdown = "";
		if (Number.isFinite(remainingMinutes) && remainingMinutes > 0) {
			const days = Math.floor(remainingMinutes / 1440);
			const hours = Math.floor((remainingMinutes % 1440) / 60);
			const minutes = remainingMinutes % 60;
			countdown = days > 0 ? ` ↻ ${days}d ${hours}h` : hours > 0 ? ` ↻ ${hours}h ${minutes}m` : ` ↻ ${minutes}m`;
		}
		return `${pool.windowLabel || pool.label} ${"━".repeat(filled)}${"─".repeat(8 - filled)} ${Math.round(percentage)}%${countdown}`;
	}).join(" · ")}`;
}

export async function fetchModelQuota(provider: string, modelId: string, signal?: AbortSignal): Promise<string | undefined> {
	if (provider !== "opencode-go" && provider !== "cliproxyapi") return undefined;
	const combinedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);
	const groups = await fetchUsage(combinedSignal);
	const accounts = groups.flatMap((group) => group.accounts);
	let account: AccountUsage | undefined;

	if (provider === "opencode-go") {
		account = selectQuotaAccount(provider, modelId, accounts, new Map());
	} else {
		const base = (process.env.CLIPROXYAPI_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
		const key = (process.env.CLIPROXYAPI_MANAGEMENT_KEY || "").trim();
		const modelsByAccount = new Map<string, string[]>();
		await Promise.all(accounts.filter((entry) => entry.id !== "opencode-go" && entry.authFileName).map(async (entry) => {
			const url = new URL(`${base}/v0/management/auth-files/models`);
			url.searchParams.set("name", entry.authFileName!);
			const response = await fetch(url, {
				headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
				signal: combinedSignal,
			});
			if (!response.ok) throw new Error(`auth-files/models HTTP ${response.status}`);
			const data = await response.json() as { models?: Array<{ id?: string }> };
			modelsByAccount.set(entry.id, (data.models ?? []).map((model) => model.id).filter((id): id is string => typeof id === "string"));
		}));
		account = selectQuotaAccount(provider, modelId, accounts, modelsByAccount);
	}

	return formatQuota(account?.pools ?? []);
}
