import { type CommunityPost } from "../data/community-posts.js";
import { inferIntent } from "../config/classify.js";

// Reddit adapter: query in, normalized posts out. No persistence and no
// module-level state, so the scan runner and the dry-run preview share it.

const REDDIT_SEARCH_BASE_URL = "https://www.reddit.com/search.json";
const MAX_SELF_TEXT_LENGTH = 200;
const USER_AGENT = "community-voices-radar/1.0 (+https://github.com/schwentker/community-voices-radar)";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface RedditSearchChild {
  data: {
    id: string;
    author?: string;
    title?: string;
    selftext?: string;
    created_utc?: number;
    subreddit?: string;
    permalink?: string;
    score?: number;
    num_comments?: number;
    promoted?: boolean;
    is_ad?: boolean;
    over_18?: boolean;
  };
}

interface RedditSearchResponse {
  data?: {
    after?: string | null;
    children?: RedditSearchChild[];
  };
}

export interface RedditSearchOptions {
  limit?: number;
  after?: string | null;
  painKeywords?: string[];
  fetchImpl?: FetchLike;
}

export interface RedditSearchResult {
  posts: CommunityPost[];
  after: string | null;
  status: "ok" | "rate_limited" | "error";
}

export function getSearchUrl(query: string, after: string | null, limit: number): string {
  const params = new URLSearchParams({ q: query, sort: "new", limit: String(limit) });
  if (after) {
    params.set("after", after);
  }
  return `${REDDIT_SEARCH_BASE_URL}?${params.toString()}`;
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function isDeletedValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "[deleted]" || normalized === "[removed]";
}

function hasMeaningfulContent(title: string, selfText: string): boolean {
  if (title && !isDeletedValue(title)) {
    return true;
  }
  return Boolean(selfText && !isDeletedValue(selfText));
}

export function normalizeRedditChild(
  child: RedditSearchChild,
  painKeywords: string[] = [],
): CommunityPost | null {
  const post = child.data;
  const title = post.title?.trim() ?? "";
  const selfText = post.selftext?.trim() ?? "";

  if (post.promoted || post.is_ad || post.over_18) {
    return null;
  }
  if (!post.id || !post.created_utc || !hasMeaningfulContent(title, selfText)) {
    return null;
  }

  const body = truncateText(selfText, MAX_SELF_TEXT_LENGTH);
  const content = (body ? `${title} ${body}` : title).trim();
  if (!content) {
    return null;
  }

  const score = post.score ?? 0;
  const comments = post.num_comments ?? 0;

  return {
    id: `reddit_${post.id}`,
    external_id: post.id,
    platform: "reddit",
    author: post.author?.trim() || "unknown",
    region: "unknown",
    content,
    type: inferIntent(title, content, painKeywords),
    timestamp: new Date(post.created_utc * 1000).toISOString(),
    source: "reddit_live",
    meta: {
      subreddit: post.subreddit ?? "unknown",
      ...(post.permalink ? { url: `https://www.reddit.com${post.permalink}` } : {}),
      score,
      comments,
      rank: score + comments * 2,
    },
  };
}

export async function searchReddit(
  query: string,
  { limit = 25, after = null, painKeywords = [], fetchImpl = fetch }: RedditSearchOptions = {},
): Promise<RedditSearchResult> {
  try {
    const response = await fetchImpl(getSearchUrl(query, after, limit), {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });

    if (response.status === 429) {
      console.warn("[reddit] Rate limited");
      return { posts: [], after: null, status: "rate_limited" };
    }
    if (!response.ok) {
      console.error(`[reddit] Search failed: ${response.status} ${response.statusText}`);
      return { posts: [], after: null, status: "error" };
    }

    const listing = ((await response.json()) as RedditSearchResponse).data;
    const posts = (listing?.children ?? [])
      .map((child) => normalizeRedditChild(child, painKeywords))
      .filter((post): post is CommunityPost => post !== null);

    return { posts, after: listing?.after ?? null, status: "ok" };
  } catch (error) {
    console.error("[reddit] Search request failed", error);
    return { posts: [], after: null, status: "error" };
  }
}
