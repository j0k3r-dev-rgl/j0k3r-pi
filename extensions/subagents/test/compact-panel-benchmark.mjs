#!/usr/bin/env node
/**
 * Paired baseline/candidate benchmark for concurrent subagents panel opening (MINI-007).
 *
 * Run with the package's own declared environment:
 *   node --experimental-strip-types test/compact-panel-benchmark.mjs
 *
 * The fixture loads the TypeScript panel through this package's own installed `jiti` — the same
 * documented host-loader approach the existing panel/thread-view tests use — and it imports no
 * sibling extension. Every task and thread snapshot is synthetic: no network, provider credentials
 * or production subagent history is read or written.
 *
 * Two kinds of evidence are reported and must be read together:
 *  - Deterministic counters are the regression gates: hydration reads, native component
 *    constructions/renders for unchanged terminal items, and content-freshness assertions.
 *  - Timings (median/p95/max, milliseconds) are machine-dependent wall-clock observations of the
 *    same fixture before and after the change; they are not a latency promise.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createJiti } = require('jiti');
const jiti = createJiti(new URL('../package.json', import.meta.url).pathname, { moduleCache: true, interopDefault: true });

const threadView = jiti(new URL('../src/thread-view.ts', import.meta.url).pathname);
const panelModule = jiti(new URL('../src/ui/subagents-history-panel.ts', import.meta.url).pathname);
const overlayModule = jiti(new URL('../src/ui/panel-overlay.ts', import.meta.url).pathname);

const { SubagentsHistoryPanel } = panelModule;
const { showSubagentsPanel } = overlayModule;
const { setPiComponentProviderForSubagentRendering, resetPiComponentCacheForTests } = threadView;

const ITERATIONS = Number(process.env.PI_COMPACT_BENCH_ITERATIONS ?? 25);
const WIDTH = Number(process.env.PI_COMPACT_BENCH_WIDTH ?? 120);
const HISTORY_ITEMS = Number(process.env.PI_COMPACT_BENCH_ITEMS ?? 30);

const counters = {
  assistantConstructions: 0,
  assistantRenders: 0,
  toolConstructions: 0,
  toolRenders: 0,
};

function installCountingComponents() {
  resetPiComponentCacheForTests();
  setPiComponentProviderForSubagentRendering({
    getMarkdownTheme: () => ({}),
    AssistantMessageComponent: class {
      constructor(message) {
        counters.assistantConstructions += 1;
        this.message = message;
      }
      invalidate() {}
      render(width) {
        counters.assistantRenders += 1;
        const text = this.message?.content?.map((part) => part.text ?? '').join('') ?? '';
        return [`assistant:${width}:${text}`];
      }
    },
    UserMessageComponent: class {
      constructor(text) { this.text = text; }
      invalidate() {}
      render(width) { return [`user:${width}:${String(this.text).slice(0, 40)}`]; }
    },
    ToolExecutionComponent: class {
      constructor(name, id, args, _options, definition) {
        counters.toolConstructions += 1;
        this.name = name;
        this.args = args;
        this.definition = definition;
        this.resultText = '';
      }
      markExecutionStarted() {}
      setArgsComplete() {}
      updateResult(result) { this.resultText = result?.content?.[0]?.text ?? ''; }
      setExpanded() {}
      invalidate() {}
      render(width) {
        counters.toolRenders += 1;
        return [`tool:${width}:${this.name}:${JSON.stringify(this.args)}:${this.resultText.slice(0, 40)}`];
      }
    },
    createReadToolDefinition: (cwd) => ({ name: 'read', cwd, renderShell: 'self' }),
    createBashToolDefinition: (cwd) => ({ name: 'bash', cwd, renderShell: 'self' }),
  });
}

function resetCounters() {
  counters.assistantConstructions = 0;
  counters.assistantRenders = 0;
  counters.toolConstructions = 0;
  counters.toolRenders = 0;
}

function snapshotItems(count, label, { liveTool = false } = {}) {
  const items = [{ type: 'user', id: `${label}-user`, label: 'delegated_task', text: `delegated task for ${label}` }];
  for (let index = 0; index < count; index += 1) {
    items.push({
      type: 'assistant',
      id: `${label}-assistant-${index}`,
      message: { role: 'assistant', content: [{ type: 'text', text: `assistant step ${index} for ${label}` }] },
    });
    const isLast = index === count - 1;
    items.push({
      type: 'tool',
      id: `${label}-tool-${index}`,
      tool_call_id: `${label}-tool-call-${index}`,
      name: 'read',
      status: liveTool && isLast ? 'running' : 'completed',
      arguments: { path: `src/module-${index}.ts` },
      result: liveTool && isLast ? undefined : { content: [{ type: 'text', text: `content of module ${index}` }], isError: false },
    });
  }
  return items;
}

function makeTask({ id, status, items, createdAt, updatedAt, mode = 'background', agent = 'analyst' }) {
  return {
    id,
    agent,
    display_name: id,
    mode,
    effective_mode: mode,
    status,
    task: `benchmark task ${id}`,
    created_at: createdAt,
    last_activity_at: updatedAt,
    attempt: 1,
    model: 'benchmark/model',
    effort: 'medium',
    thread_snapshot: { version: 1, source: 'events', created_at: createdAt, updated_at: updatedAt, items },
  };
}

/** Realistic mixed list: active tasks first (creation DESC then id DESC), then terminal history. */
function buildFixture(activeCount, { liveTool = false } = {}) {
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  const tasks = [];
  for (let index = 0; index < activeCount; index += 1) {
    const createdAt = new Date(base + (1000 - index) * 1000).toISOString();
    tasks.push(makeTask({
      id: `subtask_active_${index}`,
      status: 'running',
      items: snapshotItems(HISTORY_ITEMS, `active-${index}`, { liveTool }),
      createdAt,
      updatedAt: createdAt,
    }));
  }
  for (let index = 0; index < 3; index += 1) {
    const createdAt = new Date(base - (index + 1) * 1000).toISOString();
    tasks.push(makeTask({
      id: `subtask_done_${index}`,
      status: 'completed',
      items: snapshotItems(HISTORY_ITEMS, `done-${index}`),
      createdAt,
      updatedAt: createdAt,
    }));
  }
  tasks.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1));
  return tasks;
}

