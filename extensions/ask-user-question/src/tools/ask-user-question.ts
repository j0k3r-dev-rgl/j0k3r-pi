import { DynamicBorder, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { answersText } from "../core/answers.ts";
import { QuestionParamsSchema } from "../core/schema.ts";
import { validateQuestionnaire } from "../core/validate.ts";
import { QuestionnaireInteraction } from "../render/interaction.ts";
import { renderQuestionCall, renderQuestionResult } from "../render/index.ts";
import { QuestionnaireView, type QuestionnaireResult } from "../render/questionnaire-view.ts";
import type { QuestionnaireDetails } from "../types.ts";

/** Open/free-text decisions only; closed authorization domains use their own UI. */
export function registerQuestionTool(pi: ExtensionAPI): void {
  const tool: ToolDefinition<typeof QuestionParamsSchema, QuestionnaireDetails> = {
    name: "ask_user_question",
    label: "Ask User Question",
    description: "Ask one to four structured questions, each with two to four ordered options, optional previews, multiple selection and an always-available free-text response. Requires the interactive Pi TUI.",
    promptSnippet: "Ask the user for necessary decisions through a native interactive questionnaire.",
    promptGuidelines: [
      "When a material product or design decision is open, use ask_user_question for one focused question, then wait. Do not turn clear tasks into unnecessary interviews.",
      "Find environment and code facts yourself within authorized scope; ask only for user-owned decisions.",
      "Batch up to four questions only when they are independent and the governing workflow permits it; defer questions that depend on unanswered choices.",
      "Keep headers at most 16 characters and option labels at most 60 characters; give two to four honest options with descriptions and optional previews. Use multiSelect only for non-exclusive choices.",
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
    renderCall: renderQuestionCall,
    renderResult: renderQuestionResult,
  };
  pi.registerTool(tool);
}
