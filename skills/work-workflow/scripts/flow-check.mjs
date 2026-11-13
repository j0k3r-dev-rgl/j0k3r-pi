#!/usr/bin/env node
// Compatibility CLI; the workflow-check extension owns the single validation engine.
import { main } from '../../../extensions/workflow-check/src/core/flow-check.ts';
export { main };
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
