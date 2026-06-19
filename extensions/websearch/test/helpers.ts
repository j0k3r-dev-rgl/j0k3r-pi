export type Tool = {
  name: string;
  description: string;
  parameters: { type: string; [key: string]: unknown };
  execute: (...args: unknown[]) => Promise<unknown> | unknown;
};

export type MockPi = {
  tools: Tool[];
  registerTool: (tool: Tool) => void;
};

export function createMockPi(): MockPi {
  const tools: Tool[] = [];
  return {
    tools,
    registerTool(tool: Tool) {
      tools.push(tool);
    },
  };
}

export async function execute(tool: Tool, params: Record<string, unknown>) {
  return tool.execute('id', params, undefined, undefined, {});
}

export function response(jsonBody: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(jsonBody), {
    status: init?.status ?? 200,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}
