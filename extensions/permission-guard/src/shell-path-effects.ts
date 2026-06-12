import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { classifyPathTarget, classifyResolvedPathTargetSync } from './path-policy.js';
import type { BashExecutionContext, BashPathEffect, PermissionPolicyConfig, ShellAnalysisResult } from './types.js';

export interface ExtractShellPathEffectsOptions {
  analysis: ShellAnalysisResult;
  context: BashExecutionContext;
  config: PermissionPolicyConfig;
}

function signatureFor(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function looksLikePath(token: string): boolean {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(token)) return false;
  return token.startsWith('/') || token.startsWith('./') || token.startsWith('../') || token.includes('/') || /^\.[A-Za-z0-9]/.test(token);
}

function pathIntentForCommand(commandName: string | undefined): { args: Array<{ index?: number; intent: BashPathEffect['intent']; source?: BashPathEffect['source'] }>; allPathArgs?: BashPathEffect['intent']; ignoreUnmappedPathArgs?: boolean } {
  switch (commandName) {
    case 'cat':
    case 'grep':
    case 'rg':
    case 'sed':
    case 'awk':
    case 'head':
    case 'tail':
    case 'less':
    case 'more':
      return { args: [], allPathArgs: 'read' };
    case 'rm':
      return { args: [], allPathArgs: 'delete' };
    case 'mkdir':
    case 'touch':
      return { args: [], allPathArgs: 'create' };
    case 'ls':
    case 'find':
      return { args: [], allPathArgs: 'read' };
    case 'git':
    case 'npm':
      return { args: [], ignoreUnmappedPathArgs: true };
    case 'cp':
      return { args: [{ index: 0, intent: 'read' }, { index: 1, intent: 'write' }] };
    case 'mv':
      return { args: [{ index: 0, intent: 'write' }, { index: 1, intent: 'write' }] };
    case 'cd':
      return { args: [{ index: 0, intent: 'cwd', source: 'cd' }] };
    case 'pushd':
      return { args: [{ index: 0, intent: 'cwd', source: 'argument' }] };
    case 'popd':
      return { args: [{ index: 0, intent: 'cwd', source: 'argument' }] };
    default:
      return { args: [] };
  }
}

function expandTildePath(raw: string): string {
  if (raw === '~') return homedir();
  if (raw.startsWith('~/')) return join(homedir(), raw.slice(2));
  return raw;
}

