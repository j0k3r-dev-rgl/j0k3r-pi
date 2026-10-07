import { Type } from 'typebox';
import { RELATION_TYPES } from '../graph/types.ts';

export const SaveSchema = Type.Object(
  {
    action: Type.Optional(Type.String({ enum: ['save', 'reindex'], description: 'save (default) persists title/content/type; reindex retries embeddings only and forbids title/content/type/topic_key' })),
    id: Type.Optional(Type.Integer({ minimum: 1, description: 'Known positive memory ID: save replaces this record in the target scope; reindex targets one record in the current scope (no cursor)' })),
    topic_key: Type.Optional(Type.String({ description: 'Stable same-topic upsert key in the target scope, e.g. convention/test-runner; pass existing key on id updates to retain it. Save only; omit for session_summary' })),
    title: Type.Optional(Type.String({ description: 'Non-empty English title required for save (including updates); forbidden for reindex' })),
    content: Type.Optional(Type.String({ description: 'Non-empty English knowledge with source/context, required for save; replaces existing content on update, so preserve valid facts. Forbidden for reindex' })),
    type: Type.Optional(Type.String({ description: 'Non-empty category required for save, e.g. note, decision, lesson, project_summary. session_summary requires explicit user request. Forbidden for reindex' })),
    scope: Type.Optional(Type.String({ enum: ['project', 'global'], description: 'Save target: current resolved scope by default; global for authorized cross-project knowledge. Does not select reindex scope' })),
    global: Type.Optional(Type.Boolean({ description: 'Bulk reindex only: true targets pending records across projects; not a save-scope selector or an override for id reindex' })),
    cursor: Type.Optional(Type.String({ description: 'Returned next_cursor for bulk reindex with unchanged global selection; omit for save and id reindex; never invent' })),
  },
  { additionalProperties: false },
);

export const SearchSchema = Type.Object(
  {
    query: Type.Optional(Type.String({ description: 'Non-empty English query with technical literals preserved, required on every hybrid/semantic/fts5 page; omit for graph' })),
    mode: Type.Optional(Type.String({ enum: ['hybrid', 'semantic', 'fts5', 'graph'], description: 'hybrid (default) for topical recall, semantic for concepts, fts5 for lexical identifiers/errors without embeddings, graph for known entity relationships' })),
    global: Type.Optional(Type.Boolean({ description: 'Expand reads across projects and global records when relevant; false/default stays in the resolved project. Never grants write access' })),
    cursor: Type.Optional(Type.String({ description: 'Returned next_cursor with the same query, mode and global selection; omit for graph. Restart search if expired; never invent' })),
    entity_id: Type.Optional(Type.String({ description: 'Known string entity ID from memory_entity or orchestrator, required only for graph; not an integer memory ID. Omit query/cursor' })),
  },
  { additionalProperties: false },
);

export const GetSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1, description: 'Known positive integer memory ID from search/context/save, required on every page; not a graph entity ID' }),
    global: Type.Optional(Type.Boolean({ description: 'Permit relevant cross-project reads; keep unchanged during pagination. Read permission does not authorize updates' })),
    cursor: Type.Optional(Type.String({ description: 'Returned next_cursor with the same id and global selection to continue full title/content; omit initially, never invent' })),
  },
  { additionalProperties: false },
);

export const ContextSchema = Type.Object(
  {
    global: Type.Optional(Type.Boolean({ description: 'Include cross-project memories after local priority only when relevant; default is current resolved scope' })),
    cursor: Type.Optional(Type.String({ description: 'Returned next_cursor with unchanged global selection; follow only when more context is needed, never invent' })),
  },
  { additionalProperties: false },
);

export const DeleteSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1, description: 'Known active memory ID selected for explicitly authorized recoverable deletion; inspect the target first' }),
    owner_scope: Type.String({ enum: ['project', 'global'], description: 'Must match the record owner and selected target scope: project or global; assertion does not grant cross-project write access' }),
    scope: Type.Optional(Type.String({ enum: ['project', 'global'], description: 'Current resolved scope by default; set global together with owner_scope=global for a global record from a project session' })),
  },
  { additionalProperties: false },
);

export const RestoreSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1, description: 'Known deleted memory ID returned by memory_deleted_list, selected for explicitly authorized recovery' }),
    owner_scope: Type.String({ enum: ['project', 'global'], description: 'Must match the deleted record owner and selected target scope from recovery metadata: project or global' }),
    scope: Type.Optional(Type.String({ enum: ['project', 'global'], description: 'Current resolved scope by default; set global together with owner_scope=global for recovery of a global record' })),
  },
  { additionalProperties: false },
);

export const DeletedListSchema = Type.Object(
  {
    global: Type.Optional(Type.Boolean({ description: 'Expand recovery metadata reads across projects and global records; does not authorize restoring foreign-project records' })),
    cursor: Type.Optional(Type.String({ description: 'Returned next_cursor with the same global selection for further recovery metadata; omit initially, never invent' })),
  },
  { additionalProperties: false },
);

export const EntitySchema = Type.Object(
  {
    action: Type.String({ enum: ['save', 'get', 'list'], description: 'get reads a known entity ID; list discovers IDs (optional type filter); save requires type/name and authorized graph management' }),
    id: Type.Optional(Type.String({ description: 'Known string entity ID, required for get and optional for save update; distinct from integer memory_id' })),
    type: Type.Optional(Type.String({ enum: ['project', 'technology', 'file', 'concept', 'memory'], description: 'Required for save, optional filter for list; immutable on update. File/project entities are project-owned' })),
    name: Type.Optional(Type.String({ description: 'Required for save; canonical identity determines upsert. For file use a normalized project-relative path' })),
    aliases: Type.Optional(Type.Array(Type.String(), { description: 'Explicit alternative names for save; aliases must not collide with another canonical name or alias in the scope' })),
    memory_id: Type.Optional(Type.Integer({ minimum: 1, description: 'Positive active memory ID required only for type=memory; forbidden for other types and immutable on update' })),
    scope: Type.Optional(Type.String({ enum: ['project', 'global'], description: 'Save write scope, current resolved scope by default; global only for authorized shared entities. Does not expand reads' })),
    global: Type.Optional(Type.Boolean({ description: 'Expand get/list reads across projects and global records; does not select or authorize save scope' })),
    cursor: Type.Optional(Type.String({ description: 'Returned next_cursor for list with the same type filter/global selection; omit for get/save, never invent' })),
  },
  { additionalProperties: false },
);

export const RelationSchema = Type.Object(
  {
    action: Type.String({ enum: ['save', 'delete'], description: 'save requires existing source/target IDs and relation_type; delete requires a known relation id and explicit authorization' }),
    id: Type.Optional(Type.String({ description: 'Known string relation ID required for delete, optional for save update; not an entity or memory ID' })),
    source: Type.Optional(Type.String({ description: 'Existing source entity string ID required for save; obtain with memory_entity and preserve intended direction' })),
    target: Type.Optional(Type.String({ description: 'Existing target entity string ID required for save; endpoint ownership must be compatible with the relation scope' })),
    relation_type: Type.Optional(Type.String({ enum: [...RELATION_TYPES], description: 'Required for save: one of the declared directed relationship types; not arbitrary text' })),
    scope: Type.Optional(Type.String({ enum: ['project', 'global'], description: 'Relation write scope: current resolved scope by default or authorized global; not cross-project read access' })),
  },
  { additionalProperties: false },
);
