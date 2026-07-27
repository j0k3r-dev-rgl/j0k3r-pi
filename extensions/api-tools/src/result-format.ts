import { API_CONTRACT_VERSION, type ApiActionDocument, type ApiFailureEnvelope, type ApiLogicalRecord, type ApiToolName } from './types.js';

export function record(id: string, kind: string, text: string): ApiLogicalRecord {
  return { id, kind, text };
}

export function linesToRecords(prefix: string, kind: string, lines: string[]): ApiLogicalRecord[] {
  return lines.filter((line) => line.length > 0).map((line, index) => record(`${prefix}-${index + 1}`, kind, line));
}

export function frameText(prefix: string, kind: string, text: string, maxLinesPerRecord = 20): ApiLogicalRecord[] {
  const lines = text.split('\n');
  const records: ApiLogicalRecord[] = [];
  for (let index = 0; index < lines.length; index += maxLinesPerRecord) {
    records.push(record(`${prefix}-${records.length + 1}`, kind, lines.slice(index, index + maxLinesPerRecord).join('\n')));
  }
  return records.length > 0 ? records : [record(`${prefix}-1`, kind, '')];
}

export function successDocument(input: {
  tool: ApiToolName;
  action: string;
  identity?: string;
  records: ApiLogicalRecord[];
  total?: number;
  render?: ApiActionDocument['render'];
}): ApiActionDocument {
  return {
    contract_version: API_CONTRACT_VERSION,
    tool: input.tool,
    action: input.action,
    identity: input.identity,
    status: 'success',
    records: input.records,
    total: input.total,
    render: input.render,
  };
}

export function failureDocument(input: {
  tool: ApiToolName;
  action: string;
  identity?: string;
  failure: ApiFailureEnvelope;
  records?: ApiLogicalRecord[];
  render?: ApiActionDocument['render'];
}): ApiActionDocument {
  return {
    contract_version: API_CONTRACT_VERSION,
    tool: input.tool,
    action: input.action,
    identity: input.identity,
    status: 'failure',
    failure: input.failure,
    records: input.records ?? [record('failure-1', 'failure', input.failure.message)],
    total: input.records?.length ?? 1,
    render: input.render,
  };
}
