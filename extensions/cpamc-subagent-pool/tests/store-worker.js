const [modulePath, stateFile, taskId] = process.argv.slice(2);
const { PoolStateStore } = await import(modulePath);
const store = new PoolStateStore({ stateFile });
process.on('message', () => process.exit(0));
const prefix = await store.allocateAccount(new Map([['a', { remainingFraction: 0.9 }], ['b', { remainingFraction: 0.8 }]]), { taskId, sessionId: taskId });
process.send({ prefix });
