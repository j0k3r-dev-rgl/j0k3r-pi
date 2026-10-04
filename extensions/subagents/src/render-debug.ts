import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSubagentsConfig } from './config.js';
import type { SubagentsRenderDebugConfig } from './types.js';

export const DEFAULT_RENDER_DEBUG_LOG_PATH = path.join(os.tmpdir(), 'pi-subagents-render.jsonl');

type RenderDebugDimensions = {
  stdoutColumns?: number;
  stdoutRows?: number;
  renderWidth?: number;
};

type RenderDebugState = {
  taskCount?: number;
  selectedIndex?: number;
  selectedStatus?: string;
  scrollOffset?: number;
  followTail?: boolean;
  hasUsage?: boolean;
  configuredMaxLines?: number;
  renderedLineCount?: number;
  bodyHeight?: number;
  maxVisibleWidth?: number;
  widthViolationCount?: number;
};

type RenderDebugInput = {
  category: string;
  action: string;
};

type RenderDebugEvent = {
  event: 'panel_created' | 'render_requested' | 'render_started' | 'render_completed' | 'input_received' | 'panel_disposed';
  reason?: string;
  renderCycle?: number;
  durationMs?: number;
  dimensions?: RenderDebugDimensions;
  state?: RenderDebugState;
  input?: RenderDebugInput;
};

type RenderDebugLogger = {
  enabled: boolean;
  panelInstanceId: string;
  log: (event: RenderDebugEvent) => void;
};

function sha256(value: string): string {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function pickTerminal(env: NodeJS.ProcessEnv) {
  return {
    term: env.TERM,
    colorterm: env.COLORTERM,
    term_program: env.TERM_PROGRAM,
    inside_tmux: Boolean(env.TMUX),
    inside_herdr: Boolean(env.HERDR || env.HERDR_SESSION),
  };
}

function sanitizeState(state?: RenderDebugState) {
  if (!state) return undefined;
  return {
    task_count: typeof state.taskCount === 'number' ? state.taskCount : undefined,
    selected_index: typeof state.selectedIndex === 'number' ? state.selectedIndex : undefined,
    selected_status: state.selectedStatus,
    scroll_offset: typeof state.scrollOffset === 'number' ? state.scrollOffset : undefined,
    follow_tail: typeof state.followTail === 'boolean' ? state.followTail : undefined,
    has_usage: typeof state.hasUsage === 'boolean' ? state.hasUsage : undefined,
    configured_max_lines: typeof state.configuredMaxLines === 'number' ? state.configuredMaxLines : undefined,
    rendered_line_count: typeof state.renderedLineCount === 'number' ? state.renderedLineCount : undefined,
    body_height: typeof state.bodyHeight === 'number' ? state.bodyHeight : undefined,
    max_visible_width: typeof state.maxVisibleWidth === 'number' ? state.maxVisibleWidth : undefined,
    width_violation_count: typeof state.widthViolationCount === 'number' ? state.widthViolationCount : undefined,
  };
}

export function isSubagentsRenderDebugEnabled(cwd?: string): boolean {
  if (!cwd) return false;
  try {
    return readSubagentsConfig(cwd).render_debug?.enabled === true;
  } catch {
    return false;
  }
}

export function createSubagentsRenderLogger(input: {
  cwd: string;
  sessionId?: string;
  config?: SubagentsRenderDebugConfig;
  env?: NodeJS.ProcessEnv;
}): RenderDebugLogger {
  const config = input.config;
  const panelInstanceId = crypto.randomUUID();
  if (!config?.enabled) {
    return {
      enabled: false,
      panelInstanceId,
      log: () => undefined,
    };
  }

  const env = input.env ?? process.env;
  const terminal = pickTerminal(env);
  let sequence = 0;
  return {
    enabled: true,
    panelInstanceId,
    log: (event) => {
      try {
        const record = {
          schema_version: 1,
          event: event.event,
          timestamp: new Date().toISOString(),
          sequence: ++sequence,
          panel_instance_id: panelInstanceId,
          session_id_hash: input.sessionId ? sha256(input.sessionId) : undefined,
          reason: event.reason,
          render_cycle: event.renderCycle,
          duration_ms: typeof event.durationMs === 'number' ? Number(event.durationMs.toFixed(3)) : undefined,
          dimensions: event.dimensions ? {
            stdout_columns: event.dimensions.stdoutColumns,
            stdout_rows: event.dimensions.stdoutRows,
            render_width: event.dimensions.renderWidth,
          } : undefined,
          state: sanitizeState(event.state),
          input: event.input ? { category: event.input.category, action: event.input.action } : undefined,
          terminal,
        };
        fs.mkdirSync(path.dirname(config.path), { recursive: true, mode: 0o700 });
        fs.appendFileSync(config.path, `${JSON.stringify(record)}\n`, 'utf8');
      } catch {}
    },
  };
}
