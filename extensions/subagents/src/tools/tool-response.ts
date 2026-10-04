export function ok(text: string, details: Record<string, unknown> = {}) { return { content: [{ type: 'text', text }], details }; }
export function fail(error: unknown) { const msg = error instanceof Error ? error.message : String(error); return { content: [{ type: 'text', text: msg }], details: { error: msg }, isError: true }; }
