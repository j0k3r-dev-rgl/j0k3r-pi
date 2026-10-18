import { Type } from 'typebox';

export const ASK_ORCHESTRATOR_TOOL = 'ask_orchestrator';

export const ASK_ORCHESTRATOR_GUIDELINE =
  'ask_orchestrator: when a missing fact or decision blocks progress, ask the parent orchestrator instead of guessing or returning BLOCKED. '
  + 'The call waits in this same session until the orchestrator answers. Ask one concise, self-contained question with the options you see. '
  + 'Never use it for routine progress updates.';

/** Child-session tool that pauses on a question to the parent orchestrator and returns its answer. */
export function createAskOrchestratorTool(ask: (question: string) => Promise<string>) {
  return {
    name: ASK_ORCHESTRATOR_TOOL,
    label: 'Ask Orchestrator',
    description: 'Ask the parent orchestrator a blocking question (missing fact, scope, or decision) and wait for its answer without ending this session.',
    parameters: Type.Object({
      question: Type.String({ description: 'One concise, self-contained question, including the options or trade-off when relevant.' }),
    }),
    async execute(_id: string, params: { question?: unknown }) {
      const question = typeof params?.question === 'string' ? params.question : '';
      try {
        const answer = await ask(question);
        return { content: [{ type: 'text', text: `Orchestrator answer:\n${answer}` }], details: { answered: true } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `No answer: ${message}` }], details: { answered: false, error: message }, isError: true };
      }
    },
  };
}
