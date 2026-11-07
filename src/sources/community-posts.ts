import { COMMUNITY_POSTS } from "../data/community-posts.js";
import type { PostQuery, Store, StoredPost } from "../store/types.js";

export type CommunityPostResult = StoredPost;
export type CommunityPostFilters = PostQuery;

// Reads what scans stored. Fetching from Reddit/Discourse happens only in a
// scan (on demand or weekly), never on a read request.
export async function getCommunityPosts(
  store: Store,
  filters: CommunityPostFilters = {},
): Promise<CommunityPostResult[]> {
  const [{ settings }, stored] = await Promise.all([store.getConfig(), store.listPosts(filters)]);

  if (!settings.includeSynthetic || filters.entity) {
    return stored;
  }

  const synthetic = COMMUNITY_POSTS.map((post) => ({ ...post, source: "synthetic", entities: [] }))
    .filter((post) => !filters.platform || filters.platform === "all" || post.platform === filters.platform)
    .filter((post) => !filters.region || filters.region === "all" || post.region === filters.region)
    .filter((post) => !filters.type || filters.type === "all" || post.type === filters.type);

  const merged = [...stored, ...synthetic].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return filters.limit ? merged.slice(0, filters.limit) : merged;
}
