import type { ToolError } from '../shared.js';

export type SourceError<Source extends string = string> = {
  source: Source;
  error: ToolError;
};
