import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
export const { findSymbol } = jiti('../src/core/find-symbol-resolver.ts');
