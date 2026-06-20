import type { ToolError } from './error.js';

export type SourceError<Source extends string = string> = {
  source: Source;
  error: ToolError;
};
