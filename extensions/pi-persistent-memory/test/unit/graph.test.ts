import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { withDatabase, openDatabase } from '../../src/storage/db.ts';
import { initSchema } from '../../src/storage/schema.ts';
import {
  activateSession,
  cleanupTerminalChildSession,
} from '../../src/storage/session-store.ts';
import {
  createMemory,
  replaceMemory,
  softDeleteMemory,
  restoreMemory,
} from '../../src/storage/memory-store.ts';
import { encodeScope } from '../../src/identity.ts';
import type { Scope } from '../../src/types.ts';
import {
  saveEntity,
  getEntity,
  listEntities,
  saveRelation,
  deleteRelation,
  saveAssociation,
  deleteAssociation,
  traverseGraph,
  canonicalizeName,
  normalizeFilePath,
} from '../../src/graph/index.ts';

function createTempDb(): { dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pi-memory-mini-004-test-'));
  const dbPath = join(dir, 'test.db');
  withDatabase(dbPath, (db) => {
    initSchema(db);
    activateSession(db, 'session-test', '["global"]', 'normal');
  });
  return {
    dbPath,
    cleanup: () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

test('M4-A01: Five entity types, six relation types, canonical keys, punctuation preserved', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    withDatabase(dbPath, (db) => {
      const projectScope: Scope = { kind: 'project', project: 'my-org/my-repo' };
      const globalScope: Scope = { kind: 'global' };

      // 1. Punctuation preserved for technology / concept
      const cpp = saveEntity(db, {
        type: 'technology',
        name: '  C++  ',
        scope: globalScope,
      }, { sessionId: 'session-test', explicitGlobalWrite: true });
      assert.equal(cpp.canonical_name, 'c++');
      assert.equal(cpp.display_name, 'C++');

      const csharp = saveEntity(db, {
        type: 'technology',
        name: 'C#',
        scope: globalScope,
      }, { sessionId: 'session-test', explicitGlobalWrite: true });
      assert.equal(csharp.canonical_name, 'c#');
      assert.notEqual(cpp.id, csharp.id);

      const nodejs = saveEntity(db, {
        type: 'technology',
        name: 'Node.js',
        scope: globalScope,
      }, { sessionId: 'session-test', explicitGlobalWrite: true });
      assert.equal(nodejs.canonical_name, 'node.js');

      // 2. Project entity preserves case and collapses whitespace
      const proj = saveEntity(db, {
        type: 'project',
        name: '  My-Org/My-Repo  ',
        scope: projectScope,
      }, { sessionId: 'session-test' });
      assert.equal(proj.canonical_name, 'My-Org/My-Repo');

      // 3. File entity: normalized project-relative lexical path, case preserved
      const file = saveEntity(db, {
        type: 'file',
        name: 'src/./utils/../index.ts',
        scope: projectScope,
      }, { sessionId: 'session-test' });
      assert.equal(file.canonical_name, 'src/index.ts');

      // Rejections for invalid file paths
      assert.throws(() => {
        normalizeFilePath('../secret.txt');
      }, /escape project root/);

      assert.throws(() => {
        normalizeFilePath('/etc/passwd');
      }, /Absolute paths are unsupported/);

      assert.throws(() => {
        normalizeFilePath('//network/share');
      }, /UNC paths/);

      assert.throws(() => {
        normalizeFilePath('C:\\windows\\system32');
      }, /Drive letter paths/);

      assert.throws(() => {
        normalizeFilePath('src/null\0byte.ts');
      }, /NUL bytes/);

      // 4. Memory entity: requires memoryId, canonical key is String(memoryId)
      const mem = createMemory(db, {
        scopeKey: encodeScope(projectScope),
        title: 'Project Setup Guide',
        content: 'Use bun or node to start.',
        type: 'guide',
        sessionId: 'session-test',
      });

      const memEntity = saveEntity(db, {
        type: 'memory',
        name: 'MemEntity',
        memoryId: mem.id,
        scope: projectScope,
      }, { sessionId: 'session-test' });
      assert.equal(memEntity.canonical_name, String(mem.id));

      // Rejections: memoryId for non-memory or missing memoryId for memory
      assert.throws(() => {
        saveEntity(db, {
          type: 'technology',
          name: 'Python',
          memoryId: 123,
          scope: globalScope,
        }, { sessionId: 'session-test', explicitGlobalWrite: true });
      }, /memoryId is only allowed for type 'memory'/);

      assert.throws(() => {
        saveEntity(db, {
          type: 'memory',
          name: 'MemWithoutId',
          scope: projectScope,
        }, { sessionId: 'session-test' });
      }, /Memory entity requires a positive integer memoryId/);

      // Invalid entity type
      assert.throws(() => {
        saveEntity(db, {
          type: 'unknown_kind' as any,
          name: 'Test',
          scope: projectScope,
        }, { sessionId: 'session-test' });
      }, /Invalid entity type/);
    });
  } finally {
    cleanup();
  }
});

