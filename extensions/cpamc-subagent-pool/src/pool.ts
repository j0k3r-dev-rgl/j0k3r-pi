/**
 * Pure selection function that determines the best account candidate based on
 * idle status, 5-hour quota consumption threshold (95%), and active lease counts.
 *
 * @param {import('./types.ts').PoolAccount[]} accounts
 * @param {import('./types.ts').SubagentLease[]} activeLeases
 * @param {Map<string, import('./types.ts').QuotaBucket>} [quotaMap]
 * @returns {import('./types.ts').PoolAccount | null}
 */
export function selectAccountCandidate(accounts, activeLeases = [], quotaMap = new Map()) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return null;
  }

  // Count active leases per account prefix
  const leaseCounts = new Map();
  for (const lease of activeLeases) {
    if (lease?.account) {
      leaseCounts.set(lease.account, (leaseCounts.get(lease.account) ?? 0) + 1);
    }
  }

  /**
   * Helper to get remaining quota fraction for an account
   * @param {import('./types.ts').PoolAccount} acc
   * @returns {number}
   */
  const getRemainingFraction = (acc) => {
    const q = quotaMap.get(acc.prefix) ?? quotaMap.get(acc.authIndex) ?? acc.quota;
    if (q && Number.isFinite(q.remainingFraction) && q.remainingFraction >= 0 && q.remainingFraction <= 1) {
      return q.remainingFraction;
    }
    return 0; // Unknown is conservative, but remains eligible for nonblocking fallback.
  };

  // Partition into idle and busy accounts
  // Account is idle iff zero active leases remain
  const idleAccounts = [];
  const allCandidates = [];

  for (const acc of accounts) {
    if (acc.status === 'disabled') continue;
    const leases = leaseCounts.get(acc.prefix) ?? 0;
    const remainingFraction = getRemainingFraction(acc);
    const candidate = {
      account: acc,
      leases,
      remainingFraction,
    };
    allCandidates.push(candidate);
    if (leases === 0) {
      idleAccounts.push(candidate);
    }
  }

  if (allCandidates.length === 0) {
    return null;
  }

  // Phase 1: Filter idle accounts with remainingFraction > 0.05 (<95% consumed)
  const preferredIdle = idleAccounts.filter((c) => c.remainingFraction > 0.05);

  if (preferredIdle.length > 0) {
    // Sort descending by remaining quota
    preferredIdle.sort((a, b) => {
      if (b.remainingFraction !== a.remainingFraction) {
        return b.remainingFraction - a.remainingFraction;
      }
      return a.account.prefix.localeCompare(b.account.prefix);
    });
    return preferredIdle[0].account;
  }

  // Phase 2: Fallback candidate
  // If no idle account is <95% consumed (or all accounts are busy):
  // Rank ALL accounts descending by remainingFraction, breaking ties by fewest active leases
  allCandidates.sort((a, b) => {
    if (b.remainingFraction !== a.remainingFraction) {
      return b.remainingFraction - a.remainingFraction;
    }
    if (a.leases !== b.leases) {
      return a.leases - b.leases;
    }
    return a.account.prefix.localeCompare(b.account.prefix);
  });

  return allCandidates[0].account;
}
