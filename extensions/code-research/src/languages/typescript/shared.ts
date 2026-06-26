import { access, readFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { SupportedLanguage } from '../../types.js';

const PROJECT_ROOT_MARKERS = [
  'package.json',
  'tsconfig.json',
  'jsconfig.json',
  'bun.lock',
  'bun.lockb',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'deno.json',
  'deno.jsonc',
] as const;

const SOURCE_ROOT_DIR_NAMES = new Set(['app', 'src']);
const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

export interface TypeScriptPathAlias {
  pattern: string;
  targets: string[];
}

export interface TypeScriptProjectConfig {
  projectRoot: string;
  baseUrl?: string;
  pathAliases: TypeScriptPathAlias[];
}

export function detectLanguage(filePath: string, explicit: SupportedLanguage): Exclude<SupportedLanguage, 'auto'> {
  if (explicit !== 'auto') return explicit;

  const ext = extname(filePath).toLowerCase();
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'js';
  return 'ts';
}

export function isSupportedFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext);
}

export async function resolveTypeScriptProjectRoot(targetPath: string, isDirectory: boolean): Promise<string> {
  const startDir = isDirectory ? targetPath : dirname(targetPath);
  const markerRoot = await findNearestProjectMarkerRoot(startDir);
  if (markerRoot) return markerRoot;

  const sourceRoot = findSourceContainerRoot(startDir);
  return sourceRoot ?? startDir;
}

async function findNearestProjectMarkerRoot(startDir: string): Promise<string | undefined> {
  let current = startDir;

  while (true) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      if (await exists(join(current, marker))) {
        return current;
      }
    }

    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function findSourceContainerRoot(startDir: string): string | undefined {
  let current = startDir;
  let candidate: string | undefined;

  while (true) {
    if (SOURCE_ROOT_DIR_NAMES.has(basename(current))) {
      candidate = dirname(current);
    }

    const parent = dirname(current);
    if (parent === current) return candidate;
    current = parent;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function loadTypeScriptProjectConfig(projectRoot: string): Promise<TypeScriptProjectConfig> {
  const configPath = await resolveProjectConfigPath(projectRoot);
  if (!configPath) {
    return {
      projectRoot,
      pathAliases: [],
    };
  }

  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = parseJsonc(raw);
    const compilerOptions = parsed?.compilerOptions ?? {};
    const rawPaths = compilerOptions.paths ?? {};
    const pathAliases = Object.entries(rawPaths)
      .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
      .map(([pattern, targets]) => ({
        pattern,
        targets: targets.filter((target): target is string => typeof target === 'string'),
      }))
      .filter((entry) => entry.targets.length > 0);

    return {
      projectRoot,
      baseUrl: typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : undefined,
      pathAliases,
    };
  } catch {
    return {
      projectRoot,
      pathAliases: [],
    };
  }
}

export function resolveTypeScriptImportCandidates(
  currentFile: string,
  source: string,
  config: TypeScriptProjectConfig
): string[] {
  const candidates = new Set<string>();

  if (source.startsWith('.')) {
    for (const candidate of buildModuleCandidates(resolve(dirname(currentFile), source))) {
      candidates.add(candidate);
    }
    return [...candidates];
  }

  for (const alias of config.pathAliases) {
    const match = matchAliasPattern(alias.pattern, source);
    if (!match.matched) continue;

    for (const target of alias.targets) {
      const substituted = substituteAliasTarget(target, match.wildcardValue);
      const basePath = resolve(resolveBaseUrl(config), substituted);
      for (const candidate of buildModuleCandidates(basePath)) {
        candidates.add(candidate);
      }
    }
  }

  const baseUrl = config.baseUrl;
  if (baseUrl) {
    const basePath = resolve(resolveBaseUrl(config), source);
    for (const candidate of buildModuleCandidates(basePath)) {
      candidates.add(candidate);
    }
  }

  return [...candidates];
}

export function matchesTypeScriptPathAlias(source: string, config: TypeScriptProjectConfig): boolean {
  return config.pathAliases.some((alias) => matchAliasPattern(alias.pattern, source).matched);
}

async function resolveProjectConfigPath(projectRoot: string): Promise<string | undefined> {
  for (const candidate of ['tsconfig.json', 'jsconfig.json']) {
    const fullPath = join(projectRoot, candidate);
    if (await exists(fullPath)) return fullPath;
  }
  return undefined;
}

function resolveBaseUrl(config: TypeScriptProjectConfig): string {
  return config.baseUrl ? resolve(config.projectRoot, config.baseUrl) : config.projectRoot;
}

function buildModuleCandidates(basePath: string): string[] {
  return [
    basePath,
    ...SUPPORTED_EXTENSIONS.map((ext) => `${basePath}${ext}`),
    ...SUPPORTED_EXTENSIONS.map((ext) => join(basePath, `index${ext}`)),
  ];
}

function matchAliasPattern(pattern: string, source: string): { matched: boolean; wildcardValue?: string } {
  const wildcardIndex = pattern.indexOf('*');
  if (wildcardIndex === -1) {
    return { matched: pattern === source };
  }

  const prefix = pattern.slice(0, wildcardIndex);
  const suffix = pattern.slice(wildcardIndex + 1);
  if (!source.startsWith(prefix) || !source.endsWith(suffix)) {
    return { matched: false };
  }

  return {
    matched: true,
    wildcardValue: source.slice(prefix.length, source.length - suffix.length),
  };
}

function substituteAliasTarget(target: string, wildcardValue?: string): string {
  if (wildcardValue === undefined) return target;
  return target.replace('*', wildcardValue);
}

function parseJsonc(content: string): any {
  const withoutBlockComments = content.replace(/\/\*[\s\S]*?\*\//g, '');
  const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, '');
  const withoutTrailingCommas = withoutLineComments.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(withoutTrailingCommas);
}

export function extractSignature(node: any): string {
  const bodyTypes = new Set([
    'statement_block',
    'class_body',
    'interface_body',
    'object',
  ]);

  interface Range {
    start: number;
    end: number;
  }

  const ranges: Range[] = [];

  function collect(n: any) {
    if (bodyTypes.has(n.type)) {
      ranges.push({ start: n.startIndex, end: n.endIndex });
      return;
    }
    for (const child of n.children) {
      collect(child);
    }
  }

  collect(node);

  ranges.sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push(range);
    }
  }

  let result = '';
  let last = node.startIndex;
  for (const range of merged) {
    result += node.text.slice(last - node.startIndex, range.start - node.startIndex);
    result += ' ... ';
    last = range.end;
  }
  result += node.text.slice(last - node.startIndex);

  return result.replace(/\s+/g, ' ').trim();
}
