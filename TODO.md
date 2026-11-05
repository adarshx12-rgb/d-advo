# To do: assets for the courtroom tabloid redesign

Drop the files in with **exactly these names**, then ask Claude to wire up anything marked *needs wiring*.

## 1. Font files

Folder: `apps/web/public/fonts/` (create it). Format: `.woff2` (web licence required).
These are picked up automatically through `@font-face` in `apps/web/app/globals.css`; no code change needed.

- [x] Headline font: replaced Druk with our own **Docket Gothic** (placeholder name), built from Big Shoulders Display (free licence) by `tools/fonts/build_display_font.py`. Rename it when the game name is final.
- [ ] `tiempos-headline-semibold.woff2` (Tiempos Headline Semibold, Klim)
- [ ] `tiempos-text-regular.woff2` (Tiempos Text Regular, Klim)
- [ ] `tiempos-text-regular-italic.woff2` (Tiempos Text Regular Italic, Klim)
- [ ] `soehne-buch.woff2` (Söhne Buch, Klim)
- [ ] `soehne-kraftig.woff2` (Söhne Kräftig, Klim)
- [ ] `soehne-halbfett.woff2` (Söhne Halbfett, Klim)
- [ ] `soehne-mono-buch.woff2` (Söhne Mono Buch, Klim)
- [ ] `soehne-mono-kraftig.woff2` (Söhne Mono Kräftig, Klim)

## 2. Images still to generate

Folder: `public/art/` at the repo root, same as before (Claude converts them to WebP into `apps/web/public/art/`).
Use the prompts from the earlier chat: style anchor first, black and white newsprint, one colour accent.

### Pack covers (tall, about 1024x1536, top 25% left blank for the title). *Needs wiring.*
- [ ] `pack-base.png` (Base Game)
- [ ] `pack-dark-humor.png` (Dark Humor)
- [ ] `pack-friendship-destroyer.png` (Friendship Destroyer)
- [ ] `pack-dating.png` (Dating & Relationships)
- [ ] `pack-anime-gaming.png` (Anime & Gaming)

### Store items (optional, same tall format). *Needs wiring.*
- [ ] `theme-neon-docket.png` (Neon Docket card theme)
- [ ] `theme-velvet-gavel.png` (Velvet Gavel card theme)
- [ ] `theme-tabloid.png` (Tabloid Scandal card theme)
- [ ] `theme-midnight-arcade.png` (Midnight Arcade card theme)
- [ ] `creator-streamer-branding.png` (Streamer Branding)
- [ ] `bundle-all-access.png` (All-Access Host Bundle)

### Pages. *Needs wiring.*
- [ ] `404.png`: black and white press photo of an empty witness stand with a knocked over chair, wide, transparent around the photo
- [ ] `og.png`: social share image, exactly 1200x630, tabloid front page with masthead and headline (the only image where generated text is fine)

### Textures (optional upgrade). *Needs wiring.*
The page and desk textures are currently generated in CSS. Real photos would add depth.
- [ ] `texture-newsprint.jpg`: seamless tileable off-white newsprint, fine fibres, faint halftone, no marks, square
- [ ] `texture-desk.jpg`: seamless tileable dark walnut desk top seen from above, soft warm light, no objects, square

## 3. Already done
- Courtroom hero, tall and empty versions, front page, 3 clippings
- 4 round photos, 11 stamps, 12 avatar stickers
- 4 chaos cards and the card back
- Evidence tag, sticky note, highlighter, tape
