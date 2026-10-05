import { startTransition, useEffect, useMemo, useState } from "react";

type Platform = "all" | "discourse" | "discord" | "slack" | "reddit";
type Region = "all" | "us" | "europe" | "india" | "japan" | "brazil";
type PostType = "all" | "question" | "feature_request" | "announcement";

interface CommunityPost {
  id: string;
  platform: Exclude<Platform, "all"> | string;
  author: string;
  region: Exclude<Region, "all"> | "unknown" | string;
  content: string;
  type: Exclude<PostType, "all"> | string;
  timestamp: string;
  source?: string;
}

type RouteStatus = "idle" | "sending" | "sent" | "error";

const PLATFORM_OPTIONS: { label: string; value: Platform }[] = [
  { label: "All", value: "all" },
  { label: "Discourse", value: "discourse" },
  { label: "Discord", value: "discord" },
  { label: "Slack", value: "slack" },
  { label: "Reddit", value: "reddit" },
];

const REGION_OPTIONS: { label: string; value: Region }[] = [
  { label: "All", value: "all" },
  { label: "US", value: "us" },
  { label: "Europe", value: "europe" },
  { label: "India", value: "india" },
  { label: "Japan", value: "japan" },
  { label: "Brazil", value: "brazil" },
];

const TYPE_OPTIONS: { label: string; value: PostType }[] = [
  { label: "All", value: "all" },
  { label: "Questions", value: "question" },
  { label: "Feature Requests", value: "feature_request" },
  { label: "Announcements", value: "announcement" },
];

const PLATFORM_STYLES: Record<string, string> = {
  discourse: "bg-[#ede7fb] text-[#5a40a3] border-[#d6c9f3]",
  discord: "bg-indigo-50 text-indigo-700 border-indigo-200",
  slack: "bg-emerald-50 text-emerald-700 border-emerald-200",
  reddit: "bg-orange-50 text-orange-700 border-orange-200",
};

const PLATFORM_LABELS: Record<string, string> = {
  discourse: "Discourse",
  discord: "Discord",
  slack: "Slack",
  reddit: "Reddit",
};

const REGION_FLAGS: Record<string, string> = {
  us: "🇺🇸",
  europe: "🇬🇧",
  india: "🇮🇳",
  japan: "🇯🇵",
  brazil: "🇧🇷",
  unknown: "🌐",
};

const REGION_LABELS: Record<string, string> = {
  us: "US",
  europe: "Europe",
  india: "India",
  japan: "Japan",
  brazil: "Brazil",
  unknown: "Unknown",
};

const TYPE_LABELS: Record<string, string> = {
  question: "Question",
  feature_request: "Feature Request",
  announcement: "Announcement",
};

const TYPE_COLORS: Record<string, string> = {
  question: "#F97316",
  feature_request: "#0F9D91",
  announcement: "#6B4FBB",
};

const COMMUNITY_POSTS_URL = "https://community-voices-radar.fly.dev/community-posts";

