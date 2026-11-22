# Design Brief

## Direction

Tournament Hall, Six Moods — one chess product in six switchable themes, framed by two branding buffer bands (top wordmark + bottom tagline) that re-skin per theme as future advertising space.

## Tone

Light is simple elegant (cream band, hairline rule), dark is Gothic moody ornate (recessed slate, double antique-gold rule, tracked uppercase), neon is 80s synthwave (cyan→magenta gradient rule, neon-tube wordmark glow). Fire is a warm ember palette on a dark background, water is a cool deep-blue palette on a dark background, and bubblegum is a soft pastel pink + sky-blue light theme.

## Differentiation

The same two buffer bands and the same window stack project six fully-committed identities — refined, carved, neon-lit, smoldering, submerged, and confectionary — purely through OKLCH tokens and `.dark` / `.dark-neon` / `.theme-fire` / `.theme-water` / `.theme-bubblegum`-scoped utilities, with zero component branching.

## Color Palette

| Token          | Light OKLCH    | Dark OKLCH      | Neon OKLCH       | Role                              |
| -------------- | -------------- | --------------- | ---------------- | --------------------------------- |
| buffer-bg      | 0.92 0.03 85   | 0.18 0.015 120  | 0.12 0.03 290    | Buffer band surface               |
| buffer-fg      | 0.25 0.01 120  | 0.82 0.03 85    | 0.92 0.06 200    | Wordmark + tagline text           |
| buffer-rule    | 0.5 0.1 130    | 0.62 0.06 75    | 0.82 0.15 200    | Hairline / gradient rule          |
| buffer-accent  | 0.5 0.1 130    | 0.62 0.06 75    | 0.72 0.2 320     | Secondary accent (magenta in neon)|
| background     | 0.97 0.005 120 | 0.22 0.01 120   | 0.14 0.02 280    | App canvas                        |
| card           | 0.92 0.03 85   | 0.28 0.02 120   | 0.18 0.03 280    | Board + panels                    |

Fire, water, and bubblegum each define their own `--buffer-*` values in their theme block (fire: warm ember band; water: deep-water band; bubblegum: pastel pink band with a sky-blue rule).

## Typography

- Display: Space Grotesk — wordmark (top buffer), tracked uppercase
- Body: DM Sans — tagline in light mode
- Mono: JetBrains Mono — tagline in dark + neon modes (quiet technical footer)
- Wordmark scale: text-xl/text-2xl, letter-spacing 0.18em (light) / 0.32em (dark gothic) / 0.18em (neon)
- Tagline scale: text-xs, letter-spacing 0.04em (light) / 0.08em (dark/neon)

## Elevation & Depth

Light buffers are flat cream with a single hairline; dark buffers recess below the card via a deeper slate surface and a carved double-rule inset shadow; neon buffers sit on near-black purple with a static cyan→magenta gradient hairline and layered text-shadow glow. Fire and water buffers are recessed warm/cool dark bands with a single hairline rule and no glow; bubblegum is a flat pastel band with a single sky-blue rule.

## Structural Zones

| Zone            | Light                  | Dark                              | Neon                              |
| --------------- | ---------------------- | --------------------------------- | --------------------------------- |
| Top buffer      | bg-buffer hairline rule| bg-buffer double antique-gold rule| bg-buffer gradient rule + glow    |
| Board + panels  | bg-card                | bg-card                           | bg-card + neon piece glow         |
| Bottom buffer   | bg-buffer hairline rule| bg-buffer double antique-gold rule| bg-buffer gradient rule + glow    |

## Spacing & Rhythm

Top buffer fixed 4.5rem (~72px), bottom buffer fixed 4rem (~64px); both `shrink-0` inside the existing `flex flex-col gap-2 p-2` stack within `mx-auto max-w-[700px]`; scroll with page (no sticky/fixed).

## Component Patterns

- Buffers: `.brand-buffer` base + `.brand-buffer-top` / `.brand-buffer-bottom` height/flex modifiers
- Wordmark: `.brand-wordmark` (display, tracked uppercase); `.dark` widens tracking to 0.32em for Gothic ornament
- Tagline: `.brand-tagline` (small, muted); mono in dark/neon, body in light
- All colors via `oklch(var(--buffer-*))` — no raw literals in components

## Motion

- Theme switch: inherits the existing 250ms html/body fade (buffers re-theme automatically)
- Hover: none on buffers (non-interactive branding space)
- Decorative: static neon wordmark glow only — NO animated synthwave grid (out of scope)

