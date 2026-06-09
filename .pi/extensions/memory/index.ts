import { openMemoryDb } from './src/db.js';
import { migrate } from './src/migrations.js';
import { registerMemoryTools } from './src/tools.js';
import { registerMemoryCommands } from './src/commands.js';
import { registerMemoryLifecycle } from './src/lifecycle.js';

export default function memoryExtension(pi: any) {
  const db = openMemoryDb();
  migrate(db);
  registerMemoryTools(pi, db);
  registerMemoryCommands(pi, db);
  registerMemoryLifecycle(pi, db);
}
