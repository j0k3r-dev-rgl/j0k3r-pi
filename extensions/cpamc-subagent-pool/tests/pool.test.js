import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectAccountCandidate } from '../src/pool.js';

describe('Pool candidate selection algorithm', () => {
  const accounts = [
    { prefix: 'pdas', authIndex: '0', email: 'pdas@test.com', status: 'healthy' },
    { prefix: 'j0k3r2', authIndex: '1', email: 'j0k3r2@test.com', status: 'healthy' },
    { prefix: 'j0k3r3', authIndex: '2', email: 'j0k3r3@test.com', status: 'healthy' },
    { prefix: 'ytest664', authIndex: '5', email: 'ytest664@test.com', status: 'healthy' },
  ];

  it('never ranks unknown or invalid quotas as full, but still dispatches when all unknown', () => {
    const candidates = [{ prefix: 'unknown', authIndex: 'u' }, { prefix: 'known', authIndex: 'k', quota: { remainingFraction: 0.2 } }];
    assert.equal(selectAccountCandidate(candidates).prefix, 'known');
    assert.ok(selectAccountCandidate([{ prefix: 'unknown', authIndex: 'u' }]));
    assert.equal(selectAccountCandidate(candidates, [], new Map([['u', { remainingFraction: NaN }]])).prefix, 'known');
  });

  it('prefers idle account with highest remaining quota under 95% consumed', () => {
    const quotaMap = new Map([
      ['pdas', { remainingFraction: 0.5, usedPercentage: 50.0 }],
      ['j0k3r2', { remainingFraction: 0.88, usedPercentage: 12.0 }],
      ['j0k3r3', { remainingFraction: 0.92, usedPercentage: 8.0 }],
      ['ytest664', { remainingFraction: 0.99, usedPercentage: 1.0 }],
    ]);

    // All idle: should pick ytest664 (0.99)
    const selected = selectAccountCandidate(accounts, [], quotaMap);
    assert.equal(selected?.prefix, 'ytest664');

    // ytest664 is busy: should pick j0k3r3 (0.92)
    const leases1 = [{ id: 't1:1', account: 'ytest664', taskId: 't1', attempt: 1, pid: 123, createdAt: '' }];
    const selected2 = selectAccountCandidate(accounts, leases1, quotaMap);
    assert.equal(selected2?.prefix, 'j0k3r3');
  });

  it('falls back to busy account with highest quota when all idle accounts are >=95% consumed', () => {
    const quotaMap = new Map([
      ['pdas', { remainingFraction: 0.03, usedPercentage: 97.0 }], // idle but >=95% consumed
      ['j0k3r2', { remainingFraction: 0.02, usedPercentage: 98.0 }], // idle but >=95% consumed
      ['j0k3r3', { remainingFraction: 0.8, usedPercentage: 20.0 }], // busy!
      ['ytest664', { remainingFraction: 0.01, usedPercentage: 99.0 }],
    ]);

    const leases = [{ id: 't1:1', account: 'j0k3r3', taskId: 't1', attempt: 1, pid: 123, createdAt: '' }];
    // No idle account has >5% remaining; j0k3r3 has 80% remaining even though busy
    const selected = selectAccountCandidate(accounts, leases, quotaMap);
    assert.equal(selected?.prefix, 'j0k3r3');
  });

  it('breaks ties in fallback by fewest active leases', () => {
    const quotaMap = new Map([
      ['pdas', { remainingFraction: 0.8, usedPercentage: 20.0 }],
      ['j0k3r2', { remainingFraction: 0.8, usedPercentage: 20.0 }],
      ['j0k3r3', { remainingFraction: 0.1, usedPercentage: 90.0 }],
      ['ytest664', { remainingFraction: 0.1, usedPercentage: 90.0 }],
    ]);

    // Both pdas and j0k3r2 have 80% quota, but pdas has 2 leases and j0k3r2 has 1 lease
    const leases = [
      { id: 't1:1', account: 'pdas', taskId: 't1', attempt: 1, pid: 123, createdAt: '' },
      { id: 't2:1', account: 'pdas', taskId: 't2', attempt: 1, pid: 123, createdAt: '' },
      { id: 't3:1', account: 'j0k3r2', taskId: 't3', attempt: 1, pid: 123, createdAt: '' },
      { id: 't4:1', account: 'j0k3r3', taskId: 't4', attempt: 1, pid: 123, createdAt: '' },
      { id: 't5:1', account: 'ytest664', taskId: 't5', attempt: 1, pid: 123, createdAt: '' },
    ];

    const selected = selectAccountCandidate(accounts, leases, quotaMap);
    assert.equal(selected?.prefix, 'j0k3r2');
  });

  it('falls back when every idle account is at or above 95 percent consumed, including exact boundary', () => {
    const quota = new Map(accounts.map((account, i) => [account.prefix, { remainingFraction: i === 0 ? 0.05 : 0.01 }]));
    assert.equal(selectAccountCandidate(accounts, [], quota).prefix, 'pdas');
    const busy = accounts.map((account) => ({ account: account.prefix }));
    assert.equal(selectAccountCandidate(accounts, busy, quota).prefix, 'pdas');
  });

  it('returns greatest remaining candidate even at zero quota without throwing or rejecting', () => {
    const quotaMap = new Map([
      ['pdas', { remainingFraction: 0.0, usedPercentage: 100.0 }],
      ['j0k3r2', { remainingFraction: 0.0, usedPercentage: 100.0 }],
      ['j0k3r3', { remainingFraction: 0.0, usedPercentage: 100.0 }],
      ['ytest664', { remainingFraction: 0.0, usedPercentage: 100.0 }],
    ]);

    const leases = [
      { id: 't1:1', account: 'pdas', taskId: 't1', attempt: 1, pid: 123, createdAt: '' },
    ];

    // All zero quota: pdas has 1 lease, j0k3r2/j0k3r3/ytest664 have 0 leases
    const selected = selectAccountCandidate(accounts, leases, quotaMap);
    assert.ok(selected);
    assert.notEqual(selected.prefix, 'pdas');
  });
});