## Constraints

- Frontend-only — no backend changes; Board, pieces, coordinates, modal, OISY, capture sound, chat, players, moves, timer, log out untouched
- Buffers scroll with the page (not sticky/fixed), inside the centered max-w-[700px] column
- Dark mode stays glow-free (Gothic ornament via double-rule inset shadow, not neon)
- No new fonts; no new keyframes for the buffers (glow is static box-shadow/text-shadow)
- No real ad slot rendering, no animated synthwave grid background

## Signature Detail

The neon buffer's cyan→magenta gradient hairline paired with a layered cyan+magenta text-shadow wordmark glow — a static synthwave sign that frames the board without an animated grid, reusing the same `.dark-neon`-scoped utility pattern as the piece glows.

## Oisy Burn Panel (isolated module)

Self-contained NFT-burn panel that connects to the Oisy wallet and burns NFTs one token at a time. Fully isolated from the existing mint UI: every class is `.oisy-burn-*`, every token is `--burn-*` / `--oisy-*`. Delete the CSS block, the `--burn-accent` token line, this section, and the component module set to remove the feature cleanly.

### Connected vs disconnected states

- Connect chip (`.oisy-burn-connect`) reflects wallet state via `data-connected`
- Disconnected (`data-connected="false"`): ember-tinted chip, clickable to connect
- Connected (`data-connected="true"`): ember-tinted chip showing the truncated principal plus a `.oisy-burn-disconnect` action in the destructive hue
- Connection does NOT persist across refreshes (per doNotBuild)

### NFT list item layout

- `.oisy-burn-nft-item` row: 2.5rem thumbnail + name (truncate) + per-token result + burn button
- Row border lifts to `--burn-accent` on hover so each row reads as a burn target
- One burn per row — NO batch-burn-all in a single approval (per doNotBuild)

### Burn button states (`.oisy-burn-button[data-state]`)

| State    | Surface                  | Motion                          |
| -------- | ------------------------ | ------------------------------- |
| idle     | `--burn-accent` ember    | none                            |
| burning  | ember @ 55% + disabled   | none (static)                   |
| success  | `--burn-accent` ember    | none (static)                   |
| error    | `--destructive` red      | none; hover returns to ember    |

### Per-token result indicators (`.oisy-burn-result`)

- Hidden in idle; shown for burning/success/error via item `data-state`
- burning: muted-foreground mono; success: `--burn-accent` ember; error: `--destructive` red
- Per-token feedback so a multi-token burn shows individual outcomes, not a single batch result

### Visual separation from mint UI

- 2px `--burn-accent` top border on `.oisy-burn-panel` frames it as a distinct destructive-action zone
- Burn accent hue 45 (ember/orange) is a different family from `--destructive` (25, close buttons) and `--accent` (85, exercise/opening amber)
- Neon mode adds an ember glow on the panel + connect chip (`.dark-neon`-scoped) — distinct from cyan/magenta piece + buffer glows so the burn keeps its ember identity

### Isolation contract

- Tokens: `--burn-accent` in the `:root` block
- Keyframes: `oisy-burn-backdrop-in` and `oisy-burn-modal-in` in index.css (with `prefers-reduced-motion` override)
- CSS: the `=== Oisy Burn NFTs Feature ===` block at the end of index.css
- Removing all of the above leaves the mint UI, board, and every other feature untouched

## Theme-Aware Window Headings

Fix for window titles (Captured, Move History, Player List, Wallet Connection, Move Maker Indicator, Prediction Bet) that were invisible on the wrong theme — white text on light cards, dark text on dark cards.

- New `--heading` token in all six theme blocks, resolving to the high-contrast foreground per theme (dark on light themes, light on dark themes):

| Theme       | --heading OKLCH |
| ----------- | --------------- |
| light       | 0.25 0.01 120   |
| dark        | 0.92 0.02 85    |
| dark-neon   | 0.95 0.01 250   |
| fire        | 0.92 0.02 60    |
| water       | 0.92 0.015 220  |
| bubblegum   | 0.28 0.02 280   |

- `.window-heading` utility in `@layer utilities`: `color: oklch(var(--heading))` + `font-family: var(--font-display)` — the single handoff class applied to every window heading; replaces the old `font-display text-sm font-semibold text-foreground` pattern.
- Frontend applies `.window-heading` to each window title; design owns only the token + utility (component edits are a parallel task).

