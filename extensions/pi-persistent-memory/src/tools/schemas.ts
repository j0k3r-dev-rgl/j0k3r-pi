import { Type } from 'typebox';

export const SaveSchema = Type.Object(
  {
    action: Type.Optional(Type.String({ enum: ['save', 'reindex'], description: "Action to perform: 'save' (default) or 'reindex'" })),
    id: Type.Optional(Type.Integer({ minimum: 1, description: 'Target memory ID for update or specific reindex' })),
    topic_key: Type.Optional(Type.String({ description: 'Optional stable topic key for upserts or deduplication' })),
    title: Type.Optional(Type.String({ description: 'Memory title in English' })),
    content: Type.Optional(Type.String({ description: 'Memory content in English prose' })),
    type: Type.Optional(Type.String({ description: "Category/type of memory, e.g. 'note', 'decision', 'session_summary', 'project_summary'" })),
    scope: Type.Optional(Type.String({ enum: ['project', 'global'], description: "Target write scope: 'project' (default) or 'global'" })),
    global: Type.Optional(Type.Boolean({ description: 'If true during reindex, targets all projects' })),
    cursor: Type.Optional(Type.String({ description: 'Continuation cursor for bulk reindex' })),
  },
  { additionalProperties: false },
);

export const SearchSchema = Type.Object(
  {
    query: Type.Optional(Type.String({ description: 'Search query in English. Required for non-graph modes.' })),
    mode: Type.Optional(Type.String({ enum: ['hybrid', 'semantic', 'fts5', 'graph'], description: "Search mode: 'hybrid' (default), 'semantic', 'fts5', or 'graph'" })),
    global: Type.Optional(Type.Boolean({ description: 'If true, searches across all projects' })),
    cursor: Type.Optional(Type.String({ description: 'Continuation cursor for paginated results' })),
    entity_id: Type.Optional(Type.String({ description: "Target entity ID for 'graph' neighborhood search" })),
  },
  { additionalProperties: false },
);

export const GetSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1, description: 'Positive integer ID of the memory to retrieve' }),
    global: Type.Optional(Type.Boolean({ description: 'If true, permits reading memory from other projects' })),
    cursor: Type.Optional(Type.String({ description: 'Continuation cursor for progressive reading' })),
  },
  { additionalProperties: false },
);

export const ContextSchema = Type.Object(
  {
    global: Type.Optional(Type.Boolean({ description: 'If true, includes memories from other projects after local priority' })),
    cursor: Type.Optional(Type.String({ description: 'Continuation cursor for progressive context' })),
  },
  { additionalProperties: false },
);

export const DeleteSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1, description: 'Positive integer ID of the memory to soft-delete' }),
    owner_scope: Type.String({ enum: ['project', 'global'], description: "Asserted owner scope of the memory: 'project' or 'global'" }),
    scope: Type.Optional(Type.String({ enum: ['project', 'global'], description: 'Target scope override if applicable' })),
  },
  { additionalProperties: false },
);

export const RestoreSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1, description: 'Positive integer ID of the soft-deleted memory to restore' }),
    owner_scope: Type.String({ enum: ['project', 'global'], description: "Asserted owner scope of the memory: 'project' or 'global'" }),
    scope: Type.Optional(Type.String({ enum: ['project', 'global'], description: 'Target scope override if applicable' })),
  },
  { additionalProperties: false },
);

export const DeletedListSchema = Type.Object(
  {
    global: Type.Optional(Type.Boolean({ description: 'If true, lists deleted memories across all projects' })),
    cursor: Type.Optional(Type.String({ description: 'Continuation cursor for progressive deleted list' })),
  },
  { additionalProperties: false },
);

export const EntitySchema = Type.Object(
  {
    action: Type.String({ enum: ['save', 'get', 'list'], description: "Action to perform: 'save', 'get', or 'list'" }),
    id: Type.Optional(Type.String({ description: 'Entity ID (required for get; optional for save)' })),
    type: Type.Optional(Type.String({ enum: ['project', 'technology', 'file', 'concept', 'memory'], description: 'Entity type' })),
    name: Type.Optional(Type.String({ description: 'Entity display name' })),
    aliases: Type.Optional(Type.Array(Type.String(), { description: 'Known aliases or alternative names' })),
    memory_id: Type.Optional(Type.Integer({ minimum: 1, description: "Associated memory ID (required for type 'memory')" })),
    scope: Type.Optional(Type.String({ enum: ['project', 'global'], description: "Write scope for action 'save'" })),
    global: Type.Optional(Type.Boolean({ description: "Read across all projects for action 'get' or 'list'" })),
    cursor: Type.Optional(Type.String({ description: "Continuation cursor for action 'list'" })),
  },
  { additionalProperties: false },
);

export const RelationSchema = Type.Object(
  {
    action: Type.String({ enum: ['save', 'delete'], description: "Action to perform: 'save' or 'delete'" }),
    id: Type.Optional(Type.String({ description: 'Relation ID (for delete or update)' })),
    source: Type.Optional(Type.String({ description: 'Source entity ID' })),
    target: Type.Optional(Type.String({ description: 'Target entity ID' })),
    relation_type: Type.Optional(Type.String({ enum: ['depends_on', 'implements', 'references', 'configured_by', 'owned_by', 'related_to'], description: 'Relation type' })),
    scope: Type.Optional(Type.String({ enum: ['project', 'global'], description: 'Target scope' })),
  },
  { additionalProperties: false },
);
