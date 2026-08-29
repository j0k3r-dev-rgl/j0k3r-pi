import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { discoverActiveSlugs, readArtifacts, assertInside, assertRealPathInside } from './artifacts.js';
import { parseExecutionScope } from './scope.js';
import { detectWorkflow, deriveStateFields } from './workflowRules.js';
import type { ChangeWorkflowState, SyncResult, WorkflowIndex } from '../types.js';

async function atomicWriteJson(cwd: string, relPath: string, value: unknown): Promise<void> {
  const openspec = resolve(cwd, 'openspec');
  const dest = resolve(cwd, relPath);
  assertInside(openspec, dest);
  await mkdir(dirname(dest), { recursive: true });
  await assertRealPathInside(openspec, dirname(dest));
  const temp = `${dest}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, dest);
}

const syncQueues = new Map<string, Promise<SyncResult>>();

export async function deriveChangeState(cwd: string, slug: string, generatedAt = new Date().toISOString()): Promise<ChangeWorkflowState> {
  const artifacts = await readArtifacts(cwd, slug, generatedAt);
  const workflow = detectWorkflow(artifacts);
  const fields = deriveStateFields(workflow, artifacts);
  let execution_scope;
  const authorityName = workflow === 'mini-sdd' ? 'mini-sdd.md' : workflow === 'formal-sdd' ? 'tasks.md' : undefined;
  if (authorityName && artifacts[authorityName]?.exists) {
    const authorityPath = join(cwd, 'openspec', 'changes', slug, authorityName);
    const markdown = await readFile(authorityPath, 'utf8');
    execution_scope = parseExecutionScope(markdown, join('openspec', 'changes', slug, authorityName).replaceAll('\\', '/'), cwd);
  } else if (workflow === 'conflict' || workflow === 'unknown') {
    execution_scope = {
      authority_artifact: 'unavailable',
      root: resolve(cwd),
      allowed_paths: [],
      writable_paths: [],
      allowed_bash: [],
      tmp_always_allowed: true as const,
      status: 'BLOCKED' as const,
      blockers: [workflow === 'conflict' ? 'Execution scope unavailable because workflow signatures conflict.' : 'Execution scope unavailable because workflow is unknown.'],
      warnings: [],
    };
  }
  const scopeBlockers = execution_scope?.blockers.map((blocker) => `execution_scope: ${blocker}`) ?? [];
  const scopeWarnings = execution_scope?.warnings.map((warning) => `execution_scope: ${warning}`) ?? [];
  return {
    schema_version: 1,
    kind: 'change-workflow-state',
    slug,
    location: 'active',
    workflow,
    ...fields,
    status: fields.status === 'READY' && execution_scope?.status === 'BLOCKED' ? 'BLOCKED' : fields.status,
    blockers: [...fields.blockers, ...scopeBlockers],
    warnings: [...fields.warnings, ...scopeWarnings],
    artifacts,
    execution_scope,
    derived_from: { source: 'markdown-artifacts', generated_at: generatedAt },
  };
}

export async function deriveActiveWorkflows(cwd: string, generatedAt = new Date().toISOString()): Promise<{ states: ChangeWorkflowState[]; index: WorkflowIndex; warnings: string[] }> {
  const slugs = await discoverActiveSlugs(cwd);
  const states = await Promise.all(slugs.map((slug) => deriveChangeState(cwd, slug, generatedAt)));
  const active = Object.fromEntries(states.map((state) => [state.slug, {
    workflow: state.workflow,
    phase: state.phase,
    status: state.status,
    freshness: state.freshness,
    path: join('openspec', 'changes', state.slug, 'workflow.json').replaceAll('\\', '/'),
  }]));
  const index: WorkflowIndex = { schema_version: 1, kind: 'workflow-index', generated_at: generatedAt, active, warnings: [] };
  return { states, index, warnings: [] };
}

async function performSyncActiveWorkflows(cwd: string, options: { slug?: string } = {}): Promise<SyncResult> {
  const generatedAt = new Date().toISOString();
  const all = await deriveActiveWorkflows(cwd, generatedAt);
  const selected = options.slug ? all.states.filter((state) => state.slug === options.slug) : all.states;
  const regenerated_files: string[] = [];
  for (const state of selected) {
    const rel = join('openspec', 'changes', state.slug, 'workflow.json').replaceAll('\\', '/');
    await atomicWriteJson(cwd, rel, state);
    regenerated_files.push(rel);
  }
  await atomicWriteJson(cwd, 'openspec/workflows.json', all.index);
  regenerated_files.push('openspec/workflows.json');
  return { ...all, regenerated_files };
}

export async function syncActiveWorkflows(cwd: string, options: { slug?: string } = {}): Promise<SyncResult> {
  const key = resolve(cwd);
  const previous = syncQueues.get(key) ?? Promise.resolve({ states: [], index: { schema_version: 1, kind: 'workflow-index', generated_at: '', active: {}, warnings: [] }, warnings: [], regenerated_files: [] });
  const next = previous.catch(() => undefined).then(() => performSyncActiveWorkflows(cwd, options));
  syncQueues.set(key, next);
  try {
    return await next;
  } finally {
    if (syncQueues.get(key) === next) syncQueues.delete(key);
  }
}
