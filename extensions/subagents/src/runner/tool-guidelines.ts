/**
 * Generic extraction and composition of active tool prompt guidelines for lean subagents.
 * 100% generic with zero references to specific tools or extensions.
 */

export function extractActiveToolGuidelines(allowedTools: string[], ctx: any): string[] {
  let rawTools: any[] | undefined;
  for (const source of [ctx?.pi, ctx]) {
    try {
      const tools = source?.getAllTools?.() ?? source?.getTools?.();
      if (Array.isArray(tools)) {
        rawTools = tools;
        break;
      }
    } catch {}
  }

  if (!rawTools || rawTools.length === 0 || !Array.isArray(allowedTools) || allowedTools.length === 0) {
    return [];
  }

  const allowedSet = new Set(allowedTools);
  const guidelines: string[] = [];

  for (const tool of rawTools) {
    if (!tool || typeof tool !== 'object') continue;
    const name = (tool as { name?: unknown }).name;
    if (typeof name !== 'string' || !allowedSet.has(name)) continue;

    const rawGuidelines = (tool as { promptGuidelines?: unknown }).promptGuidelines;
    if (typeof rawGuidelines === 'string') {
      const trimmed = rawGuidelines.trim();
      if (trimmed.length > 0) {
        guidelines.push(trimmed);
      }
    } else if (Array.isArray(rawGuidelines)) {
      for (const item of rawGuidelines) {
        if (typeof item === 'string') {
          const trimmed = item.trim();
          if (trimmed.length > 0) {
            guidelines.push(trimmed);
          }
        }
      }
    }
  }

  return Array.from(new Set(guidelines));
}

export function composeLeanSystemPrompt(instructions: string, allowedTools: string[], ctx: any): string {
  const guidelines = extractActiveToolGuidelines(allowedTools, ctx);
  if (guidelines.length === 0) {
    return instructions;
  }

  const guidelineSection = [
    '## Active Tool Guidelines',
    ...guidelines.map((g) => `- ${g}`),
  ].join('\n');

  return instructions ? `${instructions}\n\n${guidelineSection}` : guidelineSection;
}