const theme = { fg: (_name, text) => text, bold: (text) => text };

// Pi's registry returns stable definition objects; mirror that so per-frame reuse decisions are the
// panel's, not an artifact of the fixture. Provide BOTH marked compliant definitions (which exercise
// real ToolExecutionComponent caching/rendering) and unmarked/fallback definitions (separate mode)
// so neither path silently swaps code paths under the benchmark label.
const markedToolDefinitions = new Map([
  ['read', {
    name: 'read',
    compactToolRenderingVersion: 1,
    renderShell: 'self',
    renderCall: () => ({ invalidate() {}, render: () => ['read call'] }),
    renderResult: (res, opts) => ({
      invalidate() {},
      render: () => (opts?.expanded ? [res?.content?.[0]?.text ?? ''] : ['read summary']),
    }),
  }],
  ['bash', {
    name: 'bash',
    compactToolRenderingVersion: 1,
    renderShell: 'self',
    renderCall: () => ({ invalidate() {}, render: () => ['bash call'] }),
    renderResult: (res, opts) => ({
      invalidate() {},
      render: () => (opts?.expanded ? [res?.content?.[0]?.text ?? ''] : ['bash summary']),
    }),
  }],
]);
const unmarkedToolDefinitions = new Map([
  ['read', { name: 'read', renderShell: 'self' }],
  ['bash', { name: 'bash', renderShell: 'self' }],
]);
const makeToolDefLookup = (defs) => (name) => defs.get(name);

