import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quotaHudAccounts, compactReset } from '../src/hud.ts';

const pool = (windowLabel: string | null, availablePercentage: number, label = 'Quota') => ({
  label, displayName: null, windowLabel, availablePercentage, used: 0, available: null,
  total: null, unlimited: false, resetAt: null, modelCount: 1, models: [],
});

test('HUD prioritizes the minimum across explicit 5h pools, never weekly values', () => {
  const groups: any = [{ provider: 'openai', accounts: [{ id: 'one', account: 'account', plan: 'pro', pools: [pool('7d', 2), pool('5h', 70), pool('5 hs', 40)] }] }];
  const [account] = quotaHudAccounts(groups);
  assert.equal(account.fiveHourPercent, 40);
  assert.equal(account.fiveHourCount, 2);
  assert.equal(account.pools.length, 3);
  assert.equal(account.id, 'openai:one');
  assert.equal(account.pools[0].value, '2%');
});

test('HUD keeps monetary balances and unavailable 5h distinct from zero', () => {
  const groups: any = [{ provider: 'deepseek', accounts: [{ id: 'money', account: 'account', plan: 'payg', pools: [{ ...pool(null, 100), amountText: '$9.25', showBar: false }] }] }];
  const [account] = quotaHudAccounts(groups);
  assert.equal(account.fiveHourPercent, null);
  assert.equal(account.summary, '$9.25');
  assert.equal(account.pools[0].percent, null);
  assert.equal(account.pools[0].reset, '');
});

test('HUD countdown uses HH:mm or compact days, with no invented resets', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  assert.equal(compactReset(null, now), '');
  assert.equal(compactReset('invalid', now), '');
  assert.equal(compactReset('2026-11-16T17:00:00Z', now), '05:00');
  assert.equal(compactReset('2026-11-18T02:00:00Z', now), '1d14h');
  assert.equal(compactReset('2026-11-16T11:00:00Z', now), '00:00');
});

test('HUD DeepRelay prioritizes token meters over subscription name and suppresses boilerplate', () => {
  const groups: any = [{ provider: 'deeprelay', accounts: [{ id: 'relay', account: 'relay', plan: 'pro', pools: [
    { ...pool(null, 0, 'Plan'), displayName: 'DeepRelay · Suscripción', amountText: 'Pro', showBar: false },
    { ...pool('Mensual', 60, 'Input mensual'), displayName: 'DeepRelay · Input mensual', amountText: '4M / 10M', showBar: true },
    { ...pool('Semanal', 80, 'Output semanal'), displayName: 'DeepRelay · Output semanal', amountText: '200K / 1M', showBar: true, noteText: 'ventana móvil 7d' },
  ] }] }];
  const [account] = quotaHudAccounts(groups);
  assert.equal(account.summary, 'in 4M/10M');
  assert.equal(account.pools[0].group, 'Mensual · tok');
  assert.equal(account.pools[0].title, 'in');
  assert.equal(account.pools[0].value, '4M/10M');
  assert.equal(account.pools[0].window, 'Mensual');
  assert.equal(account.pools[1].reset, '');
  assert.equal(account.pools[1].note, '');
});

test('HUD separates model families from windows without merging distinct Gemini meters', () => {
  const groups: any = [{ provider: 'antigravity', accounts: [{ id: 'a', account: 'a', plan: 'pro', pools: [
    { ...pool('5 hs', 82, 'Gemini Models (5 hs)'), displayName: 'Gemini Models · 5 hs' },
    { ...pool('sem', 76, 'Gemini Models (sem)'), displayName: 'Gemini Models · sem' },
    { ...pool('sem', 100, 'Gemini 4 Argon (sem)'), displayName: 'Gemini 4 Argon · sem' },
    { ...pool('5 hs', 100, 'Claude and GPT models (5 hs)'), displayName: 'Claude and GPT models · 5 hs' },
  ] }] }];
  const [account] = quotaHudAccounts(groups);
  assert.deepEqual(account.pools.map(p => [p.group, p.title, p.window]), [
    ['Gemini Models', '5h', '5h'], ['Gemini Models', '7d', '7d'],
    ['Gemini 4 Argon', '7d', '7d'], ['Claude / GPT Models', '5h', '5h'],
  ]);
});
