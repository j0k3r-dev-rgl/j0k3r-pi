import type { WorkflowStatus } from '../types.js';

const STATUS_VALUES = new Set(['READY', 'BLOCKED', 'FAILED', 'STALE', 'CONFLICT', 'UNKNOWN']);

export interface ParsedMarkdownStatus {
  status: WorkflowStatus;
  blockers: string[];
  warnings: string[];
  ids: string[];
  verification_result?: string;
}

export function parseMarkdownStatus(markdown: string): ParsedMarkdownStatus {
  const warnings: string[] = [];
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === '## Workflow Status');
  let status: WorkflowStatus = 'UNKNOWN';
  const blockers: string[] = [];

  if (headingIndex === -1) {
    warnings.push('Missing required Workflow Status block.');
    status = 'BLOCKED';
  } else {
    const blockLines: string[] = [];
    for (const line of lines.slice(headingIndex + 1)) {
      if (line.startsWith('#')) break;
      if (line.trim() === '' && blockLines.length > 0) break;
      blockLines.push(line);
    }
    const block = blockLines.join('\n');
    const parsedStatus = block.match(/^-\s*Status:\s*([A-Z]+)/m)?.[1];
    if (parsedStatus && STATUS_VALUES.has(parsedStatus)) {
      status = parsedStatus as WorkflowStatus;
    } else {
      status = 'BLOCKED';
      warnings.push('Workflow Status block has missing or invalid Status value.');
    }
    const blockerLine = block.match(/^-\s*Blockers:\s*(.+)$/m)?.[1]?.trim();
    if (!blockerLine || blockerLine.toLowerCase() !== 'none') {
      blockers.push(blockerLine || 'Workflow Status blockers are missing.');
    }
  }

  const ids = [...new Set(markdown.match(/\b(?:MINI|TASK|REQ|SCENARIO|DES|DELTA)-\d{3}\b/g) ?? [])];
  const verification_result = markdown.match(/^[-#\s]*Verification Result:?\s*(PASS|ISSUES_FOUND|FAIL|BLOCKED)/im)?.[1]?.toUpperCase();
  return { status, blockers, warnings, ids, verification_result };
}
