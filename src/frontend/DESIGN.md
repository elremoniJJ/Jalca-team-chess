# Team Chess Online — Frontend Design System

## Direction

Tournament Hall, Six Moods — one chess product in six switchable themes, framed by two branding buffer bands (top wordmark + bottom tagline) that re-skin per theme as future advertising space. The layout is a single centered vertical window stack, not a multi-column desktop grid.

## Tone

Light is simple and elegant (cream band, hairline rule). Dark is Gothic, moody, ornate (recessed slate, double antique-gold rule, tracked uppercase). Neon is 80s synthwave (cyan→magenta gradient rule, neon-tube wordmark glow). Fire is a warm ember palette on a dark background. Water is a cool deep-blue palette on a dark background. Bubblegum is a soft pastel pink + sky-blue light theme.

## Differentiation

The same two buffer bands and the same window stack project six fully-committed identities purely through OKLCH tokens and `.dark` / `.dark-neon` / `.theme-fire` / `.theme-water` / `.theme-bubblegum`-scoped utilities, with zero component branching. The board itself is a spell surface: five "Balls" spells recolour it, and the recolour is theme-independent so both players read the same game fact.

## Themes

Six themes, cycled by `hooks/use-theme.ts` in the order light → dark → dark-neon → fire → water → bubblegum → light. Themes are applied as a class on `<html>`:

| Theme id | `<html>` class | Character |
| --- | --- | --- |
| `light` | *(none — the `:root` palette)* | Warm analog Tournament Hall |
| `dark` | `.dark` | Moody slate, glow-free |
| `dark-neon` | `.dark-neon` | Near-black purple, cyan/magenta neon |
| `fire` | `.theme-fire` | Warm ember on dark |
| `water` | `.theme-water` | Cool deep blue on dark |
| `bubblegum` | `.theme-bubblegum` | Soft pastel pink + sky blue |

Persistence: `localStorage` key `"theme"`. An inline script in `index.html` reads it before first paint and sets the class so there is no FOUC. Default is `light`. There is no OS `prefers-color-scheme` auto mode.

## Color Palette (light / `:root`)

| Token | Light OKLCH | Role |
| --- | --- | --- |
| background | 0.97 0.005 120 | Page canvas, soft warm gray |
| foreground | 0.25 0.01 120 | Primary text |
| heading | 0.25 0.01 120 | Window headings (theme-aware) |
| card | 0.92 0.03 85 | Beige panels / window cards |
| primary | 0.5 0.1 130 | Olive CTA, active states |
| accent | 0.72 0.15 85 | Gold highlight |
| team-white | 0.95 0.02 85 | Ivory white team accent |
| team-black | 0.25 0.01 120 | Charcoal black team accent |
| destructive | 0.55 0.22 25 | Timer urgency, low clock, errors |
| board-light | 0.92 0.03 85 | Beige board squares |
| board-dark | 0.55 0.08 130 | Olive board squares |
| board-highlight | 0.72 0.15 85 | Last-move / selection gold |
| window-border | 0.84 0.025 100 | Stronger hairline for window cards |

Every theme block redefines the same token set. Feature accents are additive: `--drinking-accent` (grape 330), `--vote-for` / `--vote-track` (affirmative cyan 200), `--advice-accent` (violet 290), `--approval-warning` (amber 65) / `--approval-success` (green 150), `--flow-active` (coin-gold 90), and the `--buffer-*` branding tokens are defined in all six theme blocks. `--burn-accent` (ember 45) is defined once on `:root` and is theme-independent.

## Typography

- Display: Space Grotesk — headings, window titles, board labels, team names, wordmark
- Body: DM Sans — chat, roster, UI text, tagline in light mode
- Mono: JetBrains Mono — move timer, move counters, clock, tagline in dark/neon modes
- Weights: display 500/700, body 400/500/700, mono 400/700
- Wordmark scale: `text-xl`/`text-2xl`, letter-spacing 0.18em (light) / 0.32em (dark gothic) / 0.18em (neon)
- Tagline scale: `text-xs`, letter-spacing 0.04em (light) / 0.08em (dark/neon)

## Elevation & Depth

