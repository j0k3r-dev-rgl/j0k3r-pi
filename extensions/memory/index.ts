import { openMemoryDb } from './src/db.js';
import { migrate } from './src/migrations.js';
import { registerMemoryTools } from './src/tools.js';
import { registerMemoryCommands } from './src/commands.js';
import { registerMemoryLifecycle } from './src/lifecycle.js';
import { renderMemoryContextMessage } from './src/render.js';

export default function memoryExtension(pi: any) {
  const db = openMemoryDb();
  migrate(db);
  pi.registerMessageRenderer?.('memory-context', renderMemoryContextMessage);
  registerMemoryTools(pi, db);
  registerMemoryCommands(pi, db);
  registerMemoryLifecycle(pi, db);
}
