import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import typesafeExtension, { isExtensionEnabled } from '../index.ts';

test('MINI-005: isExtensionEnabled correctly parses .pi/extensions.json', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'typesafe-optin-test-'));
  try {
    // 1. Missing config
    assert.equal(isExtensionEnabled('typesafe', tmp), false);

    // 2. Disabled
    const piDir = join(tmp, '.pi');
    mkdirSync(piDir, { recursive: true });
    const configPath = join(piDir, 'extensions.json');
    writeFileSync(configPath, JSON.stringify({ typesafe: false }), 'utf8');
    assert.equal(isExtensionEnabled('typesafe', tmp), false);

    // 3. Corrupted
    writeFileSync(configPath, '{ invalid-json', 'utf8');
    assert.equal(isExtensionEnabled('typesafe', tmp), false);

    // 4. Enabled
    writeFileSync(configPath, JSON.stringify({ typesafe: true }), 'utf8');
    assert.equal(isExtensionEnabled('typesafe', tmp), true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('MINI-005: typesafeExtension does not register tools or hooks when disabled', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'typesafe-disabled-test-'));
  try {
    const registeredTools = [];
    const eventHandlers = new Map();
    const mockPi = {
      registerTool: (tool) => registeredTools.push(tool),
      registerCommand: () => {},
      on: (event, handler) => eventHandlers.set(event, handler),
    };

    typesafeExtension(mockPi, { cwd: tmp });
    assert.equal(registeredTools.length, 0, 'No tools should be registered when disabled');
    assert.equal(eventHandlers.size, 0, 'No event handlers should be registered when disabled');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('MINI-005: typesafeExtension initializes, registers tools and hooks, and injects policy when enabled', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'typesafe-enabled-test-'));
  try {
    const piDir = join(tmp, '.pi');
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, 'extensions.json'), JSON.stringify({ typesafe: true }), 'utf8');

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

    typesafeExtension(mockPi, { cwd: tmp });

    // Assert tools registered
    assert.ok(registeredTools.length >= 3, `Expected at least 3 tools, got ${registeredTools.length}`);
    const toolNames = registeredTools.map(t => t.name);
    assert.ok(toolNames.includes('typesafe_evaluate'));
    assert.ok(toolNames.includes('typesafe_telemetry'));
    assert.ok(toolNames.includes('typesafe_record_shadow_triage'));
    assert.ok(toolNames.includes('typesafe_circuit_breaker'));
    assert.ok(toolNames.includes('typesafe_check_overengineering'));

    // Assert promptGuidelines are present on evaluate tool
    const evalTool = registeredTools.find(t => t.name === 'typesafe_evaluate');
    assert.ok(Array.isArray(evalTool.promptGuidelines), 'evaluate tool must provide promptGuidelines');

    // Assert command registered
    assert.equal(registeredCommands.length, 1);
    assert.equal(registeredCommands[0].name, 'typesafe');

    // Assert lifecycle event listeners: before_agent_start and session_shutdown must be present
    assert.ok(eventHandlers.has('before_agent_start'), 'before_agent_start hook must be registered');
    assert.ok(eventHandlers.has('session_shutdown'), 'session_shutdown hook must be registered');

    // Test before_agent_start dynamic policy injection
    const beforeAgentStartHandler = eventHandlers.get('before_agent_start');
    const result = await beforeAgentStartHandler({ systemPrompt: 'BASE SYSTEM PROMPT' });
    assert.ok(result.systemPrompt.includes('BASE SYSTEM PROMPT'));
    assert.ok(result.systemPrompt.includes('## TypeSafe System One (Jev) Policy'));

    // Test shutdown cleans up without errors
    const shutdownHandler = eventHandlers.get('session_shutdown');
    await shutdownHandler();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
