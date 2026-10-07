import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { MemoryLifecycle } from '../lifecycle.ts';
import type { OperationContext } from './types.ts';
import {
  SaveSchema,
  SearchSchema,
  GetSchema,
  ContextSchema,
  DeleteSchema,
  RestoreSchema,
  DeletedListSchema,
  EntitySchema,
  RelationSchema,
} from './schemas.ts';
import {
  SAVE_TOOL_DESCRIPTION,
  SEARCH_TOOL_DESCRIPTION,
  GET_TOOL_DESCRIPTION,
  CONTEXT_TOOL_DESCRIPTION,
  DELETE_TOOL_DESCRIPTION,
  RESTORE_TOOL_DESCRIPTION,
  DELETED_LIST_DESCRIPTION,
  ENTITY_TOOL_DESCRIPTION,
  RELATION_TOOL_DESCRIPTION,
  MEMORY_TOOL_GUIDELINES,
} from './descriptions.ts';
import { executeSaveTool } from './save.ts';
import { executeSearchTool } from './search.ts';
import { executeGetTool } from './get.ts';
import { executeContextTool } from './context.ts';
import { executeDeleteTool } from './delete.ts';
import { executeRestoreTool } from './restore.ts';
import { executeDeletedListTool } from './deleted-list.ts';
import { executeEntityTool } from './entity.ts';
import { executeRelationTool } from './relation.ts';
import { createToolRenderers } from '../render/index.ts';

export const TOOL_NAMES = [
  'memory_save',
  'memory_search',
  'memory_get',
  'memory_context',
  'memory_delete',
  'memory_restore',
  'memory_deleted_list',
  'memory_entity',
  'memory_relation',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

function isOperationContext(obj: any): obj is OperationContext {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.dbPath === 'string' &&
    typeof obj.sessionId === 'string' &&
    typeof obj.scopeKey === 'string' &&
    typeof obj.assertActive === 'function'
  );
}

export function createMemoryTools(lifecycle?: MemoryLifecycle): ToolDefinition[] {
  function wrapExecutor(
    toolName: string,
    handler: (args: any, opCtx: OperationContext) => Promise<any>,
  ) {
    return async (
      _callId: string,
      args: any,
      signal?: AbortSignal,
      _onUpdate?: any,
      ctx?: any,
    ) => {
      // Direct OperationContext injection (unit tests or direct execution)
      if (isOperationContext(ctx)) {
        return handler(args, ctx);
      }

      if (!lifecycle) {
        throw new Error(`lifecycle_unavailable: Cannot execute tool ${toolName} without MemoryLifecycle`);
      }

      return lifecycle.performOperation(signal, ctx, async (opCtx) => {
        return handler(args, opCtx);
      });
    };
  }

  const renderers = {
    memory_save: createToolRenderers('memory_save'),
    memory_search: createToolRenderers('memory_search'),
    memory_get: createToolRenderers('memory_get'),
    memory_context: createToolRenderers('memory_context'),
    memory_delete: createToolRenderers('memory_delete'),
    memory_restore: createToolRenderers('memory_restore'),
    memory_deleted_list: createToolRenderers('memory_deleted_list'),
    memory_entity: createToolRenderers('memory_entity'),
    memory_relation: createToolRenderers('memory_relation'),
  };

  return [
    {
      name: 'memory_save',
      label: 'Memory: Save',
      description: SAVE_TOOL_DESCRIPTION,
      promptGuidelines: MEMORY_TOOL_GUIDELINES.memory_save,
      parameters: SaveSchema,
      execute: wrapExecutor('memory_save', executeSaveTool),
      ...renderers.memory_save,
    },
    {
      name: 'memory_search',
      label: 'Memory: Search',
      description: SEARCH_TOOL_DESCRIPTION,
      promptGuidelines: MEMORY_TOOL_GUIDELINES.memory_search,
      parameters: SearchSchema,
      execute: wrapExecutor('memory_search', executeSearchTool),
      ...renderers.memory_search,
    },
    {
      name: 'memory_get',
      label: 'Memory: Get Detail',
      description: GET_TOOL_DESCRIPTION,
      promptGuidelines: MEMORY_TOOL_GUIDELINES.memory_get,
      parameters: GetSchema,
      execute: wrapExecutor('memory_get', executeGetTool),
      ...renderers.memory_get,
    },
    {
      name: 'memory_context',
      label: 'Memory: Context',
      description: CONTEXT_TOOL_DESCRIPTION,
      promptGuidelines: MEMORY_TOOL_GUIDELINES.memory_context,
      parameters: ContextSchema,
      execute: wrapExecutor('memory_context', executeContextTool),
      ...renderers.memory_context,
    },
    {
      name: 'memory_delete',
      label: 'Memory: Soft Delete',
      description: DELETE_TOOL_DESCRIPTION,
      promptGuidelines: MEMORY_TOOL_GUIDELINES.memory_delete,
      parameters: DeleteSchema,
      execute: wrapExecutor('memory_delete', executeDeleteTool),
      ...renderers.memory_delete,
    },
    {
      name: 'memory_restore',
      label: 'Memory: Restore',
      description: RESTORE_TOOL_DESCRIPTION,
      promptGuidelines: MEMORY_TOOL_GUIDELINES.memory_restore,
      parameters: RestoreSchema,
      execute: wrapExecutor('memory_restore', executeRestoreTool),
      ...renderers.memory_restore,
    },
    {
      name: 'memory_deleted_list',
      label: 'Memory: List Deleted',
      description: DELETED_LIST_DESCRIPTION,
      promptGuidelines: MEMORY_TOOL_GUIDELINES.memory_deleted_list,
      parameters: DeletedListSchema,
      execute: wrapExecutor('memory_deleted_list', executeDeletedListTool),
      ...renderers.memory_deleted_list,
    },
    {
      name: 'memory_entity',
      label: 'Memory: Graph Entity',
      description: ENTITY_TOOL_DESCRIPTION,
      promptGuidelines: MEMORY_TOOL_GUIDELINES.memory_entity,
      parameters: EntitySchema,
      execute: wrapExecutor('memory_entity', executeEntityTool),
      ...renderers.memory_entity,
    },
    {
      name: 'memory_relation',
      label: 'Memory: Graph Relation',
      description: RELATION_TOOL_DESCRIPTION,
      promptGuidelines: MEMORY_TOOL_GUIDELINES.memory_relation,
      parameters: RelationSchema,
      execute: wrapExecutor('memory_relation', executeRelationTool),
      ...renderers.memory_relation,
    },
  ];
}
