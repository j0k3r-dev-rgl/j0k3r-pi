export type SupportedLanguage = 'ts' | 'js' | 'java' | 'go' | 'auto';
export type SymbolKind = 'function' | 'class' | 'method' | 'interface' | 'variable' | 'unknown';
export type SearchScope = 'file' | 'directory';
export type SearchMode = 'exact' | 'prefix' | 'contains';
export type WorkspaceGraphStatusKind = 'missing' | 'fresh' | 'stale' | 'refreshing' | 'partial' | 'errored' | 'incompatible';
export type GraphNodeKind = 'workspace' | 'subproject' | 'file' | 'symbol';
export type GraphEdgeKind = 'contains' | 'imports' | 'calls' | 'reads' | 'implements' | 'extends' | 'permits';

export type TypeScriptDeclarationKindValues =
  | 'function'
  | 'function_overload'
  | 'callable_variable'
  | 'variable'
  | 'class'
  | 'constructor'
  | 'method'
  | 'getter'
  | 'setter'
  | 'field'
  | 'interface'
  | 'interface_method'
  | 'property'
  | 'call_signature'
  | 'construct_signature'
  | 'index_signature'
  | 'type_alias'
  | 'enum'
  | 'enum_member'
  | 'namespace'
  | 'module'
  | 'import_alias'
  | 'export_alias'
  | 'object_method'
  | 'object_property'
  | 'assignment'
  | 'commonjs_export';

export type JavaDeclarationKind =
  | 'package'
  | 'module'
  | 'class'
  | 'interface'
  | 'enum'
  | 'enum_constant'
  | 'record'
  | 'record_component'
  | 'annotation'
  | 'annotation_element'
  | 'constructor'
  | 'compact_constructor'
  | 'method'
  | 'field'
  | 'parameter'
  | 'receiver_parameter'
  | 'lambda_parameter'
  | 'local_variable'
  | 'enhanced_for_variable'
  | 'catch_parameter'
  | 'resource_variable'
  | 'pattern_variable'
  | 'type_parameter'
  | 'unknown';

export type DeclarationKind = TypeScriptDeclarationKindValues | JavaDeclarationKind | 'unknown';
/** @deprecated Use DeclarationKind. */
export type TypeScriptDeclarationKind = DeclarationKind;
export type JavaDeclarationFamily = 'compilation_unit' | 'type' | 'callable' | 'member' | 'binding' | 'unknown';
export type JavaUnsupportedFormCode = 'anonymous_class_relationship_only' | 'lambda_relationship_only' | 'initializer_block' | 'unnamed_pattern';
export type SymbolQueryInclusion = 'default' | 'compilation_unit' | 'local_binding' | 'relationship_only';

export type SymbolQuerySourceMode = 'graph';
export type SymbolQueryGraphStatus = 'disabled' | 'fresh' | 'stale' | 'partial' | 'missing' | 'incompatible' | 'error';
export type SymbolQueryCompleteness = 'complete' | 'partial' | 'unavailable';
export type SymbolQueryUnavailableReason =
  | 'graph_disabled'
  | 'graph_missing'
  | 'graph_stale'
  | 'graph_partial'
  | 'graph_incompatible'
  | 'graph_read_error'
  | 'shard_missing'
  | 'shard_corrupt'
  | 'shard_oversized'
  | 'shard_unreadable'
  | 'shard_incompatible'
  | 'snapshot_mismatch'
  | 'coverage_unproven'
  | 'parse_error'
  | 'input_unreadable';

export interface SourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface CanonicalSymbolRecord {
  name: string;
  qualifiedName: string;
  owner?: string;
  ownerChain: string[];
  declarationKind: DeclarationKind;
  coarseKind: SymbolKind;
  sourceName?: string;
  exportedName?: string;
  anonymous?: boolean;
  dynamicName?: boolean;
  modifiers: string[];
  declarationRange: SourceRange;
  codeRange?: SourceRange;
  isDefinition: boolean;
  isImplementation: boolean;
  discriminator: string;
  relationshipId?: string;
  signature?: string;
  symbolId: string;
  sourceHash: string;
  queryInclusion?: SymbolQueryInclusion;
}

export interface CanonicalJavaSymbolRecord extends CanonicalSymbolRecord {
  declarationKind: JavaDeclarationKind;
  javaFamily: JavaDeclarationFamily;
}

export interface JavaRelationshipScope {
  id: string;
  ownerChain: string[];
  kind: 'anonymous_class' | 'lambda';
  range: SourceRange;
}

export interface JavaExtractionResult {
  sourceHash: string;
  records: CanonicalJavaSymbolRecord[];
  relationshipScopes: JavaRelationshipScope[];
  observedFamilies: JavaDeclarationFamily[];
  unsupportedForms: JavaUnsupportedFormCode[];
}

