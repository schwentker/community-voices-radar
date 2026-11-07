import { entitySchema, type Entity, type EntityInput } from "./schema.js";

// Starter packs. Applying one upserts its entities; it never deletes yours.
// Aliases and subreddits are a starting point: run a dry-run preview and tune.

export interface Preset {
  id: string;
  name: string;
  description: string;
  entities: Entity[];
}

const COMMERCE_PAIN = ["checkout", "payments", "app review", "theme", "webhook", "rate limit", "fees"];
const STOCK_NOISE = ["stock", "shares", "earnings", "dividend"];

const SHOPIFY: EntityInput = {
  id: "shopify",
  name: "Shopify",
  role: "primary",
  aliases: ["shopify plus", "shopify hydrogen", "shopify polaris", "shopify functions", "shopify app"],
  exclude: STOCK_NOISE,
  sources: { reddit: { subreddits: [] }, discourse: { forums: [] } },
  painKeywords: [...COMMERCE_PAIN, "api version", "liquid"],
  color: "#008060",
};

const COMPETITORS: EntityInput[] = [
  {
    id: "bigcommerce",
    name: "BigCommerce",
    role: "competitor",
    exclude: STOCK_NOISE,
    painKeywords: COMMERCE_PAIN,
    color: "#34313f",
  },
  {
    id: "woocommerce",
    name: "WooCommerce",
    role: "competitor",
    aliases: ["woo commerce"],
    painKeywords: [...COMMERCE_PAIN, "plugin"],
    color: "#7f54b3",
  },
  {
    id: "wix",
    name: "Wix",
    role: "competitor",
    aliases: ["wix ecommerce", "wix stores"],
    exclude: STOCK_NOISE,
    painKeywords: COMMERCE_PAIN,
    color: "#116dff",
  },
  {
    id: "squarespace",
    name: "Squarespace",
    role: "competitor",
    aliases: ["squarespace commerce"],
    painKeywords: COMMERCE_PAIN,
    color: "#e5a000",
  },
];

const MCP_BUILDERS: EntityInput = {
  id: "mcp",
  name: "Model Context Protocol",
  role: "primary",
  aliases: ["mcp server", "mcp client"],
  painKeywords: ["auth", "oauth", "transport", "timeout", "rate limit"],
  color: "#6b4fbb",
};

function build(entities: EntityInput[]): Entity[] {
  return entities.map((entity) => entitySchema.parse(entity));
}

export const PRESETS: Preset[] = [
  {
    id: "shopify",
    name: "Shopify",
    description: "Shopify only.",
    entities: build([SHOPIFY]),
  },
  {
    id: "shopify-competitors",
    name: "Shopify + competitors",
    description: "Shopify vs BigCommerce, WooCommerce, Wix, Squarespace.",
    entities: build([SHOPIFY, ...COMPETITORS]),
  },
  {
    id: "mcp-builders",
    name: "MCP builders",
    description: "The original demo topic.",
    entities: build([MCP_BUILDERS]),
  },
];

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}
