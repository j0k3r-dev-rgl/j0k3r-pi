import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
export const { buildWorkspaceGraph } = jiti('../src/core/workspace-graph.ts');