- Window cards: `.window-card` — card surface, 1px `--window-border` hairline, `var(--radius)` (0.75rem), subtle shadow
- Board: `shadow-board-elevated` lifts the board as the focal artifact
- Light buffers are flat cream with a single hairline; dark buffers recess below the card via a deeper slate surface and a carved double-rule inset shadow; neon buffers sit on near-black purple with a static cyan→magenta gradient hairline and layered text-shadow glow
- No heavy drop shadows; depth reads through tone contrast

## Structural Zones

The layout is a single centered vertical stack (`.window-column`, `mx-auto w-full`, `flex flex-col min-h-dvh gap-2`). Windows render in a fixed order, top to bottom, with no reordering:

| Order | Window | Content |
| --- | --- | --- |
| 1 | Vote on next game | Collapsible voting window + game summary |
| 2 | Game status | Merged move-maker indicator + turn timer + Coords/Flip/Advice toolbar |
| 3 | Chessboard | Board, game-mode selector, overlays |
| 4 | Wallet connection | Oisy wallet + NFT burn panel |
| 5 | Players | Logged-in roster, team assignment, kick controls |
| 6 | Captured | Captured-piece tray |
| 7 | Moves | Move history (SAN) |
| 8 | Prediction Bet | Informational betting-requirements window |

The top branding buffer (fixed ~72px wordmark band) is the first child of the column; the bottom branding buffer (fixed ~64px tagline band) is the last. Both scroll with the page (no sticky/fixed) and are `shrink-0`.

## Spacing & Rhythm

- Base unit 0.5rem; window gaps 0.5rem (`gap-2`); board padding 1.5rem
- Window card padding 1.25rem; chat message spacing 0.5rem
- Board squares sized via `aspect-ratio: 1`; portrait takes full width, landscape is `min(calc(100vw - 9rem), calc(100vh - 8.5rem))`
- `.window-column` is full-width in portrait; in landscape it insets left/right by 4.5rem so no window is flush to the screen sides

## Component Patterns

- Windows use `.window-card` (card surface + `--window-border` hairline + radius + shadow)
- Window titles use `.window-heading` — `color: oklch(var(--heading))` + display font; the single handoff class for every window title
- Board: 8x8 grid of `.board-square-light` / `.board-square-dark`
- Board overlays: `.sq-last-move` (amber), `.sq-selected` (blue 220), `.sq-destination` (teal 160), `.sq-legal-move` (primary dot), `.sq-check` (red 25, pulsing), `.sq-explosive` (Conu Bungno X), `.sq-blocked` (Bouvet Hondao magenta inner square)
- Team badges use `.team-white` / `.team-black`; captured-window labels use the fixed-contrast `.text-team-white-captured` / `.text-team-black-captured`
- Timer in JetBrains Mono; switches to destructive + `animate-timer-pulse` under 10s
- Collapsible windows (voting, status, NFT burn) use a full-width chevron header toggle with `aria-expanded`/`aria-controls`, open state persisted in localStorage, body unmounted when collapsed

## Motion

- `animate-confetti`: checkmate celebration burst, 2.5s, transient
- `animate-timer-pulse`: low-clock urgency, 1s loop
- `animate-flow-pulse`: bet-flow active stage, 2s loop
- `transition-smooth` on hover/active state changes
- Theme switch: 250ms html/body background/color/border fade
- Piece slide 200ms and capture fade 150ms (transform/opacity only)
- All motion honors `prefers-reduced-motion`

## Constraints

- Guest-only identity: no accounts, no Internet Identity login UI. A per-browser pseudo-principal is stored in localStorage; the login route collects a username and an optional ICRC-7 NFT wallet address
- No resignation, no draw offering, no spectator mode
- Polling 1500ms for game state, chat/roster, moves, spells, votes, and burn state; heartbeat 1s
- No OS `prefers-color-scheme` auto mode
- All colors come from CSS custom properties through semantic Tailwind classes — no raw palette classes, no inline color functions

## Signature Detail

The single gold highlight on the Move_Maker's active square — one warm moment per move against the olive/beige board — now one of six fully-committed theme identities sharing the same window stack and branding buffers.
