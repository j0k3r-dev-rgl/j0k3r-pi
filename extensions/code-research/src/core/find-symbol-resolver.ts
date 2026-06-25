import { readFile } from 'node:fs/promises';
import { getParser, parseSource } from './parser.js';
import { detectLanguage, resolveTargetFiles } from './shared.js';
import {
  buildSymbolLocation as buildTypeScriptSymbolLocation,
  extractSymbols as extractTypeScriptSymbols,
  findImplementationsOf as findTypeScriptImplementationsOf,
} from '../languages/typescript/find-symbol.js';
import {
  buildSymbolLocation as buildJavaSymbolLocation,
  extractSymbols as extractJavaSymbols,
  findImplementationsOf as findJavaImplementationsOf,
} from '../languages/java/find-symbol.js';
import type { FindSymbolInput, SearchMode, SupportedLanguage, SymbolLocation } from '../types.js';

interface LanguageAdapter {
  extractSymbols(rootNode: any): Array<{
    name: string;
    kind: import('../types.js').SymbolKind;
    node: any;
    isDefinition: boolean;
    isImplementation: boolean;
  }>;
  findImplementationsOf(
    symbolName: string,
    files: Array<{ path: string; rootNode: any; language: Exclude<SupportedLanguage, 'auto'> }>
  ): SymbolLocation[];
  buildSymbolLocation(
    filePath: string,
    symbolName: string,
    kind: import('../types.js').SymbolKind,
    node: any,
    isDefinition: boolean,
    isImplementation: boolean,
    includeSignature?: boolean,
    includeCode?: boolean,
    source?: string
  ): SymbolLocation;
}

interface ParsedFile {
  path: string;
  language: Exclude<SupportedLanguage, 'auto'>;
  rootNode: any;
  source: string;
}

const typeScriptAdapter: LanguageAdapter = {
  extractSymbols: extractTypeScriptSymbols,
  findImplementationsOf: findTypeScriptImplementationsOf,
  buildSymbolLocation: buildTypeScriptSymbolLocation,
};

const javaAdapter: LanguageAdapter = {
  extractSymbols: extractJavaSymbols,
  findImplementationsOf: findJavaImplementationsOf,
  buildSymbolLocation: buildJavaSymbolLocation,
};

function getLanguageAdapter(language: Exclude<SupportedLanguage, 'auto'>): LanguageAdapter {
  if (language === 'java') return javaAdapter;
  return typeScriptAdapter;
}


export async function findSymbol(
  cwd: string,
  input: FindSymbolInput
): Promise<SymbolLocation[]> {
  // In-memory cache scoped to this single tool invocation
  const parseCache = new Map<string, ParsedFile>();

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

  const { filesToScan } = await resolveTargetFiles(cwd, input.path, input.glob);

  const parsedFiles: ParsedFile[] = [];
  for (const filePath of filesToScan) {
    let parsed = parseCache.get(filePath);
    if (!parsed) {
      const language = detectLanguage(filePath, explicitLanguage);
      const source = await readFile(filePath, 'utf8');
      const parser = getParser(language);

      let tree: any;
      try {
        tree = parseSource(parser, source);
      } catch (error: any) {
        if (filesToScan.length === 1) {
          throw new Error(`Failed to parse file: ${filePath} (${error?.message ?? 'unknown parse error'})`);
        }
        continue;
      }

      parsed = { path: filePath, language, rootNode: tree.rootNode, source };
      parseCache.set(filePath, parsed);
    }
    parsedFiles.push(parsed);
  }

  const matches: SymbolLocation[] = [];

  for (const file of parsedFiles) {
    const adapter = getLanguageAdapter(file.language);
    const symbols = adapter.extractSymbols(file.rootNode);
    for (const sym of symbols) {
      if (!matchesSymbol(sym.name, input.symbol, searchMode)) continue;
      if (input.kind && sym.kind !== input.kind) continue;

      const location = adapter.buildSymbolLocation(
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
      const adapter = getLanguageAdapter(detectLanguage(match.file, 'auto'));
      match.implementation_locations = adapter.findImplementationsOf(
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

function findDefinitionFor(
  implementation: SymbolLocation,
  files: ParsedFile[],
  includeSignature = false
): SymbolLocation | undefined {
  for (const file of files) {
    const adapter = getLanguageAdapter(file.language);
    const symbols = adapter.extractSymbols(file.rootNode);
    for (const sym of symbols) {
      if (sym.name !== implementation.symbol) continue;
      if (!sym.isDefinition) continue;

      return adapter.buildSymbolLocation(
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