export interface SymbolLocation {
  file: string;
  symbol: string;
  kind: SymbolKind;
  start_line: number;
  start_column: number;
  end_line: number;
  end_column: number;
  code_start_line?: number;
  code_start_column?: number;
  code_end_line?: number;
  code_end_column?: number;
  code_block_type?: 'inline' | 'block' | 'unknown';
  is_definition: boolean;
  is_implementation: boolean;
  definition_location?: SymbolLocation;
  implementation_locations?: SymbolLocation[];
  signature?: string;
  code?: string;
  declaration_kind?: DeclarationKind;
  symbol_id?: string;
  owner?: string;
  qualified_name?: string;
  relationship_id?: string;
  source_name?: string;
  exported_name?: string;
  anonymous?: boolean;
  dynamic_name?: boolean;
  modifiers?: string[];
}

export interface FindSymbolInput {
  path: string;
  symbol: string;
  language?: SupportedLanguage;
  kind?: SymbolKind;
  declaration_kind?: DeclarationKind;
  include_code?: boolean;
  include_signature?: boolean;
  scope?: SearchScope;
  glob?: string;
  search_mode?: SearchMode;
}

export interface SymbolQueryDiagnostics {
  source_mode: SymbolQuerySourceMode;
  graph_status: SymbolQueryGraphStatus;
  completeness: SymbolQueryCompleteness;
  graph_unavailable_reason: SymbolQueryUnavailableReason | null;
  scanned_files_count: number;
  skipped_files_count: number;
  unreadable_shards_count: number;
  graph_generation?: number;
}

export interface FindSymbolResolution {
  results: SymbolLocation[];
  diagnostics: SymbolQueryDiagnostics;
}

export interface FindReferencesInput {
  path: string;
  symbol: string;
  language?: SupportedLanguage;
  kind?: SymbolKind;
  scope?: SearchScope;
  glob?: string;
  reference_kinds?: ReferenceKind[];
}

export type ReferenceQuerySourceMode = 'graph';
export type ReferenceQueryGraphStatus = 'disabled' | 'fresh' | 'stale' | 'partial' | 'missing' | 'incompatible' | 'error';
export type ReferenceQueryCompleteness = 'complete' | 'unavailable';
export type ReferenceQueryUnavailableReason =
  | 'graph_disabled'
  | 'graph_missing'
  | 'graph_stale'
  | 'graph_partial'
  | 'graph_incompatible'
  | 'graph_read_error'
  | 'language_unsupported'
  | 'coverage_insufficient'
  | 'state_unreadable'
  | 'manifest_unreadable';

export interface ReferenceQueryDiagnostics {
  source_mode: ReferenceQuerySourceMode;
  graph_status: ReferenceQueryGraphStatus;
  completeness: ReferenceQueryCompleteness;
  graph_unavailable_reason: ReferenceQueryUnavailableReason | null;
}

export interface FindReferencesResolution {
  results: ReferenceLocation[];
  diagnostics: ReferenceQueryDiagnostics;
}

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
export type ConfidenceClassification = 'confirmed' | 'probable' | 'framework';
export type ClassificationCounts = Partial<Record<ConfidenceClassification, number>>;
export type OwnerKind = 'class' | 'interface' | 'object' | 'namespace' | 'module' | 'unknown';
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
  classification?: ConfidenceClassification;
  reason?: string;
  children?: CallTreeNode[];
  callers?: CallTreeNode[];
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

export type ReferenceKind =
  | 'call'
  | 'import'
  | 'instantiate'
  | 'implements'
  | 'extends'
  | 'read'
  | 'write'
  | 'type_reference'
  | 'callback'
  | 'method_reference';

export interface ReferenceLocation {
  file: string;
  line: number;
  column: number;
  end_line?: number;
  end_column?: number;
  symbol: string;
  kind: SymbolKind;
  context_symbol?: string;
  context_kind?: SymbolKind;
  context_class?: string;
  owner_kind?: OwnerKind;
  reference_kind: ReferenceKind;
  called_as?: string;
  source_line?: string;
  receiver_name?: string;
  receiver_type?: string;
  is_application: boolean;
  source: CallSource;
  classification?: ConfidenceClassification;
  reason?: string;
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
  languageHints: Array<'java' | 'go' | 'ts' | 'js'>;
  shardPath: string;
  snapshot: SubprojectSnapshot;
  generation: number;
  markers: string[];
}

