import type { AgentToolResult, Theme, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import type { QuestionParams } from "../core/schema.ts";
import type { AnswerRow } from "./questionnaire-view.ts";
import type { QuestionnaireDetails } from "../types.ts";

const CYAN = "\x1b[38;2;0;229;255m";
const LIME = "\x1b[38;2;166;227;161m";
const AMBER = "\x1b[38;2;241;250;140m";
const RED = "\x1b[38;2;243;139;168m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
/** arch-electric muted foreground (#7aa7b8), used when no theme is available. */
const MUTED = "\x1b[38;2;122;167;184m";
const HAS_SGR_RE = /\x1b\[[0-9;]*m/;
const GRAPHEME_SEGMENTER = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Plain-text expanded body styling: theme muted token, preserving existing ANSI colors. */
function mutedText(theme: Theme, text: string): string {
  if (!text || HAS_SGR_RE.test(text)) return text;
  if (typeof theme?.fg === "function") {
    try {
      const styled = theme.fg("muted", text);
      if (typeof styled === "string" && styled !== text) return styled;
    } catch {
      // Fall back to arch-electric muted foreground.
    }
  }
  return `${MUTED}${text}${RESET}`;
}

function matchEscapeAt(str: string, index: number): string | undefined {
  if (str[index] !== "\x1b") return undefined;
  const next = str[index + 1];
  if (next === "[") {
    const m = str.slice(index).match(/^\x1b\[[0-?]*[ -/]*[@-~]/);
    return m?.[0];
  }
  if (next === "]" || next === "_") {
    const rest = str.slice(index + 2);
    const bel = rest.indexOf("\x07");
    const st = rest.indexOf("\x1b\\");
    if (bel !== -1 && (st === -1 || bel < st)) return str.slice(index, index + 2 + bel + 1);
    if (st !== -1) return str.slice(index, index + 2 + st + 2);
  }
  return undefined;
}

/** At total width 2, emit 2-col graphemes intact without margin and 1-col graphemes with `" "` margin. */
function wrapWidth2WithConditionalMargin(line: string): string[] {
  const normalized = line.replace(/\t/g, "   ");
  if (!normalized) return [" "];
  let sgr: string[] = [];
  let osc8 = "";
  const out: string[] = [];
  let i = 0;
  while (i < normalized.length) {
    const seq = matchEscapeAt(normalized, i);
    if (seq) {
      if (seq.startsWith("\x1b[") && seq.endsWith("m")) {
        const params = seq.slice(2, -1);
        if (params === "" || params.split(";").includes("0")) sgr = [];
        else if (params === "39") sgr = [];
        else sgr.push(seq);
      } else if (seq.startsWith("\x1b]8;")) {
        const oscMatch = seq.match(/^\x1b\]8;[^;]*;([^\x07\x1b]*)(?:\x07|\x1b\\)$/);
        if (oscMatch) osc8 = oscMatch[1] ? seq : "";
      }
      i += seq.length;
      continue;
    }
    let end = i + 1;
    while (end < normalized.length && !matchEscapeAt(normalized, end)) end++;
    for (const { segment } of GRAPHEME_SEGMENTER.segment(normalized.slice(i, end))) {
      const w = visibleWidth(segment);
      if (w === 0) continue;
      const prefix = sgr.join("") + osc8;
      const suffix = (osc8 ? "\x1b]8;;\x07" : "") + (sgr.length > 0 ? RESET : "");
      if (w >= 2) out.push(`${prefix}${segment}${suffix}`);
      else out.push(` ${prefix}${segment}${suffix}`);
    }
    i = end;
  }
  return out.length > 0 ? out : [" "];
}

function wrapMarginedLines(lines: string[], safeWidth: number): string[] {
  if (safeWidth <= 0) return [];
  if (safeWidth === 1) return [" "];
  if (safeWidth === 2) {
    const out: string[] = [];
    for (const raw of lines) {
      for (const sub of raw.split(/\r?\n/)) out.push(...wrapWidth2WithConditionalMargin(sub));
    }
    return out;
  }
  const innerWidth = safeWidth - 1;
  const out: string[] = [];
  for (const raw of lines) {
    for (const line of expandedLines(raw, innerWidth)) {
      out.push(line ? ` ${line}` : " ");
    }
  }
  return out;
}

/** Short inline row separator; not a card frame. */
export const ROW_SEPARATOR = " ─ ";

/** Presentation-only marker: declares compact, unboxed, single-row compliance with 1-col margin. */
export const COMPACT_TOOL_RENDERING = { compactToolRenderingVersion: 1, compactLeftMargin: 1 } as const;

interface QuestionRowState {
  hasResult?: boolean;
  badge?: string;
  isError?: boolean;
  isPartial?: boolean;
  expanded?: boolean;
  questions?: QuestionParams["questions"];
}

/** One compact inline row, composed of non-empty parts and wrapped to width without clipping. */
export function rowLine(parts: Array<string | undefined | null>, width: number): string[] {
  if (width <= 0) return [];
  const line = parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => part.replace(/[\r\n]+/g, ' '))
    .join(ROW_SEPARATOR);
  if (!line) return [""];
  const segments = wrapTextWithAnsi(line, width);
  if (segments.length === 0) return [""];
  return segments.map((segment) => (visibleWidth(segment) <= width ? segment : truncateToWidth(segment, width, "")));
}

/** Wrap expanded content losslessly, preserving blank-line meaning. */
export function expandedLines(text: string, width: number): string[] {
  if (width <= 0) return [];
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw === "") {
      out.push("");
      continue;
    }
    const segments = wrapTextWithAnsi(raw, width);
    if (segments.length === 0) out.push("");
    else out.push(...segments.map((segment) => truncateToWidth(segment, width, "")));
  }
  return out;
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

