export type SupportedLanguage = 'ts' | 'js' | 'auto';
export type SymbolKind = 'function' | 'class' | 'method' | 'interface' | 'variable' | 'unknown';
export type SearchScope = 'file' | 'directory';

export interface SymbolLocation {
  file: string;
  symbol: string;
  kind: SymbolKind;
  start_line: number;
  start_column: number;
  end_line: number;
  end_column: number;
  is_definition: boolean;
  is_implementation: boolean;
  definition_location?: SymbolLocation;
  implementation_locations?: SymbolLocation[];
  signature?: string;
  code?: string;
}

export interface FindSymbolInput {
  path: string;
  symbol: string;
  language?: SupportedLanguage;
  kind?: SymbolKind;
  include_code?: boolean;
  include_signature?: boolean;
  scope?: SearchScope;
  glob?: string;
  search_mode?: SearchMode;
}

export type SearchMode = 'exact' | 'prefix' | 'contains';