## Prediction Bet Window (documentation only)

Informational window in the fixed window stack alongside board, captured, wallet, players, moves. Documents the desired outcome of the real ICP prediction betting feature — NOT implemented (no betting, wallet, or ICP ledger logic).

- Reuses the existing `.window-card` surface + `.window-heading` title; no new tokens or surfaces.
- Content: plain-language requirements — predict game outcomes (win/loss/draw), stake ICP via a linked wallet, 5% platform fee on winning pots, payouts resolved via smart contracts on final game status, 18+ / beta rules.
- Reachable in the fixed window order; purely readable documentation.

## Phase 2 — Bet Approval / Allowance Flow (additive)

Extends the existing PredictionBetWindow BettingPanel. No new visual system — reuses the `.window-card` / `.window-heading` surfaces and the existing `--primary` CTA. Adds a self-contained `--approval-*` token set (all six theme blocks) + four `.approval-*` utilities for the three new states.

### States

| State | Surface | Token | Meaning |
| ----- | ------- | ----- | ------- |
| Approval missing | `.approval-warning` (amber) | `--approval-warning[-foreground]` | "You haven't approved JEL yet" — block relay until `icrc2_approve` |
| Allowance verified | `.approval-verified` (green chip) | `--approval-success`, `--approval-verified-bg/border` | `icrc2_allowance` confirms spender = JEL; UX convenience only |
| Relay confirmation | `.approval-relay` (primary) | `--primary` / `--primary-foreground` | Real bet relay via JEL; confirm action |
| Relay in progress | `.approval-spin` (spinner) | `--approval-success` accent | Non-blocking progress indicator |

### Rules

- Green success (hue 150) is a hue family unused by any existing board overlay / feature accent — "allowance OK" reads distinctly from amber exercise and red destructive.
- The allowance check is a UX convenience; JEL remains the authoritative gate at `icrc2_transfer_from`. The `approval_confirmed` flag is only intent, never the security gate.
- All colors via `oklch(var(--approval-*))` — no raw literals. Reduced-motion stops the spinner.

### Isolation contract

- Tokens: `--approval-warning[-foreground]`, `--approval-success[-foreground]`, `--approval-verified-bg`, `--approval-verified-border` in all six theme blocks.
- CSS: the `Bet approval flow utilities` block + `approval-spin` keyframe in `@layer utilities`.
- Removing all of the above leaves the existing approve button, board, and every other feature untouched.

## Bet Flow Walkthrough (additive)

Interactive step-by-step betting-flow walkthrough inside the Prediction Bet info panel. Renders the authoritative bet + settlement flow as a numbered stage rail with next/back progression, highlighting the active stage as the user reads it. Preserves the existing info-panel content (title, HOW IT WORKS bullets, WORKED EXAMPLE) alongside the new flow.

### Direction

"Bet Flow Ledger" — the walkthrough reads like a settlement ledger / escrow flow, using a dedicated coin-gold accent (hue ~90) distinct from every existing feature accent (exercise amber 85, drinking grape 330, burn ember 45, advice violet 290, approval amber 65 / green 150).

### Flow tokens (all six theme blocks)

| Token | Light | Dark | Neon | Fire | Water | Bubblegum | Role |
| ----- | ----- | ---- | ---- | ---- | ----- | --------- | ---- |
| flow-active | 0.6 0.14 90 | 0.72 0.14 90 | 0.8 0.16 90 | 0.72 0.16 50 | 0.72 0.13 90 | 0.68 0.13 90 | Active stage + progress fill |
| flow-active-foreground | 0.97 0.005 120 | 0.22 0.01 120 | 0.14 0.02 280 | 0.2 0.015 35 | 0.16 0.03 240 | 0.97 0.012 350 | Text on active stage |
| flow-step | 0.88 0.02 100 | 0.32 0.02 120 | 0.24 0.04 290 | 0.32 0.03 35 | 0.32 0.035 240 | 0.9 0.02 340 | Inactive step circle |
| flow-connector | 0.82 0.03 100 | 0.45 0.02 120 | 0.4 0.06 290 | 0.45 0.03 40 | 0.45 0.03 240 | 0.8 0.02 340 | Joining line |
| flow-progress | 0.6 0.14 90 | 0.72 0.14 90 | 0.8 0.16 90 | 0.72 0.16 50 | 0.72 0.13 90 | 0.68 0.13 90 | Progress bar fill |

### Layout

