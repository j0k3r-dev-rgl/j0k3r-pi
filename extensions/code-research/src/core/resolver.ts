import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { minimatch } from 'minimatch';
import { getParser } from './parser.js';
import {
  buildSymbolLocation,
  detectLanguage,
  extractSymbols,
  findImplementationsOf,
  isSupportedFile,
} from '../languages/typescript.js';
import type { FindSymbolInput, SearchMode, SupportedLanguage, SymbolLocation } from '../types.js';

interface ParsedFile {
  path: string;
  language: Exclude<SupportedLanguage, 'auto'>;
  rootNode: any;
  source: string;
}

export async function findSymbol(
  cwd: string,
  input: FindSymbolInput
): Promise<SymbolLocation[]> {
  // In-memory cache scoped to this single tool invocation
  const parseCache = new Map<string, ParsedFile>();

  const targetPath = resolve(cwd, input.path);
  const explicitLanguage = input.language ?? 'auto';
  const includeSignature = input.include_signature ?? false;
  const searchMode = input.search_mode ?? 'exact';
  let includeCode = input.include_code ?? false;

  // include_code is only allowed for functions and methods to avoid huge payloads
  if (includeCode && input.kind && input.kind !== 'function' && input.kind !== 'method') {
    includeCode = false;
  }

  // include_code is disabled for non-exact searches to avoid flooding context
  if (includeCode && searchMode !== 'exact') {
    includeCode = false;
  }

  let targetStat;
  try {
    targetStat = await stat(targetPath);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error(`Path not found: ${input.path}`);
    }
    throw err;
  }

  const isDirectory = targetStat.isDirectory();

  const filesToScan: string[] = isDirectory
    ? await collectSupportedFiles(targetPath, input.glob)
    : [targetPath];

  const parsedFiles: ParsedFile[] = [];
  for (const filePath of filesToScan) {
    let parsed = parseCache.get(filePath);
    if (!parsed) {
      const language = detectLanguage(filePath, explicitLanguage);
      const source = await readFile(filePath, 'utf8');
      const parser = getParser(language);
      const tree = parser.parse(source);
      parsed = { path: filePath, language, rootNode: tree.rootNode, source };
      parseCache.set(filePath, parsed);
    }
    parsedFiles.push(parsed);
  }

  const matches: SymbolLocation[] = [];

  for (const file of parsedFiles) {
    const symbols = extractSymbols(file.rootNode);
    for (const sym of symbols) {
      if (!matchesSymbol(sym.name, input.symbol, searchMode)) continue;
      if (input.kind && sym.kind !== input.kind) continue;

      const location = buildSymbolLocation(
        file.path,
        sym.name,
        sym.kind,
        sym.node,
        sym.isDefinition,
        sym.isImplementation,
        includeSignature,
        includeCode,
        file.source
      );

      matches.push(location);
    }
  }

  // Enrich interface definitions with implementation locations
  for (const match of matches) {
    if (match.kind === 'interface' && match.is_definition) {
      match.implementation_locations = findImplementationsOf(
        match.symbol,
        parsedFiles
      );
    }
  }

  // If the matched symbol is an implementation, try to find its definition
  for (const match of matches) {
    if (match.is_implementation && !match.is_definition) {
      const definition = findDefinitionFor(match, parsedFiles, includeSignature);
      if (definition) {
        match.definition_location = definition;
      }
    }
  }

  return matches;
}

function matchesSymbol(name: string, query: string, mode: SearchMode): boolean {
  switch (mode) {
    case 'prefix':
      return name.startsWith(query);
    case 'contains':
      return name.includes(query);
    case 'exact':
    default:
      return name === query;
  }
}

async function collectSupportedFiles(dir: string, glob?: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      files.push(...(await collectSupportedFiles(fullPath, glob)));
    } else if (entry.isFile() && isSupportedFile(fullPath)) {
      if (glob && !minimatch(fullPath, glob) && !minimatch(entry.name, glob)) continue;
      files.push(fullPath);
    }
  }

  return files;
}

function findDefinitionFor(
  implementation: SymbolLocation,
  files: ParsedFile[],
  includeSignature = false
): SymbolLocation | undefined {
  for (const file of files) {
    const symbols = extractSymbols(file.rootNode);
    for (const sym of symbols) {
      if (sym.name !== implementation.symbol) continue;
      if (!sym.isDefinition) continue;

      return buildSymbolLocation(
        file.path,
        sym.name,
        sym.kind,
        sym.node,
        true,
        false,
        includeSignature,
        false
      );
    }
  }

  return undefined;
}
