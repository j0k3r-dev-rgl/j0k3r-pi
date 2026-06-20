import type { ToolError } from './error.js';

export type ToolContent = {
  type: 'text';
  text: string;
};

export type ToolResponse<T> =
  | { status: 'success'; data: T }
  | { status: 'failure'; error: ToolError };

export type PiToolResult<T> = {
  content: ToolContent[];
  details: ToolResponse<T>;
  isError?: true;
};