test('M4-A01: Explicit aliases, collision conflict checks atomic in transaction, and rename rollback', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    withDatabase(dbPath, (db) => {
      const scope: Scope = { kind: 'global' };

      // Entity A: canonical "typescript", alias "ts"
      const entA = saveEntity(db, {
        type: 'technology',
        name: 'TypeScript',
        aliases: ['ts'],
        scope,
      }, { sessionId: 'session-test', explicitGlobalWrite: true });

      // Entity B: trying to use alias "typescript" (shadows existing canonical name) -> alias_conflict
      assert.throws(() => {
        saveEntity(db, {
          type: 'technology',
          name: 'TypedJS',
          aliases: ['typescript'],
          scope,
        }, { sessionId: 'session-test', explicitGlobalWrite: true });
      }, /alias_conflict/);

      // Entity C: trying to use alias "ts" (collides with entA's alias) -> alias_conflict
      assert.throws(() => {
        saveEntity(db, {
          type: 'technology',
          name: 'TreeSitter',
          aliases: ['ts'],
          scope,
        }, { sessionId: 'session-test', explicitGlobalWrite: true });
      }, /alias_conflict/);

      // Entity D: canonical name "ts" rename collision with entA's alias -> identity_conflict
      const entD = saveEntity(db, {
        type: 'technology',
        name: 'DataDog',
        scope,
      }, { sessionId: 'session-test', explicitGlobalWrite: true });

      assert.throws(() => {
        saveEntity(db, {
          id: entD.id,
          type: 'technology',
          name: 'TS',
          scope,
        }, { sessionId: 'session-test', explicitGlobalWrite: true });
      }, /identity_conflict/);

      // Alias cannot equal entity's own canonical name
      assert.throws(() => {
        saveEntity(db, {
          type: 'technology',
          name: 'React',
          aliases: ['react'],
          scope,
        }, { sessionId: 'session-test', explicitGlobalWrite: true });
      }, /alias_conflict/);

      // Save without ID: upsert by canonical name updates display name and preserves ID
      const entAUpsert = saveEntity(db, {
        type: 'technology',
        name: 'TypeScript',
        displayName: 'TypeScript Programming Language',
        scope,
      }, { sessionId: 'session-test', explicitGlobalWrite: true });
      assert.equal(entAUpsert.id, entA.id);

      // Save without ID: lookup by explicit unambiguous alias "ts" resolves to entA
      const entAAliasUpsert = saveEntity(db, {
        type: 'technology',
        name: 'ts',
        displayName: 'TS Lang',
        scope,
      }, { sessionId: 'session-test', explicitGlobalWrite: true });
      assert.equal(entAAliasUpsert.id, entA.id);

      // Rename entA to a name that collides with another entity fails atomically
      const entE = saveEntity(db, {
        type: 'technology',
        name: 'JavaScript',
        scope,
      }, { sessionId: 'session-test', explicitGlobalWrite: true });

      assert.throws(() => {
        saveEntity(db, {
          id: entA.id,
          type: 'technology',
          name: 'JavaScript',
          scope,
        }, { sessionId: 'session-test', explicitGlobalWrite: true });
      }, /target_conflict/);

      // Entity A remains untouched after failed rename
      const fetchedA = getEntity(db, { id: entA.id, scope, explicitGlobal: true });
      assert.ok(fetchedA);
      assert.equal(fetchedA.canonical_name, 'typescript');

      // Immutability: cannot change type, scope, or memoryId on update
      assert.throws(() => {
        saveEntity(db, {
          id: entA.id,
          type: 'concept',
          name: 'TypeScript',
          scope,
        }, { sessionId: 'session-test', explicitGlobalWrite: true });
      }, /Cannot change entity type/);

      assert.throws(() => {
        saveEntity(db, {
          id: entA.id,
          type: 'technology',
          name: 'TypeScript',
          scope: { kind: 'project', project: 'proj-x' },
        }, { sessionId: 'session-test' });
      }, /Cannot change entity scope/);
    });
  } finally {
    cleanup();
  }
});

test('M4-A02: Ownership, trust, and explicit global write separation', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    withDatabase(dbPath, (db) => {
      const projectScope: Scope = { kind: 'project', project: 'my-project' };
      const globalScope: Scope = { kind: 'global' };

      // Project entity cannot be global
      assert.throws(() => {
        saveEntity(db, {
          type: 'project',
          name: 'global-proj',
          scope: globalScope,
        }, { sessionId: 'session-test', explicitGlobalWrite: true });
      }, /project entity must be project-scoped/);

      // File entity cannot be global
      assert.throws(() => {
        saveEntity(db, {
          type: 'file',
          name: 'src/main.ts',
          scope: globalScope,
        }, { sessionId: 'session-test', explicitGlobalWrite: true });
      }, /file entity must be project-scoped/);

      // Global write requires explicitGlobalWrite: true
      assert.throws(() => {
        saveEntity(db, {
          type: 'technology',
          name: 'Rust',
          scope: globalScope,
        }, { sessionId: 'session-test' }); // omitted explicitGlobalWrite
      }, /requires explicit global write authorization/);

      // Global write succeeds with explicitGlobalWrite: true
      const rust = saveEntity(db, {
        type: 'technology',
        name: 'Rust',
        scope: globalScope,
      }, { sessionId: 'session-test', explicitGlobalWrite: true });
      assert.ok(rust.id);
    });
  } finally {
    cleanup();
  }
});

test('M4-A02: Parallel same-key entity and relation saves preserve uniqueness across workers', async () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    withDatabase(dbPath, (db) => {
      activateSession(db, 'session-worker-1', '["global"]', 'normal');
      activateSession(db, 'session-worker-2', '["global"]', 'normal');
    });

    // We launch two worker threads that concurrently try to save the exact same entity
    const workerCode = `
      import { parentPort, workerData } from 'node:worker_threads';
      import { openDatabase } from '${join(process.cwd(), 'src/storage/db.ts')}';
      import { saveEntity } from '${join(process.cwd(), 'src/graph/index.ts')}';

      const db = openDatabase(workerData.dbPath);
      try {
        const res = saveEntity(db, {
          type: 'technology',
          name: 'ConcurrentTech',
          scope: { kind: 'global' },
        }, { sessionId: workerData.sessionId, explicitGlobalWrite: true });
        parentPort.postMessage({ ok: true, id: res.id });
      } catch (err) {
        parentPort.postMessage({ ok: false, error: err.message });
      } finally {
        db.close();
      }
    `;

    const runWorker = (sessionId: string) => new Promise<{ ok: boolean; id?: string; error?: string }>((resolve, reject) => {
      const w = new Worker(workerCode, { eval: true, workerData: { dbPath, sessionId } });
      w.on('message', resolve);
      w.on('error', reject);
    });

    const [res1, res2] = await Promise.all([runWorker('session-worker-1'), runWorker('session-worker-2')]);
    assert.ok(res1.ok, `Worker 1 failed: ${res1.error}`);
    assert.ok(res2.ok, `Worker 2 failed: ${res2.error}`);

    // Both workers received the same entity ID!
    assert.equal(res1.id, res2.id);

    // In DB, exactly 1 row exists
    withDatabase(dbPath, (db) => {
      const count = db.prepare("SELECT COUNT(*) AS c FROM entities WHERE canonical_name = 'concurrenttech';").get() as { c: number };
      assert.equal(count.c, 1);
    });
  } finally {
    cleanup();
  }
});

