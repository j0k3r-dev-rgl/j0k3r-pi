export type SupportedLanguage = 'ts' | 'js' | 'java' | 'auto';
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

export interface FunctionCallTreeInput {
  path: string;
  symbol: string;
  language?: SupportedLanguage;
  kind?: SymbolKind;
  max_depth?: number;
  include_external?: boolean;
}

export type CallSource = 'application' | 'language' | 'framework' | 'library' | 'unknown';

export interface CallTreeNode {
  file?: string;
  symbol: string;
  kind: SymbolKind;
  class?: string;
  package?: string;
  line?: number;
  column?: number;
  is_application: boolean;
  is_external: boolean;
  source: CallSource;
  reason?: string;
  children?: CallTreeNode[];
}

export interface FunctionCallTreeResult {
  root: CallTreeNode;
  stats: {
    total_nodes: number;
    application_nodes: number;
    external_nodes: number;
    max_depth_reached: number;
  };
}
