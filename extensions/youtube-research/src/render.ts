type Component = { invalidate(): void; render(width: number): string[] };

type YoutubeRenderOptions = { expanded?: boolean; isPartial?: boolean };

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function lineWidth(text: string): number {
  return [...stripAnsi(text)].length;
}

function truncate(text: string, width: number): string {
  if (lineWidth(text) <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

function clip(text: unknown, limit: number): string {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > limit ? `${normalized.slice(0, Math.max(0, limit - 1))}…` : normalized;
}

function wrapLine(text: string, width: number): string[] {
  if (!text) return [''];
  if (lineWidth(text) <= width) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    const candidate = `${current} ${word}`;
    if (lineWidth(candidate) <= width) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.flatMap((line) => {
    if (lineWidth(line) <= width) return [line];
    const chunks: string[] = [];
    for (let index = 0; index < line.length; index += width) chunks.push(line.slice(index, index + width));
    return chunks;
  });
}

function wrapLines(lines: string[], width: number): string[] {
  return lines.flatMap((line) => wrapLine(line, width));
}

function textComponent(linesForWidth: (width: number) => string[]): Component {
  return {
    invalidate() {},
    render(width: number) {
      const w = Math.max(40, width);
      return linesForWidth(w).map((line) => truncate(line, w));
    },
  };
}

function resultText(result: any): string {
  return String(result?.content?.find?.((part: any) => part?.type === 'text')?.text ?? result?.content?.[0]?.text ?? '');
}

function status(result: any): string {
  return result?.details?.status ?? (result?.isError ? 'failure' : 'success');
}

function data(result: any): any {
  return result?.details?.data ?? {};
}

function inferToolLabel(result: any): string {
  const text = resultText(result);
  const match = text.match(/^(youtube_[a-z_]+):/);
  return match?.[1] ?? 'youtube_research';
}

function transcriptStats(text: string): string {
  const chars = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return `${words.toLocaleString('en-US')} words · ${chars.toLocaleString('en-US')} chars`;
}

function compactTranscript(result: any, theme: any): string[] {
  const d = data(result);
  const transcript = String(d.text ?? '');
  const title = (value: string) => theme?.fg?.('toolTitle', theme?.bold?.(value) ?? value) ?? value;
  const accent = (value: string) => theme?.fg?.('accent', value) ?? value;
  const dim = (value: string) => theme?.fg?.('dim', value) ?? value;
  const header = `${title('youtube_transcript_get')} · ${accent(d.content_source ?? 'transcript')} · ${d.language ?? 'unknown'} · ${transcriptStats(transcript)}`;
  return [
    header,
    dim(`video ${d.video_ref ?? 'unknown'} · full transcript available · ctrl+o expand`),
    `preview: ${clip(transcript, 220)}`,
  ];
}

function compactGeneric(result: any, theme: any): string[] {
  const label = inferToolLabel(result);
  const title = (value: string) => theme?.fg?.('toolTitle', theme?.bold?.(value) ?? value) ?? value;
  const dim = (value: string) => theme?.fg?.('dim', value) ?? value;
  const first = resultText(result).split('\n').find(Boolean) ?? label;
  return [
    `${title(label)} · ${status(result)}`,
    clip(first, 180),
    dim('ctrl+o expand'),
  ];
}

export function renderYoutubeToolResult(result: any, options: YoutubeRenderOptions = {}, theme: any = {}): Component {
  return textComponent((_width) => {
    if (options.isPartial) return ['youtube_research · running…'];
    if (status(result) === 'failure' || result?.isError) {
      return [`youtube_research · error`, clip(resultText(result), 240), 'ctrl+o expand'];
    }

    const label = inferToolLabel(result);
    if (!options.expanded) {
      if (label === 'youtube_transcript_get') return compactTranscript(result, theme);
      return compactGeneric(result, theme);
    }

    return wrapLines([
      `${label} · expanded`,
      'ctrl+o collapse',
      '',
      ...resultText(result).split('\n'),
    ], _width);
  });
}