- Portrait (default): `.flow-rail` is a column — steps stack top-to-bottom, each step a row (circle left + horizontal connector right).
- Landscape: `@media (orientation: landscape)` flips `.flow-rail` to a row — steps run left-to-right, each step a column (circle top + vertical connector below). Orientation handled purely by CSS; one markup shape for both.

### States (`.flow-step[data-state]`)

| State | Dot | Meaning |
| ----- | --- | ------- |
| upcoming | muted circle (`.flow-step`) | Not yet reached |
| active | gold surface + 3px ring + scale | Current stage being read |
| done | gold fill + check glyph | Completed stage |

### Rules

- Active stage gold (hue ~90) is a hue family unused by any existing board overlay / feature accent — "current betting step" reads distinctly from amber exercise and green approval.
- All colors via `oklch(var(--flow-*))` — no raw literals. `prefers-reduced-motion` drops the body entrance + active scale.
- e8s amounts rendered in mono `.flow-body-rule` lines; natural numbers use the e8s number when referring to an amount.

### Isolation contract

- Tokens: `--flow-active[-foreground]`, `--flow-step`, `--flow-connector`, `--flow-progress` in all six theme blocks.
- Config: `flow-active` boxShadow + `flow-pulse` keyframe/animation in tailwind.config.js.
- CSS: the `Bet Flow Walkthrough Feature` block in `@layer utilities`.
- Removing all of the above leaves the info panel, board, and every other feature untouched.

## NFT Grid Card Rebalance (additive)

Rebalances the `.oisy-burn-nft-item` grid card so the spell name is the dominant headline and the artwork is demoted to a compact thumbnail. No new tokens — reuses `--heading`, `--card`, `--muted-foreground`, `--burn-accent`.

### Card hierarchy (top → bottom in the text stack)

| Element | Class | Treatment |
| ------- | ----- | --------- |
| Spell name (headline) | `.oisy-burn-nft-item-name` | display font, 0.875rem, weight 700, `--heading`, up to 2 lines |
| Game number | `.oisy-burn-nft-item-game` | mono, 0.6875rem, weight 600, `--card-foreground` @ 85%, tabular |
| Token number | `.oisy-burn-nft-item-token` | mono, 0.625rem, `--muted-foreground` (quiet reference line) |

### Layout

- `.oisy-burn-nft-item` is a horizontal flex row: `.oisy-burn-nft-thumb` (2.25rem compact chip) + `.oisy-burn-nft-meta` (vertical text stack) + burn button.
- `.oisy-burn-nft-thumb` replaces the old large square: fixed 2.25rem, hairline border, `--muted` fill, `object-fit: cover` artwork.
- `.oisy-burn-nft-meta` is `min-width:0` so long spell names wrap instead of pushing the thumbnail/button out.
- Card border lifts to `--burn-accent` on hover; neon mode adds a soft cyan glow on the headline only.

### Rules

- The spell name replaces the old "JALCA Game NFT #N" collection string as the card's primary label.
- The game number (not the token number) is the secondary identifier; the token number is demoted to the muted bottom line.
- All colors via `oklch(var(--*))` — no raw literals.

## Voting Window — Game # Control + Vote Tally (additive)

Adds a Game # control to the "Vote on Next game" window header and a compact vote-tally readout showing only winning/for counts. New `--vote-*` token set (all six theme blocks) + `.voting-window-*` utilities. Reuses `.window-card` / `.window-heading`.

### Vote tokens (all six theme blocks)

| Token | Light | Dark | Neon | Fire | Water | Bubblegum | Role |
| ----- | ----- | ---- | ---- | ---- | ----- | --------- | ---- |
| vote-for | 0.55 0.12 200 | 0.72 0.13 200 | 0.82 0.15 200 | 0.74 0.13 195 | 0.76 0.13 195 | 0.55 0.13 205 | Winning/for count accent |
| vote-for-foreground | 0.97 0.005 120 | 0.22 0.01 120 | 0.14 0.02 280 | 0.2 0.015 35 | 0.16 0.03 240 | 0.97 0.012 350 | Text on filled vote chip |
| vote-track | 0.94 0.01 100 | 0.24 0.02 120 | 0.16 0.03 285 | 0.22 0.02 35 | 0.22 0.03 245 | 0.9 0.02 340 | Recessed tally surface |

### Surfaces

