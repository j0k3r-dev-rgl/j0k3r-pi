import { describe, expect, it, vi } from "vitest";
import { CURSOR_MARKER, KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionToolContext, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import register from "../index.ts";

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme;
const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);
const params = { questions: [{ question: "What should we build?", header: "Scope", options: [
  { label: "Minimal", description: "Smallest scope", preview: "Keep all selected detail." },
  { label: "Full", description: "Larger scope" },
] }] };

function tool(): ToolDefinition<any, any> {
  const registered: ToolDefinition<any, any>[] = [];
  register({ registerTool: (definition: ToolDefinition<any, any>) => { registered.push(definition); } } as unknown as ExtensionAPI);
  expect(registered).toHaveLength(1);
  return registered[0];
}

function context(drive: (component: any) => void = (component) => component.handleInput("\r")) {
  let component: any;
  const custom = vi.fn((factory: any, options?: unknown) => {
    expect(options).toBeUndefined(); // Native dock swap, never an overlay.
    return new Promise((resolve) => {
      component = factory({ requestRender: vi.fn() }, theme, keybindings, resolve);
      component.focused = true;
      drive(component);
    });
  });
  return { ctx: { mode: "tui", hasUI: true, ui: { custom } } as unknown as ExtensionToolContext,
    custom, component: () => component };
}

const execute = (definition: ToolDefinition<any, any>, ctx: ExtensionToolContext, signal?: AbortSignal, input = params) =>
  definition.execute("question-test", input, signal, undefined, ctx);

