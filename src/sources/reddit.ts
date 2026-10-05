import { type CommunityPost } from "../data/community-posts.js";
import { persistPost } from "../db/neon.js";

const REDDIT_SEARCH_BASE_URL = "https://www.reddit.com/search.json";
// Override with REDDIT_SEARCH_QUERY to track any community, product, or topic.
const DEFAULT_SEARCH_QUERY = process.env["REDDIT_SEARCH_QUERY"] ?? "\"model context protocol\" OR mcp server";
const DEFAULT_PAGE_SIZE = 10;
const MAX_SELF_TEXT_LENGTH = 200;

let searchAfterCursor: string | null = null;
let activeSearchQuery = DEFAULT_SEARCH_QUERY;

interface RedditSearchChild {
  data: {
    id: string;
    author?: string;
    title?: string;
    selftext?: string;
    created_utc?: number;
    subreddit?: string;
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

function getSearchUrl(query: string, after: string | null, limit: number): string {
  const params = new URLSearchParams({
    q: query,
    sort: "new",
    limit: String(limit),
  });

  if (after) {
    params.set("after", after);
  }

  return `${REDDIT_SEARCH_BASE_URL}?${params.toString()}`;
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function buildContent(title: string, selfText: string): string {
  const normalizedTitle = title.trim();
  const normalizedSelfText = truncateText(selfText, MAX_SELF_TEXT_LENGTH);

  if (!normalizedSelfText) {
    return normalizedTitle;
  }

  return `${normalizedTitle} ${normalizedSelfText}`.trim();
}

function isDeletedValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "[deleted]" || normalized === "[removed]";
}

function hasMeaningfulContent(title: string, selfText: string): boolean {
  const normalizedTitle = title.trim();
  const normalizedSelfText = selfText.trim();

  if (!normalizedTitle && !normalizedSelfText) {
    return false;
  }

  if (normalizedTitle && !isDeletedValue(normalizedTitle)) {
    return true;
  }

  return Boolean(normalizedSelfText && !isDeletedValue(normalizedSelfText));
}

function inferIntent(title: string, content: string): CommunityPost["type"] {
  const text = `${title} ${content}`.toLowerCase();

  if (text.includes("feature") || text.includes("request")) {
    return "feature_request";
  }

  if (title.trim().endsWith("?") || content.includes("?")) {
    return "question";
  }

  if (
    text.includes("integration") ||
    text.includes("zapier") ||
    text.includes("n8n") ||
    text.includes("salesforce")
  ) {
    return "integration_pain";
  }

  return "discussion";
}

function normalizePost(child: RedditSearchChild): CommunityPost | null {
  const post = child.data;
  const title = post.title?.trim() ?? "";
  const selfText = post.selftext?.trim() ?? "";

  if (post.promoted || post.is_ad || post.over_18) {
    return null;
  }

  if (!post.id || !post.created_utc || !hasMeaningfulContent(title, selfText)) {
    return null;
  }

  const content = buildContent(title, selfText);
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
    type: inferIntent(title, content),
    timestamp: new Date(post.created_utc * 1000).toISOString(),
    source: "reddit_live",
    meta: {
      subreddit: post.subreddit ?? "unknown",
      score,
      comments,
      rank: score + comments * 2,
    },
  };
}

async function persistNormalizedPosts(posts: CommunityPost[]): Promise<void> {
  await Promise.all(
    posts.map(async (post) => {
      try {
        await persistPost(post);
        console.log("persisted_post", post.id);
      } catch (error) {
        console.error(`[reddit] Failed to persist post ${post.id}`, error);
      }
    })
  );
}

export async function fetchRedditPosts(): Promise<CommunityPost[]> {
  const requestUrl = getSearchUrl(activeSearchQuery, searchAfterCursor, DEFAULT_PAGE_SIZE);

  try {
    const response = await fetch(requestUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "community-voices-radar/1.0 (+https://github.com/schwentker/community-voices-radar)",
      },
    });

    if (response.status === 429) {
      console.warn("[reddit] Rate limited while fetching search results");
      return [];
    }

    if (!response.ok) {
      console.error(`[reddit] Failed to fetch search results: ${response.status} ${response.statusText}`);
      return [];
    }

    const payload = (await response.json()) as RedditSearchResponse;
    const listing = payload.data;
    const children = listing?.children ?? [];

    const after = listing?.after ?? null;
    searchAfterCursor = after;

    if (searchAfterCursor === null) {
      // Resetting here allows the next poll cycle to start over with the newest page.
      activeSearchQuery = DEFAULT_SEARCH_QUERY;
    }

    const posts = children
      .map((child) => normalizePost(child))
      .filter((post): post is CommunityPost => post !== null);

    console.log("reddit_fetch_count", posts.length);
    console.log("after_cursor", after);

    await persistNormalizedPosts(posts);

    return posts;
  } catch (error) {
    console.error("[reddit] Failed to fetch Reddit posts", error);
    return [];
  }
}
