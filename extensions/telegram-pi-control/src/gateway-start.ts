import { homedir } from 'node:os';

import { buildEnvConfig } from './env-config.js';
import { defaultGatewayEnvFilePath, loadGatewayEnvFile, mergeEnvFile } from './env-file.js';
import { runTelegramControlGateway } from './cli.js';

function describeStartupEnv(env: NodeJS.ProcessEnv): string[] {
  const lines = [
    'telegram pi control gateway starting...',
    'config: PI_TELEGRAM_CONTROL_BOT_TOKEN + PI_TELEGRAM_CONTROL_USER_ID',
    'workspaces: ~/.pi/agent/trust.json exact true roots only',
    `user id env: ${env.PI_TELEGRAM_CONTROL_USER_ID ? 'set' : 'missing'}`,
    'pi backend: sdk',
  ];

  return lines;
}

async function main() {
  const envFilePath = process.env.PI_TELEGRAM_CONTROL_ENV_FILE || defaultGatewayEnvFilePath(homedir());
  const fileEnv = await loadGatewayEnvFile(envFilePath);
  const env = buildEnvConfig(mergeEnvFile(fileEnv, process.env));
  for (const line of describeStartupEnv(env)) {
    console.log(line);
  }

  if (Object.keys(fileEnv).length > 0) {
    console.log(`env file: ${envFilePath}`);
  }

  const runtime = await runTelegramControlGateway({ env });
  console.log('telegram pi control gateway running. press ctrl+c to stop.');
  await runtime.waitUntilStopped();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`telegram pi control gateway failed: ${message}`);
  process.exitCode = 1;
});
