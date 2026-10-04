function matchesKey(data: string, key: string): boolean {
  const keys: Record<string, string[]> = {
    escape: ['\u001b'],
    'ctrl+c': ['\u0003'],
    'ctrl+o': ['\u000f'],
    'ctrl+t': ['\u0014'],
    'ctrl+w': ['\u0017'],
    q: ['q', 'Q'],
    up: ['\u001b[A'],
    down: ['\u001b[B'],
    right: ['\u001b[C'],
    left: ['\u001b[D'],
    pageUp: ['\u001b[5~'],
    pageDown: ['\u001b[6~'],
    home: ['\u001b[H', '\u001b[1~', '\u001bOH'],
    end: ['\u001b[F', '\u001b[4~', '\u001bOF'],
  };
  return keys[key]?.includes(data) ?? data === key;
}

const PANEL_KEYBINDINGS: Record<string, string[]> = {
  escape: ['app.interrupt', 'tui.select.cancel'],
  'ctrl+c': ['tui.select.cancel'],
  'ctrl+o': ['app.tools.expand'],
  'ctrl+t': ['app.thinking.toggle'],
  detailCancel: ['subagents.detail.cancel'],
  up: ['tui.select.up', 'tui.editor.cursorUp'],
  down: ['tui.select.down', 'tui.editor.cursorDown'],
  right: ['tui.editor.cursorRight'],
  left: ['tui.editor.cursorLeft'],
  pageUp: ['tui.select.pageUp', 'tui.editor.pageUp'],
  pageDown: ['tui.select.pageDown', 'tui.editor.pageDown'],
  home: ['tui.editor.cursorLineStart'],
  end: ['tui.editor.cursorLineEnd'],
};

export function createSubagentsPanelKeyMatcher(keybindings?: { matches?: (data: string, keybinding: string) => boolean }) {
  return (data: string, key: string): boolean => {
    const bindings = PANEL_KEYBINDINGS[key];
    if (bindings?.some((binding) => keybindings?.matches?.(data, binding))) return true;
    return matchesKey(data, key);
  };
}

export function subagentsPanelMouseWheelDelta(data: string): -1 | 1 | undefined {
  const sgr = data.match(/^\u001b\[<(\d+);\d+;\d+M$/);
  const urxvt = data.match(/^\u001b\[(\d+);\d+;\d+M$/);
  const button = sgr || urxvt ? Number((sgr ?? urxvt)![1]) : data.startsWith('\u001b[M') && data.length >= 6 ? data.charCodeAt(3) - 32 : undefined;
  if (button === undefined || !Number.isFinite(button) || (button & 64) === 0) return undefined;
  return (button & 1) === 0 ? -1 : 1;
}

export function classifySubagentsPanelInput(data: string, matchesPanelKey: (data: string, key: string) => boolean): { category: string; action: string } {
  if (matchesPanelKey(data, 'escape') || matchesPanelKey(data, 'ctrl+c') || matchesPanelKey(data, 'q')) return { category: 'lifecycle', action: 'close' };
  if (matchesPanelKey(data, 'ctrl+o') || data === '\u000f') return { category: 'display', action: 'toggle_expand' };
  if (matchesPanelKey(data, 'ctrl+t') || data === '\u0014') return { category: 'display', action: 'toggle_thinking' };
  if (matchesPanelKey(data, 'detailCancel')) return { category: 'task', action: 'cancel_selected' };
  const wheel = subagentsPanelMouseWheelDelta(data);
  if (wheel === -1) return { category: 'scroll', action: 'up' };
  if (wheel === 1) return { category: 'scroll', action: 'down' };
  if (matchesPanelKey(data, 'right')) return { category: 'navigation', action: 'right' };
  if (matchesPanelKey(data, 'left')) return { category: 'navigation', action: 'left' };
  if (matchesPanelKey(data, 'down')) return { category: 'navigation', action: 'down' };
  if (matchesPanelKey(data, 'up')) return { category: 'navigation', action: 'up' };
  if (matchesPanelKey(data, 'pageDown')) return { category: 'scroll', action: 'page_down' };
  if (matchesPanelKey(data, 'pageUp')) return { category: 'scroll', action: 'page_up' };
  if (matchesPanelKey(data, 'home')) return { category: 'scroll', action: 'home' };
  if (matchesPanelKey(data, 'end')) return { category: 'scroll', action: 'end' };
  return { category: 'other', action: 'unmatched' };
}
