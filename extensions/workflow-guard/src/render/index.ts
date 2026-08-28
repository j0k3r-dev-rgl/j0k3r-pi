export function stateSummary(state: { slug: string; workflow: string; phase: string; status: string }): string {
  return `${state.slug}: ${state.workflow} ${state.phase} ${state.status}`;
}

export function boundedJson(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  return text.length <= 12000 ? text : `${text.slice(0, 12000)}\n[workflow-guard output truncated: use slug-specific query for more detail]`;
}
