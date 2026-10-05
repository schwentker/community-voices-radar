import {
  COMMUNITY_POSTS,
  type CommunityPlatform,
  type CommunityPost,
  type CommunityPostType,
  type CommunityRegion,
} from "../data/community-posts.js";
import { fetchRedditPosts } from "./reddit.js";
import { fetchDiscoursePosts } from "./discourse.js";

export interface CommunityPostResult extends CommunityPost {
  source: string;
}

export interface CommunityPostFilters {
  platform?: CommunityPlatform | "all";
  region?: CommunityRegion | "all";
  type?: CommunityPostType | "all";
  limit?: number;
}

function withSource(posts: CommunityPost[], source: string): CommunityPostResult[] {
  return posts.map((post) => ({ ...post, source: post.source ?? source }));
}

export async function getCommunityPosts({
  platform = "all",
  region = "all",
  type = "all",
  limit,
}: CommunityPostFilters = {}): Promise<CommunityPostResult[]> {
  const [redditPosts, discoursePosts] = await Promise.all([
    fetchRedditPosts(),
    fetchDiscoursePosts().catch(() => []),
  ]);

  const mergedPosts = [
    ...withSource(COMMUNITY_POSTS, "synthetic"),
    ...withSource(redditPosts, "reddit_live"),
    ...withSource(discoursePosts, "discourse_live"),
  ]
    .filter((post) => {
      const platformMatches = platform === "all" || post.platform === platform;
      const regionMatches = region === "all" || post.region === region;
      const typeMatches = type === "all" || post.type === type;
      return platformMatches && regionMatches && typeMatches;
    })
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  if (limit && limit > 0) {
    return mergedPosts.slice(0, limit);
  }

  return mergedPosts;
}
