import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FindReferencesInput, ReferenceLocation } from '../../types.js';
import { buildTypeScriptProjectIndex, extractCalls, resolveCall, type IndexedCallable } from './function-call-tree.js';
import { resolveTypeScriptProjectRoot } from './shared.js';

export async function findTypeScriptReferences(cwd: string, input: FindReferencesInput): Promise<ReferenceLocation[]> {
  const rootPath = resolve(cwd, input.path);
  const rootStat = await stat(rootPath).catch(() => undefined);
  const indexRoot = await resolveTypeScriptProjectRoot(rootPath, rootStat?.isDirectory() ?? false);
  const index = await buildTypeScriptProjectIndex(indexRoot);

  const target = index.callables.find((callable) => {
    if (callable.symbol !== input.symbol) return false;
    if (!rootStat?.isDirectory() && callable.file !== rootPath) return false;
    if (input.kind && input.kind !== callable.kind) return false;
    return true;
  });
  if (!target) return [];

  const results: ReferenceLocation[] = [];
  for (const caller of index.callables) {
    for (const call of extractCalls(caller.node)) {
      const resolved = resolveCall(index, caller, call);
      if (!resolved.callable || !sameCallable(resolved.callable, target)) continue;
      results.push({
        file: caller.file,
        line: call.line,
        column: call.column,
        end_line: caller.node.endPosition.row + 1,
        end_column: caller.node.endPosition.column,
        symbol: target.symbol,
        kind: target.kind,
        context_symbol: caller.symbol,
        context_kind: caller.kind,
        context_class: caller.ownerName,
        owner_kind: caller.ownerKind,
        reference_kind: 'call',
        called_as: call.text,
        receiver_name: call.receiver,
        receiver_type: resolved.receiverType,
        is_application: true,
        source: 'application',
      });
    }
  }

  return results;
}

function sameCallable(a: IndexedCallable, b: IndexedCallable): boolean {
  return a.file === b.file && a.symbol === b.symbol && a.kind === b.kind && a.ownerName === b.ownerName;
}
