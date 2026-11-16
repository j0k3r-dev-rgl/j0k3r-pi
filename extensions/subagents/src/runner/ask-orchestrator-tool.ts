import { Type } from 'typebox';
import { emptyComponent, inlineComponent } from '../render/tools/components.js';

export const ASK_ORCHESTRATOR_TOOL = 'ask_orchestrator';

export const ASK_ORCHESTRATOR_GUIDELINE =
  'ask_orchestrator: when a missing fact or decision blocks progress, ask the parent orchestrator instead of guessing or returning BLOCKED. '
  + 'The call waits in this same session until the orchestrator answers. Ask one concise, self-contained question with the options you see. '
  + 'Never use it for routine progress updates.';

const SEPARATOR = ' ─ ';

function themeFg(theme: any, key: string, text: string): string {
  try {
    return typeof theme?.fg === 'function' ? theme.fg(key, text) : text;
  } catch {
    return text;
  }
}

function questionSummary(args: any): string {
  const question = typeof args?.question === 'string' ? args.question.replace(/\s+/g, ' ').trim() : '';
  return question.length > 80 ? `${question.slice(0, 79)}…` : question;
}

/** Compact inline row for the injected child tool; no frame, background or expansion instruction. */
function renderAskCall(args: any, theme: any, context?: any) {
  try {
    if (context?.state?.hasResult) return emptyComponent();
    const question = questionSummary(args);
    const header = [
      themeFg(theme, 'toolTitle', ASK_ORCHESTRATOR_TOOL),
      themeFg(theme, 'muted', 'asking'),
      question ? themeFg(theme, 'muted', question) : undefined,
    ].filter(Boolean).join(SEPARATOR);
    return inlineComponent({ header, body: [], expanded: false, state: context?.state, isCallSlot: true });
  } catch {
    return inlineComponent({ header: `${ASK_ORCHESTRATOR_TOOL}${SEPARATOR}asking`, body: [], expanded: false, state: context?.state, isCallSlot: true });
  }
}

function renderAskResult(result: any, options: any, theme: any, context?: any) {
  if (context?.state && typeof context.state === 'object') context.state.hasResult = true;
  try {
    const expanded = options?.expanded === true;
    const isPartial = Boolean(options?.isPartial);
    const answered = result?.details?.answered !== false && !result?.isError;
    const state = isPartial ? 'waiting' : answered ? 'answered' : 'no answer';
    const header = [
      themeFg(theme, 'toolTitle', ASK_ORCHESTRATOR_TOOL),
      themeFg(theme, isPartial ? 'muted' : answered ? 'success' : 'error', state),
    ].filter(Boolean).join(SEPARATOR);
    const text = (result?.content ?? []).filter((part: any) => part?.type === 'text').map((part: any) => part.text).join('\n');
    return inlineComponent({ header, body: text ? text.split('\n') : [], expanded });
  } catch {
    const text = (result?.content ?? []).filter((part: any) => part?.type === 'text').map((part: any) => part.text).join('\n');
    return inlineComponent({
      header: `${ASK_ORCHESTRATOR_TOOL}${SEPARATOR}${result?.isError ? 'no answer' : 'answered'}`,
      body: text ? text.split('\n') : [],
      expanded: options?.expanded === true,
    });
  }
}

/** Child-session tool that pauses on a question to the parent orchestrator and returns its answer. */
export function createAskOrchestratorTool(ask: (question: string) => Promise<string>) {
  return {
    name: ASK_ORCHESTRATOR_TOOL,
    label: 'Ask Orchestrator',
    description: 'Ask the parent orchestrator a blocking question (missing fact, scope, or decision) and wait for its answer without ending this session.',
    parameters: Type.Object({
      question: Type.String({ description: 'One concise, self-contained question, including the options or trade-off when relevant.' }),
    }),
    renderShell: 'self',
    compactToolRenderingVersion: 1,
    compactLeftMargin: 1,
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
    renderCall: renderAskCall,
    renderResult: renderAskResult,
  };
}