test('M4-A03: Relations, memory links (associations), child session terminal retention, and memory replacement', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    const projectScope: Scope = { kind: 'project', project: 'my-project' };
    const globalScope: Scope = { kind: 'global' };

    withDatabase(dbPath, (db) => {
      // 1. Activate child session
      activateSession(db, 'child-session-1', encodeScope(projectScope), 'child');

      // 2. Create entities in child session
      const app = saveEntity(db, {
        type: 'project',
        name: 'my-project',
        scope: projectScope,
      }, { sessionId: 'child-session-1' });

      const react = saveEntity(db, {
        type: 'technology',
        name: 'React',
        scope: globalScope,
      }, { sessionId: 'child-session-1', explicitGlobalWrite: true });

      // 3. Create relation: project uses React
      const rel1 = saveRelation(db, {
        sourceEntityId: app.id,
        targetEntityId: react.id,
        relationType: 'uses',
        scope: projectScope,
      }, { sessionId: 'child-session-1' });

      assert.equal(rel1.existed, false);

      // Idempotent save with same natural key returns same relation ID
      const rel1Duplicate = saveRelation(db, {
        sourceEntityId: app.id,
        targetEntityId: react.id,
        relationType: 'uses',
        scope: projectScope,
      }, { sessionId: 'child-session-1' });

      assert.equal(rel1Duplicate.id, rel1.id);
      assert.equal(rel1Duplicate.existed, true);

      // Verify child session is retained upon terminal cleanup because it created entities/relations
      const cleanupResult = cleanupTerminalChildSession(db, 'child-session-1');
      assert.equal(cleanupResult.retained, true);

      // 4. Memory links (associations)
      const mem = createMemory(db, {
        scopeKey: encodeScope(projectScope),
        title: 'App Architecture',
        content: 'App uses React for UI.',
        type: 'note',
        sessionId: 'session-test',
      });

      const assoc = saveAssociation(db, {
        memoryId: mem.id,
        entityId: app.id,
        scope: projectScope,
      }, { sessionId: 'session-test' });

      assert.ok(assoc.id);
      assert.equal(assoc.existed, false);

      // Idempotent association save
      const assocDup = saveAssociation(db, {
        memoryId: mem.id,
        entityId: app.id,
        scope: projectScope,
      }, { sessionId: 'session-test' });
      assert.equal(assocDup.id, assoc.id);
      assert.equal(assocDup.existed, true);

      // 5. Memory text replacement preserves memory entity ID and links
      const memEntity = saveEntity(db, {
        type: 'memory',
        name: 'ArchMemory',
        memoryId: mem.id,
        scope: projectScope,
      }, { sessionId: 'session-test' });

      replaceMemory(db, mem.id, {
        scopeKey: encodeScope(projectScope),
        title: 'Updated App Architecture',
        content: 'App uses React and SQLite.',
        type: 'note',
        sessionId: 'session-test',
      });

      // Fetch memory entity: title and excerpt reflect the replaced memory content
      const fetchedMemEnt = getEntity(db, { id: memEntity.id, scope: projectScope });
      assert.ok(fetchedMemEnt);
      assert.equal(fetchedMemEnt.memory_summary?.title, 'Updated App Architecture');
      assert.ok(fetchedMemEnt.memory_summary?.excerpt.includes('React and SQLite'));

      // 6. Delete relation removes only the edge, endpoints survive
      deleteRelation(db, { id: rel1.id, scope: projectScope });
      const edgeCheck = db.prepare('SELECT COUNT(*) AS c FROM relations WHERE id = ?;').get(rel1.id) as { c: number };
      assert.equal(edgeCheck.c, 0);

      // Endpoints still exist
      assert.ok(getEntity(db, { id: app.id, scope: projectScope }));
      assert.ok(getEntity(db, { id: react.id, scope: projectScope }));
    });
  } finally {
    cleanup();
  }
});

