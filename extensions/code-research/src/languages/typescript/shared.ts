import { extname } from 'node:path';
import type { SupportedLanguage } from '../../types.js';

export function detectLanguage(filePath: string, explicit: SupportedLanguage): Exclude<SupportedLanguage, 'auto'> {
  if (explicit !== 'auto') return explicit;

  const ext = extname(filePath).toLowerCase();
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'js';
  return 'ts';
}

export function isSupportedFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext);
}

export function extractSignature(node: any): string {
  const bodyTypes = new Set([
    'statement_block',
    'class_body',
    'interface_body',
    'object',
  ]);

  interface Range {
    start: number;
    end: number;
  }

  const ranges: Range[] = [];

  function collect(n: any) {
    if (bodyTypes.has(n.type)) {
      ranges.push({ start: n.startIndex, end: n.endIndex });
      return;
    }
    for (const child of n.children) {
      collect(child);
    }
  }

  collect(node);

  ranges.sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push(range);
    }
  }

  let result = '';
  let last = node.startIndex;
  for (const range of merged) {
    result += node.text.slice(last - node.startIndex, range.start - node.startIndex);
    result += ' ... ';
    last = range.end;
  }
  result += node.text.slice(last - node.startIndex);

  return result.replace(/\s+/g, ' ').trim();
}
