import { registerPoolLifecycle } from './src/lifecycle.js';

/**
 * Pi Extension entrypoint for CPAMC Subagent Account Allocation Pool.
 * Automatically discovered by Pi under ~/.pi/agent/extensions/cpamc-subagent-pool/index.js.
 *
 * @param {any} pi ExtensionAPI
 */
export default function cpamcSubagentPoolExtension(pi) {
  // Installed Pi tracks pi.events.on subscriptions per runtime and removes them
  // on invalidation AFTER awaited session_shutdown. Factory returns void, not cleanup.
  registerPoolLifecycle(pi);
}
