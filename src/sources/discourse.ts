import { type CommunityPost } from "../data/community-posts.js";
import { inferIntent } from "../config/classify.js";
import type { FetchLike } from "./reddit.js";

// Discourse adapter: forum URL in, normalized posts out. Forums come from each
// watchlist entity (sources.discourse.forums), not from env.

interface DiscourseUser {
  id: number;
  username: string;
}

interface DiscourseTopic {
  id: number;
  title: string;
  slug: string;
  created_at: string;
  posters?: { user_id: number; description?: string }[];
}

interface DiscourseLatestResponse {
  users?: DiscourseUser[];
  topic_list?: { topics?: DiscourseTopic[] };
}

export function normalizeDiscourseTopics(
  baseUrl: string,
  payload: DiscourseLatestResponse,
  limit: number,
  painKeywords: string[] = [],
): CommunityPost[] {
  const usernames = new Map((payload.users ?? []).map((user) => [user.id, user.username]));
  const host = new URL(baseUrl).host;

  return (payload.topic_list?.topics ?? []).slice(0, limit).map((topic) => {
    const originalPoster =
      topic.posters?.find((poster) => poster.description?.includes("Original Poster")) ?? topic.posters?.[0];
    const externalId = `${host}:${topic.id}`;

    return {
      id: `discourse-${externalId}`,
      external_id: externalId,
      platform: "discourse",
      author: (originalPoster && usernames.get(originalPoster.user_id)) ?? "unknown",
      region: "unknown",
      content: topic.title,
      type: inferIntent(topic.title, "", painKeywords),
      timestamp: new Date(topic.created_at).toISOString(),
      source: "discourse_live",
      meta: { url: `${baseUrl}/t/${topic.slug}/${topic.id}`, forum: host },
    };
  });
}

export async function fetchForumTopics(
  baseUrl: string,
  { limit = 25, painKeywords = [], fetchImpl = fetch }: { limit?: number; painKeywords?: string[]; fetchImpl?: FetchLike } = {},
): Promise<CommunityPost[]> {
  try {
    const response = await fetchImpl(`${baseUrl}/latest.json?order=created`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      console.error(`[discourse] ${baseUrl} returned ${response.status}`);
      return [];
    }
    return normalizeDiscourseTopics(
      baseUrl,
      (await response.json()) as DiscourseLatestResponse,
      limit,
      painKeywords,
    );
  } catch (error) {
    console.error(`[discourse] Failed to fetch ${baseUrl}`, error);
    return [];
  }
}
