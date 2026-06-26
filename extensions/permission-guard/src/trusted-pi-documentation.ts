import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { isPathContainedByRoot } from './path-policy.js';
import type { PermissionRequest } from './types.js';

type Target = NonNullable<PermissionRequest['target']>;

interface PiPackageMatch {
  packageRoot: string;
  relativeSegments: string[];
}

function realpathIfPossible(path: string): string | undefined {
  try {
    return realpathSync.native(path);
  } catch {
    return undefined;
  }
}

function pathSegments(path: string): string[] {
  return path.split(sep).filter(Boolean);
}

function isPiPackageRoot(path: string): boolean {
  const packageJsonPath = join(path, 'package.json');
  if (!existsSync(packageJsonPath)) return false;
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: unknown };
    return parsed.name === '@earendil-works/pi-coding-agent';
  } catch {
    return false;
  }
}

function findPiPackageMatch(path: string): PiPackageMatch | undefined {
  const targetPath = resolve(path);
  let current = dirname(targetPath);
  while (true) {
    if (isPiPackageRoot(current)) {
      return {
        packageRoot: current,
        relativeSegments: pathSegments(relative(current, targetPath)),
      };
    }

    const parent = dirname(current);
    if (parent === current || current === parse(current).root) return undefined;
    current = parent;
  }
}

function hasSafeDocumentationSegments(segments: string[]): boolean {
  return segments.every((segment) => segment.length > 0 && segment !== 'node_modules' && !segment.startsWith('.'));
}

function isAllowedPiDocumentationPath(segments: string[]): boolean {
  if (!hasSafeDocumentationSegments(segments)) return false;
  if (segments.length === 1 && segments[0] === 'README.md') return true;
  if (segments.length > 1 && (segments[0] === 'docs' || segments[0] === 'examples')) return true;
  return false;
}

function isInsidePackageRealpath(target: Target, packageRoot: string): boolean {
  const packageRootRealpath = realpathIfPossible(packageRoot);
  if (!packageRootRealpath || !target.resolvedRealpath) return false;
  return isPathContainedByRoot(target.resolvedRealpath, packageRootRealpath);
}

export function isTrustedPiDocumentationReadRequest(request: PermissionRequest): boolean {
  if (request.tool !== 'read' || request.action !== 'read' || !request.target) return false;
  const target = request.target;
  if (!target.exists || target.kind !== 'file') return false;

  const match = findPiPackageMatch(target.normalizedAbsolute);
  if (!match || !isAllowedPiDocumentationPath(match.relativeSegments)) return false;
  if (!isPathContainedByRoot(target.normalizedAbsolute, match.packageRoot)) return false;
  return isInsidePackageRealpath(target, match.packageRoot);
}
