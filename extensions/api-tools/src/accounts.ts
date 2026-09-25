import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { ApiClientError } from './client.js';
import { createGitFileInspector, type GitFileInspector } from './git.js';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const ENCODED_TRAVERSAL_PATTERN = /%2e/i;

export interface RawAccountEntry {
  role?: string;
  username?: string;
  email?: string;
  password?: string;
  [key: string]: unknown;
}

export interface ResolvedAccount {
  role?: string;
  username?: string;
  email?: string;
  identifier: string;
  password: string;
}

export interface ResolveLocalAccountOptions {
  cwd: string;
  accountsFile: string;
  alias: string;
  secretValues?: string[];
  gitInspector?: GitFileInspector;
}

function hasTraversalSegment(filePath: string): boolean {
  return filePath.split(/[/\\]/).some((segment) => segment === '.' || segment === '..');
}

export async function resolveLocalAccount(options: ResolveLocalAccountOptions): Promise<ResolvedAccount> {
  const { cwd, accountsFile, alias } = options;

  if (!accountsFile || typeof accountsFile !== 'string') {
    throw new ApiClientError('validation', 'accounts_file path is required.');
  }

  if (!alias || typeof alias !== 'string' || !alias.trim()) {
    throw new ApiClientError('validation', 'Account alias is required.');
  }

  if (CONTROL_CHARACTER_PATTERN.test(accountsFile)) {
    throw new ApiClientError('validation', 'Control characters are not allowed in accounts_file path.');
  }

  if (accountsFile.includes('\\')) {
    throw new ApiClientError('validation', 'Backslashes are not allowed in accounts_file path.');
  }

  if (ENCODED_TRAVERSAL_PATTERN.test(accountsFile) || hasTraversalSegment(accountsFile)) {
    throw new ApiClientError('validation', 'Path traversal is not allowed in accounts_file path.');
  }

  if (isAbsolute(accountsFile)) {
    throw new ApiClientError('validation', 'accounts_file must be a relative path within project.');
  }

  const normalizedCwd = resolve(cwd);
  const targetPath = resolve(normalizedCwd, accountsFile);

  if (!targetPath.startsWith(normalizedCwd + sep) && targetPath !== normalizedCwd) {
    throw new ApiClientError('validation', 'accounts_file escapes the project directory.');
  }

  let realTargetPath: string;
  try {
    realTargetPath = await realpath(targetPath);
  } catch {
    throw new ApiClientError('reference', `Accounts file not found: ${accountsFile}`);
  }

  if (!realTargetPath.startsWith(normalizedCwd + sep) && realTargetPath !== normalizedCwd) {
    throw new ApiClientError('validation', 'accounts_file symlink escapes the project directory.');
  }

  const gitInspector = options.gitInspector ?? createGitFileInspector();
  const gitState = await gitInspector.inspectFile({ cwd: normalizedCwd, relativePath: accountsFile });

  if (gitState === 'tracked') {
    throw new ApiClientError('configuration', `Accounts file ${accountsFile} is tracked by git. Credentials must be git-ignored.`);
  }

  if (gitState === 'unignored_untracked') {
    throw new ApiClientError('configuration', `Accounts file ${accountsFile} is not git-ignored. Credentials must be git-ignored.`);
  }

  if (gitState !== 'ignored') {
    throw new ApiClientError('configuration', `Accounts file ${accountsFile} git-ignore status could not be verified.`);
  }

  let rawContent: string;
  try {
    rawContent = await readFile(realTargetPath, 'utf8');
  } catch (error) {
    throw new ApiClientError('provider', `Failed to read accounts file: ${error instanceof Error ? error.message : String(error)}`);
  }

  let entries: unknown;
  try {
    entries = JSON.parse(rawContent);
  } catch {
    throw new ApiClientError('validation', `Accounts file ${accountsFile} must contain valid JSON.`);
  }

  if (!Array.isArray(entries)) {
    throw new ApiClientError('validation', `Accounts file ${accountsFile} must contain an array of accounts.`);
  }

  // Register all parsed passwords into secretValues for active redaction
  if (options.secretValues) {
    for (const entry of entries) {
      if (entry && typeof entry === 'object' && typeof entry.password === 'string' && entry.password.length > 0) {
        if (!options.secretValues.includes(entry.password)) {
          options.secretValues.push(entry.password);
        }
      }
    }
  }

  const normalizedAlias = alias.trim().toLowerCase();
  const matched = entries.find((entry): entry is RawAccountEntry => {
    if (!entry || typeof entry !== 'object') return false;
    const role = typeof entry.role === 'string' ? entry.role.trim().toLowerCase() : '';
    const username = typeof entry.username === 'string' ? entry.username.trim().toLowerCase() : '';
    const email = typeof entry.email === 'string' ? entry.email.trim().toLowerCase() : '';
    return role === normalizedAlias || username === normalizedAlias || email === normalizedAlias;
  });

  if (!matched) {
    throw new ApiClientError('reference', `Account alias "${alias}" not found in ${accountsFile}.`);
  }

  if (!matched.password || typeof matched.password !== 'string') {
    throw new ApiClientError('validation', `Account alias "${alias}" has no password configured.`);
  }

  const identifier = (typeof matched.username === 'string' && matched.username.trim())
    || (typeof matched.email === 'string' && matched.email.trim())
    || (typeof matched.role === 'string' && matched.role.trim())
    || alias.trim();

  return {
    role: typeof matched.role === 'string' ? matched.role : undefined,
    username: typeof matched.username === 'string' ? matched.username : undefined,
    email: typeof matched.email === 'string' ? matched.email : undefined,
    identifier,
    password: matched.password,
  };
}
