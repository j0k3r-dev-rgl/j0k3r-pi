import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, platform, arch, cpus, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { generateJavaSymbolCorpus, generateTypeScriptSymbolCorpus } from './typescript-symbol-corpus.js';
import { findSymbol } from '../distless/find-symbol-benchmark-bridge.js';
import { buildWorkspaceGraph } from '../distless/workspace-graph-benchmark-bridge.js';

const percentile = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * q) - 1)];
const median = (values) => percentile(values, 0.5);
const summarize = (values) => ({ median_ms: median(values), p95_ms: percentile(values, 0.95), samples_ms: values });
const normalize = (values) => values.map(({ symbol, kind, declaration_kind, owner, qualified_name, start_line, start_column }) => ({ symbol, kind, declaration_kind, owner, qualified_name, start_line, start_column }));

async function measure(root, query, repetitions) {
  const samples = [];
  let normalized;
  for (let index = 0; index < repetitions; index += 1) {
    const start = performance.now();
    const results = await findSymbol(root, query);
    samples.push(performance.now() - start);
    normalized ??= normalize(results);
    if (JSON.stringify(normalize(results)) !== JSON.stringify(normalized)) throw new Error('non-deterministic benchmark result');
  }
  return { samples, normalized, resultCount: normalized?.length ?? 0 };
}

async function readShardSizes(root) {
  const built = join(root, '.pi', 'workspace-code-graph', 'graphs');
  const state = await stat(built).catch(() => undefined);
  if (!state?.isDirectory()) return [];
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(built);
  const sizes = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const fileStat = await stat(join(built, file));
    sizes.push({ file, bytes: fileStat.size });
  }
  return sizes.sort((a, b) => a.file.localeCompare(b.file));
}

function getLanguageConfig(language, size) {
  if (language === 'java') {
    return {
      generator: generateJavaSymbolCorpus,
      query: { path: 'src', symbol: 'BenchmarkFile1', language: 'java', kind: 'class', search_mode: 'prefix' },
    };
  }
  return {
    generator: generateTypeScriptSymbolCorpus,
    query: { path: 'src', symbol: 'fn_1_', language: 'ts', search_mode: 'prefix' },
  };
}

async function main() {
  const size = process.argv.includes('--size') ? process.argv[process.argv.indexOf('--size') + 1] : 'medium';
  if (size !== 'medium' && size !== 'large') throw new Error('--size must be medium or large');
  const languageIndex = process.argv.indexOf('--language');
  const language = languageIndex >= 0 ? process.argv[languageIndex + 1] : 'ts';
  if (language !== 'ts' && language !== 'java') throw new Error('--language must be ts or java');
  const baselineIndex = process.argv.indexOf('--baseline-graph-p95');
  const baselineGraphP95 = baselineIndex >= 0 ? Number(process.argv[baselineIndex + 1]) : undefined;
  const root = await mkdtemp(join(tmpdir(), `pi-${language}-symbol-benchmark-${size}-`));
  try {
    const src = join(root, 'src');
    const { generator, query } = getLanguageConfig(language, size);
    const corpus = await generator(src, size);
    await mkdir(join(root, '.pi'), { recursive: true });

    await writeFile(join(root, '.pi/code-research.json'), '{"graph":{"enable":false}}\n');
    const directCold = await measure(root, query, 5);
    const directWarm = await measure(root, query, 20);

    await writeFile(join(root, '.pi/code-research.json'), '{"graph":{"enable":true}}\n');
    await buildWorkspaceGraph(root);
    const shardSizes = await readShardSizes(root);
    const graphCold = await measure(root, query, 5);
    const graphWarm = await measure(root, query, 20);
    if (JSON.stringify(graphWarm.normalized) !== JSON.stringify(directWarm.normalized)) throw new Error('direct/graph parity failed');

    const direct = { cold: summarize(directCold.samples), warm: summarize(directWarm.samples), result_count: directWarm.resultCount };
    const graph = { cold: summarize(graphCold.samples), warm: summarize(graphWarm.samples), result_count: graphWarm.resultCount };
    const maxShardBytes = Math.max(0, ...shardSizes.map((entry) => entry.bytes));
    const fasterThanDirect = graph.warm.p95_ms < direct.warm.p95_ms;
    const withinBaseline = baselineGraphP95 === undefined || graph.warm.p95_ms <= baselineGraphP95 * 1.1;
    const withinShardLimit = maxShardBytes <= 256 * 1024 * 1024;
    const report = {
      language,
      size,
      corpus,
      repetitions: { cold: 5, warm: 20 },
      environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, cpu_count: cpus().length, total_memory_bytes: totalmem() },
      direct,
      graph,
      shard_sizes: shardSizes,
      baseline_graph_p95_ms: baselineGraphP95 ?? null,
      acceptance: {
        parity: true,
        graph_faster_than_direct: fasterThanDirect,
        within_110_percent_of_baseline: baselineGraphP95 === undefined ? 'not-evaluated' : withinBaseline,
        shard_size_limit_ok: withinShardLimit,
      },
    };
    console.log(JSON.stringify(report, null, 2));
    if (!fasterThanDirect || !withinBaseline || !withinShardLimit) process.exitCode = 1;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