describe("standalone question tool", () => {
  it("registers only ask_user_question with necessary-decision guidance and sequential execution", () => {
    const definition = tool();
    expect(definition.name).toBe("ask_user_question");
    expect(definition.executionMode).toBe("sequential");
    expect(definition.exposure).toBe("model-only");
    expect(definition.promptSnippet).toBeTruthy();
    expect(definition.promptGuidelines?.join(" ")).toMatch(/decision/);
    expect(definition.promptGuidelines?.join(" ")).toMatch(/cancel/i);
  });

  it("returns the actual answer and preview without writing configuration", async () => {
    const { ctx, custom } = context();
    const result = await execute(tool(), ctx);
    expect(custom).toHaveBeenCalledOnce();
    expect(result.details.answers[0]).toMatchObject({ kind: "option", answer: "Minimal" });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Keep all selected detail.") });
  });

  it("cancels the whole questionnaire without exposing committed partial answers", async () => {
    const input = { questions: [...params.questions, { ...params.questions[0], question: "Next decision?", header: "Next" }] };
    const { ctx } = context((view) => { view.handleInput("\r"); view.handleInput("\x1b"); });
    const result = await execute(tool(), ctx, undefined, input);
    expect(result.details).toEqual({ cancelled: true });
    expect(result.content[0]).toMatchObject({ text: expect.stringMatching(/cancelled/i) });
  });

  it("rejects headless and RPC calls rather than hanging or guessing answers", async () => {
    for (const mode of ["print", "json", "rpc"]) {
      const { ctx, custom } = context();
      ctx.mode = mode as ExtensionToolContext["mode"];
      await expect(execute(tool(), ctx)).rejects.toThrow(/interactive TUI/);
      expect(custom).not.toHaveBeenCalled();
    }
  });

  it("rejects duplicate labels before opening the UI", async () => {
    const { ctx, custom } = context();
    const input = { questions: [{ ...params.questions[0], options: [params.questions[0].options[0], params.questions[0].options[0]] }] };
    await expect(execute(tool(), ctx, undefined, input)).rejects.toThrow(/duplicates/);
    expect(custom).not.toHaveBeenCalled();
  });

  it("pre-aborted execution never opens the UI", async () => {
    const { ctx, custom } = context();
    const controller = new AbortController();
    controller.abort();
    await expect(execute(tool(), ctx, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(custom).not.toHaveBeenCalled();
  });

  it("aborting an active interaction closes it and rejects with AbortError", async () => {
    const controller = new AbortController();
    const { ctx, component } = context(() => {});
    const pending = execute(tool(), ctx, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    component().dispose?.();
  });

  it("disposing an unfinished view resolves cancellation once and removes its listener", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const { ctx, component } = context(() => {});
    const pending = execute(tool(), ctx, controller.signal);
    component().dispose();
    component().dispose();
    expect((await pending).details).toEqual({ cancelled: true });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("abort winning over an answer never accepts that answer", async () => {
    const controller = new AbortController();
    const { ctx } = context((component) => {
      component.handleInput("\r");
      controller.abort();
    });
    await expect(execute(tool(), ctx, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("normal completion removes the abort listener", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const { ctx } = context();
    await execute(tool(), ctx, controller.signal);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("forwards focus to the custom editor through the native container", async () => {
    const { ctx } = context((component) => {
      component.handleInput("\x1b[B"); component.handleInput("\x1b[B"); component.handleInput("\r");
      expect(component.render(80).join("\n")).toContain(CURSOR_MARKER);
      component.handleInput("\x1b"); component.handleInput("\x1b");
    });
    expect((await execute(tool(), ctx)).details.cancelled).toBe(true);
  });

  it("preserves custom text plus multi-select choices in model-facing output", async () => {
    const { ctx } = context((component) => {
      component.handleInput(" "); component.handleInput("\x1b[B"); component.handleInput("\x1b[B");
      component.handleInput("\r"); component.handleInput("My alternative"); component.handleInput("\r");
    });
    const input = { questions: [{ ...params.questions[0], multiSelect: true }] };
    const result = await execute(tool(), ctx, undefined, input);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("My alternative — selected: Minimal") });
  });
});

describe("native tool result rendering", () => {
  it("declares renderShell as 'self'", () => {
    expect(tool().renderShell).toBe("self");
  });

  it("assembles the card in two phases across call and result using context.state", async () => {
    const definition = tool();
    const { ctx } = context();
    const result = await execute(definition, ctx);
    const sharedContext = { state: {} as Record<string, any> };

    const callComponent = definition.renderCall!(params, theme, sharedContext as any);
    const callPendingLines = callComponent.render(80);
    expect(callPendingLines).toHaveLength(3);
    expect(callPendingLines[0]).toMatch(/╭/);
    expect(callPendingLines[1]).toMatch(/│/);
    expect(callPendingLines[2]).toMatch(/╰/);

    const resultComponent = definition.renderResult!(result, { expanded: false, isPartial: false }, theme, sharedContext as any);
    const resultLines = resultComponent.render(80);
    expect(sharedContext.state.hasResult).toBe(true);
    expect(resultLines.some((l) => l.includes("│"))).toBe(true);
    expect(resultLines[resultLines.length - 1]).toMatch(/╰/);

    const callCompletedLines = callComponent.render(80);
    expect(callCompletedLines).toHaveLength(1);
    expect(callCompletedLines[0]).toMatch(/╭/);
    expect(callCompletedLines[0]).not.toMatch(/╰/);
  });

  it("falls back to question prompt when header is omitted in renderCall", () => {
    const definition = tool();
    const noHeaderArgs = { questions: [{ question: "Select an architectural option" }] };
    const lines = definition.renderCall!(noHeaderArgs, theme, {} as any).render(80);
    expect(lines.join("\n")).toContain("Select an architectural option");
    expect(lines.join("\n")).not.toMatch(/1\.\s+·/);
  });

  it("keeps collapsed summary short, exposes expansion, shows borders and answers without preview", async () => {
    const definition = tool();
    const { ctx } = context();
    const result = await execute(definition, ctx);
    const sharedContext = { state: {} as Record<string, any> };
    definition.renderCall!(params, theme, sharedContext as any);
    const collapsed = definition.renderResult!(result, { expanded: false, isPartial: false }, theme, sharedContext as any).render(100).join("\n");
    const expanded = definition.renderResult!(result, { expanded: true, isPartial: false }, theme, sharedContext as any).render(100).join("\n");
    expect(collapsed).toMatch(/│/);
    expect(collapsed).toMatch(/╰/);
    expect(collapsed).toMatch(/1 answer/);
    expect(collapsed).toContain("Scope");
    expect(collapsed).toContain("Minimal");
    expect(collapsed).toMatch(/expand/i);
    expect(collapsed).not.toContain("Keep all selected detail.");
    expect(expanded).toContain("Keep all selected detail.");
    expect(expanded).toMatch(/collapse/i);
  });

  it("preserves multi-select and custom answers in collapsed and expanded views with collapse hint", () => {
    const definition = tool();
    const multiCustomResult = {
      content: [
        { type: "text" as const, text: "1. Scope — (custom) Bespoke — selected: Minimal\n   selected preview: Keep detail." },
      ],
      details: {
        answers: [
          {
            questionIndex: 0,
            question: "Scope",
            header: "Scope",
            kind: "custom" as const,
            custom: "Bespoke",
            selected: ["Minimal"],
            answer: "Bespoke",
            preview: "Keep detail.",
          },
        ],
      },
    };
    const collapsed = definition.renderResult!(multiCustomResult, { expanded: false, isPartial: false }, theme, {} as any).render(100).join("\n");
    expect(collapsed).toContain("(custom) Bespoke");
    expect(collapsed).toContain("selected: Minimal");
    expect(collapsed).not.toContain("selected preview:");

    const expanded = definition.renderResult!(multiCustomResult, { expanded: true, isPartial: false }, theme, {} as any).render(100).join("\n");
    expect(expanded).toContain("(custom) Bespoke");
    expect(expanded).toContain("selected: Minimal");
    expect(expanded).toContain("selected preview: Keep detail.");
    expect(expanded).toMatch(/collapse/i);
  });

  it("renders streaming, cancellation, failures and empty results deliberately", () => {
    const render = (result: any, partial = false) => tool().renderResult!(result,
      { expanded: false, isPartial: partial }, theme, {} as any).render(80).join("\n");
    expect(render({ content: [], details: {} }, true)).toMatch(/Waiting/);
    expect(render({ content: [{ type: "text", text: "Cancelled" }], details: { cancelled: true } })).toMatch(/Cancelled/);
    expect(render({ content: [{ type: "text", text: "Error: TUI unavailable" }], details: {} })).toContain("TUI unavailable");
    expect(render({ content: [], details: {} })).toMatch(/No answers/);
  });

  it("keeps call and result lines width-safe with long Unicode content", () => {
    const definition = tool();
    const result = { content: [{ type: "text" as const, text: "中文 🚀 é ".repeat(30) }], details: {} };
    for (const width of [1, 2, 8, 40, 80, 120]) {
      for (const component of [
        definition.renderCall!(params, theme, {} as any),
        definition.renderResult!(result, { expanded: true, isPartial: false }, theme, {} as any),
      ]) for (const line of component.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });
});
