import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url);

async function main() {
  const ext = await jiti.import(join(__dirname, '../index.ts'));
  const defaultExport = (ext as any).default || ext;

  const tmpDir = await mkdtemp(join(tmpdir(), 'pi-find-symbol-manual-'));
  const file = join(tmpDir, 'greeter.ts');
  await writeFile(
    file,
    `export interface Greeter {\n  greet(name: string): string;\n}\n\nexport class ConsoleGreeter implements Greeter {\n  greet(name: string): string {\n    return \`Hello, \${name}\`;\n  }\n}\n`,
    'utf8'
  );

  let registeredTool: any;
  const pi = {
    registerTool(def: any) {
      registeredTool = def;
    },
  };

  defaultExport(pi);

  const result = await registeredTool.execute(
    'call-1',
    { path: tmpDir, symbol: 'Greeter', language: 'ts' },
    undefined,
    undefined,
    { cwd: tmpDir }
  );

  console.log('Result content:');
  console.log(result.content[0].text);

  await rm(tmpDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
