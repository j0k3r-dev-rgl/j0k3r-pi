import test from 'node:test';
import assert from 'node:assert/strict';
import typesafeExtension from '../index.ts';

test('MINI-005: typesafeExtension initializes, registers tools and hooks, and cleans up on shutdown', async () => {
  const registeredTools = [];
  const registeredCommands = [];
  const eventHandlers = new Map();

  const mockPi = {
    registerTool: (tool) => {
      registeredTools.push(tool);
    },
    registerCommand: (name, options) => {
      registeredCommands.push({ name, options });
    },
    on: (event, handler) => {
      eventHandlers.set(event, handler);
    }
  };

  typesafeExtension(mockPi);

  // Assert tools registered (at least 3: typesafe_evaluate, typesafe_telemetry, typesafe_record_shadow_triage)
  assert.ok(registeredTools.length >= 3, `Expected at least 3 tools, got ${registeredTools.length}`);
  const toolNames = registeredTools.map(t => t.name);
  assert.ok(toolNames.includes('typesafe_evaluate'));
  assert.ok(toolNames.includes('typesafe_telemetry'));
  assert.ok(toolNames.includes('typesafe_record_shadow_triage'));

  // Assert command registered
  assert.equal(registeredCommands.length, 1);
  assert.equal(registeredCommands[0].name, 'typesafe');

  // Assert lifecycle event listeners: false route observation hooks must be absent
  assert.equal(eventHandlers.has('before_agent_start'), false, 'before_agent_start must not be hooked');
  assert.equal(eventHandlers.has('tool_call'), false, 'tool_call must not be hooked');
  assert.equal(eventHandlers.has('agent_end'), false, 'agent_end must not be hooked');
  assert.ok(eventHandlers.has('session_shutdown'), 'session_shutdown hook must be registered');

  // Confirmation turn test: verify no hook exists that would capture "yes" or follow-up turns
  assert.equal(eventHandlers.get('before_agent_start'), undefined);
  assert.equal(eventHandlers.get('tool_call'), undefined);
  assert.equal(eventHandlers.get('agent_end'), undefined);

  // Test shutdown cleans up without errors
  const shutdownHandler = eventHandlers.get('session_shutdown');
  await shutdownHandler();
});