test('M4-A04: Scope isolation and starvation prevention (>20 foreign neighbors on shared node)', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    withDatabase(dbPath, (db) => {
      const projA: Scope = { kind: 'project', project: 'project-a' };
      const projB: Scope = { kind: 'project', project: 'project-b' };
      const globalScope: Scope = { kind: 'global' };

      // Shared global node: React
      const react = saveEntity(db, {
        type: 'technology',
        name: 'React',
        scope: globalScope,
      }, { sessionId: 'session-test', explicitGlobalWrite: true });

      // Create 25 foreign-project relations incident to React
      for (let i = 1; i <= 25; i++) {
        const foreignNode = saveEntity(db, {
          type: 'concept',
          name: `foreign-feature-${i}`,
          scope: projB,
        }, { sessionId: 'session-test' });

        saveRelation(db, {
          sourceEntityId: foreignNode.id,
          targetEntityId: react.id,
          relationType: 'uses',
          scope: projB,
        }, { sessionId: 'session-test' });
      }

      // Create 3 current-project (projA) relations incident to React
      const projANodes: string[] = [];
      for (let i = 1; i <= 3; i++) {
        const aNode = saveEntity(db, {
          type: 'concept',
          name: `project-a-module-${i}`,
          scope: projA,
        }, { sessionId: 'session-test' });
        projANodes.push(aNode.id);

        saveRelation(db, {
          sourceEntityId: aNode.id,
          targetEntityId: react.id,
          relationType: 'uses',
          scope: projA,
        }, { sessionId: 'session-test' });
      }

      // Traverse graph starting from React in Project A scope
      const result = traverseGraph(db, {
        rootEntityId: react.id,
        scope: projA,
      });

      // Verification:
      // 1. None of the 25 foreign nodes or foreign edges appear
      assert.equal(result.nodes.some(n => n.canonical_name.includes('foreign')), false);
      assert.equal(result.edges.some(e => e.scope.kind === 'project' && e.scope.project === 'project-b'), false);

      // 2. All 3 current-project nodes ARE returned, proving no starvation!
      for (const aId of projANodes) {
        assert.ok(result.nodes.some(n => n.id === aId), `Expected node ${aId} to be returned in Project A traversal`);
      }

      // Total nodes = 1 (root React) + 3 (projA modules) = 4
      assert.equal(result.nodes.length, 4);
      assert.equal(result.edges.length, 3);
      assert.equal(result.limits.entity_limit, false);
      assert.equal(result.limits.depth_limit, false);
    });
  } finally {
    cleanup();
  }
});

test('M4-A05: Soft-deleted memory hiding across get, list, BFS, and restore re-enables visibility', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    withDatabase(dbPath, (db) => {
      const scope: Scope = { kind: 'project', project: 'my-project' };

      const mem = createMemory(db, {
        scopeKey: encodeScope(scope),
        title: 'Secret Blueprint',
        content: 'Confidential details here.',
        type: 'blueprint',
        sessionId: 'session-test',
      });

      const memEnt = saveEntity(db, {
        type: 'memory',
        name: 'BlueprintEntity',
        memoryId: mem.id,
        scope,
      }, { sessionId: 'session-test' });

      const concept = saveEntity(db, {
        type: 'concept',
        name: 'DesignSystem',
        scope,
      }, { sessionId: 'session-test' });

      const rel = saveRelation(db, {
        sourceEntityId: memEnt.id,
        targetEntityId: concept.id,
        relationType: 'about',
        scope,
      }, { sessionId: 'session-test' });

      // Before soft delete: memory entity is visible in get, list, and BFS
      assert.ok(getEntity(db, { id: memEnt.id, scope }));
      const listBefore = listEntities(db, { scope });
      assert.ok(listBefore.entities.some(e => e.id === memEnt.id));

      const bfsBefore = traverseGraph(db, { rootEntityId: concept.id, scope });
      assert.ok(bfsBefore.nodes.some(n => n.id === memEnt.id));
      assert.ok(bfsBefore.edges.some(e => e.id === rel.id));

      // 1. Soft-delete memory
      softDeleteMemory(db, mem.id, encodeScope(scope));

      // getEntity returns null
      assert.equal(getEntity(db, { id: memEnt.id, scope }), null);

      // listEntities excludes the memory entity
      const listAfter = listEntities(db, { scope });
      assert.equal(listAfter.entities.some(e => e.id === memEnt.id), false);

      // traverseGraph starting at soft-deleted memory throws not_found
      assert.throws(() => {
        traverseGraph(db, { rootEntityId: memEnt.id, scope });
      }, /references a deleted memory/);

      // traverseGraph starting from concept does NOT visit the soft-deleted memory entity or its incident edge
      const bfsAfter = traverseGraph(db, { rootEntityId: concept.id, scope });
      assert.equal(bfsAfter.nodes.some(n => n.id === memEnt.id), false);
      assert.equal(bfsAfter.edges.some(e => e.id === rel.id), false);

      // Saving relation to soft-deleted memory entity throws target_deleted
      assert.throws(() => {
        saveRelation(db, {
          sourceEntityId: concept.id,
          targetEntityId: memEnt.id,
          relationType: 'references',
          scope,
        }, { sessionId: 'session-test' });
      }, /target_deleted/);

      // 2. Restore memory
      restoreMemory(db, mem.id, encodeScope(scope));

      // Immediately visible again without duplicates
      assert.ok(getEntity(db, { id: memEnt.id, scope }));
      const listRestored = listEntities(db, { scope });
      assert.ok(listRestored.entities.some(e => e.id === memEnt.id));

      const bfsRestored = traverseGraph(db, { rootEntityId: concept.id, scope });
      assert.ok(bfsRestored.nodes.some(n => n.id === memEnt.id));
      assert.ok(bfsRestored.edges.some(e => e.id === rel.id));
    });
  } finally {
    cleanup();
  }
});

