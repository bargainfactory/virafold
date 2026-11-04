# Render Recipe — Canonical Chapters (locked)

The one way every canonical episode renders. Deviations are deliberate and noted.

## Chapter defaults
- **Format**: landscape (16:9), 8–12 minutes (script 1,400–2,100 words).
- **Animation**: level 2 (full motion, lite model) with **Omni Flash reserved
  for the premium hero beats** the engine already selects (dolly, blooms,
  cast-referenced close-ups) — in chapters that means roughly 2–4 Omni shots.
- **Style**: `bold` captions, `cartoon` vstyle, fireside trio as persona cast.
- **Budget target**: ~$10–15 per chapter all-in (voice + paint + motion).
  Season 1 (6 chapters) ≈ $60–90. The full 53-chapter arc ≈ $550–800.
  Extended tellings (the Abraham/Isaac/Jacob features) are the deluxe format
  at $40–60 and are produced only by explicit decision.

## Pipeline per episode (locked order)
1. Write from the outline + bible + cast book, using template tokens
   ({{LITURGY}}, {{HOOK}}, {{VIGNETTE:object}}, {{THREAD:era}}).
2. `node tools/expand-templates.mjs <script>` — expand + lint (must pass).
3. `node /home/echoforge/brain-trust.mjs <script>` — must be READY, or one
   revision addressing the top fixes, then re-run.
4. Queue (landscape, animate 2). The engine runs: registry/plates → QA gate →
   motion (Omni heroes) → grades → foley/motifs/leitmotifs → splice → publish kit.
5. Operator review on the Clips tab (tap-to-flag anything).
6. `node tools/master-pass.mjs <clipId>` — the GPU master before publishing.

## The Register
Reset to 0 at the start of the canonical numbering: each S#E## chapter adds
its star at render. (The pre-canon features kept their own count era.)

## Episode thumbnail template (locked)
One composition for feed recognition: the episode's single most shareable
frame fills the card; the lamp mark bottom-left; the Thread as a thin gold
line entering from frame-left; episode code (S1E03) small, top-right, in the
title-card font. Dark vignette edges. No other text.
