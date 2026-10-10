import type { AnswerRow } from "./render/questionnaire-view.ts";

export interface QuestionnaireDetails {
  cancelled?: boolean;
  answers?: AnswerRow[];
}
