import { registerWebsearchTools } from './src/tools.js';

export default function websearchExtension(pi: any): void {
  registerWebsearchTools(pi);
}
