import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);

async function main() {
  const payload = JSON.parse(process.argv[2] ?? '{}');
  const { buildSubprojectShard } = await jiti.import('./workspace-graph.ts');
  const { writeSubprojectGraphShard } = await jiti.import('./graph-persistence.ts');

  const shard = await buildSubprojectShard(
    payload.projectRoot,
    payload.subprojectRoot,
    payload.subprojectId,
    payload.subprojectRelativeRoot,
    payload.markers,
    payload.generation,
    payload.excludedNestedRoots ?? []
  );
  await writeSubprojectGraphShard(payload.projectRoot, payload.subprojectId, shard);

  process.stdout.write(JSON.stringify({
    id: payload.subprojectId,
    root: payload.subprojectRelativeRoot,
    status: shard.nodes.length > 0 ? 'fresh' : 'partial',
    languageHints: Array.from(new Set(shard.nodes.flatMap((node) => node.kind === 'file' ? [node.language] : []))),
    shardPath: `graphs/${payload.subprojectId}.json`,
    nodeCount: shard.nodes.length,
  }));
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