function truncateContent(text: string, maxLength = 150): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trimEnd()}...`;
}

function formatRelativeTime(timestamp: string): string {
  const date = Date.parse(timestamp);
  if (Number.isNaN(date)) {
    return "just now";
  }

  const seconds = Math.round((date - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];

  for (const [unit, unitSeconds] of ranges) {
    if (Math.abs(seconds) >= unitSeconds || unit === "minute") {
      return formatter.format(Math.round(seconds / unitSeconds), unit);
    }
  }

  return "just now";
}

function isLiveSource(source?: string): boolean {
  return Boolean(source && !source.toLowerCase().includes("synthetic"));
}

function isLikelyUnanswered(post: CommunityPost): boolean {
  if (post.type !== "question") {
    return false;
  }

  const lowerContent = post.content.toLowerCase();
  return !["solved", "resolved", "fixed", "figured out", "thanks, got it"].some((token) =>
    lowerContent.includes(token)
  );
}

function buildDonutSegments(breakdown: Record<string, number>): string {
  const total = Object.values(breakdown).reduce((sum, count) => sum + count, 0);
  if (!total) {
    return "conic-gradient(#e5e7eb 0deg 360deg)";
  }

  let current = 0;
  const segments = Object.entries(breakdown).map(([key, count]) => {
    const start = current;
    const slice = (count / total) * 360;
    current += slice;
    return `${TYPE_COLORS[key]} ${start}deg ${current}deg`;
  });

  return `conic-gradient(${segments.join(", ")})`;
}

function FilterGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { label: string; value: T }[];
  onChange: (nextValue: T) => void;
}) {
  return (
    <div className="rounded-2xl border border-[color:var(--radar-line)] bg-white/85 p-3 shadow-sm backdrop-blur">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={[
                "rounded-full border px-3 py-2 text-sm font-medium transition",
                active
                  ? "border-radar-purple bg-radar-purple text-white shadow-md shadow-violet-200"
                  : "border-slate-200 bg-white text-slate-700 hover:border-violet-200 hover:text-radar-purple",
              ].join(" ")}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-[28px] border border-white/80 bg-white/80 p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="h-7 w-28 animate-pulse rounded-full bg-slate-200" />
        <div className="h-5 w-16 animate-pulse rounded-full bg-slate-200" />
      </div>
      <div className="mb-3 h-4 w-40 animate-pulse rounded bg-slate-200" />
      <div className="space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
      </div>
    </div>
  );
}

function App() {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [platform, setPlatform] = useState<Platform>("all");
  const [region, setRegion] = useState<Region>("all");
  const [type, setType] = useState<PostType>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routeStatus, setRouteStatus] = useState<Record<string, RouteStatus>>({});

  useEffect(() => {
    const controller = new AbortController();

    const loadPosts = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(COMMUNITY_POSTS_URL, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`);
        }

        const data = (await response.json()) as CommunityPost[];
        startTransition(() => {
          setPosts(Array.isArray(data) ? data : []);
        });
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }

        setError(err instanceof Error ? err.message : "Unable to load community posts");
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void loadPosts();

    return () => {
      controller.abort();
    };
  }, []);

  const scopedPosts = useMemo(() => {
    return posts.filter((post) => {
      const matchesPlatform = platform === "all" || post.platform === platform;
      const matchesRegion = region === "all" || post.region === region;
      return matchesPlatform && matchesRegion;
    });
  }, [platform, posts, region]);

  const filteredPosts = useMemo(() => {
    return scopedPosts.filter((post) => {
      const matchesType = type === "all" || post.type === type;
      return matchesType;
    });
  }, [scopedPosts, type]);

  const topRegions = useMemo(() => {
    const counts = scopedPosts.reduce<Record<string, number>>((accumulator, post) => {
      const key = post.region in REGION_LABELS ? post.region : "unknown";
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    }, {});

    return Object.entries(counts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5);
  }, [scopedPosts]);

  const typeBreakdown = useMemo(() => {
    return scopedPosts.reduce<Record<string, number>>(
      (accumulator, post) => {
        if (post.type in accumulator) {
          accumulator[post.type] += 1;
        }
        return accumulator;
      },
      { question: 0, feature_request: 0, announcement: 0 }
    );
  }, [scopedPosts]);

  const featureRequests = useMemo(
    () => scopedPosts.filter((post) => post.type === "feature_request"),
    [scopedPosts]
  );

  const unansweredQuestions = useMemo(
    () => scopedPosts.filter((post) => isLikelyUnanswered(post)).length,
    [scopedPosts]
  );

  const livePostCount = filteredPosts.filter((post) => isLiveSource(post.source)).length;
  const maxRegionCount = Math.max(...topRegions.map(([, count]) => count), 1);

  const refreshPosts = async () => {
    setIsRefreshing(true);
    setError(null);

    try {
      const response = await fetch(COMMUNITY_POSTS_URL, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Refresh failed with ${response.status}`);
      }

      const data = (await response.json()) as CommunityPost[];
      startTransition(() => {
        setPosts(Array.isArray(data) ? data : []);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to refresh community posts");
    } finally {
      setIsRefreshing(false);
    }
  };

  const routeToProduct = async (post: CommunityPost) => {
    setRouteStatus((current) => ({ ...current, [post.id]: "sending" }));

    try {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 600);
      });
      console.info("Feature request routed in demo mode", {
        post,
        routedAt: new Date().toISOString(),
        channel: "community-voices-radar",
      });

      setRouteStatus((current) => ({ ...current, [post.id]: "sent" }));
    } catch (_err) {
      setRouteStatus((current) => ({ ...current, [post.id]: "error" }));
    }
  };

  return (
    <div className="min-h-screen px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="relative overflow-hidden rounded-[36px] border border-white/70 bg-[linear-gradient(135deg,#1f1833_0%,#4f378d_38%,#6b4fbb_72%,#8b78d6_100%)] px-6 py-8 text-white shadow-glow sm:px-8 lg:px-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.18),transparent_24%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.16),transparent_24%)]" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-white/80">
                MCP + Recipes + Genies
              </div>
              <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
                Community Voices Radar
              </h1>
              <p className="mt-3 max-w-2xl text-base text-white/84 sm:text-lg">
                Live intelligence across Discourse, Discord, Slack &amp; Reddit
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
                <div className="text-xs uppercase tracking-[0.22em] text-white/65">Community feed</div>
                <div className="mt-1 text-2xl font-semibold">{posts.length}</div>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
                <div className="text-xs uppercase tracking-[0.22em] text-white/65">Feature requests</div>
                <div className="mt-1 text-2xl font-semibold">{featureRequests.length}</div>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
                <div className="text-xs uppercase tracking-[0.22em] text-white/65">Open questions</div>
                <div className="mt-1 text-2xl font-semibold">{unansweredQuestions}</div>
              </div>
            </div>
          </div>
        </header>

        <section className="mt-6 grid gap-3 xl:grid-cols-[1fr_auto]">
          <div className="grid gap-3 lg:grid-cols-3">
            <FilterGroup label="Platform" value={platform} options={PLATFORM_OPTIONS} onChange={setPlatform} />
            <FilterGroup label="Region" value={region} options={REGION_OPTIONS} onChange={setRegion} />
            <FilterGroup label="Type" value={type} options={TYPE_OPTIONS} onChange={setType} />
          </div>
          <div className="flex items-center justify-between rounded-2xl border border-[color:var(--radar-line)] bg-white/85 px-4 py-3 shadow-sm backdrop-blur xl:min-w-[240px] xl:flex-col xl:items-start xl:justify-center">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
              <span className="relative inline-flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
              </span>
              {filteredPosts.length} posts in view
            </div>
            <div className="text-sm text-slate-500">{livePostCount} live sources active</div>
          </div>
        </section>

        <main className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
          <section className="space-y-4">
            <div className="flex flex-col gap-3 rounded-[30px] border border-[color:var(--radar-line)] bg-white/78 p-5 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-2xl font-semibold text-radar-ink">Community feed</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Unified signal stream from live and synthetic community sources.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refreshPosts()}
                disabled={isRefreshing}
                className="inline-flex items-center justify-center rounded-full border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-radar-purple transition hover:border-violet-300 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            {error ? (
              <div className="rounded-[28px] border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
                {error}. The static demo fetches community posts directly from `community-voices-radar.fly.dev`.
              </div>
            ) : null}

            {isLoading ? (
              <div className="grid gap-4">
                {Array.from({ length: 5 }, (_, index) => (
                  <SkeletonCard key={index} />
                ))}
              </div>
            ) : filteredPosts.length === 0 ? (
              <div className="rounded-[28px] border border-[color:var(--radar-line)] bg-white/80 p-8 text-center text-slate-600 shadow-sm">
                No posts match the current filters.
              </div>
            ) : (
              <div className="grid gap-4">
                {filteredPosts.map((post) => {
                  const routeState = routeStatus[post.id] ?? "idle";

                  return (
                    <article
                      key={post.id}
                      className="rounded-[28px] border border-white/80 bg-white/86 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <span
                              className={[
                                "inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
                                PLATFORM_STYLES[post.platform] ?? "bg-slate-100 text-slate-700 border-slate-200",
                              ].join(" ")}
                            >
                              {PLATFORM_LABELS[post.platform] ?? post.platform}
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                              <span>{REGION_FLAGS[post.region] ?? "🌐"}</span>
                              <span>{REGION_LABELS[post.region] ?? post.region}</span>
                            </span>
                            <span className="inline-flex rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">
                              {TYPE_LABELS[post.type] ?? post.type}
                            </span>
                          </div>
                          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                            <span className="font-semibold text-slate-800">{post.author}</span>
                            <span>{formatRelativeTime(post.timestamp)}</span>
                            <span
                              className={[
                                "rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em]",
                                isLiveSource(post.source) ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600",
                              ].join(" ")}
                            >
                              {isLiveSource(post.source) ? "live" : "synthetic"}
                            </span>
                          </div>
                          <p className="text-[15px] leading-7 text-slate-700">{truncateContent(post.content)}</p>
                        </div>

                        {post.type === "feature_request" ? (
                          <div className="sm:pl-4">
                            <button
                              type="button"
                              onClick={() => void routeToProduct(post)}
                              disabled={routeState === "sending" || routeState === "sent"}
                              className={[
                                "w-full rounded-full px-4 py-2 text-sm font-semibold transition sm:w-auto",
                                routeState === "sent"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-radar-purple text-white hover:bg-radar-plum disabled:cursor-not-allowed disabled:opacity-70",
                              ].join(" ")}
                            >
                              {routeState === "sending"
                                ? "Routing..."
                                : routeState === "sent"
                                  ? "Routed"
                                  : routeState === "error"
                                    ? "Retry Route"
                                    : "Route to Product"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="space-y-4">
            <section className="rounded-[30px] border border-[color:var(--radar-line)] bg-white/82 p-5 shadow-sm backdrop-blur">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="font-display text-2xl font-semibold text-radar-ink">Insights</h2>
                  <p className="mt-1 text-sm text-slate-600">Real-time community pulse across regions and post types.</p>
                </div>
              </div>

              <div className="space-y-5">
                <div>
                  <div className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">Top regions</div>
                  <div className="space-y-3">
                    {topRegions.map(([regionKey, count]) => (
                      <div key={regionKey}>
                        <div className="mb-1 flex items-center justify-between text-sm text-slate-700">
                          <span className="inline-flex items-center gap-2">
                            <span>{REGION_FLAGS[regionKey] ?? "🌐"}</span>
                            <span>{REGION_LABELS[regionKey] ?? regionKey}</span>
                          </span>
                          <span className="font-semibold">{count}</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100">
                          <div
                            className="h-2 rounded-full bg-[linear-gradient(90deg,#6b4fbb,#8b78d6)]"
                            style={{ width: `${(count / maxRegionCount) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[26px] border border-slate-100 bg-slate-50/70 p-4">
                  <div className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Post type breakdown
                  </div>
                  <div className="flex items-center gap-4">
                    <div
                      className="relative h-28 w-28 rounded-full"
                      style={{ background: buildDonutSegments(typeBreakdown) }}
                    >
                      <div className="absolute inset-[18px] rounded-full bg-white" />
                    </div>
                    <div className="flex-1 space-y-2">
                      {Object.entries(typeBreakdown).map(([key, count]) => (
                        <div key={key} className="flex items-center justify-between text-sm text-slate-700">
                          <span className="inline-flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: TYPE_COLORS[key] }} />
                            {TYPE_LABELS[key]}
                          </span>
                          <span className="font-semibold">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[24px] bg-[linear-gradient(135deg,#0f9d91,#34c8b2)] p-4 text-white">
                    <div className="text-xs uppercase tracking-[0.22em] text-white/70">Feature requests</div>
                    <div className="mt-2 text-3xl font-semibold">{featureRequests.length}</div>
                    <div className="mt-2 text-sm text-white/80">Signals ready for recipe routing.</div>
                  </div>
                  <div className="rounded-[24px] bg-[linear-gradient(135deg,#f97316,#fb923c)] p-4 text-white">
                    <div className="text-xs uppercase tracking-[0.22em] text-white/70">Unanswered questions</div>
                    <div className="mt-2 text-3xl font-semibold">{unansweredQuestions}</div>
                    <div className="mt-2 text-sm text-white/80">Likely needs follow-up from advocates or support.</div>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[30px] border border-[color:var(--radar-line)] bg-white/82 p-5 shadow-sm backdrop-blur">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-display text-2xl font-semibold text-radar-ink">Feature request spotlight</h2>
                  <p className="mt-1 text-sm text-slate-600">Requests most ready for product routing.</p>
                </div>
                <div className="rounded-full bg-violet-50 px-3 py-1 text-sm font-semibold text-radar-purple">
                  {featureRequests.length}
                </div>
              </div>

              <div className="space-y-3">
                {featureRequests.length === 0 ? (
                  <div className="rounded-[24px] bg-slate-50 p-4 text-sm text-slate-600">
                    No feature requests match the current filters.
                  </div>
                ) : (
                  featureRequests.slice(0, 5).map((post) => {
                    const routeState = routeStatus[post.id] ?? "idle";
                    return (
                      <div key={post.id} className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div className="min-w-0 text-sm font-semibold text-slate-800">{post.author}</div>
                          <div className="text-xs text-slate-500">{formatRelativeTime(post.timestamp)}</div>
                        </div>
                        <p className="text-sm leading-6 text-slate-700">{truncateContent(post.content, 110)}</p>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <div className="text-xs uppercase tracking-[0.16em] text-slate-500">
                            {PLATFORM_LABELS[post.platform] ?? post.platform}
                          </div>
                          <button
                            type="button"
                            onClick={() => void routeToProduct(post)}
                            disabled={routeState === "sending" || routeState === "sent"}
                            className={[
                              "rounded-full px-3 py-2 text-sm font-semibold transition",
                              routeState === "sent"
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-slate-900 text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70",
                            ].join(" ")}
                          >
                            {routeState === "sending"
                              ? "Routing..."
                              : routeState === "sent"
                                ? "Routed"
                                : routeState === "error"
                                  ? "Retry Route"
                                  : "Route to Product"}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </aside>
        </main>
      </div>
    </div>
  );
}

export default App;
