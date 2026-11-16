import { describe, expect, it, vi } from "vitest";
import { CURSOR_MARKER, KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionToolContext, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import register from "../index.ts";
import { QuestionParamsSchema } from "../src/core/schema.ts";
import { getNtfyUrl, notifyNtfyQuestion } from "../src/tools/ask-user-question.ts";

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
    expect(definition.description).toMatch(/one to six.*two to five/);
    expect(definition.parameters).toBe(QuestionParamsSchema);
    const guidance = definition.promptGuidelines?.join(" ") ?? "";
    expect(guidance).toMatch(/Batch up to six questions/);
    expect(guidance).toMatch(/two to five honest options/);
    expect(guidance).toMatch(/why the decision is needed/i);
    expect(guidance).toMatch(/relevant background/i);
    expect(guidance).toMatch(/consequences, trade-offs, and practical differences/i);
  });

  it("returns the actual answer and preview without writing configuration", async () => {
    const { ctx, custom } = context();
    const result = await execute(tool(), ctx);
    expect(custom).toHaveBeenCalledOnce();
    expect(result.details.answers[0]).toMatchObject({ kind: "option", answer: "Minimal" });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Keep all selected detail.") });
  });

  it("opens the questionnaire with long headers without truncating its input", async () => {
    const header = "Configuración autorizada 中文 🚀 ".repeat(30);
    const input = { questions: [{ ...params.questions[0], header }] };
    const { ctx, custom, component } = context();
    const definition = tool();
    expect(definition.parameters.properties.questions.items.properties.header).not.toHaveProperty("maxLength");
    expect(definition.promptGuidelines?.join(" ")).not.toMatch(/headers at most 16/);
    const result = await execute(definition, ctx, undefined, input);
    expect(custom).toHaveBeenCalledOnce();
    expect(result.details.answers[0].answer).toBe("Minimal");
    expect(input.questions[0].header).toBe(header);
    for (const width of [1, 8, 24, 40, 80]) {
      for (const line of component().render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  it("completes six questions with five options and preserves context in expanded output", async () => {
    const input = { questions: Array.from({ length: 6 }, (_, index) => ({
      question: `Decision ${index + 1}: we need a rollout strategy because downtime affects customers. Which approach should we use?`,
      header: `Q${index + 1}`,
      options: Array.from({ length: 5 }, (_, optionIndex) => ({
        label: `Option ${optionIndex + 1}`,
        description: `Approach ${optionIndex + 1} trades rollout speed for rollback safety; compare its impact before choosing.`,
        preview: `Preview ${index + 1}/${optionIndex + 1}`,
      })),
    })) };
    const { ctx, custom } = context((component) => {
      for (let index = 0; index < 6; index++) {
        const rendered = component.render(200).join("\n");
        expect(rendered).toContain(`[${index + 1}/6]`);
        expect(rendered).toContain("downtime affects customers");
        expect(rendered).toContain("rollback safety");
        for (let move = 0; move < 4; move++) component.handleInput("\x1b[B");
        component.handleInput("\r");
      }
    });
    const definition = tool();
    const result = await execute(definition, ctx, undefined, input);
    expect(custom).toHaveBeenCalledOnce();
    expect(result.details.answers).toHaveLength(6);
    const sharedContext = { state: {} as Record<string, any> };
    const call = definition.renderCall!(input, theme, sharedContext as any);
    // Render the call row before the result paints, since the result hides it.
    expect(call.render(200).join("\n")).toContain("6. Q6");
    const collapsed = definition.renderResult!(result, { expanded: false, isPartial: false }, theme, sharedContext as any);
    const expanded = definition.renderResult!(result, { expanded: true, isPartial: false }, theme, sharedContext as any);
    expect(collapsed.render(200).join("\n")).toContain("6 answers");
    const expandedText = expanded.render(200).join("\n");
    for (let index = 0; index < 6; index++) {
      expect(result.details.answers[index]).toMatchObject({ questionIndex: index, answer: "Option 5", preview: `Preview ${index + 1}/5` });
      expect(expandedText).toContain(`Decision ${index + 1}`);
      expect(expandedText).toContain(`Preview ${index + 1}/5`);
    }
    for (const width of [1, 8, 24, 40, 80, 100, 120]) {
      for (const component of [collapsed, expanded]) {
        for (const line of component.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
    for (const width of [1, 8, 24, 40, 80, 100, 120]) {
      for (const line of definition.renderCall!(input, theme, { state: {} } as any).render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
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
  it("declares renderShell as 'self' and the compact marker", () => {
    expect(tool().renderShell).toBe("self");
    expect((tool() as any).compactToolRenderingVersion).toBe(1);
  });

  it("assembles one compact inline row across call and result using context.state", async () => {
    const definition = tool();
    const { ctx } = context();
    const result = await execute(definition, ctx);
    const sharedContext = { state: {} as Record<string, any> };

    const callComponent = definition.renderCall!(params, theme, sharedContext as any);
    const callPendingLines = callComponent.render(80);
    expect(callPendingLines).toHaveLength(1);
    expect(callPendingLines[0]).toContain("ask_user_question");
    expect(callPendingLines[0]).toContain("─");
    expect(callPendingLines[0]).not.toMatch(/[╭╮╰╯│]/);

    const resultComponent = definition.renderResult!(result, { expanded: false, isPartial: false }, theme, sharedContext as any);
    const resultLines = resultComponent.render(80);
    expect(sharedContext.state.hasResult).toBe(true);
    expect(resultLines).toHaveLength(1);
    expect(resultLines[0]).not.toMatch(/[╭╮╰╯│]/);

    // The call slot disappears entirely once the result row exists: no second status row.
    expect(callComponent.render(80)).toEqual([]);
  });

  it("falls back to question prompt when header is omitted in renderCall", () => {
    const definition = tool();
    const noHeaderArgs = { questions: [{ question: "Select an architectural option" }] };
    const lines = definition.renderCall!(noHeaderArgs, theme, {} as any).render(80);
    expect(lines.join("\n")).toContain("Select an architectural option");
    expect(lines.join("\n")).not.toMatch(/1\.\s+·/);
  });

  it("keeps one compact answer row without expansion hints and shows previews only on expansion", async () => {
    const definition = tool();
    const { ctx } = context();
    const result = await execute(definition, ctx);
    const sharedContext = { state: {} as Record<string, any> };
    definition.renderCall!(params, theme, sharedContext as any);
    const collapsedLines = definition.renderResult!(result, { expanded: false, isPartial: false }, theme, sharedContext as any).render(100);
    const collapsed = collapsedLines.join("\n");
    const expanded = definition.renderResult!(result, { expanded: true, isPartial: false }, theme, sharedContext as any).render(100).join("\n");
    expect(collapsedLines).toHaveLength(1);
    expect(collapsed).not.toMatch(/[╭╮╰╯│]/);
    expect(collapsed).toMatch(/1 answer/);
    expect(collapsed).toContain("Scope");
    expect(collapsed).toContain("Minimal");
    expect(collapsed).not.toMatch(/expand|ctrl\+o/i);
    expect(collapsed).not.toContain("Keep all selected detail.");
    expect(expanded).toContain("Keep all selected detail.");
    expect(expanded).not.toMatch(/collapse|ctrl\+o/i);
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
    const collapsed = definition.renderResult!(multiCustomResult, { expanded: false, isPartial: false }, theme, {} as any).render(120).join("\n");
    expect(collapsed).toContain("(custom) Bespoke");
    expect(collapsed).toContain("selected: Minimal");
    expect(collapsed).not.toContain("selected preview:");

    const expanded = definition.renderResult!(multiCustomResult, { expanded: true, isPartial: false }, theme, {} as any).render(120).join("\n");
    expect(expanded).toContain("(custom) Bespoke");
    expect(expanded).toContain("selected: Minimal");
    expect(expanded).toContain("selected preview: Keep detail.");
    expect(expanded).not.toMatch(/collapse|ctrl\+o/i);
  });

  it("renders streaming, cancellation, failures and empty results deliberately", () => {
    const render = (result: any, partial = false) => tool().renderResult!(result,
      { expanded: false, isPartial: partial }, theme, {} as any).render(80).join("\n");
    expect(render({ content: [], details: {} }, true)).toMatch(/waiting/i);
    expect(render({ content: [{ type: "text", text: "Cancelled" }], details: { cancelled: true } })).toMatch(/cancelled/i);
    expect(render({ content: [{ type: "text", text: "Error: TUI unavailable" }], details: {} })).toContain("TUI unavailable");
    expect(render({ content: [], details: {} })).toMatch(/no answers/i);
    for (const result of [
      { content: [], details: {} },
      { content: [{ type: "text", text: "Cancelled" }], details: { cancelled: true } },
      { content: [], details: {} },
    ]) {
      expect(render(result).split("\n")).toHaveLength(1);
    }
  });

  it("compacts native validation errors but preserves every line on expansion", () => {
    const definition = tool();
    const body = 'Validation failed for tool "ask_user_question":\n  - questions.1.header: invalid input\n\nReceived arguments:\n{\n  "questions": ["full diagnostic payload"]\n}';
    // Pi schema failures have no questionnaire details and signal errors via context.
    const result = { content: [{ type: "text" as const, text: body }], details: undefined };
    const original = JSON.stringify(result);
    const sharedContext = { state: {} as Record<string, any>, isError: true };
    const call = definition.renderCall!(params, theme, sharedContext as any);
    expect(call.render(80)).toHaveLength(1);
    const collapsed = definition.renderResult!(result, { expanded: false, isPartial: false }, theme, sharedContext as any);
    for (const width of [1, 2, 8, 24, 40, 80, 120]) {
      const lines = collapsed.render(width);
      expect(lines).toHaveLength(1);
      for (const line of [...call.render(width), ...lines]) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      expect(lines.join("\n")).not.toContain("Received arguments");
      expect(lines.join("\n")).not.toContain("full diagnostic payload");
    }
    expect(collapsed.render(200).join("\n")).toContain('Validation failed for tool "ask_user_question"');
    expect(collapsed.render(200).join("\n")).not.toMatch(/expand|ctrl\+o/i);
    expect(call.render(80)).toEqual([]);
    const expanded = definition.renderResult!(result, { expanded: true, isPartial: false }, theme, sharedContext as any).render(200).join("\n");
    for (const line of body.split("\n").filter(Boolean)) expect(expanded).toContain(line);
    expect(expanded).not.toMatch(/collapse|ctrl\+o/i);
    expect(JSON.stringify(result)).toBe(original);
  });

  it("keeps long single-line execution errors compact and handles empty error bodies", () => {
    const definition = tool();
    for (const body of ["Error: 中文 🚀 é ".repeat(100), ""]) {
      const result = { content: [{ type: "text" as const, text: body }], details: undefined, isError: true };
      for (const width of [1, 8, 24, 40, 80]) {
        const lines = definition.renderResult!(result, { expanded: false, isPartial: false }, theme, {} as any).render(width);
        expect(lines).toHaveLength(1);
        for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
      if (!body) {
        const expanded = definition.renderResult!(result, { expanded: true, isPartial: false }, theme, {} as any).render(80).join("\n");
        expect(expanded.toLowerCase()).toContain("tool execution failed");
      }
    }
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

  describe("ntfy notification integration", () => {
    it("resolves ntfy URL from process.env without exposing secrets in code", async () => {
      const originalEnv = process.env.PI_NTFY_URL;
      try {
        process.env.PI_NTFY_URL = "https://ntfy.sh/test-topic-123";
        expect(await getNtfyUrl()).toBe("https://ntfy.sh/test-topic-123");
      } finally {
        if (originalEnv !== undefined) {
          process.env.PI_NTFY_URL = originalEnv;
        } else {
          delete process.env.PI_NTFY_URL;
        }
      }
    });

    it("sends notification with header as title and question as body", async () => {
      const originalEnv = process.env.PI_NTFY_URL;
      const originalFetch = globalThis.fetch;
      const mockFetch = vi.fn().mockResolvedValue({ body: { cancel: vi.fn() } });
      globalThis.fetch = mockFetch;

      try {
        process.env.PI_NTFY_URL = "https://ntfy.sh/test-topic-abc";
        await notifyNtfyQuestion("Decisión clave", "¿Proceder con la refactorización?");

        expect(mockFetch).toHaveBeenCalledWith(
          "https://ntfy.sh/test-topic-abc",
          expect.objectContaining({
            method: "POST",
            headers: expect.objectContaining({
              Title: "Pi: Decisión clave",
              Priority: "high",
              Tags: "question,warning",
            }),
            body: "¿Proceder con la refactorización?",
          }),
        );
      } finally {
        globalThis.fetch = originalFetch;
        if (originalEnv !== undefined) {
          process.env.PI_NTFY_URL = originalEnv;
        } else {
          delete process.env.PI_NTFY_URL;
        }
      }
    });

    it("swallows fetch network errors safely without breaking tool execution", async () => {
      const originalEnv = process.env.PI_NTFY_URL;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network timeout"));

      try {
        process.env.PI_NTFY_URL = "https://ntfy.sh/test-topic-abc";
        await expect(notifyNtfyQuestion("Header", "Question")).resolves.toBeUndefined();
      } finally {
        globalThis.fetch = originalFetch;
        if (originalEnv !== undefined) {
          process.env.PI_NTFY_URL = originalEnv;
        } else {
          delete process.env.PI_NTFY_URL;
        }
      }
    });

    it("triggers ntfy notification when execute is called", async () => {
      const originalEnv = process.env.PI_NTFY_URL;
      const originalFetch = globalThis.fetch;
      const mockFetch = vi.fn().mockResolvedValue({ body: { cancel: vi.fn() } });
      globalThis.fetch = mockFetch;

      try {
        process.env.PI_NTFY_URL = "https://ntfy.sh/test-topic-exec";
        const definition = tool();
        const { ctx } = context();
        await execute(definition, ctx);

        expect(mockFetch).toHaveBeenCalledWith(
          "https://ntfy.sh/test-topic-exec",
          expect.objectContaining({
            method: "POST",
            headers: expect.objectContaining({
              Title: "Pi: Scope",
              Priority: "high",
            }),
            body: "What should we build?",
          }),
        );
      } finally {
        globalThis.fetch = originalFetch;
        if (originalEnv !== undefined) {
          process.env.PI_NTFY_URL = originalEnv;
        } else {
          delete process.env.PI_NTFY_URL;
        }
      }
    });
  });
});
