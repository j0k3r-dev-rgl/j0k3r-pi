export type DevtoArticleSearchRequest = {
  tag: string;
  limit: number;
};

export type DevtoCommentsRequest = {
  articleId: number;
  topLevelLimit: number;
  topLevelOffset: number;
  totalLimit: number;
  maxDepth: number;
};

export type DevtoRawArticle = Record<string, unknown>;
export type DevtoRawComment = Record<string, unknown>;

export type NormalizedDevtoArticle = {
  platform: 'devto';
  id: string;
  article_id: number;
  url?: string;
  title?: string;
  author?: string;
  published_at?: string;
  tags?: string[];
  reactions_count?: number;
  comments_count?: number;
  reading_time_minutes?: number;
  snippet?: string;
  follow_up_article_id: number;
};

export type DevtoArticleSearchResult = {
  tag: string;
  limit: number;
  items: NormalizedDevtoArticle[];
};

export type DevtoCommentNode = {
  id: string;
  author?: string;
  created_at?: string;
  body?: string;
  children?: DevtoCommentNode[];
};

export type DevtoCommentsResult = {
  platform: 'devto';
  article_id: number;
  url?: string;
  top_level_limit: number;
  top_level_offset: number;
  total_limit: number;
  max_depth: number;
  has_more_top_level_comments: boolean;
  next_top_level_offset?: number;
  comments: DevtoCommentNode[];
  bounds: {
    returned_top_level_comments: number;
    returned_total_nodes: number;
    truncated_by_depth: boolean;
    truncated_by_total_limit: boolean;
    truncated_by_top_level_limit: boolean;
  };
};

export interface DevtoClient {
  searchArticles(input: DevtoArticleSearchRequest, signal?: AbortSignal): Promise<DevtoRawArticle[]>;
  getComments(input: DevtoCommentsRequest, signal?: AbortSignal): Promise<DevtoRawComment[]>;
}
