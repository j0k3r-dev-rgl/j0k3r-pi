export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: 'image/png' };

export interface PiToolResult<T = unknown> {
  content: ToolContent[];
  details?:
    | { status: 'success'; data: T; warnings?: string[] }
    | { status: 'failure'; error: { code: string; message: string; recoverable: boolean } };
  isError?: boolean;
}

export interface ToolExecutionContext {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  model?: { input?: string[] };
}

export interface BrowserPageTarget {
  id: string;
  title: string;
  url: string;
  hasWebSocketDebuggerUrl: boolean;
  webSocketDebuggerUrl?: string;
}

export interface BrowserCdpStatus {
  cdpUrl: string;
  versionReachable: boolean;
  tabsReachable: boolean;
  browser?: string;
  protocolVersion?: string;
  pageTargetCount?: number;
  warnings: string[];
}

export interface BrowserPageScreenshotResult {
  target: Pick<BrowserPageTarget, 'id' | 'title' | 'url'>;
  outputPath: string;
  outputSizeBytes: number;
  inlineAttached: boolean;
  width: number;
  height: number;
  warnings: string[];
}

export interface BrowserTabsListResult {
  cdpUrl: string;
  totalPageTargets: number;
  returnedCount: number;
  tabs: Array<Pick<BrowserPageTarget, 'id' | 'title' | 'url' | 'hasWebSocketDebuggerUrl'>>;
  warnings: string[];
}
