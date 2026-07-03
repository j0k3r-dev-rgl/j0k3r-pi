import { registerBrowserScreenshotTools } from './src/tools.js';

export { registerBrowserScreenshotTools } from './src/tools.js';
export * from './src/cdp.js';
export * from './src/config.js';
export * from './src/types.js';

export default function browserScreenshotExtension(pi: any): void {
  registerBrowserScreenshotTools(pi);
}