test('M4-A06: Bidirectional BFS (incoming and outgoing), preserved stored direction, 2 hops and 20 entities boundary', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    withDatabase(dbPath, (db) => {
      const scope: Scope = { kind: 'project', project: 'nav-test' };

      // Root node: B
      const nodeB = saveEntity(db, { type: 'concept', name: 'NodeB', scope }, { sessionId: 'session-test' });

      // Outgoing edge: B -> uses -> C
      const nodeC = saveEntity(db, { type: 'concept', name: 'NodeC', scope }, { sessionId: 'session-test' });
      saveRelation(db, {
        sourceEntityId: nodeB.id,
        targetEntityId: nodeC.id,
        relationType: 'uses',
        scope,
      }, { sessionId: 'session-test' });

      // Incoming edge: A -> references -> B
      const nodeA = saveEntity(db, { type: 'concept', name: 'NodeA', scope }, { sessionId: 'session-test' });
      saveRelation(db, {
        sourceEntityId: nodeA.id,
        targetEntityId: nodeB.id,
        relationType: 'references',
        scope,
      }, { sessionId: 'session-test' });

      // Traversal starting from B
      const result = traverseGraph(db, { rootEntityId: nodeB.id, scope });

      // Visited nodes: B (depth 0), A (depth 1), C (depth 1)
      assert.equal(result.nodes.length, 3);
      assert.ok(result.nodes.some(n => n.id === nodeA.id));
      assert.ok(result.nodes.some(n => n.id === nodeB.id));
      assert.ok(result.nodes.some(n => n.id === nodeC.id));

      // Check edge directions and stored direction preservation
      const edgeBC = result.edges.find(e => e.target === nodeC.id);
      assert.ok(edgeBC);
      assert.equal(edgeBC.source, nodeB.id);
      assert.equal(edgeBC.direction, 'outgoing');

      const edgeAB = result.edges.find(e => e.source === nodeA.id);
      assert.ok(edgeAB);
      assert.equal(edgeAB.target, nodeB.id);
      assert.equal(edgeAB.direction, 'incoming'); // Navigated in reverse, but stored source=A, target=B is preserved!

      // 2 hops boundary test: B -> C -> D -> E
      const nodeD = saveEntity(db, { type: 'concept', name: 'NodeD', scope }, { sessionId: 'session-test' });
      saveRelation(db, {
        sourceEntityId: nodeC.id,
        targetEntityId: nodeD.id,
        relationType: 'uses',
        scope,
      }, { sessionId: 'session-test' });

      const nodeE = saveEntity(db, { type: 'concept', name: 'NodeE', scope }, { sessionId: 'session-test' });
      saveRelation(db, {
        sourceEntityId: nodeD.id,
        targetEntityId: nodeE.id,
        relationType: 'uses',
        scope,
      }, { sessionId: 'session-test' });

      const hopResult = traverseGraph(db, { rootEntityId: nodeB.id, scope, maxHops: 2 });
      // Node D is at depth 2 (B -> C -> D), so D is visited
      assert.ok(hopResult.nodes.some(n => n.id === nodeD.id));
      // Node E is at depth 3, so E is NOT visited
      assert.equal(hopResult.nodes.some(n => n.id === nodeE.id), false);
      assert.equal(hopResult.limits.depth_limit, true);
      assert.equal(hopResult.limits.has_more, true);

      // 20 entities boundary test & 15 incident relations cap probe (verify.md Defect 2)
      const capHub15 = saveEntity(db, { type: 'concept', name: 'CapHub15', scope }, { sessionId: 'session-test' });
      for (let i = 1; i <= 15; i++) {
        const leaf = saveEntity(db, { type: 'concept', name: `CapLeaf-${i}`, scope }, { sessionId: 'session-test' });
        saveRelation(db, {
          sourceEntityId: capHub15.id,
          targetEntityId: leaf.id,
          relationType: 'references',
          scope,
        }, { sessionId: 'session-test' });
      }

      // Max entities limit 10 on 15 incident relations: must NOT leak frontier edges or inflate distinct entity IDs beyond cap
      const capResult15 = traverseGraph(db, { rootEntityId: capHub15.id, scope, maxEntities: 10 });
      assert.equal(capResult15.nodes.length, 10);
      assert.equal(capResult15.edges.length, 9, 'Must only admit edges between admitted nodes, not frontier edges');
      const distinctCap15Ids = new Set([
        ...capResult15.nodes.map(n => n.id),
        ...capResult15.edges.map(e => e.source),
        ...capResult15.edges.map(e => e.target),
      ]);
      assert.equal(distinctCap15Ids.size, 10, 'Union of nodes and edge endpoints must not exceed maxEntities (10)');

      const hub = saveEntity(db, { type: 'concept', name: 'BigHub', scope }, { sessionId: 'session-test' });
      for (let i = 1; i <= 25; i++) {
        const leaf = saveEntity(db, { type: 'concept', name: `Leaf-${i}`, scope }, { sessionId: 'session-test' });
        saveRelation(db, {
          sourceEntityId: hub.id,
          targetEntityId: leaf.id,
          relationType: 'references',
          scope,
        }, { sessionId: 'session-test' });
      }

      // Max entities limit 10: must NOT leak frontier edges or inflate distinct entity IDs beyond cap
      const hubResult10 = traverseGraph(db, { rootEntityId: hub.id, scope, maxEntities: 10 });
      assert.equal(hubResult10.nodes.length, 10);
      // Edges must only connect admitted nodes (root + 9 admitted leaves = 9 edges)
      assert.equal(hubResult10.edges.length, 9);
      assert.ok(
        hubResult10.edges.every(e =>
          hubResult10.nodes.some(n => n.id === e.source) &&
          hubResult10.nodes.some(n => n.id === e.target)
        ),
        'All emitted edges must have both endpoints admitted in nodes'
      );
      const distinctEntityIds = new Set([
        ...hubResult10.nodes.map(n => n.id),
        ...hubResult10.edges.map(e => e.source),
        ...hubResult10.edges.map(e => e.target),
      ]);
      assert.equal(distinctEntityIds.size, 10, 'Union of nodes and edge endpoints must not exceed maxEntities');
      assert.equal(hubResult10.limits.entity_limit, true);
      assert.equal(hubResult10.limits.byte_limit, false, 'byte_limit must be false when payload fits within budget');
      assert.equal(hubResult10.limits.has_more, true);
      assert.equal(hubResult10.limits.guidance, 'Recommend a new focused root query');

      // Max entities 20 bound
      const hubResult20 = traverseGraph(db, { rootEntityId: hub.id, scope, maxEntities: 20 });
      assert.ok(hubResult20.nodes.length <= 20);
      assert.equal(hubResult20.edges.length, hubResult20.nodes.length - 1);
      assert.ok(
        hubResult20.edges.every(e =>
          hubResult20.nodes.some(n => n.id === e.source) &&
          hubResult20.nodes.some(n => n.id === e.target)
        )
      );
      assert.equal(hubResult20.limits.entity_limit, true);
      assert.ok(Buffer.byteLength(JSON.stringify(hubResult20), 'utf8') <= 6144);
      assert.equal(hubResult20.limits.has_more, true);
      assert.equal(hubResult20.limits.guidance, 'Recommend a new focused root query');

      // High-degree root fixture (100 incident edges): bounded SQL keyset reads (no unbounded stmt.all)
      const busyHub = saveEntity(db, { type: 'concept', name: 'BusyHub', scope }, { sessionId: 'session-test' });
      for (let i = 1; i <= 100; i++) {
        const leaf = saveEntity(db, { type: 'concept', name: `BusyLeaf-${i}`, scope }, { sessionId: 'session-test' });
        saveRelation(db, {
          sourceEntityId: busyHub.id,
          targetEntityId: leaf.id,
          relationType: 'references',
          scope,
        }, { sessionId: 'session-test' });
      }

      // Intercept db.prepare to spy on SQL query and count fetched rows
      const origPrepare = db.prepare.bind(db);
      let capturedSql = '';
      let totalFetchedRelationRows = 0;
      db.prepare = ((sql: string) => {
        const stmt = origPrepare(sql);
        if (sql.includes('FROM relations r')) {
          capturedSql = sql;
          const origAll = stmt.all.bind(stmt);
          stmt.all = ((...args: any[]) => {
            const rows = origAll(...args) as any[];
            totalFetchedRelationRows += rows.length;
            return rows;
          }) as any;
        }
        return stmt;
      }) as any;

      try {
        const busyResult = traverseGraph(db, { rootEntityId: busyHub.id, scope, maxEntities: 10 });
        assert.equal(busyResult.nodes.length, 10);
        assert.equal(busyResult.edges.length, 9);
        assert.match(capturedSql, /LIMIT/i, 'incidentSql must contain LIMIT clause');
        assert.match(capturedSql, /r\.id\s*>/i, 'incidentSql must contain keyset pagination condition');
        assert.ok(
          totalFetchedRelationRows <= 25,
          `Expected <= 25 fetched relation rows for keyset page, got ${totalFetchedRelationRows}`
        );
      } finally {
        db.prepare = origPrepare;
      }

      // 1. Supported service fixture: maximum six directed relation types between root and neighbor
      const sixRoot = saveEntity(db, { type: 'concept', name: 'SixRoot', scope }, { sessionId: 'session-test' });
      const sixNeighbor = saveEntity(db, { type: 'concept', name: 'SixNeighbor', scope }, { sessionId: 'session-test' });
      const relationTypes: Array<'uses' | 'about' | 'references' | 'depends_on' | 'related_to' | 'contradicts'> = [
        'uses', 'about', 'references', 'depends_on', 'related_to', 'contradicts',
      ];
      for (const rType of relationTypes) {
        saveRelation(db, {
          sourceEntityId: sixRoot.id,
          targetEntityId: sixNeighbor.id,
          relationType: rType,
          scope,
        }, { sessionId: 'session-test' });
      }

      const sixResult = traverseGraph(db, { rootEntityId: sixRoot.id, scope });
      assert.equal(sixResult.nodes.length, 2, 'Both root and neighbor must be returned for six-relation fixture');
      assert.ok(sixResult.nodes.some(n => n.id === sixRoot.id));
      assert.ok(sixResult.nodes.some(n => n.id === sixNeighbor.id));
      assert.equal(sixResult.edges.length, 6, 'All six directed relation types must be admitted');
      assert.equal(sixResult.limits.byte_limit, false, 'No false byte_limit flag on small graph with 6 relations');
      assert.equal(sixResult.limits.has_more, false);
      const sixBytes = Buffer.byteLength(JSON.stringify(sixResult), 'utf8');
      assert.ok(sixBytes <= 6144, `Six-relation envelope (${sixBytes} bytes) must be <= 6144`);

      // 2. Parallel edges comparison (100 rows vs 1,000 legacy directly-seeded duplicate rows)
      // 100 parallel rows fixture
      const root100 = saveEntity(db, { type: 'concept', name: 'Root100', scope }, { sessionId: 'session-test' });
      const neighbor100 = saveEntity(db, { type: 'concept', name: 'Neighbor100', scope }, { sessionId: 'session-test' });
      const insertRelStmt = db.prepare(`
        INSERT INTO relations (id, source_entity_id, target_entity_id, relation_type, scope_key, session_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?);
      `);
      for (let i = 1; i <= 100; i++) {
        insertRelStmt.run(
          `rel-100-${String(i).padStart(5, '0')}`,
          root100.id,
          neighbor100.id,
          'references',
          '["project","nav-test"]',
          'session-test',
          '2026-10-06T00:00:00.000Z',
        );
      }

      let queries100 = 0;
      let rows100 = 0;
      const prepareFor100 = db.prepare.bind(db);
      db.prepare = ((sql: string) => {
        const stmt = prepareFor100(sql);
        if (sql.includes('FROM relations r')) {
          const origAll = stmt.all.bind(stmt);
          stmt.all = ((...args: any[]) => {
            queries100++;
            const rows = origAll(...args) as any[];
            rows100 += rows.length;
            return rows;
          }) as any;
        }
        return stmt;
      }) as any;

      let res100: ReturnType<typeof traverseGraph>;
      try {
        res100 = traverseGraph(db, { rootEntityId: root100.id, scope });
      } finally {
        db.prepare = prepareFor100;
      }

      assert.equal(res100.nodes.length, 2, 'Root and neighbor must BOTH be retained for 100 parallel rows');
      assert.ok(res100.nodes.some(n => n.id === root100.id), 'Root must be retained in 100 parallel rows');
      assert.ok(res100.nodes.some(n => n.id === neighbor100.id), 'Admitted neighbor must NOT be dropped in 100 parallel rows');
      assert.ok(res100.edges.length > 0, 'Admitted edges must not be zero in 100 parallel rows');
      assert.equal(res100.limits.byte_limit, true, 'byte_limit must be true when edge overflow occurs');
      assert.equal(res100.limits.has_more, true);
      assert.equal(res100.limits.guidance, 'Recommend a new focused root query');
      const bytes100 = Buffer.byteLength(JSON.stringify(res100), 'utf8');
      assert.ok(bytes100 <= 6144, `res100 envelope (${bytes100} bytes) must be <= 6144`);
      assert.ok(queries100 <= 10, `SQL queries for 100 rows must be bounded (got ${queries100})`);
      assert.ok(rows100 <= 100, `Fetched rows for 100 rows must be bounded (got ${rows100})`);

      // 1,000 parallel rows fixture
      const root1000 = saveEntity(db, { type: 'concept', name: 'Root1000', scope }, { sessionId: 'session-test' });
      const neighbor1000 = saveEntity(db, { type: 'concept', name: 'Neighbor1000', scope }, { sessionId: 'session-test' });
      for (let i = 1; i <= 1000; i++) {
        insertRelStmt.run(
          `rel-1000-${String(i).padStart(5, '0')}`,
          root1000.id,
          neighbor1000.id,
          'references',
          '["project","nav-test"]',
          'session-test',
          '2026-10-06T00:00:00.000Z',
        );
      }

      let queries1000 = 0;
      let rows1000 = 0;
      const prepareFor1000 = db.prepare.bind(db);
      db.prepare = ((sql: string) => {
        const stmt = prepareFor1000(sql);
        if (sql.includes('FROM relations r')) {
          const origAll = stmt.all.bind(stmt);
          stmt.all = ((...args: any[]) => {
            queries1000++;
            const rows = origAll(...args) as any[];
            rows1000 += rows.length;
            return rows;
          }) as any;
        }
        return stmt;
      }) as any;

      let res1000: ReturnType<typeof traverseGraph>;
      try {
        res1000 = traverseGraph(db, { rootEntityId: root1000.id, scope });
      } finally {
        db.prepare = prepareFor1000;
      }

      assert.equal(res1000.nodes.length, 2, 'Root and neighbor must BOTH be retained for 1,000 parallel rows');
      assert.ok(res1000.nodes.some(n => n.id === root1000.id), 'Root must be retained in 1,000 parallel rows');
      assert.ok(res1000.nodes.some(n => n.id === neighbor1000.id), 'Admitted neighbor must NOT be dropped in 1,000 parallel rows');
      assert.ok(res1000.edges.length > 0, 'Admitted edges must not be zero in 1,000 parallel rows');
      assert.equal(res1000.limits.byte_limit, true, 'byte_limit must be true when edge overflow occurs');
      assert.equal(res1000.limits.has_more, true);
      assert.equal(res1000.limits.guidance, 'Recommend a new focused root query');
      const bytes1000 = Buffer.byteLength(JSON.stringify(res1000), 'utf8');
      assert.ok(bytes1000 <= 6144, `res1000 envelope (${bytes1000} bytes) must be <= 6144`);
      assert.ok(queries1000 <= 10, `SQL queries for 1,000 rows must be bounded (got ${queries1000})`);
      assert.ok(rows1000 <= 100, `Fetched rows for 1,000 rows must be bounded (got ${rows1000})`);

      // Same-order bounded growth assertion: 100 rows vs 1000 rows
      assert.ok(
        queries1000 <= queries100 + 4,
        `Queries for 1000 rows (${queries1000}) must have same-order bounded growth compared to 100 rows (${queries100})`
      );
      assert.ok(
        rows1000 <= rows100 + 50,
        `Fetched rows for 1000 rows (${rows1000}) must have same-order bounded growth compared to 100 rows (${rows100})`
      );

      // 3. High-degree self-edges fixture (1,000 parallel self-edges)
      const rootSelf = saveEntity(db, { type: 'concept', name: 'RootSelf', scope }, { sessionId: 'session-test' });
      for (let i = 1; i <= 1000; i++) {
        insertRelStmt.run(
          `self-1000-${String(i).padStart(5, '0')}`,
          rootSelf.id,
          rootSelf.id,
          'related_to',
          '["project","nav-test"]',
          'session-test',
          '2026-10-06T00:00:00.000Z',
        );
      }

      let queriesSelf = 0;
      let rowsSelf = 0;
      const prepareForSelf = db.prepare.bind(db);
      db.prepare = ((sql: string) => {
        const stmt = prepareForSelf(sql);
        if (sql.includes('FROM relations r')) {
          const origAll = stmt.all.bind(stmt);
          stmt.all = ((...args: any[]) => {
            queriesSelf++;
            const rows = origAll(...args) as any[];
            rowsSelf += rows.length;
            return rows;
          }) as any;
        }
        return stmt;
      }) as any;

      let resSelf: ReturnType<typeof traverseGraph>;
      try {
        resSelf = traverseGraph(db, { rootEntityId: rootSelf.id, scope });
      } finally {
        db.prepare = prepareForSelf;
      }

      assert.equal(resSelf.nodes.length, 1, 'Root must be retained in self-edges fixture');
      assert.ok(resSelf.edges.length > 0, 'Admitted self-edges must not be zero');
      assert.ok(
        resSelf.edges.every(e => e.source === rootSelf.id && e.target === rootSelf.id),
        'All admitted edges must have root as both source and target'
      );
      assert.equal(resSelf.limits.byte_limit, true);
      const bytesSelf = Buffer.byteLength(JSON.stringify(resSelf), 'utf8');
      assert.ok(bytesSelf <= 6144, `resSelf envelope (${bytesSelf} bytes) must be <= 6144`);
      assert.ok(queriesSelf <= 10, `SQL queries for 1000 self-edges must be bounded (got ${queriesSelf})`);
      assert.ok(rowsSelf <= 100, `Fetched rows for 1000 self-edges must be bounded (got ${rowsSelf})`);
    });
  } finally {
    cleanup();
  }
});

