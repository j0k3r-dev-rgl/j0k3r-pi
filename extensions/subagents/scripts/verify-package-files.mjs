#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));

const requiredFiles = [
  'index.ts',
  'README.md',
  'LICENSE',
  'package.json',
  '.releaserc.json',
  'src/config.ts',
  'src/debug.ts',
  'src/history.ts',
  'src/interaction-channel.ts',
  'src/manager.ts',
  'src/model-profiles-ui.ts',
  'src/profile-resolver.ts',
  'src/runner.ts',
  'src/thread-view.ts',
  'src/tools.ts',
  'src/types.ts',
  'src/ui.ts',
  'skills/subagents-configuration/SKILL.md',
];

const missing = requiredFiles.filter((relativePath) => {
  const absolutePath = join(root, relativePath);
  return !existsSync(absolutePath) || !statSync(absolutePath).isFile();
});

if (missing.length > 0) {
  console.error('pi-subagents-j0k3r package is missing required Pi resources:');
  for (const relativePath of missing) console.error(`- ${relativePath}`);
  console.error('\nRefusing to pack/publish an incomplete npm package.');
  process.exit(1);
}

console.log(`pi-subagents-j0k3r package resource check passed (${requiredFiles.length} files).`);
