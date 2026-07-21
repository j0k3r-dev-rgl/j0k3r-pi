export type Context7CacheLocation = 'disabled' | 'xdg' | 'home';

export interface Context7OutputArtifact {
  kind: 'file';
  path: string;
  mediaType: 'text/plain';
  chars: number;
  instruction: string;
}

export interface Context7ProjectConfigFile {
  cache?: {
    enabled?: boolean;
    ttl_seconds?: number;
  };
  defaults?: {
    max_chars?: number;
    result_limit?: number;
  };
  [key: string]: unknown;
}

export interface Context7RuntimeConfig {
  configPath?: string;
  apiKeyPresent: boolean;
  cache: {
    enabled: boolean;
    ttlSeconds: number;
    directory?: string;
    location: Context7CacheLocation;
  };
  defaults: {
    maxChars: number;
    resultLimit: number;
  };
  warnings: string[];
}

export interface LibraryCandidate {
  id: string;
  name: string;
  description?: string;
  totalSnippets?: number;
  trustScore?: number;
  benchmarkScore?: number;
  versions?: string[];
}

export interface DocumentationSnippet {
  title?: string;
  content: string;
  source?: string;
  sourceUrl?: string;
  truncated?: boolean;
  originalChars?: number;
}

export interface Context7Documentation {
  libraryId: string;
  query: string;
  type: 'json' | 'txt';
  snippets?: DocumentationSnippet[];
  text?: string;
  sources: Array<{ title?: string; source?: string; sourceUrl?: string }>;
}

export interface SearchLibraryInput {
  libraryName: string;
  query: string;
  limit: number;
}

export interface GetContextInput {
  libraryId: string;
  query: string;
  type: 'json' | 'txt';
  maxChars: number;
}

export interface Context7Client {
  searchLibrary(input: SearchLibraryInput, signal?: AbortSignal): Promise<LibraryCandidate[]>;
  getContext(input: GetContextInput, signal?: AbortSignal): Promise<Context7Documentation>;
}