function makePanel(tasks, selectedTaskId, hydration, getToolDefinition = makeToolDefLookup(markedToolDefinitions)) {
  return new SubagentsHistoryPanel(
    () => tasks,
    theme,
    () => {},
    () => false,
    (text) => text.length,
    (text, width) => (text.length > width ? text.slice(0, width) : text),
    {
      cwd: process.cwd(),
      tui: { requestRender() {} },
      getToolDefinition,
    },
    42,
    (id) => {
      hydration.hydrationReads += 1;
      return tasks.find((task) => task.id === id);
    },
    selectedTaskId,
    () => {},
    'x',
    {},
  );
}

function percentile(samples, fraction) {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function stats(samples) {
  return {
    medianMs: Number(percentile(samples, 0.5).toFixed(3)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...samples).toFixed(3)),
  };
}

function measure(panel, width) {
  // Count JSON serialization work during the frame. The plan calls out full snapshot serialization
  // and item reconstruction on unrelated refresh; counting stringify calls/characters makes that
  // deterministic instead of relying on timings alone.
  const originalStringify = JSON.stringify;
  let stringifyCalls = 0;
  let stringifyChars = 0;
  JSON.stringify = function countedStringify(...args) {
    const result = originalStringify.apply(this, args);
    stringifyCalls += 1;
    stringifyChars += typeof result === 'string' ? result.length : 0;
    return result;
  };
  const started = process.hrtime.bigint();
  let lines;
  try {
    lines = panel.render(width);
  } finally {
    JSON.stringify = originalStringify;
  }
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  return { elapsed, lines, stringifyCalls, stringifyChars };
}

function measureSeries(panel, widthFor) {
  const samples = [];
  let stringifyCalls = 0;
  let stringifyChars = 0;
  let lastLines;
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const result = measure(panel, widthFor(iteration));
    samples.push(result.elapsed);
    stringifyCalls += result.stringifyCalls;
    stringifyChars += result.stringifyChars;
    lastLines = result.lines;
  }
  return { samples, stringifyCalls, stringifyChars, lastLines };
}

function countersSnapshot() {
  return {
    assistantConstructions: counters.assistantConstructions,
    assistantRenders: counters.assistantRenders,
    toolConstructions: counters.toolConstructions,
    toolRenders: counters.toolRenders,
  };
}

