#!/usr/bin/env node
/** Local Planned Workflow checks. No dependencies, sandbox, or inferred consent. */
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync, writeFileSync, renameSync, unlinkSync, mkdirSync, rmdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const usage = 'Usage: node flow-check.mjs <check|authorize|baseline|candidate|verify|archive> <change-dir> [--phase plan|apply|verify|deliver|snapshot|surface] [--baseline-id ID_OR_LABEL] [--label LABEL] [--author NAME --reference MESSAGE] [--date YYYY-MM-DD] [--executor SESSION_ID | --executors SESSION_ID ...] [--files ABSOLUTE_PATH ...]';
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_BASELINE_FILES = 5000;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (message) => { throw new Error(message); };
const inside = (root, path) => path === root || (!relative(root, path).startsWith('..' + sep) && relative(root, path) !== '..' && !isAbsolute(relative(root, path)));
const compareStrings = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const compareRecords = (a, b) => compareStrings(a[0], b[0]);

// Reject redirects in every component, including missing deliverables' parents.
function safePath(path, allowAbsent = false) {
  const absolute = resolve(path);
  const { root } = parse(absolute);
  let current = root;
  for (const component of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) fail(`Unexpected symlink: ${current}`);
      if (current !== absolute && !stat.isDirectory()) fail(`Not a directory: ${current}`);
    } catch (error) {
      if (error.code === 'ENOENT' && allowAbsent) return absolute;
      throw error;
    }
  }
  return absolute;
}
function bytes(path, optional = false) {
  safePath(path, optional);
  try {
    if (!lstatSync(path).isFile()) fail(`Expected regular file: ${path}`);
    if (lstatSync(path).size > 2 * 1024 * 1024) fail(`Artifact exceeds 2 MiB: ${path}`);
    return readFileSync(path);
  } catch (error) {
    if (optional && error.code === 'ENOENT') return undefined;
    throw error;
  }
}
const prose = (text) => text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
function section(text, title) {
  const lines = prose(text).split(/\r?\n/);
  const positions = lines.flatMap((line, i) => line.trimEnd().toLowerCase() === `## ${title}`.toLowerCase() ? [i] : []);
  if (positions.length > 1) fail(`Duplicate section: ${title}`);
  const start = positions[0] ?? -1;
  if (start < 0) return '';
  const end = lines.findIndex((line, i) => i > start && /^## /.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}
function ready(text, name) {
  const status = section(text, 'Workflow Status');
  if (!/^## Workflow Status\r?\n/.test(text) || !/^- Status: READY\s*$/m.test(status)) fail(`${name}: Workflow Status must be READY`);
  if (!/^- Blockers: None\s*$/m.test(status)) fail(`${name}: Blockers must be None`);
  if ((status.match(/^- Status:/gm) ?? []).length !== 1 || (status.match(/^- Blockers:/gm) ?? []).length !== 1) fail(`${name}: ambiguous status`);
}
function definitions(text, prefix) {
  return [...prose(text).matchAll(new RegExp(`^#{1,6}\\s+(${prefix}-\\d{3,})\\b[^\\n]*`, 'gm'))];
}
function unique(matches) {
  const seen = new Set();
  for (const match of matches) {
    if (seen.has(match[1])) fail(`duplicate ${match[1]} definition`);
    seen.add(match[1]);
  }
  return seen;
}
function listAfter(text, label) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `- ${label}:`);
  if (start < 0) fail(`Execution Scope missing ${label}`);
  const result = [];
  for (const line of lines.slice(start + 1)) {
    if (/^- /.test(line)) break;
    if (/^\s+- /.test(line)) result.push(line.replace(/^\s+- /, '').trim());
  }
  if (!result.length) fail(`Execution Scope has empty ${label}`);
  return result;
}
function boundary(pattern) {
  const path = pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern;
  if (!isAbsolute(path) || /[*?`]/.test(path)) fail(`Expected absolute directory root or exact path: ${pattern}`);
  return { path: resolve(path), tree: pattern.endsWith('/**') };
}
const covered = (path, item) => item.tree ? inside(item.path, path) : path === item.path;
function planAt(dir) {
  const raw = bytes(join(dir, 'plan.md'));
  const text = raw.toString('utf8');
  ready(text, 'plan.md');
  for (const title of ['Goal', 'Scope & Exclusions', 'Execution Scope', 'Risks & Constraints', 'Open Decisions', 'Next Permitted Action']) {
    if (!section(text, title)) fail(`plan.md missing ${title}`);
  }
  if (!/^None\.?$/i.test(section(text, 'Open Decisions'))) fail('plan.md: unresolved Open Decisions');
  const matches = definitions(text, 'MINI');
  const ids = unique(matches);
  if (!ids.size) fail('plan.md needs MINI definitions');
  const clean = prose(text);
  const dependencies = new Map();
  for (let i = 0; i < matches.length; i++) {
    const remainder = clean.slice(matches[i].index, matches[i + 1]?.index ?? clean.length);
    const nextSection = remainder.indexOf('\n## ');
    const block = remainder.slice(0, nextSection < 0 ? undefined : nextSection);
    for (const label of ['Contract', 'Acceptance', 'Canonical sources', 'Validation', 'Depends on']) {
      if (!new RegExp(`(?:^|\\n)(?:- )?(?:\\*\\*)?${label}(?:\\*\\*)?:[ \\t]*(?:\\*\\*)?[ \\t]*[^\\s*]`, 'i').test(block)) fail(`${matches[i][1]} missing ${label}`);
    }
    const depends = block.match(/(?:^|\n)(?:- )?(?:\*\*)?Depends on(?:\*\*)?:[^\S\n]*(?:\*\*)?([^\n]+)/i)?.[1] ?? '';
    dependencies.set(matches[i][1], depends.match(/MINI-\d{3,}/g) ?? []);
    for (const id of dependencies.get(matches[i][1])) {
      if (!ids.has(id) || id === matches[i][1]) fail(`${matches[i][1]} invalid dependency ${id}`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) fail(`Dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id)) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of ids) visit(id);
  const evidence = new Set();
  for (const name of readdirSync(dir).filter((name) => /^discovery(?:-[a-zA-Z0-9-]+)?\.md$/.test(name))) {
    const discovery = bytes(join(dir, name)).toString('utf8');
    ready(discovery, name);
    for (const id of unique(definitions(discovery, 'EVID'))) {
      if (evidence.has(id)) fail(`Ambiguous discovery evidence ${id}; assign unique IDs before planning`);
      evidence.add(id);
    }
  }
  for (const id of clean.match(/EVID-\d{3,}/g) ?? []) if (!evidence.has(id)) fail(`plan.md cites missing evidence ${id}`);
  const scope = section(text, 'Execution Scope');
  const root = scope.match(/^- Root: (.+)$/m)?.[1]?.trim();
  if (!root || !isAbsolute(root)) fail('Execution Scope needs absolute Root');
  safePath(root);
  const allowed = listAfter(scope, 'Allowed Paths').map(boundary);
  const writable = listAfter(scope, 'Writable Paths').map(boundary);
  listAfter(scope, 'Allowed Bash');
  for (const item of writable) {
    if (!inside(root, item.path) || !allowed.some((a) => covered(item.path, a) && (!item.tree || a.tree))) fail(`Writable Paths outside Root/Allowed Paths: ${item.path}`);
  }
  const units = [];
  const owners = new Map();
  const sequence = section(text, 'Apply Sequence');
  if (!sequence && /^## Apply Sequence\s*$/im.test(prose(text))) fail('Apply Sequence must not be empty');
  const stages = new Map();
  if (sequence) {
    for (const line of sequence.split(/\r?\n/)) {
      const match = line.match(/^- (Preparation|Integration): (None|MINI-\d{3,}(?:, MINI-\d{3,})*)$/);
      if (!match || stages.has(match[1])) fail('Malformed Apply Sequence; require one Preparation and Integration line');
      const minis = match[2] === 'None' ? [] : match[2].split(', ');
      stages.set(match[1], minis);
      for (const id of minis) {
        if (!ids.has(id) || owners.has(id)) fail(`Invalid apply MINI ownership: ${id}`);
        owners.set(id, match[1]);
      }
    }
    if (stages.size !== 2) fail('Apply Sequence requires Preparation and Integration');
  }
  for (const line of section(text, 'Parallel Units').split(/\r?\n/).filter((line) => line.trim())) {
    const match = line.match(/^- (UNIT-[A-Z0-9-]+): (MINI-\d{3,}(?:, MINI-\d{3,})*) \| Writable: (.+)$/);
    if (!match) fail('Malformed Parallel Units line');
    if (units.some((unit) => unit.id === match[1])) fail('Duplicate Parallel Units');
    const areas = match[3].split(' ; ').map(boundary);
    for (let i = 0; i < areas.length; i++) {
      const area = areas[i];
      if (!writable.some((item) => covered(area.path, item) && (!area.tree || item.tree))) fail('Parallel unit outside Writable Paths');
      safePath(area.path, true);
      const overlaps = (other) => covered(area.path, other) || covered(other.path, area);
      if (areas.slice(0, i).some(overlaps) || units.some((unit) => unit.areas.some(overlaps))) fail('Parallel Units have overlapping write surfaces');
    }
    const minis = match[2].split(', ');
    for (const id of minis) {
      if (!ids.has(id) || owners.has(id)) fail(`Invalid parallel MINI ownership: ${id}`);
      owners.set(id, match[1]);
    }
    units.push({ id: match[1], areas, minis });
  }
  if (sequence && units.length < 2) fail('Apply Sequence requires at least two Parallel Units');
  if (units.length) {
    if (owners.size !== ids.size) fail('Parallel Units and Apply Sequence must assign every MINI once');
    for (const [id, deps] of dependencies) {
      const owner = owners.get(id);
      for (const dep of deps) {
        const prerequisite = owners.get(dep);
        const earlierStage = sequence && (owner === 'Integration' || (owner !== 'Preparation' && prerequisite === 'Preparation'));
        if (owner === prerequisite || earlierStage) continue;
        fail(`Cross-unit parallel dependency: ${id}`);
      }
    }
  }
  const integrated = section(text, 'Integrated Validation');
  if (sequence && (!/^- Owner: \S[^\n]*$/m.test(integrated) || !/^- Command: \S[^\n]*$/m.test(integrated))) fail('Apply Sequence requires Integrated Validation Owner and Command');
  const contracts = [];
  for (const line of section(text, 'Project Contracts').split(/\r?\n/).filter((line) => line.trim())) {
    if (!line.startsWith('- ')) fail('Malformed Project Contracts line');
    const item = boundary(line.slice(2));
    if (item.tree || contracts.includes(item.path) || !inside(root, item.path) || inside(join(root, 'openspec'), item.path) || inside(dir, item.path) || !allowed.some((area) => covered(item.path, area))) fail('Project Contracts require unique exact project files outside workflow artifacts and inside Allowed Paths');
    safePath(item.path, true);
    contracts.push(item.path);
  }
  const applyNames = units.length ? [
    ...(stages.get('Preparation')?.length ? ['apply-preparation.md'] : []),
    ...units.map(({ id }) => `apply-${id}.md`),
    ...(stages.get('Integration')?.length ? ['apply-integration.md'] : []),
  ] : ['apply.md'];
  return {
    hash: sha(raw),
    text,
    root: resolve(root),
    ids: [...ids],
    allowed,
    writable,
    units,
    hasSequence: Boolean(sequence),
    hasPreparation: (stages.get('Preparation')?.length ?? 0) > 0,
    hasIntegration: (stages.get('Integration')?.length ?? 0) > 0,
    contracts,
    applyNames,
  };
}
function receiptAt(dir, optional = false) {
  const raw = bytes(join(dir, 'flow.json'), true);
  if (!raw) {
    if (!optional) fail('Missing flow.json authorization receipt');
    return { version: 1, slug: dir.split(sep).at(-1) };
  }
  let receipt;
  try { receipt = JSON.parse(raw); } catch { fail('Invalid JSON workflow receipt'); }
  if (!receipt || receipt.version !== 1 || receipt.slug !== dir.split(sep).at(-1)) fail('Invalid workflow receipt version/slug');
  return receipt;
}
function authorization(receipt, plan) {
  const auth = receipt.authorization;
  if (!auth?.author?.trim() || !auth?.reference?.trim() || !auth?.at || auth.action !== 'apply') fail('Missing valid apply authorization');
  if (auth.plan_sha256 !== plan.hash) fail('Authorized plan changed; stale authorization: review the diff before renewing the receipt');
}
function applyHashes(dir, plan) {
  return plan.applyNames.map((name) => {
    const raw = bytes(join(dir, name));
    ready(raw.toString('utf8'), name);
    return [name, sha(raw)];
  });
}
function recordsFor(paths, plan) {
  if (!paths?.length) fail('candidate requires --files with the complete explicit deliverable set');
  const seen = new Set();
  return paths.map((path) => {
    if (!isAbsolute(path)) fail(`Candidate path must be absolute: ${path}`);
    path = resolve(path);
    if (seen.has(path)) fail(`Duplicate candidate path: ${path}`);
    seen.add(path);
    if (!plan.writable.some((item) => covered(path, item))) fail(`Candidate outside Writable Paths: ${path}`);
    safePath(path, true);
    try {
      if (!lstatSync(path).isFile()) fail(`Candidate is not a regular file: ${path}`);
      return [path, 'present', sha(readFileSync(path))];
    } catch (error) {
      if (error.code === 'ENOENT') return [path, 'absent', ''];
      throw error;
    }
  }).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}
function contractRecords(plan) {
  return plan.contracts.map((path) => [path, 'present', sha(bytes(path))]).sort(compareRecords);
}
function snapshotContractRecords(plan) {
  return plan.contracts.map((path) => {
    safePath(path, true);
    try {
      const stat = lstatSync(path);
      if (!stat.isFile()) fail(`Expected regular file: ${path}`);
      if (stat.size > 2 * 1024 * 1024) fail(`Artifact exceeds 2 MiB: ${path}`);
      return [path, 'present', sha(readFileSync(path))];
    } catch (error) {
      if (error.code === 'ENOENT') return [path, 'absent', ''];
      throw error;
    }
  }).sort(compareRecords);
}
function validateImplementationShape(receipt) {
  const impl = receipt.implementation;
  if (!Array.isArray(impl?.executors) || !impl.executors.length || impl.executors.some((id) => typeof id !== 'string' || !id.trim()) || new Set(impl.executors).size !== impl.executors.length || !Array.isArray(impl.records) || !impl.records.length) fail('Missing candidate implementation receipt');
  if (impl.records.some((r) => !Array.isArray(r) || r.length !== 3 || typeof r[0] !== 'string' || !['present', 'absent'].includes(r[1]) || (r[1] === 'absent' ? r[2] !== '' : !/^[a-f0-9]{64}$/.test(r[2])))) fail('Invalid candidate records');
  return impl;
}
function implementation(receipt, dir, plan) {
  const impl = validateImplementationShape(receipt);
  if (plan.contracts.length && JSON.stringify(contractRecords(plan)) !== JSON.stringify(impl.contracts)) fail('Project contract drift: content changed or missing contract identities');
  const current = recordsFor(impl.records.map(([path]) => path), plan);
  if (JSON.stringify(current) !== JSON.stringify(impl.records) || sha(JSON.stringify(current)) !== impl.sha256) fail('Candidate drift: content/state changed');
  if (JSON.stringify(applyHashes(dir, plan)) !== JSON.stringify(impl.apply)) fail('Implementation summary changed; capture candidate again');
  return impl;
}
function snapshotOf(receipt, dir, plan) {
  const impl = validateImplementationShape(receipt);
  const current = recordsFor(impl.records.map(([path]) => path), plan);
  const candidate_sha256 = sha(JSON.stringify(current));
  const contracts = snapshotContractRecords(plan);
  const merged = new Map();
  for (const record of current) merged.set(record[0], record);
  for (const record of contracts) if (!merged.has(record[0])) merged.set(record[0], record);
  const snapshot_records = [...merged.values()].sort(compareRecords);
  const snapshot_sha256 = sha(JSON.stringify(snapshot_records));
  const drift = [];
  const expectedDeliverables = new Map(impl.records.map((r) => [r[0], r]));
  let deliverableDrift = false;
  for (const actual of current) {
    const expected = expectedDeliverables.get(actual[0]);
    if (!expected || expected[1] !== actual[1] || expected[2] !== actual[2]) {
      deliverableDrift = true;
      drift.push({
        kind: 'deliverable',
        path: actual[0],
        expected_state: expected?.[1] ?? 'missing',
        expected_sha256: expected?.[2] ?? '',
        actual_state: actual[1],
        actual_sha256: actual[2],
      });
    }
  }
  if (!deliverableDrift && (JSON.stringify(current) !== JSON.stringify(impl.records) || candidate_sha256 !== impl.sha256)) {
    drift.push({ kind: 'candidate_digest', expected_sha256: impl.sha256 ?? '', actual_sha256: candidate_sha256 });
  }
  let contracts_status = 'NONE';
  const recordedContracts = Array.isArray(impl.contracts) ? impl.contracts : [];
  if (plan.contracts.length > 0 || recordedContracts.length > 0) {
    const expectedContracts = new Map(recordedContracts.map((r) => [r[0], r]));
    const actualContracts = new Map(contracts.map((r) => [r[0], r]));
    const allContractPaths = [...new Set([...expectedContracts.keys(), ...actualContracts.keys()])].sort(compareStrings);
    let hasContractDrift = false;
    for (const path of allContractPaths) {
      const expected = expectedContracts.get(path);
      const actual = actualContracts.get(path);
      if (!expected || !actual || actual[1] !== 'present' || expected[1] !== actual[1] || expected[2] !== actual[2]) {
        hasContractDrift = true;
        drift.push({
          kind: 'contract',
          path,
          expected_state: expected?.[1] ?? 'missing',
          expected_sha256: expected?.[2] ?? '',
          actual_state: actual?.[1] ?? 'missing',
          actual_sha256: actual?.[2] ?? '',
        });
      }
    }
    contracts_status = hasContractDrift ? 'DRIFT' : 'MATCH';
  }
  const expectedApply = new Map((Array.isArray(impl.apply) ? impl.apply : []).map((entry) => [entry[0], entry[1]]));
  const currentApply = [];
  for (const name of plan.applyNames) {
    const filePath = join(dir, name);
    safePath(filePath, true);
    let actualHash = '';
    let reason;
    try {
      const stat = lstatSync(filePath);
      if (!stat.isFile()) fail(`Expected regular file: ${filePath}`);
      if (stat.size > 2 * 1024 * 1024) fail(`Artifact exceeds 2 MiB: ${filePath}`);
      const raw = readFileSync(filePath);
      actualHash = sha(raw);
      try { ready(raw.toString('utf8'), name); } catch (err) { reason = err instanceof Error ? err.message : String(err); }
    } catch (error) {
      if (error.code === 'ENOENT') {
        reason = `Missing ${name}`;
      } else {
        throw error;
      }
    }
    currentApply.push([name, actualHash]);
    const expectedHash = expectedApply.get(name) ?? '';
    if (reason || actualHash !== expectedHash) {
      drift.push({ kind: 'apply', name, path: filePath, expected_sha256: expectedHash, actual_sha256: actualHash, ...(reason ? { reason } : {}) });
    }
  }
  for (const [name, expectedHash] of expectedApply) {
    if (!plan.applyNames.includes(name)) {
      drift.push({ kind: 'apply', name, path: join(dir, name), expected_sha256: expectedHash, actual_sha256: '', reason: 'Unexpected recorded apply summary' });
    }
  }
  return {
    contract_count: plan.ids.length,
    plan_sha256: plan.hash,
    continuity_status: drift.length === 0 ? 'MATCH' : 'DRIFT',
    contracts_status,
    candidate_sha256,
    recorded_candidate_sha256: impl.sha256,
    snapshot_sha256,
    records: current,
    contracts,
    snapshot_records,
    apply: currentApply,
    drift,
  };
}
function unwrapMarkdown(value) {
  let current = value.trim();
  for (;;) {
    const next = current
      .replace(/^\*\*([^*]+)\*\*$/, '$1')
      .replace(/^__([^_]+)__$/, '$1')
      .replace(/^`([^`]+)`$/, '$1')
      .trim();
    if (next === current) return current;
    current = next;
  }
}
function verifyResultPass(text) {
  const explicit = [...prose(text).matchAll(/^(?:-\s+)?(?:\*\*|__)?Verification Result(?:\*\*|__)?:\s*(.+?)[ \t]*$/gm)]
    .map((match) => unwrapMarkdown(match[1]));
  const secLines = section(text, 'Verification Result')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (explicit.length > 0) {
    if (explicit.length !== 1 || explicit[0] !== 'PASS') return false;
    const extra = secLines.filter((line) => !/^(?:-\s+)?(?:\*\*|__)?Verification Result(?:\*\*|__)?:/i.test(line));
    return extra.every((line) => unwrapMarkdown(line.replace(/^-\s+/, '')) === 'PASS');
  }
  return secLines.length === 1 && unwrapMarkdown(secLines[0].replace(/^-\s+/, '')) === 'PASS';
}
function parseTableCells(line) {
  const trimmed = line.trim();
  const parts = trimmed.split('|');
  const inner = trimmed.endsWith('|') ? parts.slice(1, -1) : parts.slice(1);
  return inner.map((cell) => cell.trim());
}
const isSeparatorRow = (cells) => cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
const nonPassToken = /^(?:FAIL|FAILED|BLOCKED|SKIP|SKIPPED|PENDING|PARTIAL)$/i;
const mixedPassFail = /^PASS\b.*\b(?:FAIL|FAILED|BLOCKED|SKIP|SKIPPED|PENDING|PARTIAL)\b/i;

function verificationHash(dir, plan) {
  const raw = bytes(join(dir, 'verify.md'));
  const text = raw.toString('utf8');
  ready(text, 'verify.md');
  if (!verifyResultPass(text)) fail('verify.md needs one unambiguous Verification Result: PASS');
  const matrix = section(text, 'Evidence Matrix');
  const tableRows = matrix.split(/\r?\n/)
    .filter((line) => line.trimStart().startsWith('|'))
    .map(parseTableCells);
  const sepIndex = tableRows.findIndex(isSeparatorRow);
  const header = sepIndex > 0 ? tableRows[sepIndex - 1].map((cell) => unwrapMarkdown(cell).toLowerCase()) : [];
  const resultCol = header.findIndex((cell) => /^(?:result|status|verdict|outcome|pass\b.*)$/.test(cell));
  const dataRows = tableRows.filter((cells, index) => !isSeparatorRow(cells) && !(sepIndex > 0 && index === sepIndex - 1));
  for (const id of plan.ids) {
    const matches = dataRows.filter((cells) => cells.some((cell) => unwrapMarkdown(cell) === id));
    if (matches.length !== 1) fail(`verify.md needs one passing evidence row for ${id}`);
    const normCells = matches[0].map(unwrapMarkdown);
    const hasPass = resultCol >= 0 && resultCol < normCells.length
      ? normCells[resultCol] === 'PASS'
      : normCells.includes('PASS');
    const hasEvidence = normCells.some((cell, index) => cell && cell !== id && cell !== 'PASS' && index !== resultCol);
    const hasNonPassCell = normCells.some((cell) => nonPassToken.test(cell) || mixedPassFail.test(cell));
    if (!hasPass || !hasEvidence || hasNonPassCell) fail(`verify.md missing passing evidence for ${id}`);
  }
  return sha(raw);
}
function isSecretFileName(name) {
  return name === '.env'
    || name === '.env.local'
    || /^\.env\.[^/\\]+\.local$/.test(name)
    || name.endsWith('.pem')
    || name.endsWith('.key')
    || name === 'id_rsa'
    || name === 'id_ed25519';
}
function boundaryString(item) {
  return item.tree ? `${item.path}/**` : item.path;
}
function baselineRootsFor(plan) {
  const candidates = [
    ...plan.writable,
    ...plan.allowed.filter((item) => inside(plan.root, item.path)),
  ];
  const unique = [];
  for (const item of candidates) {
    if (unique.some((other) => other.path === item.path && other.tree === item.tree)) continue;
    unique.push(item);
  }
  const pruned = unique.filter((item, idx) => !unique.some((other, otherIdx) =>
    otherIdx !== idx && covered(item.path, other) && (!item.tree || other.tree),
  ));
  return pruned.map(boundaryString).sort(compareStrings);
}
function scanBoundaryRoots(rootPatterns, dir, plan, maxFiles = MAX_BASELINE_FILES) {
  const openspecDir = join(plan.root, 'openspec');
  const openspecExplicit = plan.writable.some((w) => inside(openspecDir, w.path));
  const recordsMap = new Map();
  function addRecord(absPath, state, hash) {
    if (!recordsMap.has(absPath) && recordsMap.size >= maxFiles) {
      fail(`Baseline scan exceeded the ${maxFiles}-file safety cap; narrow Execution Scope Writable/Allowed Paths`);
    }
    recordsMap.set(absPath, [absPath, state, hash]);
  }
  function shouldSkip(entryPath, entryName) {
    if (entryName === '.git' || entryName === 'node_modules') return true;
    if (inside(dir, entryPath)) return true;
    if (!openspecExplicit && inside(openspecDir, entryPath)) return true;
    if (isSecretFileName(entryName)) return true;
    return false;
  }
  function walkDir(dirPath) {
    for (const entryName of readdirSync(dirPath).sort(compareStrings)) {
      const entryPath = join(dirPath, entryName);
      if (shouldSkip(entryPath, entryName)) continue;
      const stat = lstatSync(entryPath);
      if (stat.isSymbolicLink()) {
        addRecord(entryPath, 'symlink', sha(readlinkSync(entryPath)));
      } else if (stat.isFile()) {
        addRecord(entryPath, 'present', sha(readFileSync(entryPath)));
      } else if (stat.isDirectory()) {
        walkDir(entryPath);
      }
    }
  }
  for (const pattern of rootPatterns) {
    const item = boundary(pattern);
    if (shouldSkip(item.path, basename(item.path))) continue;
    safePath(dirname(item.path), true);
    let stat;
    try {
      stat = lstatSync(item.path);
    } catch (error) {
      if (error.code === 'ENOENT') {
        if (!item.tree) addRecord(item.path, 'absent', '');
        continue;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      addRecord(item.path, 'symlink', sha(readlinkSync(item.path)));
    } else if (stat.isFile()) {
      addRecord(item.path, 'present', sha(readFileSync(item.path)));
    } else if (stat.isDirectory() && item.tree) {
      walkDir(item.path);
    }
  }
  return [...recordsMap.values()].sort(compareRecords);
}
function scanContractEntries(plan) {
  return plan.contracts.map((path) => {
    safePath(dirname(path), true);
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) return [path, 'symlink', sha(readlinkSync(path))];
      if (!stat.isFile()) fail(`Expected regular file: ${path}`);
      if (stat.size > MAX_ARTIFACT_BYTES) fail(`Artifact exceeds 2 MiB: ${path}`);
      return [path, 'present', sha(readFileSync(path))];
    } catch (error) {
      if (error.code === 'ENOENT') return [path, 'absent', ''];
      throw error;
    }
  }).sort(compareRecords);
}
function captureBaseline(receipt, dir, plan, options, hooks) {
  const existing = Array.isArray(receipt.baselines) ? receipt.baselines : [];
  const label = options?.label?.trim();
  if (options?.label !== undefined && !label) fail('Baseline label must be a non-empty string');
  const maxFiles = hooks?.maxBaselineFiles ?? MAX_BASELINE_FILES;
  const roots = baselineRootsFor(plan);
  const records = scanBoundaryRoots(roots, dir, plan, maxFiles);
  const contracts = plan.contracts.length ? scanContractEntries(plan) : undefined;
  let seq = existing.length + 1;
  const existingIds = new Set(existing.map((b) => b?.id));
  while (existingIds.has(`baseline-${seq}`)) seq++;
  const id = `baseline-${seq}`;
  const entry = {
    id,
    ...(label ? { label } : {}),
    at: new Date().toISOString(),
    plan_sha256: plan.hash,
    roots,
    records,
    ...(contracts ? { contracts } : {}),
    sha256: sha(JSON.stringify(records)),
  };
  receipt.baselines = [...existing, entry];
  save(dir, receipt);
  return {
    contract_count: plan.ids.length,
    plan_sha256: plan.hash,
    baseline_id: entry.id,
    ...(entry.label ? { baseline_label: entry.label } : {}),
    baseline_sha256: entry.sha256,
    file_count: entry.records.length,
  };
}
function surfaceOf(receipt, dir, plan, options, hooks) {
  const baselines = Array.isArray(receipt.baselines) ? receipt.baselines : [];
  if (!baselines.length) fail('Missing baseline in flow.json; run workflow_record action="baseline" first');
  let selected;
  if (options?.baseline_id !== undefined) {
    const query = typeof options.baseline_id === 'string' ? options.baseline_id.trim() : '';
    if (!query) fail('Invalid baseline_id');
    selected = baselines.find((b) => b?.id === query);
    if (!selected) {
      for (let i = baselines.length - 1; i >= 0; i--) {
        if (baselines[i]?.label === query) {
          selected = baselines[i];
          break;
        }
      }
    }
    if (!selected) fail(`Unknown baseline_id: ${query}`);
  } else {
    selected = baselines.at(-1);
  }
  if (!selected || typeof selected.id !== 'string' || !Array.isArray(selected.roots) || !Array.isArray(selected.records)) {
    fail('Invalid baseline entry in flow.json');
  }
  if (selected.plan_sha256 !== plan.hash) {
    fail(`Stale baseline ${selected.id}: plan.md changed since baseline capture`);
  }
  const maxFiles = hooks?.maxBaselineFiles ?? MAX_BASELINE_FILES;
  const currentRecords = scanBoundaryRoots(selected.roots, dir, plan, maxFiles);
  const currentContracts = plan.contracts.length ? scanContractEntries(plan) : [];
  const beforeMap = new Map(selected.records.map((r) => [r[0], [r[1], r[2]]]));
  const afterMap = new Map(currentRecords.map((r) => [r[0], [r[1], r[2]]]));
  const allPaths = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort(compareStrings);
  const created = [];
  const modified = [];
  const deleted = [];
  const deltas = [];
  const by_owner = {};
  const violations = [];
  const candidateSet = new Set();
  const addOwnerDelta = (owner, change, path) => {
    if (!by_owner[owner]) by_owner[owner] = { created: [], modified: [], deleted: [] };
    by_owner[owner][change].push(path);
  };
  const contractDriftPaths = new Set();
  for (const path of allPaths) {
    const before = beforeMap.get(path) ?? ['absent', ''];
    const after = afterMap.get(path) ?? ['absent', ''];
    if (before[0] === after[0] && before[1] === after[1]) continue;
    const change = before[0] === 'absent' ? 'created' : after[0] === 'absent' ? 'deleted' : 'modified';
    if (change === 'created') created.push(path);
    else if (change === 'modified') modified.push(path);
    else deleted.push(path);

    const isWritable = plan.writable.some((w) => covered(path, w));
    const isReadOnlyContract = !isWritable && plan.contracts.includes(path);
    let owner = null;
    if (after[0] === 'symlink') {
      violations.push({ type: 'unexpected_symlink', path, change, detail: 'Created or modified symlink' });
    }
    if (!isWritable) {
      if (isReadOnlyContract) {
        contractDriftPaths.add(path);
        violations.push({ type: 'project_contract_drift', path, change, detail: 'Read-only Project Contract changed or deleted' });
      } else {
        violations.push({ type: 'out_of_surface', path, change, detail: 'Path is outside Execution Scope Writable Paths' });
      }
    } else if (plan.units.length === 0) {
      owner = 'Writable Paths';
    } else {
      const matchingUnits = plan.units.filter((unit) => unit.areas.some((area) => covered(path, area)));
      if (matchingUnits.length > 1) {
        violations.push({ type: 'overlap', path, change, owners: matchingUnits.map((u) => u.id), detail: 'Path matches multiple Parallel Units' });
      } else if (matchingUnits.length === 1) {
        owner = matchingUnits[0].id;
      } else if (plan.hasPreparation || plan.hasIntegration) {
        owner = 'Preparation/Integration';
      } else {
        violations.push({ type: 'unassigned_writable', path, change, detail: 'Path is inside Writable Paths but not assigned to any Parallel Unit and no Preparation/Integration stage is declared' });
      }
    }
    if (owner) addOwnerDelta(owner, change, path);
    deltas.push({ path, change, owner, state: after[0], sha256: after[1] });
    if (isWritable && after[0] !== 'symlink' && !inside(dir, path)) {
      candidateSet.add(path);
    }
  }
  // Explicitly verify read-only Project Contracts against baseline contracts
  const beforeContracts = new Map((Array.isArray(selected.contracts) ? selected.contracts : []).map((r) => [r[0], [r[1], r[2]]]));
  const afterContracts = new Map(currentContracts.map((r) => [r[0], [r[1], r[2]]]));
  for (const contractPath of plan.contracts) {
    if (plan.writable.some((w) => covered(contractPath, w))) continue;
    const before = beforeContracts.get(contractPath) ?? ['absent', ''];
    const after = afterContracts.get(contractPath) ?? ['absent', ''];
    if (before[0] !== after[0] || before[1] !== after[1] || after[0] !== 'present') {
      if (!contractDriftPaths.has(contractPath)) {
        contractDriftPaths.add(contractPath);
        const change = before[0] === 'absent' ? 'created' : after[0] === 'absent' ? 'deleted' : 'modified';
        violations.push({ type: 'project_contract_drift', path: contractPath, change, detail: 'Read-only Project Contract changed, missing, or redirected' });
      }
    }
  }
  const contracts_status = plan.contracts.length === 0 ? 'NONE' : contractDriftPaths.size > 0 ? 'DRIFT' : 'MATCH';
  const candidate_files = [...candidateSet].sort(compareStrings);
  return {
    contract_count: plan.ids.length,
    plan_sha256: plan.hash,
    baseline_id: selected.id,
    ...(selected.label ? { baseline_label: selected.label } : {}),
    surface_status: violations.length === 0 ? 'CLEAN' : 'VIOLATIONS',
    contracts_status,
    created,
    modified,
    deleted,
    deltas,
    by_owner,
    violations,
    candidate_files,
  };
}
function parseArchiveDate(value) {
  if (value === undefined) return new Date().toISOString().slice(0, 10);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Archive date must be YYYY-MM-DD');
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
    fail(`Invalid calendar archive date: ${value}`);
  }
  return value;
}
function inventoryTree(rootDir) {
  const files = [];
  const dirs = [];
  function walk(currentDir, relPrefix) {
    for (const name of readdirSync(currentDir).sort(compareStrings)) {
      const absPath = join(currentDir, name);
      const relPath = relPrefix ? join(relPrefix, name) : name;
      const stat = lstatSync(absPath);
      if (stat.isSymbolicLink()) fail(`Unexpected symlink inside change directory: ${absPath}`);
      if (stat.isDirectory()) {
        dirs.push(relPath);
        walk(absPath, relPath);
      } else if (stat.isFile()) {
        const raw = readFileSync(absPath);
        files.push({ relPath, size: stat.size, sha256: sha(raw) });
      } else {
        fail(`Unsupported file type inside change directory: ${absPath}`);
      }
    }
  }
  walk(rootDir, '');
  return { files, dirs };
}
function archiveChange(receipt, dir, plan, options, hooks) {
  const author = typeof options?.author === 'string' ? options.author.trim() : '';
  const reference = typeof options?.reference === 'string' ? options.reference.trim() : '';
  if (!author || !reference) fail('Archive requires explicit author and reference');
  const archiveDate = parseArchiveDate(options?.date);
  if (!lstatSync(dir).isDirectory()) fail(`Archive source is not a directory: ${dir}`);
  const slug = basename(dir);
  const changesDir = dirname(dir);
  const openspecDir = dirname(changesDir);
  const baseDir = dirname(openspecDir);
  if (
    basename(changesDir) !== 'changes'
    || basename(openspecDir) !== 'openspec'
    || changesDir === openspecDir
    || openspecDir === baseDir
    || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(slug)
    || slug !== receipt.slug
  ) {
    fail(`Archive source must be an active openspec/changes/<slug> directory matching receipt slug: ${dir}`);
  }
  // Execute full deliver gate and fresh post-verification continuity recomputation before any mutation.
  checkWorkflow(dir, 'deliver');
  const snapshot = checkWorkflow(dir, 'snapshot');
  if (snapshot.continuity_status !== 'MATCH' || snapshot.contracts_status === 'DRIFT') {
    fail('Post-verification continuity drift blocks archive');
  }
  const inventory = inventoryTree(dir);
  const archiveRoot = join(openspecDir, 'archive');
  const dateDir = join(archiveRoot, archiveDate);
  const destDir = join(dateDir, slug);
  safePath(archiveRoot, true);
  safePath(dateDir, true);
  safePath(destDir, true);
  if (inside(dir, destDir) || inside(destDir, dir)) {
    fail(`Archive destination must be strictly outside source: ${destDir}`);
  }
  let destExists = true;
  try { lstatSync(destDir); } catch (error) {
    if (error.code === 'ENOENT') destExists = false;
    else throw error;
  }
  if (destExists) fail(`Archive destination already exists: ${destDir}`);

  const devOf = (target) => (hooks?.devFor ? hooks.devFor(target) : lstatSync(target).dev);
  let nearestAncestor = dateDir;
  for (;;) {
    try {
      const st = lstatSync(nearestAncestor);
      if (st.isSymbolicLink()) fail(`Unexpected symlink: ${nearestAncestor}`);
      if (!st.isDirectory()) fail(`Not a directory: ${nearestAncestor}`);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(nearestAncestor);
      if (parent === nearestAncestor) fail(`Cannot resolve destination ancestor for ${destDir}`);
      nearestAncestor = parent;
    }
  }
  if (devOf(dir) !== devOf(nearestAncestor)) {
    fail(`Archive requires same-filesystem atomic rename; source (${dir}) and destination (${nearestAncestor}) are on different devices (no copy/delete fallback)`);
  }

  let createdArchiveRoot = false;
  let createdDateDir = false;
  const ensureDir = (target) => {
    safePath(target, true);
    try {
      const st = lstatSync(target);
      if (st.isSymbolicLink()) fail(`Unexpected symlink: ${target}`);
      if (!st.isDirectory()) fail(`Not a directory: ${target}`);
      return false;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      mkdirSync(target);
      return true;
    }
  };
  const doRename = hooks?.renameSync ?? renameSync;
  try {
    createdArchiveRoot = ensureDir(archiveRoot);
    createdDateDir = ensureDir(dateDir);
    safePath(destDir, true);
    if (devOf(dir) !== devOf(dateDir)) {
      fail(`Archive requires same-filesystem atomic rename; source (${dir}) and destination (${dateDir}) are on different devices (no copy/delete fallback)`);
    }
    let collision = true;
    try { lstatSync(destDir); } catch (error) {
      if (error.code === 'ENOENT') collision = false;
      else throw error;
    }
    if (collision) fail(`Archive destination already exists: ${destDir}`);
    doRename(dir, destDir);
  } catch (error) {
    if (createdDateDir) { try { rmdirSync(dateDir); } catch {} }
    if (createdArchiveRoot) { try { rmdirSync(archiveRoot); } catch {} }
    if (error?.code === 'EXDEV') {
      fail(`Archive atomic rename failed with EXDEV (cross-device link not permitted; no copy/delete fallback): ${dir} -> ${destDir}`);
    }
    throw error;
  }

  // Post-move verification
  const destStat = lstatSync(destDir);
  if (destStat.isSymbolicLink() || !destStat.isDirectory()) fail(`Post-move verification failed: ${destDir} is not a regular directory`);
  let sourceStillExists = true;
  try { lstatSync(dir); } catch (error) {
    if (error.code === 'ENOENT') sourceStillExists = false;
    else throw error;
  }
  if (sourceStillExists) fail(`Post-move verification failed: source still exists at ${dir}`);
  for (const relDir of inventory.dirs) {
    const movedDir = join(destDir, relDir);
    const st = lstatSync(movedDir);
    if (st.isSymbolicLink() || !st.isDirectory()) fail(`Post-move verification failed: expected directory at ${movedDir}`);
  }
  for (const item of inventory.files) {
    const movedFile = join(destDir, item.relPath);
    const st = lstatSync(movedFile);
    if (st.isSymbolicLink() || !st.isFile()) fail(`Post-move verification failed: expected regular file at ${movedFile}`);
    const raw = readFileSync(movedFile);
    if (st.size !== item.size || sha(raw) !== item.sha256) {
      fail(`Post-move verification failed: integrity mismatch at ${movedFile}`);
    }
  }
  const archivedReceipt = receiptAt(destDir);
  archivedReceipt.archive = {
    author,
    reference,
    at: new Date().toISOString(),
    source: dir,
    destination: destDir,
    candidate_sha256: snapshot.candidate_sha256,
    artifact_sha256: receipt.verification.artifact_sha256,
  };
  save(destDir, archivedReceipt);
  if (readdirSync(destDir).some((name) => /^flow\.json\..+\.tmp$/.test(name))) {
    fail(`Post-move verification failed: temporary receipt residue remains in ${destDir}`);
  }
  checkWorkflow(destDir, 'deliver');
  return {
    contract_count: plan.ids.length,
    plan_sha256: plan.hash,
    source: dir,
    destination: destDir,
    archived_files: inventory.files.length,
    candidate_sha256: snapshot.candidate_sha256,
    artifact_sha256: receipt.verification.artifact_sha256,
  };
}
function save(dir, receipt) {
  const target = safePath(join(dir, 'flow.json'), true);
  const serialized = JSON.stringify(receipt, null, 2) + '\n';
  if (Buffer.byteLength(serialized, 'utf8') > MAX_ARTIFACT_BYTES) {
    fail('Workflow receipt flow.json exceeds 2 MiB artifact limit; narrow Execution Scope or reduce baseline entries');
  }
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, serialized, { flag: 'wx', mode: 0o600 });
    safePath(target, true);
    renameSync(temp, target);
  } finally {
    try { unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function argumentsOf(args) {
  const [command, directory, ...rest] = args;
  if (!['check', 'authorize', 'baseline', 'candidate', 'verify', 'archive'].includes(command) || !directory) fail(usage);
  const options = {};
  const permitted = {
    check: ['phase', 'baseline-id'],
    authorize: ['author', 'reference'],
    baseline: ['label'],
    candidate: ['executor', 'executors', 'files'],
    verify: ['executor'],
    archive: ['author', 'reference', 'date'],
  }[command];
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i].slice(2);
    if (!rest[i].startsWith('--') || !permitted.includes(key) || Object.hasOwn(options, key)) fail(`${usage}\nUnknown/duplicate option: ${rest[i]}`);
    if (key === 'files' || key === 'executors') {
      options[key] = [];
      while (rest[i + 1] && !rest[i + 1].startsWith('--')) options[key].push(rest[++i]);
    } else {
      if (!rest[i + 1]?.trim() || rest[i + 1].startsWith('--')) fail(`${usage}\n--${key} needs a value`);
      options[key] = rest[++i].trim();
    }
  }
  if (command === 'check' && !['plan', 'apply', 'verify', 'deliver', 'snapshot', 'surface'].includes(options.phase)) fail(usage);
  if (command === 'check' && options['baseline-id'] && options.phase !== 'surface') fail(usage);
  if ((command === 'authorize' || command === 'archive') && (!options.author || !options.reference)) fail(usage);
  if (command === 'verify' && !options.executor) fail(usage);
  if (command === 'candidate' && ((!options.executor && !options.executors?.length) || (options.executor && options.executors))) fail(usage);
  return { command, dir: resolve(directory), options };
}
// Read-only API shared by the tool and CLI.
export function checkWorkflow(directory, phase, options, hooks) {
  if (!['plan', 'apply', 'verify', 'deliver', 'snapshot', 'surface'].includes(phase)) fail('Invalid workflow check phase');
  const dir = resolve(directory);
  safePath(dir);
  const plan = planAt(dir);
  if (phase !== 'plan') {
    const receipt = receiptAt(dir);
    authorization(receipt, plan);
    if (phase === 'snapshot') return snapshotOf(receipt, dir, plan);
    if (phase === 'surface') return surfaceOf(receipt, dir, plan, options, hooks);
    if (phase === 'verify' || phase === 'deliver') implementation(receipt, dir, plan);
    if (phase === 'verify') {
      const verifyRaw = bytes(join(dir, 'verify.md'), true);
      if (verifyRaw && /^- Status: READY\s*$/m.test(section(verifyRaw.toString('utf8'), 'Workflow Status'))) {
        verificationHash(dir, plan);
      }
    }
    if (phase === 'deliver') {
      const verified = receipt.verification;
      if (!verified?.executor || receipt.implementation.executors.includes(verified.executor) || verified.candidate_sha256 !== receipt.implementation.sha256) fail('Missing independent verification receipt');
      if (verified.artifact_sha256 !== verificationHash(dir, plan)) fail('Verification artifact verify.md changed');
    }
  }
  return { contract_count: plan.ids.length, plan_sha256: plan.hash };
}

// Caller must serialize receipt writes and supply already granted consent/actual identities.
export function recordWorkflow(directory, action, options, hooks) {
  if (!['authorize', 'baseline', 'candidate', 'verify', 'archive'].includes(action)) fail('Invalid workflow record action');
  const dir = resolve(directory);
  safePath(dir);
  const plan = planAt(dir);
  const receipt = receiptAt(dir, action === 'authorize');
  if (action === 'authorize') {
    if (!options.author?.trim() || !options.reference?.trim()) fail('Authorization requires author and reference');
    if (options.plan_sha256 !== plan.hash) fail('Approved plan digest mismatch; inspect the diff before recording consent');
    save(dir, { version: 1, slug: receipt.slug, authorization: { author: options.author, reference: options.reference, at: new Date().toISOString(), action: 'apply', plan_sha256: plan.hash } });
  } else {
    authorization(receipt, plan);
    if (action === 'baseline') {
      return captureBaseline(receipt, dir, plan, options, hooks);
    } else if (action === 'archive') {
      return archiveChange(receipt, dir, plan, options, hooks);
    } else if (action === 'candidate') {
      const records = recordsFor(options.files, plan);
      for (const [path] of records) if (inside(dir, path)) fail('Workflow artifacts cannot be candidate deliverables');
      const executors = options.executors;
      if (!Array.isArray(executors) || !executors.length || executors.some((id) => typeof id !== 'string' || !id.trim()) || new Set(executors).size !== executors.length) fail('Candidate requires unique non-empty executor identities');
      if (executors.length < plan.applyNames.length) fail('Record every Parallel Unit and preparation/integration implementation executor');
      receipt.implementation = { executors, records, sha256: sha(JSON.stringify(records)), apply: applyHashes(dir, plan), ...(plan.contracts.length ? { contracts: contractRecords(plan) } : {}) };
      delete receipt.verification;
      save(dir, receipt);
    } else {
      const impl = implementation(receipt, dir, plan);
      if (!options.executor?.trim()) fail('Verification requires executor identity');
      if (impl.executors.includes(options.executor)) fail('Verification must use an independent session/task executor');
      receipt.verification = { executor: options.executor, candidate_sha256: impl.sha256, artifact_sha256: verificationHash(dir, plan) };
      save(dir, receipt);
    }
  }
  return { contract_count: plan.ids.length, plan_sha256: plan.hash };
}

export function main(args) {
  let input;
  try { input = argumentsOf(args); } catch (error) { console.error(error.message); return 2; }
  try {
    const { command, dir, options } = input;
    if (command === 'check') {
      const checkOptions = options['baseline-id'] ? { baseline_id: options['baseline-id'] } : undefined;
      const result = checkWorkflow(dir, options.phase, checkOptions);
      if (options.phase === 'snapshot') {
        if (result.continuity_status !== 'MATCH') {
          console.error(`flow-check: BLOCKED snapshot DRIFT (${result.drift.length} drift item(s); snapshot_sha256=${result.snapshot_sha256})`);
          return 1;
        }
        console.log(`flow-check: PASS snapshot (${result.snapshot_records.length} records, contracts=${result.contracts_status}, snapshot_sha256=${result.snapshot_sha256})`);
        return 0;
      }
      if (options.phase === 'surface') {
        if (result.surface_status !== 'CLEAN') {
          console.error(`flow-check: BLOCKED surface VIOLATIONS (${result.violations.length} violation(s); baseline=${result.baseline_id})`);
          return 1;
        }
        console.log(`flow-check: PASS surface (baseline=${result.baseline_id}, deltas=${result.deltas.length}, candidate_files=${result.candidate_files.length})`);
        return 0;
      }
      console.log(`flow-check: PASS ${options.phase}${options.phase === 'plan' ? ` (${result.contract_count} contracts)` : ''}`);
      return 0;
    }
    safePath(dir);
    const plan = planAt(dir);
    const result = recordWorkflow(dir, command, { ...options, plan_sha256: plan.hash, executors: options.executors ?? (options.executor ? [options.executor] : undefined) });
    if (command === 'baseline') {
      console.log(`flow-check: PASS baseline (${result.baseline_id}, ${result.file_count} files)`);
      return 0;
    }
    if (command === 'archive') {
      console.log(`flow-check: PASS archive (${result.destination})`);
      return 0;
    }
    console.log(`flow-check: PASS ${command}`);
    return 0;
  } catch (error) {
    console.error(`flow-check: BLOCKED ${error.message}`);
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
