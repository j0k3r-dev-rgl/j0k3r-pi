import { DynamicBorder, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { answersText } from "../core/answers.ts";
import { QuestionParamsSchema } from "../core/schema.ts";
import { validateQuestionnaire } from "../core/validate.ts";
import { QuestionnaireInteraction } from "../render/interaction.ts";
import { renderQuestionCall, renderQuestionResult } from "../render/index.ts";
import { QuestionnaireView, type QuestionnaireResult } from "../render/questionnaire-view.ts";
import type { QuestionnaireDetails } from "../types.ts";

export async function getNtfyUrl(): Promise<string | undefined> {
  if (process.env.PI_NTFY_URL) return process.env.PI_NTFY_URL.trim();
  if (process.env.NTFY_TOPIC_URL) return process.env.NTFY_TOPIC_URL.trim();

  try {
    const { existsSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");

    const candidatePaths = [
      join(process.cwd(), ".env"),
      join(homedir(), ".pi", "agent", ".env"),
    ];

    for (const envPath of candidatePaths) {
      if (existsSync(envPath)) {
        const content = readFileSync(envPath, "utf8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
          const [key, ...vals] = trimmed.split("=");
          const val = vals.join("=").trim().replace(/^['"]|['"]$/g, "");
          if ((key.trim() === "PI_NTFY_URL" || key.trim() === "NTFY_TOPIC_URL") && val) {
            return val;
          }
        }
      }
    }
  } catch {
    // Ignore reading error
  }
  return undefined;
}

export async function notifyNtfyQuestion(header?: string, question?: string): Promise<void> {
  const url = await getNtfyUrl();
  if (!url) return;

  try {
    const title = header ? `Pi: ${header}` : "Pi necesita tu atención";
    const body = question || "Pi requiere una decisión o intervención humana.";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Title: title,
        Priority: "high",
        Tags: "question,warning",
        "Content-Type": "text/plain; charset=utf-8",
      },
      body,
      signal: AbortSignal.timeout(3000),
    });
    await response.body?.cancel();
  } catch {
    // Best effort: network errors must never interrupt tool execution.
  }
}

/** Open/free-text decisions only; closed authorization domains use their own UI. */
export function registerQuestionTool(pi: ExtensionAPI): void {
  const tool: ToolDefinition<typeof QuestionParamsSchema, QuestionnaireDetails> = {
    name: "ask_user_question",
    label: "Ask User Question",
    description: "Ask one to six structured questions, each with two to five ordered options, optional previews, multiple selection and an always-available free-text response. Requires the interactive Pi TUI.",
    promptSnippet: "Ask the user for necessary decisions through a native interactive questionnaire.",
    promptGuidelines: [
      "When a material product or design decision is open, use ask_user_question for one focused question, then wait. Do not turn clear tasks into unnecessary interviews.",
      "Find environment and code facts yourself within authorized scope; ask only for user-owned decisions.",
      "Batch up to six questions only when they are independent and the governing workflow permits it; defer questions that depend on unanswered choices.",
      "Keep headers concise for readability and option labels at most 60 characters; give two to five honest options with descriptions and optional previews. Use multiSelect only for non-exclusive choices.",
      "Provide clear context in each question: explain why the decision is needed, relevant background, and the trade-off at hand. Avoid terse or context-free questions that leave the user guessing; be concise without omitting what is needed to understand the choice.",
      "Provide meaningful explanations in option descriptions: clearly state consequences, trade-offs, and practical differences between options so the user can make an informed choice. Use plain language and explain necessary technical terms.",
      "Write questions and authored options in the user's conversation language. Indicate a recommendation in the description when helpful, without preselecting or deciding for the user.",
      "The Type something. row is always available. Treat free text as the user's actual response, not as an opaque choice token or implicit approval.",
      "Cancellation means no decision or authorization was accepted: stop dependent work and wait, never guess, retry automatically, or treat cancellation as approval.",
      "Do not use this open/free-text tool for closed-domain provider consent, security confirmations or exact opaque-token authorizations. Preserve their original contracts.",
      "If this tool is unavailable or a complete question cannot fit its limits, ask the complete question in chat and wait; never omit options to force it into the UI.",
    ],
    exposure: "model-only",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    executionMode: "sequential",
    parameters: QuestionParamsSchema,
    async execute(_id, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      const error = validateQuestionnaire(params);
      if (error) throw new Error(`Invalid questionnaire: ${error.message}`);
      if (ctx.mode !== "tui") throw new Error("ask_user_question requires the interactive TUI; ask the user in chat instead.");

      const firstQ = params.questions[0];
      void notifyNtfyQuestion(firstQ?.header, firstQ?.question);

      let removeAbortListener = () => {};
      let selection: QuestionnaireResult;
      try {
        selection = await ctx.ui.custom<QuestionnaireResult>((tui, theme, keybindings, done) => {
          let settled = false;
          const finish = (result: QuestionnaireResult) => {
            if (settled) return;
            settled = true;
            removeAbortListener();
            done(result);
          };
          const abort = () => finish({ cancelled: true, answers: [] });
          const view = new QuestionnaireView({ questions: params.questions, theme, keybindings, onComplete: finish });
          const container = new QuestionnaireInteraction(view, () => tui.requestRender(), () => {
            removeAbortListener();
            finish({ cancelled: true, answers: [] });
          });
          container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
          container.addChild(view);
          container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
          if (signal) {
            removeAbortListener = () => signal.removeEventListener("abort", abort);
            signal.addEventListener("abort", abort, { once: true });
            // Queue an already-aborted completion until Pi mounts the component.
            if (signal.aborted) queueMicrotask(abort);
          }
          return container;
        });
      } finally { removeAbortListener(); }
      signal?.throwIfAborted();
      if (!selection || selection.cancelled) {
        return { content: [{ type: "text", text: "User cancelled the questionnaire. No decision was accepted; stop dependent work and wait for the user." }], details: { cancelled: true } };
      }
      return { content: [{ type: "text", text: answersText(selection.answers) }], details: { answers: selection.answers } };
    },
    renderShell: "self",
    renderCall: renderQuestionCall,
    renderResult: renderQuestionResult,
  };
  pi.registerTool(tool);
}
