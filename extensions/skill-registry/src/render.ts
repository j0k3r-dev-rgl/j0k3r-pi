export type Component = {
  render(width: number): string[];
  invalidate(): void;
};

export interface SkillRegistryRenderOptions {
  expanded?: boolean;
  isPartial?: boolean;
}

export const RESET = '\x1b[0m';
export const CYAN = '\x1b[1;38;2;0;229;255m';
export const LIME = '\x1b[1;38;2;102;255;102m';
export const RED = '\x1b[1;38;2;255;77;109m';
export const DIM = '\x1b[2m';
export const BOLD = '\x1b[1m';

const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;
const CJK_REGEX =
  /[\u1100-\u115f\u231a-\u231b\u2329-\u232a\u23e9-\u23ec\u23f0\u23f3\u25fd-\u25fe\u2614-\u2615\u2648-\u2653\u267f\u2693\u26a1\u26aa-\u26ab\u26bd-\u26be\u26c4-\u26c5\u26ce\u26d4\u26ea\u26f2-\u26f3\u26f5\u26fa\u26fd\u2705\u270a-\u270b\u2728\u274c\u274e\u2753-\u2755\u2757\u2795-\u2797\u27b0\u27bf\u2b1b-\u2b1c\u2b50\u2b55\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

export function charWidth(char: string): number {
  return CJK_REGEX.test(char) ? 2 : 1;
}

export function visibleWidth(str: string): number {
  const stripped = stripAnsi(str);
  let width = 0;
  for (const ch of stripped) {
    width += charWidth(ch);
  }
  return width;
}

export function truncateWithAnsi(str: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (visibleWidth(str) <= maxWidth) return str;

  let visible = 0;
  let result = '';
  const ansiTokenRegex = /^\x1b\[[0-9;]*[a-zA-Z]/;
  const chars = [...str];
  let i = 0;

  while (i < chars.length) {
    const slice = chars.slice(i).join('');
    const match = slice.match(ansiTokenRegex);
    if (match) {
      result += match[0];
      i += [...match[0]].length;
      continue;
    }
    const ch = chars[i];
    const w = charWidth(ch);
    if (visible + w > maxWidth) break;
    result += ch;
    visible += w;
    i++;
  }

  result += RESET;
  return result;
}

export function fit(text: string, width: number): string {
  return truncateWithAnsi(text, Math.max(0, width));
}

export function pad(text: string, width: number): string {
  const fitted = fit(text, width);
  const vis = visibleWidth(fitted);
  return fitted + ' '.repeat(Math.max(0, width - vis));
}

export function boxLine(content: string, innerWidth: number, borderColor: string = CYAN): string {
  const innerContentWidth = Math.max(0, innerWidth - 2);
  return `${borderColor}│${RESET} ${pad(content, innerContentWidth)} ${borderColor}│${RESET}`;
}

export function cardTopBorder(
  toolName: string,
  actionOrTarget: string | undefined,
  innerWidth: number,
  borderColor: string = CYAN,
  titleColor: string = borderColor,
): string {
  const cleanAction = actionOrTarget ? actionOrTarget.replace(/[\r\n]+/g, ' ').trim() : undefined;
  let label = cleanAction ? `${toolName} [${cleanAction}]` : toolName;

  const maxTitleWidth = Math.max(4, innerWidth - 4);
  if (visibleWidth(label) + 2 > maxTitleWidth && cleanAction) {
    const maxActionWidth = Math.max(3, maxTitleWidth - visibleWidth(toolName) - 5);
    const truncatedAction = fit(cleanAction, maxActionWidth);
    label = `${toolName} [${truncatedAction}]`;
  }

  let titleText = ` ${label} `;
  if (visibleWidth(titleText) > innerWidth) {
    titleText = ` ${fit(label, Math.max(1, innerWidth - 2))} `;
  }

  const rest = Math.max(0, innerWidth - visibleWidth(titleText));
  const leftDash = Math.min(2, rest);
  const rightDash = Math.max(0, rest - leftDash);
  return `${borderColor}╭${'─'.repeat(leftDash)}${RESET}${titleColor}${titleText}${RESET}${borderColor}${'─'.repeat(rightDash)}╮${RESET}`;
}

export function cardBottomBorder(innerWidth: number, borderColor: string = CYAN): string {
  return `${borderColor}╰${'─'.repeat(Math.max(0, innerWidth))}╯${RESET}`;
}

export function frameContent(
  lines: string[],
  innerWidth: number,
  borderColor: string = CYAN,
): string[] {
  const framed: string[] = [];
  for (const rawLine of lines) {
    const subLines = rawLine.split(/\r?\n/);
    for (const sub of subLines) {
      framed.push(boxLine(sub, innerWidth, borderColor));
    }
  }
  return framed;
}

export function wrapLineToWidth(text: string, width: number): string[] {
  if (width <= 0) return [''];
  if (!text) return [''];
  if (visibleWidth(text) <= width) return [text];

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (visibleWidth(word) > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      let rem = word;
      while (visibleWidth(rem) > width) {
        const chunk = fit(rem, width);
        lines.push(chunk);
        const chunkStripped = stripAnsi(chunk);
        let remIdx = 0;
        let strippedCount = 0;
        while (remIdx < rem.length && strippedCount < chunkStripped.length) {
          const m = rem.slice(remIdx).match(/^\x1b\[[0-9;]*[a-zA-Z]/);
          if (m) {
            remIdx += m[0].length;
          } else {
            remIdx++;
            strippedCount++;
          }
        }
        const nextRem = rem.slice(remIdx);
        if (nextRem.length === rem.length) {
          rem = rem.slice(1);
        } else {
          rem = nextRem;
        }
      }
      if (rem) {
        current = rem;
      }
      continue;
    }

    if (!current) {
      current = word;
      continue;
    }

    const candidate = `${current} ${word}`;
    if (visibleWidth(candidate) <= width) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

export function extractSkillRegistryAction(toolName: string, args: any): string | undefined {
  if (!args || typeof args !== 'object') {
    return toolName === 'skill_registry_generate' ? 'generate' : 'resolve';
  }

  if (toolName === 'skill_registry_generate') {
    if (args.write === false) return 'write: false';
    return 'generate';
  }

  if (toolName === 'skill_registry_resolve') {
    if (typeof args.sdd_phase === 'string' && args.sdd_phase) {
      return `phase: ${args.sdd_phase}`;
    }
    if (Array.isArray(args.paths) && args.paths.length > 0) {
      return `paths: ${args.paths.join(', ')}`;
    }
    if (typeof args.intent === 'string' && args.intent) {
      return `intent: ${args.intent}`;
    }
    return 'resolve';
  }

  return undefined;
}

export function getKeyHint(theme: any, action: 'expand' | 'collapse'): string {
  const key = theme?.keybinding?.('app.tools.expand') ?? 'ctrl+o';
  return `${DIM}${key} ${action}${RESET}`;
}

export function renderSkillRegistryCall(
  toolName: string,
  args: any,
  _theme?: any,
  context?: any,
): Component {
  return {
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];
      const actionBadge = extractSkillRegistryAction(toolName, args);

      if (width < 24) {
        return [fit(actionBadge ? `${toolName} [${actionBadge}]` : toolName, width)];
      }

      const innerWidth = Math.max(0, width - 2);
      const state = context?.state;
      const isError = Boolean(context?.isError);
      const borderColor = state?.borderColor ?? (isError ? RED : CYAN);
      const topBorder = cardTopBorder(toolName, actionBadge, innerWidth, borderColor, borderColor);

      if (state?.hasResult) {
        return [topBorder];
      }

      const pendingDetail =
        toolName === 'skill_registry_generate'
          ? 'Generating skill registry...'
          : 'Resolving skill registry...';
      const pendingLine = `${CYAN}●${RESET} Pending: ${pendingDetail}`;

      return [
        topBorder,
        boxLine(pendingLine, innerWidth, borderColor),
        cardBottomBorder(innerWidth, borderColor),
      ];
    },
  };
}

function buildGenerateSummary(result: any): string {
  const reg = result?.details?.registry;
  const count = reg?.skill_count ?? 0;
  const warnCount = reg?.warnings?.length ?? 0;
  const writeRes = result?.details?.write_result;

  let writeStatus = 'dry run';
  if (writeRes) {
    const jsonStr = writeRes.json_changed ? 'json updated' : 'json unchanged';
    const mdStr = writeRes.markdown_changed ? 'markdown updated' : 'markdown unchanged';
    writeStatus = `${jsonStr}, ${mdStr}`;
  } else if (result?.details?.write_result === null) {
    writeStatus = 'write skipped';
  }

  return `✓ ${count} skill(s), ${warnCount} warning(s) · ${writeStatus}`;
}

function buildResolveSummary(result: any): string {
  const details = result?.details;
  const direct = Array.isArray(details?.matches) ? details.matches.length : 0;
  const related = Array.isArray(details?.related_matches) ? details.related_matches.length : 0;
  const cache = details?.registry_status?.cache ?? 'unknown';
  const warnings = Array.isArray(details?.warnings) ? details.warnings.length : 0;

  let text = `✓ skill registry: ${direct} direct, ${related} related, cache ${cache}`;
  if (warnings > 0) {
    text += `, ${warnings} warn`;
  }
  return text;
}

function formatResolveExpandedLines(details: any): string[] {
  const lines: string[] = [];
  if (details?.registry_status) {
    lines.push(
      `source ${details.registry_status.source}, cache ${details.registry_status.cache} · hash ${String(details.registry_status.live_hash ?? '').slice(0, 10)}...`,
    );
  }
  if (details?.query?.paths?.length) {
    lines.push(`paths: ${details.query.paths.join(', ')}`);
  }

  const matches = Array.isArray(details?.matches) ? details.matches : [];
  if (matches.length > 0) {
    lines.push('', 'direct matches:');
    for (const [index, match] of matches.entries()) {
      const role = index === 0 ? 'primary' : index <= 2 ? 'secondary' : 'direct';
      lines.push(
        `${String(match.score).padStart(3, ' ')} · ${String(match.priority).padStart(2, ' ')} · ${match.name} · ${match.path} · ${role}`,
      );
      if (Array.isArray(match.reasons) && match.reasons.length > 0) {
        const topReasons = match.reasons.slice(0, 3).map((r: any) => r.detail ?? r);
        lines.push(`  - reasons: ${topReasons.join(', ')}`);
      }
      if (match.read_before_acting) {
        lines.push(`  - ${match.read_before_acting}`);
      }
    }
  }

  const related = Array.isArray(details?.related_matches) ? details.related_matches : [];
  if (related.length > 0) {
    lines.push('', 'related matches:');
    for (const match of related) {
      lines.push(`  - ${match.name} · ${match.path}`);
      if (match.related_from?.length) {
        lines.push(`    - related from: ${match.related_from.join(', ')}`);
      }
      if (match.relation_reasons?.length) {
        lines.push(`    - reasons: ${match.relation_reasons.join(', ')}`);
      }
      if (match.read_before_acting) {
        lines.push(`    - ${match.read_before_acting}`);
      }
    }
  }

  const guidance = Array.isArray(details?.guidance) ? details.guidance : [];
  if (guidance.length > 0) {
    lines.push('', 'guidance:');
    for (const item of guidance.slice(0, 4)) {
      lines.push(`- ${item}`);
    }
  }

  const warnings = Array.isArray(details?.warnings) ? details.warnings : [];
  if (warnings.length > 0) {
    lines.push('', 'warnings:');
    for (const warning of warnings.slice(0, 20)) {
      lines.push(`- ${warning}`);
    }
    if (warnings.length > 20) {
      lines.push(`- ... and ${warnings.length - 20} more warnings`);
    }
  }

  return lines;
}

export function renderSkillRegistryResult(
  toolName: string,
  result: any,
  options: SkillRegistryRenderOptions = {},
  theme?: any,
  context?: any,
): Component {
  const isError = Boolean(
    context?.isError ||
      result?.isError ||
      result?.details?.status === 'failure' ||
      result?.details?.error,
  );
  const borderColor = isError ? RED : LIME;

  if (context?.state) {
    context.state.hasResult = true;
    context.state.borderColor = borderColor;
  }

  return {
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];
      const isExpanded = Boolean(options?.expanded);
      const hint = getKeyHint(theme, isExpanded ? 'collapse' : 'expand');
      const bodyLines: string[] = [];

      if (options?.isPartial) {
        const runningText =
          toolName === 'skill_registry_generate'
            ? 'Generating skill registry…'
            : 'Resolving skill registry…';
        bodyLines.push(runningText);
      } else if (isError) {
        const errorMsg =
          result?.details?.error?.message ??
          result?.details?.error ??
          result?.content?.[0]?.text ??
          'tool failed';
        bodyLines.push(`${RED}Error: ${stripAnsi(String(errorMsg))}${RESET}`);
        bodyLines.push(hint);
      } else if (!isExpanded) {
        const summary =
          toolName === 'skill_registry_generate'
            ? buildGenerateSummary(result)
            : buildResolveSummary(result);
        bodyLines.push(summary);
        bodyLines.push(hint);
      } else {
        if (toolName === 'skill_registry_generate') {
          const summary = buildGenerateSummary(result);
          bodyLines.push(summary);
          bodyLines.push(hint);
          const rawContent =
            result?.content?.find?.((c: any) => c?.type === 'text')?.text ??
            result?.content?.[0]?.text;
          if (rawContent) {
            bodyLines.push('');
            bodyLines.push(...String(rawContent).split('\n'));
          }
        } else {
          const summary = buildResolveSummary(result);
          bodyLines.push(summary);
          bodyLines.push(hint);
          const detailLines = formatResolveExpandedLines(result?.details);
          if (detailLines.length > 0) {
            bodyLines.push('');
            bodyLines.push(...detailLines);
          }
        }
      }

      if (width < 24) {
        return bodyLines.map((line) => fit(stripAnsi(line), width));
      }

      const innerWidth = Math.max(0, width - 2);
      const innerContentWidth = Math.max(0, innerWidth - 2);
      const wrappedBodyLines: string[] = [];
      for (const rawLine of bodyLines) {
        for (const sub of rawLine.split(/\r?\n/)) {
          wrappedBodyLines.push(...wrapLineToWidth(sub, innerContentWidth));
        }
      }

      const framed = frameContent(wrappedBodyLines, innerWidth, borderColor);
      const bottomBorder = cardBottomBorder(innerWidth, borderColor);
      return [...framed, bottomBorder];
    },
  };
}
