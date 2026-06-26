import { describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readGraphArtifactJson,
  writeGraphArtifactJson,
  writeSubprojectGraphShard,
  writeWorkspaceGraphManifest,
} from '../../src/core/graph-persistence.js';
import { WORKSPACE_GRAPH_SCHEMA_VERSION, createWorkspaceNodeId } from '../../src/core/graph-schema.js';

describe('workspace graph persistence', () => {
  it('rejects incompatible schema versions and corrupt json safely', async () => {
    const rootDir = join(tmpdir(), `pi-graph-persist-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(rootDir, { recursive: true });
    const graphDir = join(rootDir, '.pi/workspace-code-graph');
    await mkdir(graphDir, { recursive: true });

    const incompatiblePath = join(graphDir, 'graph-manifest.json');
    await writeFile(incompatiblePath, JSON.stringify({ schemaVersion: 999, createdBy: 'x' }), 'utf8');
    const incompatible = await readGraphArtifactJson(incompatiblePath);
    expect(incompatible.status).toBe('incompatible');

    const corruptPath = join(graphDir, 'workspace-state.json');
    await writeFile(corruptPath, '{bad json', 'utf8');
    const corrupt = await readGraphArtifactJson(corruptPath);
    expect(corrupt.status).toBe('errored');
  });

  it('writes manifest and shard artifacts atomically', async () => {
    const rootDir = join(tmpdir(), `pi-graph-persist-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(rootDir, { recursive: true });

    const manifestPath = await writeWorkspaceGraphManifest(rootDir, {
      schemaVersion: WORKSPACE_GRAPH_SCHEMA_VERSION,
      createdBy: 'pi-code-research-extension',
      projectRoot: rootDir,
      generation: 1,
      workspaceNodeId: createWorkspaceNodeId(rootDir),
      subprojects: [{ id: 'app', root: 'app', shardPath: 'graphs/app.json', generation: 1 }],
    });

    const shardPath = await writeSubprojectGraphShard(rootDir, 'app', {
      schemaVersion: WORKSPACE_GRAPH_SCHEMA_VERSION,
      createdBy: 'pi-code-research-extension',
      subprojectId: 'app',
      generation: 1,
      nodes: [],
      edges: [],
    });

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const shard = JSON.parse(await readFile(shardPath, 'utf8'));
    expect(manifest.subprojects[0].id).toBe('app');
    expect(shard.subprojectId).toBe('app');
  });

  it('replaces whole files during atomic writes', async () => {
    const rootDir = join(tmpdir(), `pi-graph-persist-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(rootDir, { recursive: true });
    const artifactPath = join(rootDir, '.pi/workspace-code-graph/workspace-state.json');

    await writeGraphArtifactJson(artifactPath, { schemaVersion: 1, createdBy: 'pi-code-research-extension', generation: 1 });
    await writeGraphArtifactJson(artifactPath, { schemaVersion: 1, createdBy: 'pi-code-research-extension', generation: 2, extra: true });

    const raw = await readFile(artifactPath, 'utf8');
    expect(raw).toContain('"generation": 2');
    expect(raw).toContain('"extra": true');
  });

  it('adds workspace graph directory to gitignore when project root is a git repo', async () => {
    const rootDir = join(tmpdir(), `pi-graph-persist-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(rootDir, '.git'), { recursive: true });
    await mkdir(join(rootDir, '.pi'), { recursive: true });
    await writeFile(join(rootDir, '.pi', 'code-research.json'), '{"graph":{"enable":true}}\n', 'utf8');
    await writeFile(join(rootDir, '.gitignore'), 'node_modules/\n', 'utf8');

    await writeWorkspaceGraphManifest(rootDir, {
      schemaVersion: WORKSPACE_GRAPH_SCHEMA_VERSION,
      createdBy: 'pi-code-research-extension',
      projectRoot: rootDir,
      generation: 1,
      workspaceNodeId: createWorkspaceNodeId(rootDir),
      subprojects: [],
    });

    const gitignore = await readFile(join(rootDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.pi/workspace-code-graph/');
    expect(gitignore.match(/\.pi\/workspace-code-graph\//g)?.length).toBe(1);
  });

  it('does not add workspace graph to gitignore when graph.addGitignore is explicitly false', async () => {
    const rootDir = join(tmpdir(), `pi-graph-persist-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(rootDir, '.git'), { recursive: true });
    await mkdir(join(rootDir, '.pi'), { recursive: true });
    await writeFile(join(rootDir, '.pi', 'code-research.json'), '{"graph":{"enable":true,"addGitignore":false}}\n', 'utf8');

    await writeWorkspaceGraphManifest(rootDir, {
      schemaVersion: WORKSPACE_GRAPH_SCHEMA_VERSION,
      createdBy: 'pi-code-research-extension',
      projectRoot: rootDir,
      generation: 1,
      workspaceNodeId: createWorkspaceNodeId(rootDir),
      subprojects: [],
    });

    const gitignoreCheck = await readGraphArtifactJson(join(rootDir, '.gitignore'));
    expect(gitignoreCheck.status).toBe('missing');
  });

  it('does not create gitignore entries when project root is not a git repo', async () => {
    const rootDir = join(tmpdir(), `pi-graph-persist-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(rootDir, { recursive: true });

    await writeWorkspaceGraphManifest(rootDir, {
      schemaVersion: WORKSPACE_GRAPH_SCHEMA_VERSION,
      createdBy: 'pi-code-research-extension',
      projectRoot: rootDir,
      generation: 1,
      workspaceNodeId: createWorkspaceNodeId(rootDir),
      subprojects: [],
    });

    const gitignoreCheck = await readGraphArtifactJson(join(rootDir, '.gitignore'));
    expect(gitignoreCheck.status).toBe('missing');
  });
});
