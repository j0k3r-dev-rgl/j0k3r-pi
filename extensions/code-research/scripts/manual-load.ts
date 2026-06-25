import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url);

async function main() {
  const ext = await jiti.import(join(__dirname, '../index.ts'));
  const defaultExport = (ext as any).default || ext;

  const registeredTools: any[] = [];
  const pi = {
    registerTool(def: any) {
      registeredTools.push(def);
    },
  };

  defaultExport(pi);

  if (registeredTools.length !== 1) {
    throw new Error(`Expected 1 registered tool, got ${registeredTools.length}`);
  }

  const tool = registeredTools[0];
  if (tool.name !== 'find_symbol') {
    throw new Error(`Expected tool name 'find_symbol', got '${tool.name}'`);
  }

  console.log('Extension loaded successfully.');
  console.log('Tool:', tool.name);
  console.log('Description:', tool.description.slice(0, 80) + '...');
  console.log('Parameters:', Object.keys(tool.parameters?.properties ?? {}));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
