import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

export type QuotaAccount = { id: string; provider: string; name: string; plan: string; fiveHourPercent: number | null; fiveHourCount: number; summary: string; error: string; pools: { title: string; group?: string; window?: string; value: string; reset: string; note: string; percent: number | null }[] };
export type Todo = { title: string; steps: { text: string; status: 'open' | 'completed' }[] };
export type Panel = { todo?: Todo; dir?: string; repo?: string; branch?: string; modelQuota?: string; accounts?: QuotaAccount[]; lines: string[]; header?: string[]; updatedAt?: string; error?: string };
export type Panels = Record<'main' | 'quota' | 'mem' | 'sup' | 'todo', Panel>;

/** Optional UI-only bridges. No sibling imports, commands, tools or model messages. */
export function readPanels(pi: ExtensionAPI, ctx: ExtensionContext): Panels {
  const result = {} as Panels;
  for (const name of ['main', 'quota', 'mem', 'sup', 'todo'] as const) {
    result[name] = { lines: [], error: `${name}: extensión no disponible` };
    if (ctx.mode !== 'tui' || !ctx.isProjectTrusted?.()) continue;
    const owner = ctx.sessionManager.getSessionId();
    let reading = true;
    try { pi.events.emit(`pihud:${name}:read:v1`, {
      cwd: ctx.cwd,
      sessionId: owner,
      respond: (value: Panel) => {
        if (!reading || ctx.sessionManager.getSessionId() !== owner || !ctx.isProjectTrusted?.()) return;
        if (!value || !Array.isArray(value.lines) || !value.lines.every(line => typeof line === 'string')) return;
        if (name === 'todo') {
          const todo = value.todo;
          result.todo = { lines: [] };
          if (todo && typeof todo.title === 'string' && Array.isArray(todo.steps) && todo.steps.every(step =>
            step && typeof step.text === 'string' && (step.status === 'open' || step.status === 'completed'))) {
            result.todo.todo = { title: todo.title, steps: todo.steps.map(({ text, status }) => ({ text, status })) };
          }
          return;
        }
        const accounts = name === 'quota' && Array.isArray(value.accounts) ? value.accounts.filter(account =>
          account && typeof account.id === 'string' && typeof account.provider === 'string' && typeof account.name === 'string' &&
          typeof account.plan === 'string' && typeof account.summary === 'string' && typeof account.error === 'string' &&
          (account.fiveHourPercent === null || Number.isFinite(account.fiveHourPercent)) && Number.isInteger(account.fiveHourCount) &&
          Array.isArray(account.pools) && account.pools.every(pool => pool && typeof pool.title === 'string' && typeof pool.value === 'string' && typeof pool.reset === 'string' && typeof pool.note === 'string' && (pool.percent === null || Number.isFinite(pool.percent)))) : undefined;
        result[name] = { dir: typeof value.dir === 'string' ? value.dir : undefined, repo: typeof value.repo === 'string' ? value.repo : undefined, branch: typeof value.branch === 'string' ? value.branch : undefined, modelQuota: typeof value.modelQuota === 'string' ? value.modelQuota : undefined, accounts, lines: value.lines, header: Array.isArray(value.header) && value.header.every(line => typeof line === 'string') ? value.header : undefined, updatedAt: value.updatedAt, error: value.error };
      },
    }); } catch { result[name] = { lines: [], error: `${name}: lectura no disponible` }; }
    finally { reading = false; }
  }
  return result;
}
