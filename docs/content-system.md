# Content system

## Packs and prompts

| Pack | Price | Prompts | Notes |
| --- | --- | --- | --- |
| Base Game | Free | 60 (24 spectrum, 14 debate, 12 bluff, 10 finale) | Always SAFE and stream-safe; cannot be disabled |
| Dark Humor | ₹99 | 40 (30 safe + 10 mature) | |
| Friendship Destroyer | ₹149 | 40 (30 safe + 10 mature) | |
| Dating & Relationships | ₹149 | 40 (30 safe + 10 mature) | |
| Anime & Gaming | ₹149 | 40 (30 safe + 10 mature) | |

That makes 220 original prompts, which live in `packages/content/src/packs/*.ts`. IDs are stable and append-only: `<pack>:<sp|db|bl|fn>:<nn>`. Never renumber or reuse an ID, because match history refers to them. The seed upserts prompts using `skipDuplicates`, so re-running it is safe.

Each prompt carries:

- `mode`: SPECTRUM, DEBATE, BLUFF or FINALE
- question and the two end labels
- `tags`
- `contentRating`: SAFE or MATURE
- `streamSafe`
- `intensity` (1–5)
- `difficulty`
- `enabled`

## Filtering, which always happens on the server

`buildEligiblePool` runs `checkPrompt` against the room's filter context before a match starts, and again whenever consent changes mid-match through `UPDATE_POOL`. Disallowed prompts never enter the match state, so they can never be sent to a client.

A prompt is excluded when any of these is true:

1. Its pack isn't enabled in the room, isn't owned by the host, or has been switched off by an admin.
2. It is disabled.
3. It is **adult** (MATURE or not stream-safe), unless **all** of the following hold:
   - the host turned on that pack's 18+ switch (default **OFF**; Base Game can never be switched on),
   - **every** current player opted in to adult content,
   - **every** current player confirmed they are 18+,
   - streamer mode is off.
4. Its tags include a topic the room blocks, or a topic any current player chose to hide. Hidden topics are pooled anonymously.
5. Its intensity is above the room's maximum.

A late joiner who hasn't consented immediately turns adult content off again. Store previews only ever show safe prompts.

When the filters leave too few prompts for a mode, the engine falls back to the safe Base Game pool for that mode (`safeFallbackPool`), so the match can always continue.

## Sensitive topics

`SENSITIVE_TOPICS` in `packages/shared/src/content.ts` lists the topics players can hide and hosts can block. Every mature prompt must carry at least one of them. The admin validator enforces this.

## Admin tools (`/admin`)

- Search and filter prompts by pack, mode or rating; edit them, or enable and disable them.
- Create new prompts. Validation rejects:
  - mature prompts marked stream-safe,
  - Base Game prompts that are not SAFE,
  - mature prompts without a sensitive-topic tag.
- **Bulk import** from CSV or JSON. Run **Validate** first: it reports per-row errors and writes nothing. **Import** refuses to run while any row is invalid.
  - CSV columns: `packId,mode,question,leftLabel,rightLabel,tags,contentRating,streamSafe,intensity`, with tags separated by `;`.
- Switch whole packs off (except Base Game).
- Work through the report queue that players fill using "Report this prompt": mark reports reviewed, actioned or dismissed.

Changes take effect for matches started after the change. The prompt cache refreshes on every admin write.
