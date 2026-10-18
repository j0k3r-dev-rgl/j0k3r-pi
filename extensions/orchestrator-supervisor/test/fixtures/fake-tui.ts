/**
 * Shared stand-ins for `@earendil-works/pi-tui`.
 *
 * That package is a host virtual module: it is not resolvable from this directory, so
 * `npm test` cannot import the real components. Their signatures here mirror the real ones
 * (component shape, `Input` value handling, `truncateToWidth`/`visibleWidth` clipping) so
 * the components under test exercise the same contract they get in a live terminal.
 */

export class FakeContainer {
  children: any[] = [];
  addChild(child: any) { this.children.push(child); }
  clear() { this.children = []; }
  invalidate() { for (const child of this.children) child.invalidate?.(); }
  render(width: number): string[] {
    const lines: string[] = [];
    for (const child of this.children) lines.push(...child.render(width));
    return lines;
  }
}

export class FakeText {
  private text: string;
  private paddingX: number;
  private paddingY: number;
  constructor(text: string, paddingX = 0, paddingY = 0) {
    this.text = text;
    this.paddingX = paddingX;
    this.paddingY = paddingY;
  }
  setText(text: string) { this.text = text; }
  invalidate() {}
  render(width: number): string[] {
    if (!this.text) return [];
    const pad = ' '.repeat(Math.max(0, Math.min(this.paddingX, width - 1)));
    const body = this.text.split('\n').map(line => (pad + line + pad).slice(0, width));
    return [...new Array(this.paddingY).fill(''), ...body, ...new Array(this.paddingY).fill('')];
  }
}

export class FakeInput {
  focused = false;
  private value = '';
  private options: { placeholder?: string };
  constructor(options: { placeholder?: string } = {}) {
    this.options = options;
  }
  getValue() { return this.value; }
  setValue(value: string) { this.value = value; }
  handleInput(data: string) {
    if (data === '\x7f') { this.value = this.value.slice(0, -1); return; }
    if (/^[ -~]$/.test(data)) this.value += data;
  }
  invalidate() {}
  render(width: number): string[] {
    const text = this.value || this.options.placeholder || '';
    return [`> ${text}`.slice(0, width)];
  }
}

export class FakeSpacer {
  private lines: number;
  constructor(lines = 1) {
    this.lines = lines;
  }
  invalidate() {}
  render() { return new Array(this.lines).fill(''); }
}

export const truncateToWidth = (text: string, width: number, ellipsis = ''): string =>
  (text.length <= width ? text : width <= 0 ? '' : text.slice(0, Math.max(0, width - ellipsis.length)) + ellipsis);

export const visibleWidth = (text: string): number => text.length;

export const fakeLib = {
  Container: FakeContainer,
  Text: FakeText,
  Input: FakeInput,
  Spacer: FakeSpacer,
  truncateToWidth,
  visibleWidth,
};

export const identityTheme = { fg: (_token: string, text: string) => text, bold: (text: string) => text };

/** Default key sequences for the bindings the components under test consult. */
export const KEY_MAP: Record<string, string[]> = {
  'tui.select.up': ['\x1b[A'],
  'tui.select.down': ['\x1b[B'],
  'tui.select.pageUp': ['\x1b[5~'],
  'tui.select.pageDown': ['\x1b[6~'],
  'tui.select.confirm': ['\r'],
  'tui.select.cancel': ['\x1b'],
  'tui.input.tab': ['\t'],
  // Real arrow ids the supervisor panel consults to step threshold values.
  'tui.editor.cursorLeft': ['\x1b[D'],
  'tui.editor.cursorRight': ['\x1b[C'],
};

export const fakeKeybindings = { matches: (data: string, id: string) => (KEY_MAP[id] ?? []).includes(data) };

/** Minimal mouse event shape: pi-tui hands components coordinates relative to themselves. */
export const mouseClick = (x: number, y: number) => ({ type: 'press', button: 'left', x, y, wheelDelta: 0 });
export const mouseWheel = (y: number, wheelDelta: number) => ({ type: 'wheel', button: 'none', x: 0, y, wheelDelta });