export interface WorkspaceGraphState {
  schemaVersion: number;
  builderModelVersion: number;
  builderFingerprint: string;
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
  builderModelVersion: number;
  builderFingerprint: string;
  createdBy: 'pi-code-research-extension';
  projectRoot: string;
  generation: number;
  workspaceNodeId: string;
  subprojects: Array<{ id: string; root: string; shardPath: string; generation: number }>;
}

export type GraphNode =
  | { id: string; kind: 'workspace'; name: string; root: string }
  | { id: string; kind: 'subproject'; name: string; root: string; markers: string[]; languages: string[] }
  | { id: string; kind: 'file'; path: string; language: 'java' | 'go' | 'ts' | 'js'; size: number; entrypoint?: boolean }
  | {
      id: string;
      kind: 'symbol';
      language: 'java' | 'go' | 'ts' | 'js';
      symbolKind: SymbolKind;
      name: string;
      file: string;
      range: SourceRange;
      codeRange?: SourceRange;
      owner?: string;
      ownerKind?: OwnerKind;
      exported: boolean;
      signature?: string;
      entrypoint?: boolean;
      declarationKind?: DeclarationKind;
      symbolId?: string;
      logicalSymbolKey?: string;
      snapshotSymbolId?: string;
      qualifiedName?: string;
      relationshipId?: string;
      sourceName?: string;
      exportedName?: string;
      anonymous?: boolean;
      dynamicName?: boolean;
      modifiers?: string[];
      isDefinition?: boolean;
      isImplementation?: boolean;
      sourceHash?: string;
    };

export interface GraphEdge {
  id: string;
  kind: GraphEdgeKind;
  from: string;
  to: string;
  occurrenceRange?: SourceRange;
  targetStatus?: 'resolved' | 'ambiguous' | 'external' | 'unresolved';
  resolution?: 'exact' | 'heuristic' | 'ambiguous' | 'unresolved';
  callsite?: { line: number; column: number; receiverName?: string; receiverType?: string };
  calledAs?: string;
  importSource?: string;
  external?: boolean;
  externalName?: string;
  externalKind?: SymbolKind;
  externalOwner?: string;
  externalOwnerKind?: OwnerKind;
  externalSource?: CallSource;
  targetRelationshipId?: string;
  reason?: string;
}

export interface TypeScriptSymbolCoverageFileProof {
  sourceHash: string;
  symbolCount: number;
}

export interface TypeScriptSymbolCoverageSkippedFile {
  file: string;
  reason: 'parse_error' | 'input_unreadable' | 'unsupported_language' | 'unsupported_source';
}

export interface TypeScriptSymbolCoverage {
  modelVersion: 1;
  compilerModelVersion: string;
  grammar: {
    typescript: string;
    tsx: string;
  };
  generation: number;
  completeFiles: string[];
  skippedFiles: TypeScriptSymbolCoverageSkippedFile[];
  fileProofs: Record<string, TypeScriptSymbolCoverageFileProof>;
}

export interface JavaSymbolCoverageFileProof {
  sourceHash: string;
  symbolCount: number;
  relationshipScopeCount: number;
  observedFamilies: JavaDeclarationFamily[];
  unsupportedForms: JavaUnsupportedFormCode[];
}

export interface JavaSymbolCoverageSkippedFile {
  file: string;
  reason: 'parse_error' | 'input_unreadable' | 'unsupported_source';
}

export interface JavaSymbolCoverage {
  modelVersion: 1;
  grammar: { package: 'tree-sitter-java'; version: '0.23.5' };
  generation: number;
  sourceSnapshotId: string;
  completeFiles: string[];
  skippedFiles: JavaSymbolCoverageSkippedFile[];
  fileProofs: Record<string, JavaSymbolCoverageFileProof>;
}

export interface GoSymbolCoverageFileProof {
  sourceHash: string;
  symbolCount: number;
}

export interface GoSymbolCoverageSkippedFile {
  file: string;
  reason: 'parse_error' | 'input_unreadable' | 'unsupported_source';
}

export interface GoSymbolCoverage {
  modelVersion: 1;
  grammar: { package: 'tree-sitter-go'; version: '0.23.3' };
  generation: number;
  completeFiles: string[];
  skippedFiles: GoSymbolCoverageSkippedFile[];
  fileProofs: Record<string, GoSymbolCoverageFileProof>;
}

export interface SubprojectGraphShard {
  schemaVersion: number;
  builderModelVersion: number;
  builderFingerprint: string;
  createdBy: 'pi-code-research-extension';
  subprojectId: string;
  generation: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  typescriptSymbolCoverage?: TypeScriptSymbolCoverage;
  javaSymbolCoverage?: JavaSymbolCoverage;
  goSymbolCoverage?: GoSymbolCoverage;
}

export interface GraphLookupPolicy {
  allowStale: boolean;
  maxStaleMs?: number;
}
