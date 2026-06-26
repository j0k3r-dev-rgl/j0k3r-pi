export type SupportedLanguage = 'ts' | 'js' | 'java' | 'auto';
export type SymbolKind = 'function' | 'class' | 'method' | 'interface' | 'variable' | 'unknown';
export type SearchScope = 'file' | 'directory';
export type WorkspaceGraphStatusKind = 'missing' | 'fresh' | 'stale' | 'refreshing' | 'partial' | 'errored' | 'incompatible';
export type GraphNodeKind = 'workspace' | 'subproject' | 'file' | 'symbol';
export type GraphEdgeKind = 'contains' | 'imports' | 'calls' | 'implements' | 'extends';

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
  compacted?: boolean;
}

export type CallSource = 'application' | 'language' | 'framework' | 'library' | 'unknown';
export type OwnerKind = 'class' | 'interface' | 'unknown';
export type CallNodeType = 'application' | 'external' | 'callback' | 'data_access' | 'fluent_chain' | 'framework';

export interface CallTreeNode {
  file?: string;
  symbol: string;
  kind: SymbolKind;
  node_type: CallNodeType;
  class?: string;
  package?: string;
  owner_kind?: OwnerKind;
  line?: number;
  column?: number;
  start_line?: number;
  start_column?: number;
  end_line?: number;
  end_column?: number;
  call_line?: number;
  call_column?: number;
  signature?: string;
  called_as?: string;
  receiver_name?: string;
  receiver_type?: string;
  has_callback?: boolean;
  callback_kind?: 'lambda' | 'method_reference' | 'anonymous_class';
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

export interface SubprojectSnapshotEntry {
  mtimeMs: number;
  size: number;
  hash?: string;
}

export type SubprojectSnapshot = Record<string, SubprojectSnapshotEntry>;

export interface SubprojectGraphState {
  id: string;
  root: string;
  status: WorkspaceGraphStatusKind;
  languageHints: Array<'java' | 'ts' | 'js'>;
  shardPath: string;
  snapshot: SubprojectSnapshot;
  generation: number;
  markers: string[];
}

export interface WorkspaceGraphState {
  schemaVersion: number;
  createdBy: 'pi-code-research-extension';
  projectRoot: string;
  status: WorkspaceGraphStatusKind;
  generation: number;
  manifestPath?: string;
  updatedAt: string;
  subprojects: SubprojectGraphState[];
  coverage: {
    indexedFiles: number;
    skippedLargeFiles: number;
    skippedUnsupportedFiles: number;
    excludedDirectories: string[];
    unreadableDirectories: string[];
  };
  error?: { code: string; message: string; at: string };
}

export interface GraphManifest {
  schemaVersion: number;
  createdBy: 'pi-code-research-extension';
  projectRoot: string;
  generation: number;
  workspaceNodeId: string;
  subprojects: Array<{ id: string; root: string; shardPath: string; generation: number }>;
}

export type GraphNode =
  | { id: string; kind: 'workspace'; name: string; root: string }
  | { id: string; kind: 'subproject'; name: string; root: string; markers: string[]; languages: string[] }
  | { id: string; kind: 'file'; path: string; language: 'java' | 'ts' | 'js'; size: number }
  | {
      id: string;
      kind: 'symbol';
      language: 'java' | 'ts' | 'js';
      symbolKind: SymbolKind;
      name: string;
      file: string;
      range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
      owner?: string;
      ownerKind?: OwnerKind;
      exported: boolean;
      signature?: string;
    };

export interface GraphEdge {
  id: string;
  kind: GraphEdgeKind;
  from: string;
  to: string;
  callsite?: { line: number; column: number; text?: string; receiverName?: string; receiverType?: string };
  importSource?: string;
  external?: boolean;
  externalName?: string;
  externalKind?: SymbolKind;
  externalOwner?: string;
  externalOwnerKind?: OwnerKind;
  externalSource?: CallSource;
  reason?: string;
}

export interface SubprojectGraphShard {
  schemaVersion: number;
  createdBy: 'pi-code-research-extension';
  subprojectId: string;
  generation: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphLookupPolicy {
  allowStale: boolean;
  maxStaleMs?: number;
}
