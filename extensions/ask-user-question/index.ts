import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerQuestionTool } from "./src/tools/ask-user-question.ts";

export default function (pi: ExtensionAPI): void {
  registerQuestionTool(pi);
}
