import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import type { SupportedLanguage } from '../../types.js';

export function detectLanguage(filePath: string, explicit: SupportedLanguage): Exclude<SupportedLanguage, 'auto'> {
  if (explicit !== 'auto') return explicit;
  if (extname(filePath).toLowerCase() === '.go') return 'go';
  throw new Error(`Cannot auto-detect language for ${filePath}`);
}

export function isSupportedFile(filePath: string): boolean {
  return extname(filePath).toLowerCase() === '.go';
}

export function normalizeGoTypeName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.replace(/^\*+/, '').replace(/\[[^\]]*\]/g, '').trim();
  const withoutGenerics = trimmed.replace(/\[[^\]]*\]/g, '');
  return withoutGenerics.split('.').pop()?.trim() || undefined;
}

export function packagePathToName(importPath: string): string {
  return importPath.split('/').filter(Boolean).pop() ?? importPath;
}

export function unquoteGoString(value: string): string {
  return value.replace(/^[`\"]|[`\"]$/g, '');
}

export function extractSignature(node: any): string {
  const bodyTypes = new Set(['block', 'field_declaration_list', 'interface_type']);
  const ranges: Array<{ start: number; end: number }> = [];

  function collect(current: any): void {
    if (!current?.isNamed) return;
    if (bodyTypes.has(current.type)) {
      ranges.push({ start: current.startIndex, end: current.endIndex });
      return;
    }
    for (const child of current.children ?? []) collect(child);
  }

  collect(node);
  ranges.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }

  let result = '';
  let lastIndex = node.startIndex;
  for (const range of merged) {
    result += node.text.slice(lastIndex - node.startIndex, range.start - node.startIndex);
    result += ' ... ';
    lastIndex = range.end;
  }
  result += node.text.slice(lastIndex - node.startIndex);
  return result.replace(/\s+/g, ' ').trim();
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
