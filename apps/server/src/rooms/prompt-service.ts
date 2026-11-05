import type { PackId, Prompt } from "@hps/shared";
import { isAdultPrompt } from "@hps/content";
import type { PackRecord, Persistence } from "../persistence/types";

/** Read-through cache of prompts and admin pack switches. Refreshed after every admin edit. */
export class PromptService {
  private prompts: Prompt[] = [];
  private packs: PackRecord[] = [];

  constructor(private readonly db: Persistence) {}

  async refresh(): Promise<void> {
    [this.prompts, this.packs] = await Promise.all([this.db.listPrompts(), this.db.listPacks()]);
  }

  /** Prompts from packs an administrator has not disabled. Room-level filtering happens on top of this. */
  available(): Prompt[] {
    const disabled = new Set(this.packs.filter((p) => !p.enabled).map((p) => p.id));
    return this.prompts.filter((p) => !disabled.has(p.packId));
  }

  packEnabled(id: PackId): boolean {
    return this.packs.find((p) => p.id === id)?.enabled ?? true;
  }

  counts(packId: PackId): { safe: number; mature: number } {
    let safe = 0;
    let mature = 0;
    for (const p of this.prompts) {
      if (p.packId !== packId || !p.enabled) continue;
      if (isAdultPrompt(p)) mature++;
      else safe++;
    }
    return { safe, mature };
  }

  /** A few stream-safe prompts for the store preview. Never includes adult prompts. */
  preview(packId: PackId, n: number): Prompt[] {
    const safe = this.prompts.filter((p) => p.packId === packId && p.enabled && !isAdultPrompt(p));
    const byMode = ["SPECTRUM", "DEBATE", "BLUFF", "FINALE"].map((m) => safe.filter((p) => p.mode === m));
    const out: Prompt[] = [];
    for (let i = 0; out.length < n && i < 20; i++) for (const list of byMode) if (list[i] && out.length < n) out.push(list[i]!);
    return out;
  }
}
