import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { discoverActiveSlugs, readArtifacts, assertInside } from './artifacts.js';
import { detectWorkflow, deriveStateFields } from './workflowRules.js';
import type { ChangeWorkflowState, SyncResult, WorkflowIndex } from '../types.js';

async function atomicWriteJson(cwd: string, relPath: string, value: unknown): Promise<void> {
  const openspec = resolve(cwd, 'openspec');
  const dest = resolve(cwd, relPath);
  assertInside(openspec, dest);
  await mkdir(dirname(dest), { recursive: true });
  const temp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, dest);
}

export async function deriveChangeState(cwd: string, slug: string, generatedAt = new Date().toISOString()): Promise<ChangeWorkflowState> {
  const artifacts = await readArtifacts(cwd, slug, generatedAt);
  const workflow = detectWorkflow(artifacts);
  const fields = deriveStateFields(workflow, artifacts);
  return {
    schema_version: 1,
    kind: 'change-workflow-state',
    slug,
    location: 'active',
    workflow,
    ...fields,
    artifacts,
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

export async function syncActiveWorkflows(cwd: string, options: { slug?: string } = {}): Promise<SyncResult> {
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
