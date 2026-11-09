#!/usr/bin/env node
/** Local Planned Workflow checks. No dependencies, sandbox, or inferred consent. */
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const usage = 'Usage: node flow-check.mjs <check|authorize|candidate|verify> <change-dir> [--phase plan|apply|verify|deliver] [--author NAME --reference MESSAGE] [--executor SESSION_ID | --executors SESSION_ID ...] [--files ABSOLUTE_PATH ...]';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (message) => { throw new Error(message); };
const inside = (root, path) => path === root || (!relative(root, path).startsWith('..' + sep) && relative(root, path) !== '..' && !isAbsolute(relative(root, path)));

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
  for (const line of section(text, 'Parallel Units').split(/\r?\n/).filter((line) => line.trim())) {
    const match = line.match(/^- (UNIT-[A-Z0-9-]+): (MINI-\d{3,}(?:, MINI-\d{3,})*) \| Writable: (.+)$/);
    if (!match) fail('Malformed Parallel Units line');
    if (units.some((unit) => unit.id === match[1])) fail('Duplicate Parallel Units');
    const area = boundary(match[3]);
    if (!area.tree || !writable.some((item) => item.tree && covered(area.path, item))) fail('Parallel unit outside Writable Paths');
    if (units.some((unit) => inside(unit.area.path, area.path) || inside(area.path, unit.area.path))) fail('Parallel Units have overlapping write surfaces');
    const minis = match[2].split(', ');
    for (const id of minis) {
      if (!ids.has(id) || owners.has(id)) fail(`Invalid parallel MINI ownership: ${id}`);
      owners.set(id, match[1]);
    }
    units.push({ id: match[1], area, minis });
  }
  if (units.length) {
    if (owners.size !== ids.size) fail('Parallel Units must assign every MINI once');
    for (const [id, deps] of dependencies) {
      if (deps.some((dep) => owners.get(dep) !== owners.get(id))) fail(`Cross-unit parallel dependency: ${id}`);
    }
  }
  return { hash: sha(raw), text, ids: [...ids], writable, applyNames: units.length ? units.map(({ id }) => `apply-${id}.md`) : ['apply.md'] };
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
function implementation(receipt, dir, plan) {
  const impl = receipt.implementation;
  if (!Array.isArray(impl?.executors) || !impl.executors.length || impl.executors.some((id) => typeof id !== 'string' || !id.trim()) || new Set(impl.executors).size !== impl.executors.length || !Array.isArray(impl.records) || !impl.records.length) fail('Missing candidate implementation receipt');
  if (impl.records.some((r) => !Array.isArray(r) || r.length !== 3 || typeof r[0] !== 'string' || !['present', 'absent'].includes(r[1]) || (r[1] === 'absent' ? r[2] !== '' : !/^[a-f0-9]{64}$/.test(r[2])))) fail('Invalid candidate records');
  const current = recordsFor(impl.records.map(([path]) => path), plan);
  if (JSON.stringify(current) !== JSON.stringify(impl.records) || sha(JSON.stringify(current)) !== impl.sha256) fail('Candidate drift: content/state changed');
  if (JSON.stringify(applyHashes(dir, plan)) !== JSON.stringify(impl.apply)) fail('Implementation summary changed; capture candidate again');
  return impl;
}
function verificationHash(dir, plan) {
  const raw = bytes(join(dir, 'verify.md'));
  const text = raw.toString('utf8');
  ready(text, 'verify.md');
  const results = [...prose(text).matchAll(/^(?:- )?Verification Result: (\S+)[ \t]*$/gm)];
  if (results.length !== 1 || results[0][1] !== 'PASS') fail('verify.md needs one unambiguous Verification Result: PASS');
  const matrix = section(text, 'Evidence Matrix');
  for (const id of plan.ids) {
    const rows = matrix.split(/\r?\n/).filter((line) => line.startsWith('|') && line.split('|').some((cell) => cell.trim() === id));
    if (rows.length !== 1) fail(`verify.md needs one passing evidence row for ${id}`);
    const row = rows[0];
    const cells = row?.split('|').slice(1, -1).map((cell) => cell.trim()) ?? [];
    if (!row || !cells.includes('PASS') || !cells.some((cell) => cell && cell !== id && cell !== 'PASS') || /\b(?:FAIL|BLOCKED|SKIP|PENDING)\b/i.test(row)) fail(`verify.md missing passing evidence for ${id}`);
  }
  return sha(raw);
}
function save(dir, receipt) {
  const target = safePath(join(dir, 'flow.json'), true);
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    safePath(target, true);
    renameSync(temp, target);
  } finally {
    try { unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function argumentsOf(args) {
  const [command, directory, ...rest] = args;
  if (!['check', 'authorize', 'candidate', 'verify'].includes(command) || !directory) fail(usage);
  const options = {};
  const permitted = { check: ['phase'], authorize: ['author', 'reference'], candidate: ['executor', 'executors', 'files'], verify: ['executor'] }[command];
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
  if (command === 'check' && !['plan', 'apply', 'verify', 'deliver'].includes(options.phase)) fail(usage);
  if (command === 'authorize' && (!options.author || !options.reference)) fail(usage);
  if (command === 'verify' && !options.executor) fail(usage);
  if (command === 'candidate' && ((!options.executor && !options.executors?.length) || (options.executor && options.executors))) fail(usage);
  return { command, dir: resolve(directory), options };
}
export function main(args) {
  let input;
  try { input = argumentsOf(args); } catch (error) { console.error(error.message); return 2; }
  try {
    const { command, dir, options } = input;
    safePath(dir);
    const plan = planAt(dir);
    if (command === 'check' && options.phase === 'plan') {
      console.log(`flow-check: PASS plan (${plan.ids.length} contracts)`);
      return 0;
    }
    const receipt = receiptAt(dir, command === 'authorize');
    if (command === 'authorize') {
      // This records an already granted consent; it never requests or creates consent.
      save(dir, { version: 1, slug: receipt.slug, authorization: { author: options.author, reference: options.reference, at: new Date().toISOString(), action: 'apply', plan_sha256: plan.hash } });
    } else {
      authorization(receipt, plan);
      if (command === 'candidate') {
        const records = recordsFor(options.files, plan);
        for (const [path] of records) if (inside(dir, path)) fail('Workflow artifacts cannot be candidate deliverables');
        const executors = options.executors ?? [options.executor];
        if (executors.some((id) => !id.trim()) || new Set(executors).size !== executors.length) fail('Candidate requires unique non-empty executor identities');
        if (executors.length < plan.applyNames.length) fail('Record every Parallel Unit implementation executor');
        receipt.implementation = { executors, records, sha256: sha(JSON.stringify(records)), apply: applyHashes(dir, plan) };
        delete receipt.verification;
        save(dir, receipt);
      } else if (command === 'verify' || options.phase === 'verify' || options.phase === 'deliver') {
        const impl = implementation(receipt, dir, plan);
        if (command === 'verify') {
          if (impl.executors.includes(options.executor)) fail('Verification must use an independent session/task executor');
          receipt.verification = { executor: options.executor, candidate_sha256: impl.sha256, artifact_sha256: verificationHash(dir, plan) };
          save(dir, receipt);
        } else if (options.phase === 'deliver') {
          const verified = receipt.verification;
          if (!verified?.executor || impl.executors.includes(verified.executor) || verified.candidate_sha256 !== impl.sha256) fail('Missing independent verification receipt');
          if (verified.artifact_sha256 !== verificationHash(dir, plan)) fail('Verification artifact verify.md changed');
        }
      }
    }
    console.log(`flow-check: PASS ${command === 'check' ? options.phase : command}`);
    return 0;
  } catch (error) {
    console.error(`flow-check: BLOCKED ${error.message}`);
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