- `.voting-window-summary` — recessed `--vote-track` inset panel with a `--vote-for` hairline, holding the fixed three-row game summary.
- `.voting-window-summary-row` — one literal-text line; the first row (game number) is the quiet mono uppercase heading.
- The window header is a full-width collapsible chevron toggle (matching the NFT Spell burning window) with the Info toggle beside it, so it needs no bespoke class.

### Rules

- ONLY winning/for counts render: votes in favour of NFT spells ON, and votes in favour of Random starting position. Losing counts are never displayed anywhere in the window or its Info panel.
- Affirmative hue 200/195/205 (cyan) matches the White-team neon identity — a positive, team-neutral signal; no second losing hue is defined.
- Neon mode adds a soft cyan glow on the winning count only. All colors via `oklch(var(--*))` — no raw literals.

### Isolation contract

- Tokens: `--vote-for[-foreground]`, `--vote-track` in all six theme blocks.
- CSS: the `Voting Window Feature` block in index.css.
- Removing all of the above leaves the window title, toggles, Info panel, board, and every other feature untouched.

## Balls Spell Board Recolour (additive)

Five offensive "Balls" spells recolour the chessboard. Each spell name maps to ONE fixed colour family — no per-NFT variation. The CASTER's board shows the family with the light/dark distinction preserved (light squares → family light tone, dark squares → family dark tone); the OPPONENT's board shows the same family flat (both square colours → the single mid tone, no light/dark distinction). New `--balls-*` token set (defined ONCE on `:root`, theme-independent) + `.board-square-balls-*` / `.board-balls-*` utilities.

### Why fixed, not per-theme

The recolour is a spell effect layered OVER the active theme, not a theme of its own. Defining the family tones once on `:root` means Sandy Balls looks identical in light, dark, dark-neon, fire, water, and bubblegum — the board colour is a game fact both players must read the same way.

### Colour families (all three tones fixed, theme-independent)

| Family | Spell | Light OKLCH | Dark OKLCH | Flat OKLCH | Hue |
| ------ | ----- | ----------- | ---------- | ---------- | --- |
| Sandy | Sandy Balls (light yellow) | 0.92 0.06 85 | 0.6 0.09 85 | 0.8 0.08 85 | 85 |
| Cloudy | Cloudy Balls (very light grey) | 0.93 0.005 220 | 0.6 0.012 220 | 0.82 0.008 220 | 220 |
| Grassy | Grassy Balls (green) | 0.9 0.08 145 | 0.52 0.1 145 | 0.72 0.09 145 | 145 |
| Fiery | Fiery Balls (red) | 0.88 0.07 25 | 0.5 0.13 25 | 0.7 0.1 25 | 25 |
| Wooden | Wooden Balls (brown) | 0.88 0.05 60 | 0.48 0.07 60 | 0.68 0.06 60 | 60 |

### The light / dark / flat rule

- `--balls-<name>-light` → caster's light squares; `--balls-<name>-dark` → caster's dark squares. Their lightness gap is ≥ 0.28, so the light/dark distinction is unmistakable.
- `--balls-<name>-flat` → opponent's board; its lightness sits BETWEEN light and dark, so a flat board reads as one even tone.
- Cloudy's flat (0.82, hue 220) and Sandy's flat (0.8, hue 85) are separated by hue so they never read as the same grey.

### Legibility contract (holds for every family)

- Dark tone L ≥ 0.45 and light tone L ≤ 0.92, so the existing `--piece-outline` (dark walnut / near-black) and the cream or neon piece fills both stay legible on either tone.
- Coordinates, `.sq-selected` (blue 220), `.sq-last-move` (amber 85), `.sq-destination` (teal 160), `.sq-legal-move` (`--primary`), `.sq-check` (red 25), `.sq-explosive` (`--destructive`) and `.sq-blocked` all paint ON TOP of the recoloured square unchanged.
- Fiery Balls keeps chroma low (≤ 0.13) so its red never reads as the check-red overlay (0.55 0.22 25).
- The magenta inner-square indicator (`.sq-blocked::after`, fixed 0.62 0.24 330) is NOT re-tinted and stays distinct from all five families (hues 85, 220, 145, 25, 60).

### Isolation contract

- Tokens: `--balls-<family>-light/-dark/-flat` (15 values) in the `:root` block only.
- CSS: the `Balls Spell Board Recolour Feature` block at the end of index.css.
- The existing six theme palettes' `--board-light` / `--board-dark` are UNCHANGED.
- Removing all of the above leaves the board, pieces, and every other feature untouched.
