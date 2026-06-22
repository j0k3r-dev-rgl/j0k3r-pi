import { registerApiTools, type RegisterApiToolsOptions } from './src/tools.js';

export { registerApiTools, type RegisterApiToolsOptions } from './src/tools.js';
export * from './src/types.js';

export default function apiToolsExtension(pi: any, options: RegisterApiToolsOptions = {}): Promise<void> {
  return registerApiTools(pi, options);
}
