import { type CommunityPost } from "../data/community-posts.js";
import { persistPost } from "../db/neon.js";

// Comma-separated list of public Discourse forums, e.g.
// DISCOURSE_BASE_URLS=https://forum.example.com,https://community.example.org
const DISCOURSE_BASE_URLS = (process.env["DISCOURSE_BASE_URLS"] ?? "")
  .split(",")
  .map((url) => url.trim().replace(/\/+$/, ""))
  .filter(Boolean);

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

function normalizeDiscourseTopics(
  baseUrl: string,
  payload: DiscourseLatestResponse,
  limit: number,
): CommunityPost[] {
  const usernames = new Map((payload.users ?? []).map((user) => [user.id, user.username]));
  const host = new URL(baseUrl).host;

  return (payload.topic_list?.topics ?? []).slice(0, limit).map((topic) => {
    const originalPoster =
      topic.posters?.find((poster) => poster.description?.includes("Original Poster")) ??
      topic.posters?.[0];
    const externalId = `${host}:${topic.id}`;

    return {
      id: `discourse-${externalId}`,
      external_id: externalId,
      platform: "discourse",
      author: (originalPoster && usernames.get(originalPoster.user_id)) ?? "unknown",
      region: "unknown",
      content: topic.title,
      type: topic.title.trim().endsWith("?") ? "question" : "discussion",
      timestamp: new Date(topic.created_at).toISOString(),
      source: "discourse_live",
      meta: { url: `${baseUrl}/t/${topic.slug}/${topic.id}`, forum: host },
    };
  });
}

async function persistNormalizedPosts(posts: CommunityPost[]): Promise<void> {
  await Promise.all(
    posts.map(async (post) => {
      try {
        await persistPost(post);
      } catch (error) {
        console.error(`[discourse] Failed to persist post ${post.id}`, error);
      }
    }),
  );
}

async function fetchForum(baseUrl: string, limit: number): Promise<CommunityPost[]> {
  try {
    const response = await fetch(`${baseUrl}/latest.json?order=created`, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      console.error(`[discourse] ${baseUrl} returned ${response.status}`);
      return [];
    }

    const posts = normalizeDiscourseTopics(
      baseUrl,
      (await response.json()) as DiscourseLatestResponse,
      limit,
    );
    await persistNormalizedPosts(posts);
    return posts;
  } catch (error) {
    console.error(`[discourse] Failed to fetch ${baseUrl}`, error);
    return [];
  }
}

export async function fetchDiscoursePosts(limit = 10): Promise<CommunityPost[]> {
  const results = await Promise.all(DISCOURSE_BASE_URLS.map((url) => fetchForum(url, limit)));
  return results.flat();
}
