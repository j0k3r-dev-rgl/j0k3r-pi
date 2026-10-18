import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';

export interface MockCpamcOptions {
  inventoryUnavailable?: boolean;
  mainWhamUsedPercentPrimary?: number;
  mainWhamUsedPercentSecondary?: number;
  mainWhamLimitReached?: boolean;
  mainWhamResetAt?: number;
  secondWhamUsedPercentPrimary?: number;
  secondWhamUsedPercentSecondary?: number;
  geminiRemainingFraction?: number;
  geminiMissingBuckets?: boolean;
  simulateWhamError?: boolean;
  ambiguousMainPrefix?: boolean;
  invalidWhamWindowSeconds?: boolean;
  nanWhamUsedPercent?: boolean;
}

export class MockCpamcServer {
  private server: Server;
  public port = 0;
  public options: MockCpamcOptions;
  /** Number of POST /v0/management/api-call requests received (quota probes). */
  public apiCallCount = 0;

  constructor(options: MockCpamcOptions = {}) {
    this.options = {
      mainWhamUsedPercentPrimary: 50.0,
      mainWhamUsedPercentSecondary: 40.0,
      mainWhamLimitReached: false,
      secondWhamUsedPercentPrimary: 60.0,
      secondWhamUsedPercentSecondary: 55.0,
      geminiRemainingFraction: 0.8,
      ...options,
    };

    this.server = createServer((req, res) => this.handleRequest(req, res));
  }

  async start(): Promise<string> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as any;
        this.port = addr.port;
        resolve(`http://127.0.0.1:${this.port}`);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);

    if (req.method === 'GET' && url.pathname === '/v0/management/auth-files') {
      if (this.options.inventoryUnavailable) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'inventory_unavailable' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const files: any[] = [
        { name: 'main.json', auth_index: 0, disabled: false },
        { name: 'second.json', auth_index: 1, disabled: false },
        { name: 'gemini-account.json', auth_index: 2, disabled: false, project_id: 'proj-gemini-account' },
      ];
      if (this.options.ambiguousMainPrefix) {
        files.push({ name: 'main-dup.json', auth_index: 9, disabled: false });
      }
      res.end(JSON.stringify({ files }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v0/management/auth-files/models') {
      const fileName = url.searchParams.get('name');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (fileName === 'main.json' || fileName === 'main-dup.json') {
        res.end(JSON.stringify({ models: [{ id: 'main/gpt-6.1-sol' }] }));
      } else if (fileName === 'second.json') {
        res.end(JSON.stringify({ models: [{ id: 'second/gpt-6.1-sol' }] }));
      } else if (fileName === 'gemini-account.json') {
        res.end(JSON.stringify({ models: [{ id: 'gemini-account/gemini-3.8-flash-high' }] }));
      } else {
        res.end(JSON.stringify({ models: [] }));
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v0/management/api-call') {
      this.apiCallCount++;
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const authIndex = parsed.auth_index;
          const targetUrl = parsed.url;

          if (targetUrl?.includes('/wham/usage')) {
            if (this.options.simulateWhamError && authIndex === 0) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Wham service unavailable' }));
              return;
            }

            const primaryPercent =
              authIndex === 0
                ? this.options.mainWhamUsedPercentPrimary ?? 50.0
                : this.options.secondWhamUsedPercentPrimary ?? 60.0;
            const secondaryPercent =
              authIndex === 0
                ? this.options.mainWhamUsedPercentSecondary ?? 40.0
                : this.options.secondWhamUsedPercentSecondary ?? 55.0;
            const limitReached =
              authIndex === 0 ? Boolean(this.options.mainWhamLimitReached) : false;
            const resetAt =
              authIndex === 0
                ? this.options.mainWhamResetAt ?? Math.floor(Date.now() / 1000) + 3600
                : Math.floor(Date.now() / 1000) + 3600;

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                rate_limit: {
                  primary_window: {
                    limit_window_seconds:
                      authIndex === 0 && this.options.invalidWhamWindowSeconds ? 999 : 18000,
                    used_percent:
                      authIndex === 0 && this.options.nanWhamUsedPercent ? 'invalid-num' : primaryPercent,
                    reset_at: resetAt,
                  },
                  secondary_window: {
                    limit_window_seconds: 604800,
                    used_percent: secondaryPercent,
                    reset_at: resetAt,
                  },
                  allowed: !limitReached,
                  limit_reached: limitReached,
                },
              }),
            );
            return;
          }

          if (targetUrl?.includes('retrieveUserQuotaSummary')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                groups: [
                  {
                    displayName: 'Google Models',
                    buckets: this.options.geminiMissingBuckets
                      ? []
                      : [
                          {
                            window: '5h',
                            remainingFraction: this.options.geminiRemainingFraction ?? 0.8,
                          },
                        ],
                  },
                ],
              }),
            );
            return;
          }

          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not_found' }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad_request' }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  }
}
