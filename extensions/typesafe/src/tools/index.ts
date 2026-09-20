import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { TelemetryDb } from '../storage/telemetry-db.ts';
import { createEvaluateTool } from './evaluate-tool.ts';
import { createTelemetryTool } from './telemetry-tool.ts';
import { createShadowTool } from './shadow-tool.ts';
import { evaluateSystemOne } from '../providers/typesafe-client.ts';
import { renderTypesafeCall, renderTypesafeResult } from '../render/index.ts';

export function registerTypesafeTools(pi: ExtensionAPI, db: TelemetryDb): void {
  const evaluateTool = createEvaluateTool({ evaluateSystemOne }, db);
  const telemetryTool = createTelemetryTool(db);
  const shadowTool = createShadowTool({ evaluateSystemOne }, db);

  pi.registerTool({
    name: evaluateTool.name,
    label: evaluateTool.label,
    description: evaluateTool.description,
    parameters: evaluateTool.parameters,
    execute: evaluateTool.execute,
    renderShell: 'self',
    renderCall: renderTypesafeCall,
    renderResult: renderTypesafeResult,
  });

  pi.registerTool({
    name: telemetryTool.name,
    label: telemetryTool.label,
    description: telemetryTool.description,
    parameters: telemetryTool.parameters,
    execute: telemetryTool.execute,
    renderShell: 'self',
    renderCall: renderTypesafeCall,
    renderResult: renderTypesafeResult,
  });

  pi.registerTool({
    name: shadowTool.name,
    label: shadowTool.label,
    description: shadowTool.description,
    parameters: shadowTool.parameters,
    execute: shadowTool.execute,
    renderShell: 'self',
    renderCall: renderTypesafeCall,
    renderResult: renderTypesafeResult,
  });

  // Alias typesafe_shadow_triage for convenience
  pi.registerTool({
    name: 'typesafe_shadow_triage',
    label: shadowTool.label,
    description: shadowTool.description,
    parameters: shadowTool.parameters,
    execute: shadowTool.execute,
    renderShell: 'self',
    renderCall: renderTypesafeCall,
    renderResult: renderTypesafeResult,
  });
}