export function renderQuestionCall(
  args: QuestionParams,
  _theme: Theme,
  context?: any,
): Component & { compactLeftMargin: number } {
  const state: QuestionRowState = context ? (context.state ??= {}) : {};
  if (context?.state) context.state.questions = args.questions;
  const actionBadge = questionActionBadge(args.questions);
  if (context?.state) context.state.badge = actionBadge;

  return {
    compactLeftMargin: 1,
    invalidate() {},
    render(width: number): string[] {
      if (state.hasResult) return [];
      const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
      if (safeWidth <= 0) return [];
      if (safeWidth === 1) return [" "];
      if (safeWidth === 2) {
        const line = ["ask_user_question", actionBadge, `${DIM}waiting…${RESET}`]
          .filter((part): part is string => Boolean(part && part.trim()))
          .map((part) => part.replace(/[\r\n]+/g, " "))
          .join(ROW_SEPARATOR);
        return wrapWidth2WithConditionalMargin(line);
      }
      return rowLine(["ask_user_question", actionBadge, `${DIM}waiting…${RESET}`], safeWidth - 1).map((line) => ` ${line}`);
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

function answerLabel(answer: AnswerRow, state: QuestionRowState): string {
  const qData = state.questions?.[answer.questionIndex];
  return (answer as any).header?.trim() || qData?.header?.trim() || answer.question?.trim() || "Question";
}

export function renderQuestionResult(
  result: AgentToolResult<QuestionnaireDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context?: any,
): Component & { compactLeftMargin: number } {
  const state: QuestionRowState = context ? (context.state ??= {}) : {};
  const isError = Boolean(context?.isError || result.isError);
  const isCancelled = Boolean(result.details?.cancelled);
  const isPartial = Boolean(options.isPartial);
  const answers = result.details?.answers ?? [];
  const isEmpty = !isPartial && !isError && !isCancelled && answers.length === 0;

  state.hasResult = true;
  state.isError = isError;
  state.isPartial = isPartial;
  state.expanded = options.expanded === true;

  const body = result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");

  const statusColor = isError ? RED : (isCancelled || isEmpty) ? AMBER : isPartial ? CYAN : LIME;

  return {
    compactLeftMargin: 1,
    invalidate() {},
    render(width: number): string[] {
      const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
      if (safeWidth <= 0) return [];
      if (safeWidth === 1) return [" "];
      const innerWidth = safeWidth - 1;

      let head: Array<string | undefined>;
      if (isPartial) {
        head = ["ask_user_question", `${DIM}waiting for answers…${RESET}`];
      } else if (isCancelled) {
        head = ["ask_user_question", `${AMBER}cancelled — no decision accepted${RESET}`];
      } else if (isError) {
        const summary =
          body.split(/\r?\n/).find((line) => line.trim())?.trim() || "tool execution failed";
        head = ["ask_user_question", `${RED}error · ${summary}${RESET}`];
      } else if (isEmpty) {
        head = ["ask_user_question", `${AMBER}${body || "no answers"}${RESET}`];
      } else {
        const count = answers.length;
        const answersSummary = answers
          .map((answer) => `${answerLabel(answer, state)}: ${formatAnswerSummary(answer)}`)
          .join(" · ");
        head = [
          "ask_user_question",
          `${statusColor}${count} answer${count === 1 ? "" : "s"}${RESET}`,
          answersSummary,
        ];
      }

      const lines =
        safeWidth === 2
          ? wrapWidth2WithConditionalMargin(
              head
                .filter((part): part is string => Boolean(part && part.trim()))
                .map((part) => part.replace(/[\r\n]+/g, " "))
                .join(ROW_SEPARATOR),
            )
          : rowLine(head, innerWidth).map((line) => ` ${line}`);
      if (!state.expanded || isPartial) return lines;

      const styledBody = body
        ? body
            .split(/\r?\n/)
            .map((raw) => (raw ? mutedText(theme, raw) : ""))
        : [];
      const detailLines = styledBody.length > 0 ? wrapMarginedLines(styledBody, safeWidth) : [];
      if (detailLines.length === 0) return lines;
      return [...lines, ...detailLines];
    },
  };
}