function runScenario(activeCount, options = {}) {
  const scenarios = {};
  const defs = options.fallbackMode ? unmarkedToolDefinitions : markedToolDefinitions;
  const lookup = makeToolDefLookup(defs);

  // Cold open: a fresh panel renders the selected (first active) thread for the first time.
  {
    const samples = [];
    let stringifyCalls = 0;
    let stringifyChars = 0;
    let lastCounters;
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const tasks = buildFixture(activeCount, options);
      const hydration = { hydrationReads: 0 };
      resetCounters();
      const panel = makePanel(tasks, tasks[0]?.id, hydration, lookup);
      const result = measure(panel, WIDTH);
      samples.push(result.elapsed);
      stringifyCalls += result.stringifyCalls;
      stringifyChars += result.stringifyChars;
      lastCounters = { hydrationReads: hydration.hydrationReads, ...countersSnapshot() };
      panel.invalidate();
    }
    scenarios.coldOpen = { timing: stats(samples), stringifyCalls, stringifyChars, counters: lastCounters };
  }

  // Warm frame: repeated unchanged render after opening.
  {
    const tasks = buildFixture(activeCount, options);
    const hydration = { hydrationReads: 0 };
    resetCounters();
    const panel = makePanel(tasks, tasks[0]?.id, hydration, lookup);
    const cold = measure(panel, WIDTH);
    const coldHydration = hydration.hydrationReads;
    resetCounters();
    hydration.hydrationReads = 0;
    const run = measureSeries(panel, () => WIDTH);
    scenarios.warmFrame = {
      timing: stats(run.samples),
      stringifyCalls: run.stringifyCalls,
      stringifyChars: run.stringifyChars,
      counters: {
        hydrationReads: hydration.hydrationReads,
        hydrationReadsCold: coldHydration,
        coldStringifyCalls: cold.stringifyCalls,
        ...countersSnapshot(),
      },
    };
    panel.invalidate();
  }

  // Unrelated update: a non-selected task ticks (elapsed-duration refresh / sibling task update).
  {
    const tasks = buildFixture(activeCount, options);
    const selectedId = tasks[tasks.length - 1]?.id;
    const hydration = { hydrationReads: 0 };
    resetCounters();
    const panel = makePanel(tasks, selectedId, hydration, lookup);
    measure(panel, WIDTH);
    resetCounters();
    hydration.hydrationReads = 0;
    const otherTask = tasks.find((task) => task.id !== selectedId);
    const samples = [];
    let stringifyCalls = 0;
    let stringifyChars = 0;
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      // Metadata-only tick on a task that is not selected: identical content, new timestamp.
      otherTask.last_activity_at = new Date(Date.parse('2026-01-02T00:00:00.000Z') + iteration * 1000).toISOString();
      const result = measure(panel, WIDTH);
      samples.push(result.elapsed);
      stringifyCalls += result.stringifyCalls;
      stringifyChars += result.stringifyChars;
    }
    scenarios.unrelatedUpdate = {
      timing: stats(samples),
      stringifyCalls,
      stringifyChars,
      counters: { hydrationReads: hydration.hydrationReads, ...countersSnapshot() },
    };
    panel.invalidate();
  }

  // Selected update: append a live item to the selected thread (async output must stay fresh).
  {
    const tasks = buildFixture(activeCount, options);
    const hydration = { hydrationReads: 0 };
    resetCounters();
    const panel = makePanel(tasks, tasks[0]?.id, hydration, lookup);
    measure(panel, WIDTH);
    resetCounters();
    hydration.hydrationReads = 0;
    const selected = tasks[0];
    const samples = [];
    let stringifyCalls = 0;
    let stringifyChars = 0;
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      selected.thread_snapshot.items.push({
        type: 'assistant',
        id: `live-${iteration}`,
        message: { role: 'assistant', content: [{ type: 'text', text: `live chunk ${iteration}` }] },
      });
      selected.thread_snapshot.updated_at = new Date(Date.parse('2026-01-03T00:00:00.000Z') + iteration * 1000).toISOString();
      selected.last_activity_at = selected.thread_snapshot.updated_at;
      const result = measure(panel, WIDTH);
      if (!result.lines.join('\n').includes(`live chunk ${iteration}`)) {
        throw new Error(`selected update was not rendered at iteration ${iteration}`);
      }
      samples.push(result.elapsed);
      stringifyCalls += result.stringifyCalls;
      stringifyChars += result.stringifyChars;
    }
    scenarios.selectedUpdate = {
      timing: stats(samples),
      stringifyCalls,
      stringifyChars,
      counters: { hydrationReads: hydration.hydrationReads, ...countersSnapshot() },
    };
    panel.invalidate();
  }

  // Live tool frame: the selected active thread keeps a running tool; loaders must stay fresh.
  if (options.liveTool) {
    const tasks = buildFixture(activeCount, options);
    const hydration = { hydrationReads: 0 };
    resetCounters();
    const panel = makePanel(tasks, tasks[0]?.id, hydration, lookup);
    measure(panel, WIDTH);
    resetCounters();
    hydration.hydrationReads = 0;
    const run = measureSeries(panel, () => WIDTH);
    scenarios.liveToolFrame = {
      timing: stats(run.samples),
      stringifyCalls: run.stringifyCalls,
      stringifyChars: run.stringifyChars,
      counters: { hydrationReads: hydration.hydrationReads, ...countersSnapshot() },
    };
    panel.invalidate();
  }

  // Resize: same content rendered at alternating widths.
  {
    const tasks = buildFixture(activeCount, options);
    const hydration = { hydrationReads: 0 };
    resetCounters();
    const panel = makePanel(tasks, tasks[0]?.id, hydration, lookup);
    measure(panel, WIDTH);
    resetCounters();
    hydration.hydrationReads = 0;
    const run = measureSeries(panel, (iteration) => (iteration % 2 === 0 ? 96 : 72));
    scenarios.resize = {
      timing: stats(run.samples),
      stringifyCalls: run.stringifyCalls,
      stringifyChars: run.stringifyChars,
      counters: { hydrationReads: hydration.hydrationReads, ...countersSnapshot() },
    };
    panel.invalidate();
  }

  return scenarios;
}

