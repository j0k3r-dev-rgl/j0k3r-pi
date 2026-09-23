import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TelemetryDb } from './src/storage/telemetry-db.ts';
import { registerTypesafeTools } from './src/tools/index.ts';
import { TYPESAFE_SYSTEM_POLICY } from './src/prompt/policy.ts';

export function isExtensionEnabled(name: string, cwd = process.cwd()): boolean {
  try {
    const configPath = join(cwd, '.pi', 'extensions.json');
    if (!existsSync(configPath)) return false;
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    return Boolean(config && typeof config === 'object' && config[name] === true);
  } catch {
    return false;
  }
}

export default function typesafeExtension(pi: ExtensionAPI, options: { cwd?: string } = {}): void {
  const cwd = options.cwd ?? process.cwd();
  if (!isExtensionEnabled('typesafe', cwd)) return;

  const db = new TelemetryDb();

  // Prune expired telemetry (older than 90 days) on startup
  try {
    db.pruneExpiredTelemetry(90);
  } catch {}

  // Register public tools (typesafe_evaluate, typesafe_telemetry, typesafe_record_shadow_triage, etc.)
  registerTypesafeTools(pi, db);

  // Dynamic system prompt policy injection
  if (typeof (pi as any).on === 'function') {
    (pi as any).on('before_agent_start', (event: { systemPrompt: string }) => {
      return {
        systemPrompt: `${event.systemPrompt}\n\n${TYPESAFE_SYSTEM_POLICY}`,
      };
    });
  }

  // Interactive command: /typesafe
  if (typeof pi.registerCommand === 'function') {
    pi.registerCommand('typesafe', {
      description: 'Display TypeSafe shadow triage agreement statistics and recent discrepancies.',
      handler: async (_args: string, ctx: any) => {
        const shadowStats = db.queryTelemetry({ source: 'shadow-triage', limit: 50 });
        const discrepancies = db.queryTelemetry({ source: 'shadow-triage', discrepancies_only: true, limit: 5 });

        let agreementCount = 0;
        let evaluatedCount = 0;
        for (const row of shadowStats.records) {
          if (row.shadow_agreement !== undefined && row.shadow_agreement !== null) {
            evaluatedCount++;
            if (row.shadow_agreement === 1) agreementCount++;
          }
        }

        const agreementRate = evaluatedCount > 0 ? Math.round((agreementCount / evaluatedCount) * 100) : 100;

        const lines = [
          '=== TypeSafe System One Telemetry Summary ===',
          `Total shadow runs: ${shadowStats.total}`,
          `Agreement rate: ${agreementRate}% (${agreementCount}/${evaluatedCount} matches)`,
          `Last 5 discrepancies: ${discrepancies.total === 0 ? 'None' : ''}`,
        ];

        for (const disc of discrepancies.records) {
          lines.push(
            `  • [${disc.created_at}] Predicted: ${disc.shadow_predicted_route} vs Actual: ${disc.shadow_actual_route} (id: ${disc.id})`
          );
        }

        const outputText = lines.join('\n');
        if (ctx?.ui?.notify) {
          ctx.ui.notify(outputText, 'info');
        } else {
          console.log(outputText);
        }
      },
    });
  }

  // Idempotent database cleanup on session shutdown
  pi.on('session_shutdown', async () => {
    db.close();
  });
}
