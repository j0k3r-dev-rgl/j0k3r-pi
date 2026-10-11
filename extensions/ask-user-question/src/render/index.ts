import { keyText, type AgentToolResult, type Theme, type ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import type { QuestionParams } from "../core/schema.ts";
import type { AnswerRow } from "./questionnaire-view.ts";
import type { QuestionnaireDetails } from "../types.ts";

const CYAN = "\x1b[38;2;0;229;255m";
const LIME = "\x1b[38;2;166;227;161m";
const AMBER = "\x1b[38;2;241;250;140m";
const RED = "\x1b[38;2;243;139;168m";
const RESET = "\x1b[0m";

function pad(text: string, width: number): string {
  const vis = visibleWidth(text);
  if (vis <= width) {
    return text + " ".repeat(width - vis);
  }
  const fitted = truncateToWidth(text, width, "");
  const visFitted = visibleWidth(fitted);
  return fitted + " ".repeat(Math.max(0, width - visFitted));
}

function boxLine(content: string, innerWidth: number, borderColor: string): string {
  const innerContentWidth = Math.max(0, innerWidth - 2);
  return `${borderColor}│${RESET} ${pad(content, innerContentWidth)} ${borderColor}│${RESET}`;
}

function cardTopBorder(
  toolName: string,
  actionOrTarget: string | undefined,
  innerWidth: number,
  borderColor: string,
  titleColor: string = borderColor,
): string {
  const cleanAction = actionOrTarget ? actionOrTarget.replace(/[\r\n]+/g, " ").trim() : undefined;
  let label = cleanAction ? `${toolName} [${cleanAction}]` : toolName;

  const maxTitleWidth = Math.max(4, innerWidth - 4);
  if (visibleWidth(label) + 2 > maxTitleWidth && cleanAction) {
    const maxActionWidth = Math.max(3, maxTitleWidth - visibleWidth(toolName) - 5);
    const truncatedAction = truncateToWidth(cleanAction, maxActionWidth, "");
    label = `${toolName} [${truncatedAction}]`;
  }

  let titleText = ` ${label} `;
  if (visibleWidth(titleText) > innerWidth) {
    titleText = ` ${truncateToWidth(label, Math.max(1, innerWidth - 2), "")} `;
  }

  const rest = Math.max(0, innerWidth - visibleWidth(titleText));
  const leftDash = Math.min(2, rest);
  const rightDash = Math.max(0, rest - leftDash);
  return `${borderColor}╭${"─".repeat(leftDash)}${RESET}${titleColor}${titleText}${RESET}${borderColor}${"─".repeat(rightDash)}╮${RESET}`;
}

function cardBottomBorder(innerWidth: number, borderColor: string): string {
  return `${borderColor}╰${"─".repeat(Math.max(0, innerWidth))}╯${RESET}`;
}

function questionActionBadge(questions: QuestionParams["questions"]): string | undefined {
  if (!Array.isArray(questions) || questions.length === 0) return undefined;
  return questions
    .map((q, index) => {
      const label = q.header?.trim() || q.question?.trim() || "Question";
      return `${index + 1}. ${label}`;
    })
    .join(" · ");
}

function formatKeyHint(theme: Theme, action: "expand" | "collapse"): string {
  const key = keyText("app.tools.expand") || "ctrl+o";
  return `${theme.fg("dim", key)} ${theme.fg("muted", `to ${action}`)}`;
}

export function renderQuestionCall(
  args: QuestionParams,
  _theme: Theme,
  context?: any,
): Component {
  if (context?.state) {
    context.state.questions = args.questions;
  }
  const actionBadge = questionActionBadge(args.questions);
  return {
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];
      const label = actionBadge ? `ask_user_question [${actionBadge}]` : "ask_user_question";
      if (width < 24) {
        return [truncateToWidth(label, Math.max(1, width), "")];
      }

      const innerWidth = Math.max(0, width - 2);
      const state = context?.state;
      const isError = Boolean(context?.isError);
      const borderColor = state?.borderColor ?? (isError ? RED : CYAN);
      const titleColor = borderColor;

      const topBorder = cardTopBorder("ask_user_question", actionBadge, innerWidth, borderColor, titleColor);
      if (state?.hasResult) {
        return [topBorder];
      }

      const pendingDetail = actionBadge ? `Pending: ${actionBadge}` : "Pending…";
      const pendingLine = `${CYAN}●${RESET} ${pendingDetail}`;
      return [
        topBorder,
        boxLine(pendingLine, innerWidth, borderColor),
        cardBottomBorder(innerWidth, borderColor),
      ];
    },
  };
}

function formatAnswerSummary(answer: AnswerRow): string {
  const selected = answer.selected ?? [];
  if (answer.kind === "multi") {
    return `selected: ${selected.join(", ")}`;
  }
  if (answer.kind === "custom") {
    const customText = (answer as { custom?: string }).custom ?? answer.answer ?? "";
    return `(custom) ${customText}${selected.length ? ` — selected: ${selected.join(", ")}` : ""}`;
  }
  return answer.answer ?? "";
}

