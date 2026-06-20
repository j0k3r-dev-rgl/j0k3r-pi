export type HackerNewsSearchRequest = {
  query: string;
  limit: number;
};

export type HackerNewsStoryRequest = {
  storyId: number;
  commentsLimit: number;
  commentsOffset: number;
  maxDepth: number;
};

export type HackerNewsRawStory = Record<string, unknown>;
export type HackerNewsRawItem = Record<string, unknown>;

export type NormalizedHackerNewsStory = {
  platform: 'hacker_news';
  id: string;
  url?: string;
  title?: string;
  author?: string;
  created_at?: string;
  points?: number;
  comments_count?: number;
  snippet?: string;
  follow_up_story_id: number;
};

export type HackerNewsSearchResult = {
  query: string;
  limit: number;
  items: NormalizedHackerNewsStory[];
};

export type HackerNewsCommentNode = {
  id: string;
  author?: string;
  created_at?: string;
  body?: string;
  children?: HackerNewsCommentNode[];
};

export type HackerNewsStoryDetailResult = NormalizedHackerNewsStory & {
  body?: string;
  comments_limit: number;
  comments_offset: number;
  next_comments_offset?: number;
  max_depth: number;
  comments: HackerNewsCommentNode[];
  bounds: {
    returned_top_level_comments: number;
    returned_total_comments: number;
    truncated_by_depth: boolean;
    truncated_by_total_limit: boolean;
  };
};

export interface HackerNewsClient {
  searchStories(input: HackerNewsSearchRequest, signal?: AbortSignal): Promise<HackerNewsRawStory[]>;
  getStory(input: HackerNewsStoryRequest, signal?: AbortSignal): Promise<HackerNewsRawItem | null>;
}
