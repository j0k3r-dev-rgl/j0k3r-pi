export const WEB_FETCH_DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
export const WEB_FETCH_MAX_BYTES = 5 * 1024 * 1024;
export const WEB_FETCH_MAX_REDIRECTS = 3;
export const WEB_FETCH_MAX_LINKS = 100;

export type WebFetchRequest = {
  url: string;
  maxBytes: number;
};

export type WebFetchLink = {
  text: string;
  url: string;
};

export type WebFetchRedirect = {
  url: string;
  status: number;
  location: string;
};

export type WebFetchResult = {
  url: string;
  final_url: string;
  status: number;
  content_type: string;
  title?: string;
  text: string;
  excerpt: string;
  links: WebFetchLink[];
  fetched_at: string;
  bytes_read: number;
  truncated: boolean;
  redirects: WebFetchRedirect[];
};

export interface WebFetchClient {
  fetch(input: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>;
}
