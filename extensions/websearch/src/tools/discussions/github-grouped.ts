import { Type } from 'typebox';
import type { PiToolResult, RegisterWebsearchToolsDeps } from '../../types.js';
import { ValidationError } from '../../validation.js';
import { buildFailure, toToolError } from '../common/index.js';
import { executeInternalTool, internalToolsFromDeps } from '../common/internal.js';
import { registerTool, type WebsearchToolModule } from '../common/index.js';
import { githubTools } from './github.js';

export const githubGroupedToolNames = ['github_get'] as const;

const githubKinds = ['repo', 'file', 'release', 'releases'] as const;
const kindSchema = Type.Union(githubKinds.map((kind) => Type.Literal(kind)) as [ReturnType<typeof Type.Literal>, ReturnType<typeof Type.Literal>, ...ReturnType<typeof Type.Literal>[]]);

const githubGetProperties = {
  kind: kindSchema,
  repo: Type.Optional(Type.String({ description: 'GitHub owner/repo reference. Preferred for repo, file, release, and releases kinds.' })),
  ref: Type.Optional(Type.String({ description: 'Selected file follow-up reference in owner/repo:path form for kind=file only. Use git_ref for file revisions and tag for releases.' })),
  target: Type.Optional(Type.String({ description: 'Generic selected GitHub target reference, such as owner/repo or owner/repo:path for files.' })),
  file: Type.Optional(Type.String({ description: 'File follow-up reference in owner/repo:path form.' })),
  path: Type.Optional(Type.String({ description: 'Repository-relative file path for kind=file.' })),
  git_ref: Type.Optional(Type.String({ description: 'Optional Git ref for kind=file when repo and path are supplied.' })),
  tag: Type.Optional(Type.String({ description: 'Release tag for kind=release.' })),
  limit: Type.Optional(Type.Number({ description: 'Maximum releases to return for kind=releases.' })),
  includeReadme: Type.Optional(Type.Boolean({ description: 'Include README content for kind=repo. Defaults to true.' })),
  includePrereleases: Type.Optional(Type.Boolean({ description: 'Include prereleases for kind=releases. Defaults to false.' })),
};

const githubGetParameters = {
  ...Type.Object(githubGetProperties),
  oneOf: [
    Type.Object({
      kind: Type.Literal('repo'),
      repo: githubGetProperties.repo,
      target: githubGetProperties.target,
      includeReadme: githubGetProperties.includeReadme,
    }),
    Type.Object({
      kind: Type.Literal('file'),
      repo: githubGetProperties.repo,
      ref: githubGetProperties.ref,
      target: githubGetProperties.target,
      file: githubGetProperties.file,
      path: githubGetProperties.path,
      git_ref: githubGetProperties.git_ref,
    }),
    Type.Object({
      kind: Type.Literal('release'),
      repo: githubGetProperties.repo,
      target: githubGetProperties.target,
      tag: githubGetProperties.tag,
    }),
    Type.Object({
      kind: Type.Literal('releases'),
      repo: githubGetProperties.repo,
      target: githubGetProperties.target,
      limit: githubGetProperties.limit,
      includePrereleases: githubGetProperties.includePrereleases,
    }),
  ],
};

type GitHubKind = typeof githubKinds[number];
type Input = Record<string, unknown>;

function asInput(value: unknown): Input {
  return value && typeof value === 'object' ? value as Input : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function requiredString(value: unknown, field: string): string {
  const result = stringValue(value);
  if (!result) throw new ValidationError(`${field} is required.`);
  return result;
}

function requiredKind(input: Input): GitHubKind {
  const kind = stringValue(input.kind);
  if (!kind || !(githubKinds as readonly string[]).includes(kind)) {
    throw new ValidationError(`kind must be one of: ${githubKinds.join(', ')}.`);
  }
  return kind as GitHubKind;
}

function parseFileFollowupRef(value: string): { repo: string; path: string } | undefined {
  const match = /^(?<repo>[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+):(?<path>.+)$/.exec(value.trim());
  if (!match?.groups?.repo || !match.groups.path) return undefined;
  return { repo: match.groups.repo, path: match.groups.path };
}

function fileParams(input: Input): Input {
  const repo = stringValue(input.repo);
  const path = stringValue(input.path);
  if (repo && path) {
    return { repo, path, ref: stringValue(input.git_ref) };
  }

  const followupRef = requiredString(input.file ?? input.target ?? input.ref, 'ref');
  const parsed = parseFileFollowupRef(followupRef);
  if (!parsed) throw new ValidationError('kind=file requires repo and path, or ref/target/file in owner/repo:path form.');
  return { repo: parsed.repo, path: parsed.path, ref: stringValue(input.git_ref) };
}

function githubTarget(kind: GitHubKind, input: Input): { tool: string; params: Input } {
  if (kind === 'repo') {
    return { tool: 'github_repo_get', params: { repo: requiredString(input.repo ?? input.target, 'repo'), includeReadme: booleanValue(input.includeReadme) } };
  }
  if (kind === 'file') {
    return { tool: 'github_file_get', params: fileParams(input) };
  }
  if (kind === 'release') {
    return { tool: 'github_release_get', params: { repo: requiredString(input.repo ?? input.target, 'repo'), tag: requiredString(input.tag, 'tag') } };
  }
  return { tool: 'github_releases_get', params: { repo: requiredString(input.repo ?? input.target, 'repo'), limit: numberValue(input.limit), includePrereleases: booleanValue(input.includePrereleases) } };
}

export const githubGroupedTools: WebsearchToolModule<typeof githubGroupedToolNames[number]> = {
  names: githubGroupedToolNames,
  register(pi: any, deps: RegisterWebsearchToolsDeps = {}) {
    const internalTools = internalToolsFromDeps(deps, [githubTools]);

    registerTool(pi, {
      name: 'github_get',
      label: 'GitHub Get',
      description: 'Fetch GitHub repository metadata, one file, one release, or recent releases. Use github_code_search separately for code search.',
      promptSnippet: 'Fetch GitHub repository metadata, files, releases, or release details.',
      promptGuidelines: [
        'Use github_get when you have a specific GitHub repository, file ref, release tag, or release listing to inspect.',
        'Use github_get after github_code_search when a selected code result needs file contents; use github_code_search separately for code discovery.',
      ],
      parameters: githubGetParameters,
      async execute(id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: unknown): Promise<PiToolResult<unknown>> {
        try {
          const input = asInput(params);
          const kind = requiredKind(input);
          const target = githubTarget(kind, input);
          return await executeInternalTool(internalTools, target.tool, id, target.params, context) as PiToolResult<unknown>;
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });
  },
};
