import type { CommunityPostType } from "../data/community-posts.js";

// Generic intent rules plus per-company pain keywords from the watchlist.
// "integration_pain" is kept as the stored value for compatibility; the UI
// labels it "Pain point".

const FEATURE_HINTS = ["feature request", "would love", "wish there was", "please add", "request:", "feature idea"];
const PAIN_HINTS = ["broken", "not working", "error", "bug", "outage", "frustrat", "issue with", "can't get"];

export function inferIntent(
  title: string,
  content: string,
  painKeywords: string[] = [],
): CommunityPostType {
  const text = `${title} ${content}`.toLowerCase();

  if (FEATURE_HINTS.some((hint) => text.includes(hint))) {
    return "feature_request";
  }

  if (title.trim().endsWith("?") || /\?\s/.test(`${content} `)) {
    return "question";
  }

  const pains = [...PAIN_HINTS, ...painKeywords.map((word) => word.toLowerCase())];
  if (pains.some((hint) => hint && text.includes(hint))) {
    return "integration_pain";
  }

  return "discussion";
}
