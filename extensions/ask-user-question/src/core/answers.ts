import type { AnswerRow } from "../render/questionnaire-view.ts";

/** Keep free text, selected options and previews in the model-facing result. */
export function answersText(answers: AnswerRow[]): string {
  return answers.map((answer) => {
    const selected = answer.selected ?? [];
    const body = answer.kind === "multi"
      ? `selected: ${selected.join(", ")}`
      : answer.kind === "custom"
        ? `(custom) ${answer.answer ?? ""}${selected.length ? ` — selected: ${selected.join(", ")}` : ""}`
        : answer.answer ?? "";
    return `${answer.questionIndex + 1}. ${answer.question} — ${body}` +
      (answer.preview === undefined ? "" : `\n   selected preview: ${answer.preview}`);
  }).join("\n");
}