function resolveEffectTarget(raw: string, cwd: string): string {
  const expanded = expandTildePath(raw);
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

function classifyEffect(raw: string, cwd: string, config: PermissionPolicyConfig, intent: BashPathEffect['intent']) {
  const forCreate = intent === 'create' || intent === 'write';
  const target = resolveEffectTarget(raw, cwd);
  return classifyPathTarget(target, { cwd, config, forCreate });
}

function classifyEffectSync(raw: string, cwd: string, config: PermissionPolicyConfig, intent: BashPathEffect['intent']) {
  const forCreate = intent === 'create' || intent === 'write';
  const target = resolveEffectTarget(raw, cwd);
  return classifyResolvedPathTargetSync(target, { cwd, config, forCreate });
}

function segmentShape(segment: ShellAnalysisResult['segments'][number]): string {
  const env = Object.keys(segment.envAssignments).sort().map((key) => `${key}=<value>`);
  const argv = segment.argv.map((arg) => (looksLikePath(arg) ? '<path>' : arg));
  const redirections = segment.redirections.map((redirection) => `${redirection.operator}<path>`);
  return [...env, segment.commandName ?? '<empty>', ...argv, ...redirections].join(' ').trim();
}

function commandShapeBasis(analysis: ShellAnalysisResult): string {
  const parts: string[] = [];
  analysis.segments.forEach((segment, index) => {
    if (index > 0) parts.push(analysis.operators[index - 1]!);
    parts.push(segmentShape(segment));
  });
  return parts.join(' ');
}

function finalizeResult(analysis: ShellAnalysisResult, pathEffects: BashPathEffect[], effectsComplete: boolean): ShellAnalysisResult {
  const summaryPaths = pathEffects.map((effect) => effect.classified?.workspaceRelative ?? effect.classified?.normalizedAbsolute ?? effect.raw);
  const effectBasis = pathEffects
    .map((effect) => `${effect.segmentIndex}:${effect.source}:${effect.intent}:${effect.classified?.insideWorkspace ? 'workspace' : 'outside'}:${effect.ambiguous ? 'ambiguous' : 'resolved'}`)
    .sort()
    .join('|');

  return {
    ...analysis,
    commandSignature: signatureFor(commandShapeBasis(analysis)),
    pathEffects,
    effectsComplete,
    effectSignature: signatureFor(effectBasis),
    summary: {
      ...analysis.summary,
      paths: summaryPaths.length > 0 ? summaryPaths : undefined,
    },
  };
}

export async function extractShellPathEffects(options: ExtractShellPathEffectsOptions): Promise<ShellAnalysisResult> {
  const pathEffects: BashPathEffect[] = [];
  let effectsComplete = options.analysis.ok;

  for (const segment of options.analysis.segments) {
    const commandName = segment.commandName;
    const catalog = pathIntentForCommand(commandName);

    if (commandName === 'npm') {
      const prefixIndex = segment.argv.indexOf('--prefix');
      if (prefixIndex >= 0 && segment.argv[prefixIndex + 1]) {
        const raw = segment.argv[prefixIndex + 1]!;
        pathEffects.push({
          segmentIndex: segment.index,
          raw,
          source: 'option',
          intent: 'cwd',
          classified: await classifyEffect(raw, segment.effectiveCwd, options.config, 'cwd'),
        });
      }
    }

    if (commandName === 'git') {
      const prefixIndex = segment.argv.indexOf('-C');
      if (prefixIndex >= 0 && segment.argv[prefixIndex + 1]) {
        const raw = segment.argv[prefixIndex + 1]!;
        pathEffects.push({
          segmentIndex: segment.index,
          raw,
          source: 'option',
          intent: 'cwd',
          classified: await classifyEffect(raw, segment.effectiveCwd, options.config, 'cwd'),
        });
      }
    }

    if (commandName === 'popd') {
      pathEffects.push({
        segmentIndex: segment.index,
        raw: segment.argv[0] ?? '<directory-stack>',
        source: 'argument',
        intent: 'cwd',
        ambiguous: true,
        reason: 'directory-stack-context-change',
      });
    }

    for (const rule of catalog.args) {
      const raw = rule.index === undefined ? undefined : segment.argv[rule.index];
      if (!raw) {
        if (commandName === 'pushd') {
          pathEffects.push({
            segmentIndex: segment.index,
            raw: '<directory-stack>',
            source: 'argument',
            intent: 'cwd',
            ambiguous: true,
            reason: 'directory-stack-context-change',
          });
        }
        continue;
      }
      if (commandName === 'pushd') {
        pathEffects.push({
          segmentIndex: segment.index,
          raw,
          source: rule.source ?? 'argument',
          intent: rule.intent,
          classified: await classifyEffect(raw, segment.effectiveCwd, options.config, rule.intent),
        });
      } else {
        pathEffects.push({
          segmentIndex: segment.index,
          raw,
          source: rule.source ?? 'argument',
          intent: rule.intent,
          classified: await classifyEffect(raw, segment.effectiveCwd, options.config, rule.intent),
        });
      }
    }

    if (catalog.allPathArgs) {
      for (const raw of segment.argv.filter(looksLikePath)) {
        pathEffects.push({
          segmentIndex: segment.index,
          raw,
          source: 'argument',
          intent: catalog.allPathArgs,
          classified: await classifyEffect(raw, segment.effectiveCwd, options.config, catalog.allPathArgs),
        });
      }
    }

    for (const redirection of segment.redirections) {
      const intent = redirection.operator === '<' ? 'read' : 'write';
      pathEffects.push({
        segmentIndex: segment.index,
        raw: redirection.rawTarget,
        source: 'redirection',
        intent,
        classified: await classifyEffect(redirection.rawTarget, segment.effectiveCwd, options.config, intent),
      });
    }

    if (commandName && catalog.args.length === 0 && !catalog.allPathArgs && !catalog.ignoreUnmappedPathArgs) {
      for (const raw of segment.argv.filter(looksLikePath)) {
        effectsComplete = false;
        pathEffects.push({
          segmentIndex: segment.index,
          raw,
          source: 'argument',
          intent: 'unknown',
          ambiguous: true,
          reason: 'unknown_path_effects',
        });
      }
    }
  }

  return finalizeResult(options.analysis, pathEffects, effectsComplete);
}

export function extractShellPathEffectsSync(options: ExtractShellPathEffectsOptions): ShellAnalysisResult {
  const pathEffects: BashPathEffect[] = [];
  let effectsComplete = options.analysis.ok;

  for (const segment of options.analysis.segments) {
    const commandName = segment.commandName;
    const catalog = pathIntentForCommand(commandName);

    if (commandName === 'npm') {
      const prefixIndex = segment.argv.indexOf('--prefix');
      if (prefixIndex >= 0 && segment.argv[prefixIndex + 1]) {
        const raw = segment.argv[prefixIndex + 1]!;
        pathEffects.push({ segmentIndex: segment.index, raw, source: 'option', intent: 'cwd', classified: classifyEffectSync(raw, segment.effectiveCwd, options.config, 'cwd') });
      }
    }

    if (commandName === 'git') {
      const prefixIndex = segment.argv.indexOf('-C');
      if (prefixIndex >= 0 && segment.argv[prefixIndex + 1]) {
        const raw = segment.argv[prefixIndex + 1]!;
        pathEffects.push({ segmentIndex: segment.index, raw, source: 'option', intent: 'cwd', classified: classifyEffectSync(raw, segment.effectiveCwd, options.config, 'cwd') });
      }
    }

    if (commandName === 'popd') {
      pathEffects.push({
        segmentIndex: segment.index,
        raw: segment.argv[0] ?? '<directory-stack>',
        source: 'argument',
        intent: 'cwd',
        ambiguous: true,
        reason: 'directory-stack-context-change',
      });
    }

    for (const rule of catalog.args) {
      const raw = rule.index === undefined ? undefined : segment.argv[rule.index];
      if (!raw) {
        if (commandName === 'pushd') {
          pathEffects.push({
            segmentIndex: segment.index,
            raw: '<directory-stack>',
            source: 'argument',
            intent: 'cwd',
            ambiguous: true,
            reason: 'directory-stack-context-change',
          });
        }
        continue;
      }
      pathEffects.push({ segmentIndex: segment.index, raw, source: rule.source ?? 'argument', intent: rule.intent, classified: classifyEffectSync(raw, segment.effectiveCwd, options.config, rule.intent) });
    }

    if (catalog.allPathArgs) {
      for (const raw of segment.argv.filter(looksLikePath)) {
        pathEffects.push({ segmentIndex: segment.index, raw, source: 'argument', intent: catalog.allPathArgs, classified: classifyEffectSync(raw, segment.effectiveCwd, options.config, catalog.allPathArgs) });
      }
    }

    for (const redirection of segment.redirections) {
      const intent = redirection.operator === '<' ? 'read' : 'write';
      pathEffects.push({ segmentIndex: segment.index, raw: redirection.rawTarget, source: 'redirection', intent, classified: classifyEffectSync(redirection.rawTarget, segment.effectiveCwd, options.config, intent) });
    }

    if (commandName && catalog.args.length === 0 && !catalog.allPathArgs && !catalog.ignoreUnmappedPathArgs) {
      for (const raw of segment.argv.filter(looksLikePath)) {
        effectsComplete = false;
        pathEffects.push({ segmentIndex: segment.index, raw, source: 'argument', intent: 'unknown', ambiguous: true, reason: 'unknown_path_effects' });
      }
    }
  }

  return finalizeResult(options.analysis, pathEffects, effectsComplete);
}
