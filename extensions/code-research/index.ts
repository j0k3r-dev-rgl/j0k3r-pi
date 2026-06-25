import { registerFindSymbolTool } from './src/tools/find-symbol.js';
import { registerFunctionCallTreeTool } from './src/tools/function-call-tree.js';

export { findSymbol } from './src/core/find-symbol-resolver.js';
export type { FindSymbolInput, SymbolLocation } from './src/types.js';

export default function codeResearchExtension(pi: any) {
  registerFindSymbolTool(pi);
  registerFunctionCallTreeTool(pi);
}
