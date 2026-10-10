import { keyText, type AgentToolResult, type Theme, type ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { WidthSafeText as Text } from "./text.ts";
import type { QuestionParams } from "../core/schema.ts";
import type { QuestionnaireDetails } from "../types.ts";

export function renderQuestionCall(args: QuestionParams, theme: Theme): Text {
  const questions = Array.isArray(args.questions) ? args.questions : [];
  const summary = questions.map((question, index) => `${index + 1}. ${question.header ?? ""}`).join(" · ");
  return new Text(theme.fg("toolTitle", theme.bold("ask_user_question ")) +
    theme.fg("muted", summary.length > 120 ? `${summary.slice(0, 119)}…` : summary), 0, 0);
}

export function renderQuestionResult(
  result: AgentToolResult<QuestionnaireDetails>, options: ToolRenderResultOptions, theme: Theme,
): Text {
  if (options.isPartial) return new Text(theme.fg("muted", "Waiting for answers…"), 0, 0);
  const body = result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  if (options.expanded) return new Text(body || "No answers", 0, 0);
  if (result.details?.cancelled) return new Text(theme.fg("warning", "Cancelled — no decision accepted"), 0, 0);
  const count = result.details?.answers?.length ?? 0;
  if (!count) return new Text(theme.fg("warning", body || "No answers"), 0, 0);
  return new Text(theme.fg("success", `✓ ${count} answer${count === 1 ? "" : "s"}`) +
    theme.fg("muted", ` · ${keyText("app.tools.expand")} expand`), 0, 0);
}
