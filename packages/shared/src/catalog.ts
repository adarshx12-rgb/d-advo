import type { PackId } from "./content";

/**
 * Approved store catalog. All prices are integer paise (INR minor units).
 * This is the single source of truth: the server looks prices up here (or in the
 * database rows seeded from here) and never trusts a client-supplied amount.
 */

export type ProductKind = "CONTENT_PACK" | "COSMETIC_THEME" | "CREATOR" | "BUNDLE";

export interface CatalogProduct {
  id: string;
  kind: ProductKind;
  name: string;
  tagline: string;
  description: string;
  /** Integer paise. `null` means the price is not finalized and the product cannot be bought. */
  pricePaise: number | null;
  currency: "INR";
  published: boolean;
  /** Content pack this product unlocks, if any. */
  packId?: PackId;
  /** Cosmetic theme id this product unlocks, if any. */
  themeId?: string;
  /** Product ids granted when this bundle is purchased. */
  bundleProductIds?: string[];
  /** Visual accent for styled placeholder cover art. */
  accent: "violet" | "cyan" | "amber" | "rose" | "teal";
}

export const CARD_THEMES = [
  { id: "classic", name: "House Classic", pricePaise: 0, description: "The default card face." },
  { id: "neon-docket", name: "Neon Docket", pricePaise: 4900, description: "Cyan line-art court stamps." },
  { id: "velvet-gavel", name: "Velvet Gavel", pricePaise: 9900, description: "Deep violet velvet with gold-foil edges." },
  { id: "tabloid", name: "Tabloid Scandal", pricePaise: 14900, description: "Halftone newsprint with headline stamps." },
  { id: "midnight-arcade", name: "Midnight Arcade", pricePaise: 19900, description: "Pixel borders and a gentle CRT glow." },
] as const;
export type CardThemeId = (typeof CARD_THEMES)[number]["id"];

export const CATALOG: CatalogProduct[] = [
  {
    id: "pack-base",
    kind: "CONTENT_PACK",
    name: "Base Game",
    tagline: "Everything you need for a full show.",
    description:
      "Sixty original prompts across every mode: spectrum questions, courtroom propositions, bluff setups and finale showdowns. Stream-safe and free forever.",
    pricePaise: 0,
    currency: "INR",
    published: true,
    packId: "base",
    accent: "violet",
  },
  {
    id: "pack-dark-humor",
    kind: "CONTENT_PACK",
    name: "Dark Humor",
    tagline: "Grim, funny, and still stream-safe by default.",
    description:
      "Funerals, curses, haunted roommates and the afterlife's customer service. Mature prompts stay locked unless the host and every player opt in.",
    pricePaise: 9900,
    currency: "INR",
    published: true,
    packId: "dark-humor",
    accent: "rose",
  },
  {
    id: "pack-friendship-destroyer",
    kind: "CONTENT_PACK",
    name: "Friendship Destroyer",
    tagline: "Say what you actually think about your friends.",
    description:
      "Group chats, borrowed money, plus-ones and unforgivable spoilers. Built to start arguments you will laugh about later.",
    pricePaise: 14900,
    currency: "INR",
    published: true,
    packId: "friendship-destroyer",
    accent: "amber",
  },
  {
    id: "pack-dating",
    kind: "CONTENT_PACK",
    name: "Dating & Relationships",
    tagline: "Red flags, green flags, and the beige ones.",
    description:
      "First dates, texting etiquette, exes and the great shared-password debate. Adult relationship prompts are opt-in only.",
    pricePaise: 14900,
    currency: "INR",
    published: true,
    packId: "dating",
    accent: "rose",
  },
  {
    id: "pack-anime-gaming",
    kind: "CONTENT_PACK",
    name: "Anime & Gaming",
    tagline: "Fandom court is now in session.",
    description:
      "Filler arcs, speedrun ethics, gacha regret and whether the dub is ever better. Original prompts, no franchise spoilers.",
    pricePaise: 14900,
    currency: "INR",
    published: true,
    packId: "anime-gaming",
    accent: "cyan",
  },
  ...CARD_THEMES.filter((t) => t.pricePaise > 0).map(
    (t): CatalogProduct => ({
      id: `theme-${t.id}`,
      kind: "COSMETIC_THEME",
      name: `${t.name} card theme`,
      tagline: "Cosmetic only. Changes how your Chaos Cards look, never what they do.",
      description: t.description,
      pricePaise: t.pricePaise,
      currency: "INR",
      published: true,
      themeId: t.id,
      accent: "rose",
    }),
  ),
  {
    id: "creator-streamer-branding",
    kind: "CREATOR",
    name: "Streamer Branding",
    tagline: "Your logo and colours on the show.",
    description:
      "Upload a room logo, set overlay accent colours, customise the lobby header and brand the results screen.",
    pricePaise: 29900,
    currency: "INR",
    published: true,
    accent: "teal",
  },
  {
    id: "bundle-all-access",
    kind: "BUNDLE",
    name: "All-Access Host Bundle",
    tagline: "Every pack and creator feature in one purchase.",
    description: "Pricing and included cosmetics are still being finalised.",
    pricePaise: null,
    currency: "INR",
    published: false,
    bundleProductIds: [
      "pack-dark-humor",
      "pack-friendship-destroyer",
      "pack-dating",
      "pack-anime-gaming",
      "creator-streamer-branding",
    ],
    accent: "violet",
  },
];

export function findProduct(id: string): CatalogProduct | undefined {
  return CATALOG.find((p) => p.id === id);
}

export function productForPack(packId: PackId): CatalogProduct | undefined {
  return CATALOG.find((p) => p.kind === "CONTENT_PACK" && p.packId === packId);
}

export function isPurchasable(p: CatalogProduct): boolean {
  return p.published && p.pricePaise !== null && p.pricePaise > 0;
}

export function formatInr(paise: number | null): string {
  if (paise === null) return "Coming soon";
  if (paise === 0) return "Free";
  const rupees = paise / 100;
  return `₹${Number.isInteger(rupees) ? rupees.toString() : rupees.toFixed(2)}`;
}
