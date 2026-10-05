export type Scope =
  | { kind: 'global' }
  | { kind: 'project'; project: string };

export interface Session {
  id: string;
  scope_key: string;
  kind: 'normal' | 'child';
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface Memory {
  id: number;
  scope_key: string;
  title: string;
  content: string;
  type: string;
  topic_key: string | null;
  content_version: number;
  deleted_at: string | null;
  indexing_status: 'pending' | 'indexed' | 'failed';
  pending_reason: string | null;
  session_id: string;
  invoking_parent_session_id: string | null;
  invocation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Chunk {
  id: number;
  memory_id: number;
  chunk_index: number;
  chunk_text: string;
  start_char: number;
  end_char: number;
  token_count: number;
  content_version: number;
  model_id: string;
  model_revision: string;
  dimensions: number;
  normalized: number;
  created_at: string;
}

export interface Entity {
  id: string;
  type: string;
  canonical_name: string;
  scope_key: string;
  display_name: string;
  aliases_json: string;
  memory_id: number | null;
  session_id: string;
  created_at: string;
  updated_at: string;
}

export interface Relation {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
  scope_key: string;
  session_id: string;
  created_at: string;
}

export interface MemoryEntityLink {
  id: string;
  memory_id: number;
  entity_id: string;
  scope_key: string;
  session_id: string;
  created_at: string;
}

export interface CreateMemoryInput {
  scopeKey: string;
  title: string;
  content: string;
  type: string;
  topicKey?: string | null;
  sessionId: string;
  invokingParentSessionId?: string | null;
  invocationId?: string | null;
}

export interface ReplaceMemoryInput {
  scopeKey: string;
  title: string;
  content: string;
  type: string;
  topicKey?: string | null;
  sessionId: string;
  invokingParentSessionId?: string | null;
  invocationId?: string | null;
}

export interface SyntheticChunkInput {
  chunk_text: string;
  start_char: number;
  end_char: number;
  token_count: number;
  vector: number[];
}

export interface CreateEntityInput {
  id: string;
  type: string;
  canonicalName: string;
  scopeKey: string;
  displayName: string;
  aliases?: string[];
  memoryId?: number | null;
  sessionId: string;
}

export interface CreateRelationInput {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  scopeKey: string;
  sessionId: string;
}

export interface CreateMemoryEntityLinkInput {
  id: string;
  memoryId: number;
  entityId: string;
  scopeKey: string;
  sessionId: string;
}
