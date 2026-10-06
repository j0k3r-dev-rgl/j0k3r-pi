import type { Scope } from '../types.ts';

export const ENTITY_TYPES = ['project', 'technology', 'concept', 'file', 'memory'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const RELATION_TYPES = [
  'uses',
  'about',
  'references',
  'depends_on',
  'related_to',
  'contradicts',
] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export interface SaveEntityInput {
  id?: string;
  type: EntityType;
  name: string;
  displayName?: string;
  aliases?: string[];
  scope: Scope;
  memoryId?: number;
}

export interface SaveEntityOptions {
  sessionId: string;
  explicitGlobalWrite?: boolean;
  signal?: AbortSignal;
  assertActive?: () => void;
}

export interface SaveEntityResult {
  status: 'ok';
  operation: 'save_entity';
  id: string;
  type: EntityType;
  canonical_name: string;
  display_name: string;
  scope: Scope;
  truncated?: boolean;
}

export interface SaveRelationInput {
  id?: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: RelationType;
  scope: Scope;
}

export interface SaveRelationOptions {
  sessionId: string;
  explicitGlobalWrite?: boolean;
  signal?: AbortSignal;
  assertActive?: () => void;
}

export interface SaveRelationResult {
  status: 'ok';
  operation: 'save_relation';
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: RelationType;
  scope: Scope;
  existed?: boolean;
}

export interface DeleteRelationInput {
  id: string;
  scope: Scope;
}

export interface DeleteRelationOptions {
  signal?: AbortSignal;
  assertActive?: () => void;
}

export interface DeleteRelationResult {
  status: 'ok';
  operation: 'delete_relation';
  id: string;
  scope: Scope;
}

export interface SaveAssociationInput {
  id?: string;
  memoryId: number;
  entityId: string;
  scope: Scope;
}

export interface SaveAssociationOptions {
  sessionId: string;
  signal?: AbortSignal;
  assertActive?: () => void;
}

export interface SaveAssociationResult {
  status: 'ok';
  operation: 'save_association';
  id: string;
  memory_id: number;
  entity_id: string;
  scope: Scope;
  existed?: boolean;
}

export interface DeleteAssociationInput {
  id?: string;
  memoryId?: number;
  entityId?: string;
  scope: Scope;
}

export interface DeleteAssociationOptions {
  signal?: AbortSignal;
  assertActive?: () => void;
}

export interface DeleteAssociationResult {
  status: 'ok';
  operation: 'delete_association';
  memory_id?: number;
  entity_id?: string;
  id?: string;
  scope: Scope;
}

export interface GetEntityOptions {
  id?: string;
  type?: EntityType;
  name?: string;
  scope: Scope;
  explicitGlobal?: boolean;
  signal?: AbortSignal;
  assertActive?: () => void;
}

export interface EntityRecord {
  id: string;
  type: EntityType;
  canonical_name: string;
  display_name: string;
  scope: Scope;
  aliases: string[];
  aliases_truncated?: boolean;
  total_aliases?: number;
  memory_id: number | null;
  memory_summary?: {
    title: string;
    excerpt: string;
  };
  created_at: string;
  updated_at: string;
  session_id: string;
}

export interface ListEntitiesOptions {
  scope: Scope;
  explicitGlobal?: boolean;
  type?: EntityType;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
  assertActive?: () => void;
  maxEnvelopeBytes?: number;
  isWithinBudget?: (envelope: ListEntitiesResult) => boolean;
}

export interface ListEntitiesResult {
  status: 'ok';
  scope: {
    kind: 'global' | 'project';
    project?: string;
    explicit_global: boolean;
  };
  entities: EntityRecord[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface TraverseGraphOptions {
  rootEntityId: string;
  scope: Scope;
  explicitGlobal?: boolean;
  maxHops?: number;
  maxEntities?: number;
  signal?: AbortSignal;
  assertActive?: () => void;
  maxEnvelopeBytes?: number;
  isWithinBudget?: (envelope: GraphTraverseEnvelope) => boolean;
}

export interface GraphNode {
  id: string;
  type: EntityType;
  canonical_name: string;
  display_name: string;
  scope: Scope;
  depth: number;
  memory_summary?: {
    title: string;
    excerpt: string;
  };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: RelationType;
  scope: Scope;
  direction: 'outgoing' | 'incoming';
}

export interface GraphAssociation {
  id: string;
  memory_id: number;
  entity_id: string;
  scope: Scope;
}

export interface GraphLimits {
  depth_limit: boolean;
  entity_limit: boolean;
  byte_limit: boolean;
  max_hops: number;
  max_entities: number;
  has_more: boolean;
  guidance?: string;
}

export interface GraphTraverseEnvelope {
  status: 'ok';
  root: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
  associations: GraphAssociation[];
  limits: GraphLimits;
}
