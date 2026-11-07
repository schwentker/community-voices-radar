import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { entitySchema, settingsSchema } from "../src/config/schema.js";
import { findPreset } from "../src/config/presets.js";
import { buildRedditQuery, matchEntities } from "../src/config/query.js";
import { inferIntent } from "../src/config/classify.js";
import { entitiesFromEnv } from "../src/store/seed.js";
import { MemoryStore } from "../src/store/memory.js";
import { isWeeklyScanDue, runScan } from "../src/scan.js";

const shopify = entitySchema.parse({
  id: "shopify",
  name: "Shopify",
  aliases: ["shopify plus"],
  exclude: ["stock"],
});

test("derives a Reddit query from name, aliases, excludes, subreddits", () => {
  assert.equal(buildRedditQuery(shopify), '(Shopify OR "shopify plus") NOT stock');
  const scoped = entitySchema.parse({ ...shopify, sources: { reddit: { subreddits: ["shopify", "ecommerce"] } } });
  assert.equal(buildRedditQuery(scoped), '(Shopify OR "shopify plus") NOT stock (subreddit:shopify OR subreddit:ecommerce)');
});

test("manual query override wins", () => {
  const custom = entitySchema.parse({ ...shopify, sources: { reddit: { query: "title:shopify" } } });
  assert.equal(buildRedditQuery(custom), "title:shopify");
});

test("matches entities on word boundaries and honors excludes", () => {
  const woo = entitySchema.parse({ id: "woocommerce", name: "WooCommerce", role: "competitor" });
  const all = [shopify, woo];
  assert.deepEqual(matchEntities("Moving from WooCommerce to Shopify, tips?", all), ["shopify", "woocommerce"]);
  assert.deepEqual(matchEntities("Shopify stock is up today", all), []);
  assert.deepEqual(matchEntities("shopifyish things", all), []);
});

test("rejects unsafe or malformed entities", () => {
  assert.equal(entitySchema.safeParse({ id: "Bad Id", name: "x" }).success, false);
  assert.equal(
    entitySchema.safeParse({ id: "x", name: "x", sources: { discourse: { forums: ["http://insecure.example"] } } }).success,
    false,
  );
  assert.equal(entitySchema.safeParse({ id: "x", name: "x", sources: { reddit: { subreddits: ["a b"] } } }).success, false);
});

test("classifies intent with per-company pain keywords", () => {
  assert.equal(inferIntent("Would love a bulk export", ""), "feature_request");
  assert.equal(inferIntent("How do I set up checkout?", ""), "question");
  assert.equal(inferIntent("Checkout fees keep climbing", "", ["fees"]), "integration_pain");
  assert.equal(inferIntent("Shipped my store today", ""), "discussion");
});

test("seeds one default entity from the old env vars", () => {
  assert.deepEqual(entitiesFromEnv({}), []);
  const [seeded] = entitiesFromEnv({ REDDIT_SEARCH_QUERY: "mcp server", DISCOURSE_BASE_URLS: "https://forum.example.com/" });
  assert.equal(seeded?.id, "default");
  assert.equal(seeded?.sources.reddit.query, "mcp server");
  assert.deepEqual(seeded?.sources.discourse.forums, ["https://forum.example.com"]);
});

test("Shopify + competitors preset is valid", () => {
  const preset = findPreset("shopify-competitors");
  assert.ok(preset);
  assert.equal(preset.entities.filter((entity) => entity.role === "primary").length, 1);
  assert.ok(preset.entities.length >= 4);
});

test("weekly scan is due Sunday at or after the hour, once", () => {
  const schedule = settingsSchema.parse({}).weeklyScan; // Sunday 9:00 America/Los_Angeles
  const sunday10amPt = new Date("2026-11-08T18:00:00Z");
  const sunday8amPt = new Date("2026-11-08T16:00:00Z");
  const monday = new Date("2026-11-09T18:00:00Z");
  assert.equal(isWeeklyScanDue(sunday10amPt, schedule, null), true);
  assert.equal(isWeeklyScanDue(sunday8amPt, schedule, null), false);
  assert.equal(isWeeklyScanDue(monday, schedule, null), false);
  assert.equal(isWeeklyScanDue(sunday10amPt, schedule, new Date("2026-11-08T17:15:00Z")), false);
  assert.equal(isWeeklyScanDue(sunday10amPt, schedule, new Date("2026-11-01T17:15:00Z")), true);
  assert.equal(isWeeklyScanDue(sunday10amPt, { ...schedule, enabled: false }, null), false);
});

test("scan fetches per entity, tags cross-mentions, persists, records run", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cvr-"));
  const store = new MemoryStore(join(dir, "watchlist.json"));
  await store.init();
  for (const entity of findPreset("shopify-competitors")!.entities) await store.upsertEntity(entity);

  const requested: string[] = [];
  const fakeFetch = async (url: string) => {
    requested.push(url);
    const q = new URL(url).searchParams.get("q") ?? "";
    const children = q.includes("Shopify")
      ? [{ data: { id: "a1", title: "Shopify vs WooCommerce for a small shop?", created_utc: 1_794_000_000, score: 3, num_comments: 2 } }]
      : [];
    return new Response(JSON.stringify({ data: { after: null, children } }), { status: 200 });
  };

  const run = await runScan(store, "manual", { fetchImpl: fakeFetch, delayMs: 0 });
  assert.equal(run.status, "ok");
  assert.equal(requested.length, 5);
  assert.equal(run.stats["shopify"]?.stored, 1);

  const woo = await store.listPosts({ entity: "woocommerce" });
  assert.equal(woo.length, 1);
  assert.deepEqual(woo[0]?.entities.sort(), ["shopify", "woocommerce"]);
  assert.equal(woo[0]?.type, "question");

  const [lastRun] = await store.listScanRuns(1);
  assert.equal(lastRun?.id, run.id);

  const saved = JSON.parse(await readFile(join(dir, "watchlist.json"), "utf8")) as { entities: unknown[] };
  assert.equal(saved.entities.length, 5);
});
