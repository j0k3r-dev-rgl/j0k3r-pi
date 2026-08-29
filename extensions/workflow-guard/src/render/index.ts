export function stateSummary(state: { slug: string; workflow: string; phase: string; status: string }): string {
  return `${state.slug}: ${state.workflow} ${state.phase} ${state.status}`;
}

export function workspaceSummary(states: Array<{ slug: string; workflow: string; phase: string; status: string }>): string {
  const lines = [`Active OpenSpec changes: ${states.length}`];
  lines.push(...states.map((state) => stateSummary(state)));
  return lines.join('\n');
}

export function validationSummary(validation: { pass: boolean; violations: unknown[]; conflicts: unknown[]; regenerated_files: unknown[] }): string {
  const summary = validation.pass ? 'workflow validation passed' : `workflow validation failed: ${validation.violations.length} violation(s), ${validation.conflicts.length} conflict(s)`;
  return `${summary}\nDerived JSON regenerated: ${validation.regenerated_files.length}`;
}

export function boundedJson(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  return text.length <= 12000 ? text : `${text.slice(0, 12000)}\n[workflow-guard output truncated: use slug-specific query for more detail]`;
}
