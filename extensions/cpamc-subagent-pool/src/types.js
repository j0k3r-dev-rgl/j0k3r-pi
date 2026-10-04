/**
 * @typedef {Object} QuotaBucket
 * @property {number} remainingFraction
 * @property {number} [usedPercentage]
 * @property {string} window
 * @property {string} [lastCheckedAt]
 * @property {'known' | 'stale' | 'unknown'} status
 */

/**
 * @typedef {Object} PoolAccount
 * @property {string} prefix
 * @property {string} authIndex
 * @property {string} email
 * @property {'healthy' | 'degraded' | 'disabled' | 'unknown'} status
 * @property {number} [lastRequestStartedAt]
 * @property {QuotaBucket} [quota]
 */

/**
 * @typedef {Object} SubagentLease
 * @property {string} id - Canonical owner-inclusive key: `${sessionTag}/${pidTag}/${taskTag}/${attemptTag}`
 * @property {string} account - Account prefix (e.g. 'pdas')
 * @property {string} taskId
 * @property {number} attempt
 * @property {string} [sessionId]
 * @property {number} pid
 * @property {string} createdAt
 */

/**
 * @typedef {Object} PoolState
 * @property {number} version
 * @property {string} updatedAt
 * @property {PoolAccount[]} accounts
 * @property {Record<string, SubagentLease>} leases
 */

/**
 * @typedef {Object} AllocateOptions
 * @property {AbortSignal} [signal]
 * @property {string} taskId
 * @property {number} [attempt=1]
 * @property {string} [sessionId]
 * @property {number} [pid]
 */

/**
 * @typedef {Object} ReleaseOptions
 * @property {string} taskId
 * @property {number} [attempt=1]
 * @property {string} [sessionId]
 * @property {number} [pid]
 */

export {};
