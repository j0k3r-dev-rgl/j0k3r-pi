import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FindReferencesInput, ReferenceLocation } from '../../types.js';
import { buildGoProjectIndex, extractCalls, resolveGoCall } from './workspace-graph.js';

export async function findGoReferences(cwd: string, input: FindReferencesInput): Promise<ReferenceLocation[]> {
  const rootPath = resolve(cwd, input.path);
  const rootStat = await stat(rootPath).catch(() => undefined);
  const index = await buildGoProjectIndex(rootStat?.isDirectory() ? rootPath : resolve(rootPath, '..'));

  if (input.kind === 'function' || input.kind === 'method') {
    const target = index.callables.find((callable) => callable.symbol === input.symbol && (!input.kind || input.kind === callable.kind) && (rootStat?.isDirectory() || callable.file === rootPath));
    if (!target) return [];
    const refs: ReferenceLocation[] = [];
    for (const file of index.files) {
      for (const [alias] of file.imports) {
        if (alias === input.symbol) {
          const line = file.source.split('\n').findIndex((value) => value.includes(alias));
          if (line >= 0) refs.push({ file: file.file, line: line + 1, column: file.source.split('\n')[line].indexOf(alias), symbol: input.symbol, kind: input.kind, reference_kind: 'import', is_application: true, source: 'application' });
        }
      }
    }
    for (const caller of index.callables) {
      for (const call of extractCalls(caller.node)) {
        const resolved = resolveGoCall(index, caller, call);
        if (!resolved.callable || resolved.callable.symbolId !== target.symbolId) continue;
        refs.push({ file: caller.file, line: call.line, column: call.column, end_line: caller.node.endPosition.row + 1, end_column: caller.node.endPosition.column, symbol: target.symbol, kind: target.kind === 'function' ? 'function' : 'method', context_symbol: caller.symbol, context_kind: caller.kind === 'function' ? 'function' : 'method', context_class: caller.ownerName, owner_kind: caller.ownerName ? 'class' : 'module', reference_kind: 'call', called_as: call.text, receiver_name: call.receiver, receiver_type: resolved.receiverType, is_application: true, source: 'application' });
      }
    }
    return dedupe(refs);
  }

  if (input.kind === 'variable') {
    const refs: ReferenceLocation[] = [];
    for (const file of index.files) {
      const lines = file.source.split('\n');
      for (let indexLine = 0; indexLine < lines.length; indexLine++) {
        const line = lines[indexLine];
        if (new RegExp(`\\bimport\\b`).test(line) && new RegExp(`\\b${escapeRegExp(input.symbol)}\\b`).test(line)) {
          refs.push({ file: file.file, line: indexLine + 1, column: line.indexOf(input.symbol), symbol: input.symbol, kind: 'variable', reference_kind: 'import', is_application: true, source: 'application' });
          continue;
        }
        const write = line.match(new RegExp(`\\b${escapeRegExp(input.symbol)}\\b\\s*(?::=|=)`));
        if (write) refs.push({ file: file.file, line: indexLine + 1, column: write.index ?? 0, symbol: input.symbol, kind: 'variable', reference_kind: 'write', is_application: true, source: 'application' });
        const read = line.match(new RegExp(`(?:return\\s+|\\()?(\\b${escapeRegExp(input.symbol)}\\b)(?!\\s*(?::=|=))`));
        if (read && !(write && read.index === write.index)) refs.push({ file: file.file, line: indexLine + 1, column: read.index ?? 0, symbol: input.symbol, kind: 'variable', reference_kind: 'read', is_application: true, source: 'application' });
      }
    }
    return dedupe(refs);
  }

  return [];
}

function dedupe<T extends ReferenceLocation>(references: T[]): T[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = `${reference.file}:${reference.line}:${reference.column}:${reference.reference_kind}:${reference.context_symbol ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
