import type { ProviderGroup, UsagePool } from './api.ts';

export function compactReset(resetAt: string | null, now = Date.now()): string {
  const at = resetAt ? Date.parse(resetAt) : NaN;
  if (!Number.isFinite(at)) return '';
  const minutes = Math.max(0, Math.ceil((at - now) / 60_000));
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}d${String(Math.floor(minutes % 1440 / 60)).padStart(2, '0')}h`;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

const tokenMeter = (pool: UsagePool) => pool.showBar && /^(Input|Output) /i.test(pool.label);
function windowName(window: string | null): string {
  const value = window?.trim() ?? '';
  if (/^5\s*(h|hs|hr|hours|horas)$/i.test(value)) return '5h';
  if (/^(sem|semanal|weekly|7\s*d)$/i.test(value)) return '7d';
  return value;
}

function meterIdentity(pool: UsagePool) {
  const window = windowName(pool.windowLabel);
  if (tokenMeter(pool)) return { group: /semanal/i.test(pool.label) ? 'Semanal · tok' : 'Mensual · tok', title: /^Input/i.test(pool.label) ? 'in' : 'out', window };
  if (pool.amountText) return { group: '', title: pool.label.replace('Costo del período', 'Costo plan').replace('Límite mensual', 'Límite PAYG'), window };
  const name = (pool.displayName ?? pool.label).replace(/\s*·\s*[^·]+$/, '').replace(/\s*\((?:5\s*hs?|7\s*d|sem|semanal|mensual)\)$/i, '').trim();
  const group = /claude.*gpt/i.test(name) ? 'Claude / GPT Models' : /^openai/i.test(name) || /^5h Window|^Semanal/i.test(name) ? '' : name;
  return { group, title: window || 'cuota', window };
}

/** Compact, user-only HUD payload, independent of report formatting. */
export function quotaHudAccounts(groups: ProviderGroup[]) {
  return groups.flatMap(group => group.accounts.map(account => {
    const five = account.pools.filter(pool => /^5\s*(h|hs|hr|hours|horas)$/i.test(pool.windowLabel?.trim() ?? ''));
    const pools = group.provider === 'deeprelay' ? account.pools.filter(pool => pool.label !== 'Plan') : account.pools;
    const meter = pools.find(tokenMeter);
    return {
      id: `${group.provider}:${account.id}`,
      provider: group.provider,
      name: account.account,
      plan: account.plan,
      fiveHourPercent: five.length ? Math.min(...five.map(pool => pool.availablePercentage)) : null,
      fiveHourCount: five.length,
      summary: meter ? `${/^Input/i.test(meter.label) ? 'in' : 'out'} ${meter.amountText?.replaceAll(' ', '')}` : pools.find(pool => pool.amountText)?.amountText ?? '',
      error: account.error ? 'cuota no disponible' : '',
      pools: pools.map(pool => ({
        ...meterIdentity(pool),
        value: tokenMeter(pool) ? pool.amountText!.replaceAll(' ', '') : pool.amountText ?? `${Math.round(pool.availablePercentage)}%`,
        reset: compactReset(pool.resetAt),
        note: '',
        percent: pool.amountText && !pool.showBar ? null : pool.availablePercentage,
      })),
    };
  }));
}
