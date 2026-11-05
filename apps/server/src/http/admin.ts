import { randomBytes } from "node:crypto";
import { z } from "zod";
import { PACK_IDS, PROMPT_MODES, SENSITIVE_TOPICS, type Prompt } from "@hps/shared";

export const promptInputSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9:-]{3,64}$/).optional(),
    packId: z.enum(PACK_IDS),
    mode: z.enum(PROMPT_MODES),
    question: z.string().trim().min(8).max(240),
    leftLabel: z.string().trim().min(1).max(40),
    rightLabel: z.string().trim().min(1).max(40),
    tags: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,24}$/)).max(8).default([]),
    contentRating: z.enum(["SAFE", "MATURE"]),
    streamSafe: z.boolean(),
    intensity: z.number().int().min(1).max(5),
    difficulty: z.number().int().min(1).max(3).default(2),
    enabled: z.boolean().default(true),
  })
  .superRefine((p, ctx) => {
    if (p.contentRating === "MATURE" && p.streamSafe) ctx.addIssue({ code: "custom", message: "Mature prompts can never be marked stream-safe.", path: ["streamSafe"] });
    if (p.packId === "base" && (p.contentRating === "MATURE" || !p.streamSafe)) {
      ctx.addIssue({ code: "custom", message: "Base Game prompts must be SAFE and stream-safe.", path: ["contentRating"] });
    }
    if (p.contentRating === "MATURE" && !p.tags.some((t) => (SENSITIVE_TOPICS as readonly string[]).includes(t))) {
      ctx.addIssue({ code: "custom", message: "Tag mature prompts with at least one topic (e.g. sex, alcohol, death) so players can hide them.", path: ["tags"] });
    }
  });

export type PromptInput = z.infer<typeof promptInputSchema>;

export function toPrompt(input: PromptInput, existingId?: string): Prompt {
  return {
    id: existingId ?? input.id ?? `${input.packId}:custom:${randomBytes(4).toString("hex")}`,
    packId: input.packId,
    mode: input.mode,
    question: input.question,
    leftLabel: input.leftLabel,
    rightLabel: input.rightLabel,
    tags: input.tags,
    contentRating: input.contentRating,
    streamSafe: input.streamSafe,
    intensity: input.intensity,
    difficulty: input.difficulty,
    language: "en",
    enabled: input.enabled,
  };
}

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** Converts CSV rows (with a header) into raw objects ready for promptInputSchema. */
export function csvToObjects(text: string): Record<string, unknown>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return rows.map((r) => {
    const o: Record<string, unknown> = {};
    keys.forEach((k, i) => {
      const v = (r[i] ?? "").trim();
      if (v === "") return;
      if (k === "tags") o[k] = v.split(/[;|]/).map((t) => t.trim()).filter(Boolean);
      else if (k === "streamSafe" || k === "enabled") o[k] = /^(true|1|yes)$/i.test(v);
      else if (k === "intensity" || k === "difficulty") o[k] = Number(v);
      else o[k] = v;
    });
    return o;
  });
}

export function validateRows(rows: unknown[]): { valid: PromptInput[]; errors: { row: number; message: string }[] } {
  const valid: PromptInput[] = [];
  const errors: { row: number; message: string }[] = [];
  rows.forEach((r, i) => {
    const res = promptInputSchema.safeParse(r);
    if (res.success) valid.push(res.data);
    else errors.push({ row: i + 1, message: res.error.issues.map((x) => `${x.path.join(".") || "row"}: ${x.message}`).join("; ") });
  });
  return { valid, errors };
}