test('M4-A07: Envelopes <= 6KiB, Unicode safety, and entity list cursor expiration', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    withDatabase(dbPath, (db) => {
      const scope: Scope = { kind: 'project', project: 'budget-test' };

      // Create entities with large Unicode display names
      for (let i = 1; i <= 15; i++) {
        saveEntity(db, {
          type: 'concept',
          name: `UnicodeConcept-${i}`,
          displayName: `🚀 Concept with giant description and emojis 🌟 #${i} `.repeat(5),
          aliases: [`alias-${i}-α`, `alias-${i}-β`],
          scope,
        }, { sessionId: 'session-test' });
      }

      // Test List Entities page 1
      const page1 = listEntities(db, { scope, limit: 5 });
      assert.equal(page1.entities.length, 5);
      assert.ok(page1.has_more);
      assert.ok(page1.next_cursor);

      const page1Bytes = Buffer.byteLength(JSON.stringify(page1), 'utf8');
      assert.ok(page1Bytes <= 6144, `page1Bytes = ${page1Bytes} should be <= 6144`);

      // Test List Entities page 2 with cursor
      const page2 = listEntities(db, { scope, cursor: page1.next_cursor! });
      assert.equal(page2.entities.length > 0, true);
      assert.notEqual(page2.entities[0].id, page1.entities[0].id);

      const page2Bytes = Buffer.byteLength(JSON.stringify(page2), 'utf8');
      assert.ok(page2Bytes <= 6144, `page2Bytes = ${page2Bytes} should be <= 6144`);

      // Modify dataset: add a new entity in scope
      saveEntity(db, {
        type: 'concept',
        name: 'NewInterferingConcept',
        scope,
      }, { sessionId: 'session-test' });

      // Cursor from page 1 must now throw cursor_expired!
      assert.throws(() => {
        listEntities(db, { scope, cursor: page1.next_cursor! });
      }, /cursor_expired/);

      // Wrong scope on cursor must throw cursor_scope_mismatch
      assert.throws(() => {
        listEntities(db, {
          scope: { kind: 'project', project: 'different-project' },
          cursor: page1.next_cursor!,
        });
      }, /cursor_scope_mismatch/);

      // Giant name (10,000 chars): saveEntity write confirmation must be <= 6144 bytes
      const giantName = 'GiantConcept-'.padEnd(10000, 'X');
      const giantSave = saveEntity(db, {
        type: 'concept',
        name: giantName,
        displayName: 'Giant Display '.padEnd(10000, 'Y'),
        scope,
      }, { sessionId: 'session-test' });
      const giantSaveBytes = Buffer.byteLength(JSON.stringify(giantSave), 'utf8');
      assert.ok(giantSaveBytes <= 6144, `saveEntity confirmation (${giantSaveBytes} bytes) must be <= 6144`);

      // Giant name getEntity: response must be <= 6144 bytes
      const giantGet = getEntity(db, { id: giantSave.id, scope });
      assert.ok(giantGet);
      const giantGetBytes = Buffer.byteLength(JSON.stringify(giantGet), 'utf8');
      assert.ok(giantGetBytes <= 6144, `getEntity for 10k name (${giantGetBytes} bytes) must be <= 6144`);

      // Giant aliases (200 items): getEntity must be <= 6144 bytes and report aliases_truncated
      const manyAliases = Array.from({ length: 200 }, (_, i) => `alias-${i}-` + 'z'.repeat(40));
      const aliasEnt = saveEntity(db, {
        type: 'concept',
        name: 'ManyAliasesConcept',
        aliases: manyAliases,
        scope,
      }, { sessionId: 'session-test' });
      const aliasGet = getEntity(db, { id: aliasEnt.id, scope });
      assert.ok(aliasGet);
      const aliasGetBytes = Buffer.byteLength(JSON.stringify(aliasGet), 'utf8');
      assert.ok(aliasGetBytes <= 6144, `getEntity for 200 aliases (${aliasGetBytes} bytes) must be <= 6144`);
      assert.equal(aliasGet.aliases_truncated, true, 'aliases_truncated must be true when aliases list is abbreviated');

      // Giant root traversal: envelope must be <= 6144 bytes
      const giantTraverse = traverseGraph(db, { rootEntityId: giantSave.id, scope });
      const giantTraverseBytes = Buffer.byteLength(JSON.stringify(giantTraverse), 'utf8');
      assert.ok(giantTraverseBytes <= 6144, `traverseGraph envelope for giant root (${giantTraverseBytes} bytes) must be <= 6144`);
    });
  } finally {
    cleanup();
  }
});

test('M4-A08: Cancellation with AbortSignal throws lease_cancelled', () => {
  const { dbPath, cleanup } = createTempDb();
  try {
    withDatabase(dbPath, (db) => {
      const scope: Scope = { kind: 'project', project: 'cancel-test' };
      const controller = new AbortController();
      controller.abort();

      assert.throws(() => {
        saveEntity(db, {
          type: 'concept',
          name: 'CancelledNode',
          scope,
        }, { sessionId: 'session-test', signal: controller.signal });
      }, (err: any) => {
        return err.name === 'AbortError' && err.message.includes('lease_cancelled');
      });

      assert.throws(() => {
        listEntities(db, { scope, signal: controller.signal });
      }, (err: any) => {
        return err.name === 'AbortError' && err.message.includes('lease_cancelled');
      });
    });
  } finally {
    cleanup();
  }
});
