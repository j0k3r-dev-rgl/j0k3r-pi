import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FindReferencesInput, ReferenceLocation } from '../../types.js';
import { buildProjectIndex, type IndexedMethod } from '../../core/project-index.js';
import { resolveJavaCallsForGraph, resolveJavaIndexRoot } from './function-call-tree.js';

export async function findJavaReferences(cwd: string, input: FindReferencesInput): Promise<ReferenceLocation[]> {
  const rootFile = resolve(cwd, input.path);
  const rootStat = await stat(rootFile).catch(() => undefined);
  const indexRoot = rootStat?.isDirectory() ? rootFile : await resolveJavaIndexRoot(rootFile);
  const index = await buildProjectIndex(indexRoot);

  const target = index.methods.find((method) => {
    if (method.symbol !== input.symbol) return false;
    if (!rootStat?.isDirectory() && method.file !== rootFile) return false;
    if (input.kind && input.kind !== 'method') return false;
    return true;
  });
  if (!target) return [];

  const results: ReferenceLocation[] = [];
  for (const caller of index.methods) {
    for (const resolvedCall of resolveJavaCallsForGraph(caller, index)) {
      if (!resolvedCall.targetMethod || !sameMethod(resolvedCall.targetMethod, target)) continue;
      results.push({
        file: caller.file,
        line: resolvedCall.call.line,
        column: resolvedCall.call.column,
        end_line: caller.node.endPosition.row + 1,
        end_column: caller.node.endPosition.column,
        symbol: target.symbol,
        kind: 'method',
        context_symbol: caller.symbol,
        context_kind: 'method',
        context_class: caller.className,
        owner_kind: 'class',
        reference_kind: 'call',
        called_as: resolvedCall.call.callText,
        receiver_name: resolvedCall.call.object,
        receiver_type: resolvedCall.resolved?.receiverType,
        is_application: true,
        source: 'application',
      });
    }
  }

  return results;
}

function sameMethod(a: IndexedMethod, b: IndexedMethod): boolean {
  return a.file === b.file && a.className === b.className && a.symbol === b.symbol;
}
