import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context7OutputArtifact } from '../types.js';

export async function writeContext7OutputArtifact(content: string): Promise<Context7OutputArtifact> {
  const directory = await mkdtemp(join(tmpdir(), 'pi-context7-'));
  await chmod(directory, 0o700);
  const path = join(directory, 'full-output.txt');
  await writeFile(path, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return {
    kind: 'file',
    path,
    mediaType: 'text/plain',
    chars: content.length,
    instruction: `Use the read tool with path ${path} to inspect the complete redacted output.`,
  };
}

export function appendContext7ArtifactNotice(content: string, artifact: Context7OutputArtifact | undefined): string {
  if (!artifact) return content;
  return `${content}\n\n[Complete redacted output saved to: ${artifact.path}. Use the read tool to inspect it.]`;
}