export function renderQuestionResult(
  result: AgentToolResult<QuestionnaireDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context?: any,
): Component {
  const isError = Boolean(context?.isError || result.isError);
  const isCancelled = Boolean(result.details?.cancelled);
  const isPartial = Boolean(options.isPartial);
  const answers = result.details?.answers ?? [];
  const isEmpty = !isPartial && !isError && !isCancelled && answers.length === 0;

  const borderColor = isError ? RED : (isCancelled || isEmpty) ? AMBER : isPartial ? CYAN : LIME;

  if (context?.state) {
    context.state.hasResult = true;
    context.state.borderColor = borderColor;
  }

  return {
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];

      if (context?.state) {
        context.state.hasResult = true;
        context.state.borderColor = borderColor;
      }

      const isExpanded = options.expanded === true;
      const body = result.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      const bodyLines: string[] = [];

      if (isPartial) {
        bodyLines.push(theme.fg("muted", "Waiting for answers…"));
      } else if (isCancelled) {
        bodyLines.push(theme.fg("warning", "Cancelled — no decision accepted"));
        if (!isExpanded) {
          bodyLines.push(formatKeyHint(theme, "expand"));
        } else {
          if (body) {
            bodyLines.push("");
            bodyLines.push(...body.split("\n"));
          }
          bodyLines.push(formatKeyHint(theme, "collapse"));
        }
      } else if (isError) {
        const errorMsg = body || "Error: tool execution failed";
        if (!isExpanded) {
          const summary = errorMsg.split(/\r?\n/).find((line) => line.trim())?.trim() || "Error: tool execution failed";
          const summaryWidth = width < 24 ? width : width - 4;
          bodyLines.push(truncateToWidth(theme.fg("error", summary), summaryWidth));
          bodyLines.push(formatKeyHint(theme, "expand"));
        } else {
          bodyLines.push(theme.fg("error", errorMsg));
          bodyLines.push(formatKeyHint(theme, "collapse"));
        }
      } else if (isEmpty) {
        const emptyMsg = body || "No answers";
        const isMsgError = /error/i.test(emptyMsg);
        bodyLines.push(theme.fg(isMsgError ? "error" : "warning", emptyMsg));
        if (!isExpanded) {
          bodyLines.push(formatKeyHint(theme, "expand"));
        } else {
          bodyLines.push(formatKeyHint(theme, "collapse"));
        }
      } else if (!isExpanded) {
        const count = answers.length;
        const countText = `${count} answer${count === 1 ? "" : "s"}`;
        let answersSummary: string;
        if (count === 1) {
          const a = answers[0];
          const qData = context?.state?.questions?.[a.questionIndex];
          const label = (a as any).header?.trim() || qData?.header?.trim() || a.question?.trim() || "Question";
          const ans = formatAnswerSummary(a);
          answersSummary = `${theme.fg("success", `✓ ${countText}`)}: ${theme.fg("accent", label)}: ${theme.fg("success", ans)}`;
        } else {
          const items = answers
            .map((a) => {
              const qData = context?.state?.questions?.[a.questionIndex];
              const label = (a as any).header?.trim() || qData?.header?.trim() || a.question?.trim() || "Question";
              return `${theme.fg("accent", label)}: ${theme.fg("success", formatAnswerSummary(a))}`;
            })
            .join(" · ");
          answersSummary = `${theme.fg("success", `✓ ${countText}`)}: ${items}`;
        }
        bodyLines.push(`${answersSummary} · ${formatKeyHint(theme, "expand")}`);
      } else {
        const count = answers.length;
        const countText = `${count} answer${count === 1 ? "" : "s"}`;
        bodyLines.push(`${theme.fg("success", `✓ ${countText}`)} · ${formatKeyHint(theme, "collapse")}`);

        for (const answer of answers) {
          bodyLines.push("");
          const qData = context?.state?.questions?.[answer.questionIndex];
          const header = (answer as any).header?.trim() || qData?.header?.trim();
          const label = header
            ? `${header} — ${answer.question}`
            : answer.question;
          bodyLines.push(theme.fg("accent", `${answer.questionIndex + 1}. ${label}`));
          bodyLines.push(`  ${theme.fg("success", `✓ ${formatAnswerSummary(answer)}`)}`);
          if (answer.preview !== undefined && answer.preview !== "") {
            bodyLines.push(`  ${theme.fg("dim", `selected preview: ${answer.preview}`)}`);
          }
        }
      }

      if (width < 24) {
        return bodyLines.map((line) => truncateToWidth(line, Math.max(1, width), ""));
      }

      const innerWidth = Math.max(0, width - 2);
      const innerContentWidth = Math.max(0, innerWidth - 2);
      const wrappedBodyLines: string[] = [];

      for (const rawLine of bodyLines) {
        const subLines = rawLine.split(/\r?\n/);
        for (const sub of subLines) {
          if (sub === "") {
            wrappedBodyLines.push("");
          } else {
            const wrapped = wrapTextWithAnsi(sub, innerContentWidth);
            if (wrapped.length === 0) {
              wrappedBodyLines.push("");
            } else {
              wrappedBodyLines.push(...wrapped);
            }
          }
        }
      }

      const framed: string[] = [];
      for (const line of wrappedBodyLines) {
        framed.push(boxLine(line, innerWidth, borderColor));
      }
      framed.push(cardBottomBorder(innerWidth, borderColor));
      return framed;
    },
  };
}