/**
 * Content-freshness gates. Same-length text/argument/result/error edits made in place with unchanged
 * item count and unchanged timestamps must become visible. Each case uses a short thread so the whole
 * body fits the rendered viewport (no scrolling involved).
 */
function makeShortSignalTask({ status = 'running' } = {}) {
  const createdAt = '2026-01-01T00:00:01.000Z';
  return makeTask({
    id: 'subtask_signal',
    status,
    createdAt,
    updatedAt: createdAt,
    items: [
      { type: 'user', id: 'signal-user', label: 'delegated_task', text: 'signal task' },
      { type: 'assistant', id: 'signal-assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'assistant step AAA' }] } },
      {
        type: 'tool',
        id: 'signal-tool',
        tool_call_id: 'signal-tool-call',
        name: 'read',
        status: 'completed',
        arguments: { path: 'src/module-AAA.ts' },
        result: { content: [{ type: 'text', text: 'content of module AAA' }], isError: false },
      },
    ],
  });
}

function runFreshnessChecks() {
  const checks = {};

  const visibleRender = (task) => {
    const panel = makePanel([task], task.id, { hydrationReads: 0 });
    const first = panel.render(WIDTH);
    return { panel, first };
  };

  // (1) In-place assistant text: same length, same count, same timestamps.
  {
    const task = makeShortSignalTask();
    const { panel, first } = visibleRender(task);
    const before = first.join('\n');
    task.thread_snapshot.items.find((entry) => entry.type === 'assistant').message.content[0].text = 'assistant step BBB';
    const after = panel.render(WIDTH).join('\n');
    checks.inPlaceAssistantTextSameLength = {
      baselineVisible: before.includes('assistant step AAA'),
      updatedVisible: after.includes('assistant step BBB'),
    };
    panel.invalidate();
  }

  // (2) In-place tool argument edit.
  {
    const task = makeShortSignalTask();
    const { panel } = visibleRender(task);
    task.thread_snapshot.items.find((entry) => entry.type === 'tool').arguments.path = 'src/module-BBB.ts';
    const after = panel.render(WIDTH).join('\n');
    checks.inPlaceToolArgumentSameLength = { updatedVisible: after.includes('module-BBB') };
    panel.invalidate();
  }

  // (3) In-place tool result text edit. Tool results are part of the compact collapsed row identity
  // plus the lossless expanded body, so the gate checks both surfaces.
  {
    const task = makeShortSignalTask();
    const panel = makePanel([task], task.id, { hydrationReads: 0 });
    const collapsedBefore = panel.render(WIDTH).join('\n');
    panel.handleInput('\u000f');
    const expandedBefore = panel.render(WIDTH).join('\n');
    const tool = task.thread_snapshot.items.find((entry) => entry.type === 'tool');
    tool.result.content[0].text = 'content of module BBB';
    const expandedAfter = panel.render(WIDTH).join('\n');
    checks.inPlaceToolResultSameLength = {
      collapsedBeforeLength: collapsedBefore.length,
      expandedBeforeVisible: expandedBefore.includes('content of module AAA'),
      updatedVisibleWhenExpanded: expandedAfter.includes('content of module BBB'),
    };
    panel.invalidate();
  }

  // (4) In-place terminal error text edit.
  {
    const task = makeShortSignalTask({ status: 'failed' });
    task.error = 'failure text AAA';
    const { panel, first } = visibleRender(task);
    const before = first.join('\n');
    task.error = 'failure text BBB';
    const after = panel.render(WIDTH).join('\n');
    checks.inPlaceErrorSameLength = {
      baselineVisible: before.includes('failure text AAA'),
      updatedVisible: after.includes('failure text BBB'),
    };
    panel.invalidate();
  }

  // (5) Equal-length metadata edit on the selected task.
  {
    const task = makeShortSignalTask();
    task.last_activity = 'step AAA';
    const { panel } = visibleRender(task);
    task.last_activity = 'step BBB';
    const after = panel.render(WIDTH).join('\n');
    checks.inPlaceMetadataSameLength = { updatedVisible: after.includes('step BBB') };
    panel.invalidate();
  }

  return checks;
}

function runManySubagentsLargeSnapshotScenario() {
  const lookup = makeToolDefLookup(markedToolDefinitions);
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  const activeTasks = Array.from({ length: 2 }, (_, idx) => makeTask({
    id: `subtask_many_active_${idx}`,
    status: 'running',
    items: snapshotItems(99, `many-active-${idx}`),
    createdAt: new Date(base + (500 - idx) * 1000).toISOString(),
    updatedAt: new Date(base + (500 - idx) * 1000).toISOString(),
  }));
  const persistedFull = Array.from({ length: 220 }, (_, idx) => makeTask({
    id: `subtask_many_hist_${String(219 - idx).padStart(3, '0')}`,
    status: 'completed',
    items: snapshotItems(99, `many-hist-${219 - idx}`),
    createdAt: new Date(base + (219 - idx) * 1000).toISOString(),
    updatedAt: new Date(base + (219 - idx) * 1000).toISOString(),
  }));
  const persistedMetadata = persistedFull.map(({ thread_snapshot: _snap, ...meta }) => meta);

  let maxWindowRequested = 0;
  let hydrationReads = 0;
  resetCounters();
  const panel = new SubagentsHistoryPanel(
    () => [...activeTasks, ...persistedMetadata.slice(0, 30)],
    theme,
    () => {},
    (data, key) => {
      if (key === 'pageUp') return data === '\u001b[5~';
      if (key === 'right') return data === '\u001b[C';
      return false;
    },
    (text) => text.length,
    (text, width) => (text.length > width ? text.slice(0, width) : text),
    {
      cwd: process.cwd(),
      tui: { requestRender() {} },
      getToolDefinition: lookup,
    },
    42,
    (id) => {
      hydrationReads += 1;
      return persistedFull.find((t) => t.id === id) ?? activeTasks.find((t) => t.id === id);
    },
    persistedMetadata[0]?.id,
    () => {},
    'x',
    {
      taskWindowLoader: (limit) => {
        maxWindowRequested = Math.max(maxWindowRequested, limit);
        return {
          tasks: [...activeTasks, ...persistedMetadata.slice(0, limit)],
          hasMore: limit < persistedMetadata.length,
        };
      },
      initialTaskWindow: 30,
      taskWindowStep: 30,
    },
  );

  // Cold open on a 200-item snapshot (1 user + 99 assistant + 99 tool = 199 items) with 222 total tasks
  const cold = measure(panel, WIDTH);
  const coldCounters = {
    totalTasks: activeTasks.length + persistedMetadata.length,
    snapshotItemCount: persistedFull[0].thread_snapshot.items.length,
    windowLimitLoaded: maxWindowRequested,
    hydrationReads,
    ...countersSnapshot(),
  };

  // Warm frames on the 200-item snapshot
  resetCounters();
  const warmHydrationBefore = hydrationReads;
  const warmRun = measureSeries(panel, () => WIDTH);
  const warm = {
    timing: stats(warmRun.samples),
    stringifyCalls: warmRun.stringifyCalls,
    stringifyChars: warmRun.stringifyChars,
    counters: {
      hydrationReads: hydrationReads - warmHydrationBefore,
      ...countersSnapshot(),
    },
  };

  // Incremental viewport scroll up (5 PageUps)
  resetCounters();
  const scrollSamples = [];
  for (let step = 0; step < 5; step += 1) {
    panel.handleInput('\u001b[5~');
    const res = measure(panel, WIDTH);
    scrollSamples.push(res.elapsed);
  }
  const viewportScrollUp = {
    timing: stats(scrollSamples),
    counters: countersSnapshot(),
  };

  // Navigate down past initial window (30) to trigger transparent window expansion
  const hydrationBeforeNav = hydrationReads;
  for (let step = 0; step < 28; step += 1) {
    panel.handleInput('\u001b[C');
  }
  const navResult = measure(panel, WIDTH);
  const windowExpansion = {
    elapsedMs: Number(navResult.elapsed.toFixed(3)),
    windowLimitLoaded: maxWindowRequested,
    hydrationReadsDelta: hydrationReads - hydrationBeforeNav,
  };

  panel.invalidate();
  return {
    coldOpen: {
      elapsedMs: Number(cold.elapsed.toFixed(3)),
      stringifyCalls: cold.stringifyCalls,
      stringifyChars: cold.stringifyChars,
      counters: coldCounters,
    },
    warmFrame: warm,
    viewportScrollUp,
    windowExpansion,
  };
}

async function runIdleRefreshScenario() {
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  const terminalTasks = Array.from({ length: 50 }, (_, idx) => makeTask({
    id: `subtask_idle_${String(49 - idx).padStart(2, '0')}`,
    status: 'completed',
    items: snapshotItems(10, `idle-${49 - idx}`),
    createdAt: new Date(base + (49 - idx) * 1000).toISOString(),
    updatedAt: new Date(base + (49 - idx) * 1000).toISOString(),
  }));

  let activeTasks = [];
  const listeners = new Set();
  let listenerUnsubscribed = false;
  let hydrationReads = 0;

  const mockManager = {
    listSessionTasks: () => [...activeTasks, ...terminalTasks],
    listSessionTasksWindow: (_cwd, _sessionId, { limit = 30 } = {}) => ({
      tasks: [...activeTasks, ...terminalTasks.slice(0, limit)],
      hasMore: limit < terminalTasks.length,
    }),
    listActiveSessionTasks: () => activeTasks,
    getTask: (id) => {
      hydrationReads += 1;
      return activeTasks.find((t) => t.id === id) ?? terminalTasks.find((t) => t.id === id);
    },
    onTaskUpdate: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
        listenerUnsubscribed = true;
      };
    },
    cancel: () => false,
  };

  const origSetInterval = globalThis.setInterval;
  const origClearInterval = globalThis.clearInterval;
  const intervals = [];
  let intervalsCreated = 0;
  let intervalsCleared = 0;

  globalThis.setInterval = (fn, ms) => {
    intervalsCreated += 1;
    const handle = { id: intervalsCreated, fn, ms, cleared: false, unref() {} };
    intervals.push(handle);
    return handle;
  };
  globalThis.clearInterval = (handle) => {
    if (handle && !handle.cleared) {
      handle.cleared = true;
      intervalsCleared += 1;
    }
  };

  let requestRenderCount = 0;
  let idleOpenMs = 0;
  let idleIntervalsCreated = 0;
  let idleRequestRenderCount = 0;
  let eventRefreshMs = 0;
  let eventRequestRenderCount = 0;
  let activeIntervalsCreated = 0;
  let activeTickRequestRenderCount = 0;
  let activeCloseMs = 0;

  try {
    await showSubagentsPanel({
      ctx: {
        cwd: '/tmp/subagents-bench-synthetic-idle',
        sessionId: 'bench-idle-session',
        ui: {
          custom: async (factory) => {
            let doneCalled = false;
            const tui = {
              mode: 'fullscreen',
              terminal: { rows: 42 },
              requestRender() { requestRenderCount += 1; },
            };
            const openStart = process.hrtime.bigint();
            const component = factory(tui, theme, { matches: () => false }, () => { doneCalled = true; });
            component.render(WIDTH);
            idleOpenMs = Number(process.hrtime.bigint() - openStart) / 1e6;
            idleIntervalsCreated = intervalsCreated;
            idleRequestRenderCount = requestRenderCount;

            // Event-driven refresh on task update while terminal
            const beforeEvent = requestRenderCount;
            const eventStart = process.hrtime.bigint();
            for (const listener of listeners) listener(terminalTasks[0]);
            component.render(WIDTH);
            eventRefreshMs = Number(process.hrtime.bigint() - eventStart) / 1e6;
            eventRequestRenderCount = requestRenderCount - beforeEvent;

            // Transition to active task -> conditional live timer starts
            activeTasks = [makeTask({
              id: 'subtask_idle_live',
              status: 'running',
              items: snapshotItems(10, 'idle-live'),
              createdAt: new Date(base + 100000).toISOString(),
              updatedAt: new Date(base + 100000).toISOString(),
            })];
            for (const listener of listeners) listener(activeTasks[0]);
            component.render(WIDTH);
            activeIntervalsCreated = intervalsCreated - idleIntervalsCreated;

            // Simulate one live timer tick while active task runs
            const beforeTick = requestRenderCount;
            const activeHandle = intervals.find((h) => !h.cleared);
            if (activeHandle) activeHandle.fn();
            activeTickRequestRenderCount = requestRenderCount - beforeTick;

            // Close overlay via Escape -> timer & listener disposed cleanly
            const closeStart = process.hrtime.bigint();
            component.handleInput('\u001b');
            activeCloseMs = Number(process.hrtime.bigint() - closeStart) / 1e6;
            if (!doneCalled) component.invalidate();
          },
        },
      },
      pi: {},
      manager: mockManager,
      setWidgetInputSuspended: () => {},
      setActivePanelCancelSelected: () => {},
      setActivePanelRequestRender: () => {},
    });
  } finally {
    globalThis.setInterval = origSetInterval;
    globalThis.clearInterval = origClearInterval;
  }

  return {
    idleOpenMs: Number(idleOpenMs.toFixed(3)),
    idleIntervalsCreated,
    idleRequestRenderCount,
    eventRefreshMs: Number(eventRefreshMs.toFixed(3)),
    eventRequestRenderCount,
    activeIntervalsCreated,
    activeTickRequestRenderCount,
    activeIntervalsCleared: intervalsCleared,
    activeCloseMs: Number(activeCloseMs.toFixed(3)),
    listenerUnsubscribed,
    hydrationReads,
  };
}

async function main() {
  installCountingComponents();
  const results = {};
  for (const activeCount of [1, 2, 3]) {
    results[`active${activeCount}Marked`] = runScenario(activeCount);
  }
  results.active2LiveToolMarked = runScenario(2, { liveTool: true });
  results.active3LiveToolMarked = runScenario(3, { liveTool: true });
  results.active2Fallback = runScenario(2, { fallbackMode: true });
  results.active2LiveToolFallback = runScenario(2, { liveTool: true, fallbackMode: true });
  results.manySubagentsLargeSnapshot = runManySubagentsLargeSnapshotScenario();
  results.idleRefresh = await runIdleRefreshScenario();
  const freshness = runFreshnessChecks();
  const report = {
    fixture: 'compact-panel-benchmark',
    version: 2,
    runtime: {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      iterations: ITERATIONS,
      width: WIDTH,
      historyItems: HISTORY_ITEMS,
      panelImplementation: process.env.PI_COMPACT_BENCH_LABEL ?? 'unknown',
    },
    results,
    freshness,
  };
  console.log(JSON.stringify(report, null, 2));
}

await main();
