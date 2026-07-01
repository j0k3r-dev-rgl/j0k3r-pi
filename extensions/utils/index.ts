import { registerUtilsTools } from './src/tools.js';

export { registerUtilsTools } from './src/tools.js';
export * from './src/markdown-to-audio.js';
export * from './src/screenshot.js';

export default function utilsExtension(pi: any): void {
  registerUtilsTools(pi);
}
