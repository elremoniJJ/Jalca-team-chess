import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { useWindowTheme } from "../hooks/use-window-theme";
import { WindowThemeDots } from "./WindowThemeDots";

/**
 * AlsoOnIcWindow — a collapsible window rendered at the VERY TOP of the game
 * page window stack, above the "Vote on next game" window.
 *
 * It is a small directory of other projects running on the Internet Computer:
 * a single row of six tiles. The first three tiles are thumbnail links that
 * open in a NEW browser tab (target="_blank" rel="noopener noreferrer"); the
 * last three are blank "open to suggestions" placeholders with no link and no
 * image.
 *
 * Collapse — matches the canonical collapsible pattern used by StoryWindow and
 * VotingWindow: a full-width header button with a chevron (ChevronRight
 * collapsed / ChevronDown expanded, both always mounted, toggled via Tailwind
 * hidden/block, size-4 text-muted-foreground transition-smooth) and
 * aria-expanded; the body is conditionally UNMOUNTED when collapsed. Open
 * state is persisted to localStorage key "tco-also-on-ic-open".
 *
 * The header also carries the per-window theme dots (WindowThemeDots) and an
 * Info toggle, matching the other windows in the stack.
 */

/* --- Open/collapsed persistence (tco-also-on-ic-open) ------------------ */

const OPEN_KEY = "tco-also-on-ic-open";
const DEFAULT_OPEN = false; // collapsed by default on first visit

function readStoredOpen(): boolean {
  if (typeof window === "undefined") return DEFAULT_OPEN;
  try {
    const raw = window.localStorage.getItem(OPEN_KEY);
    if (raw === null) return DEFAULT_OPEN;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "boolean") return parsed;
  } catch {
    // Corrupt or unreadable — fall back to the default (collapsed).
  }
  return DEFAULT_OPEN;
}

function writeStoredOpen(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OPEN_KEY, JSON.stringify(value));
  } catch {
    // localStorage may be unavailable (private mode, etc.) — the window
    // still works in-session via React state, just won't persist.
  }
}

/* --- Tile data ---------------------------------------------------------- */

interface LinkTile {
  kind: "link";
  /** Stable identity for the React key. */
  id: string;
  /** Destination URL — opened in a new browser tab. */
  href: string;
  /** Thumbnail image path under /assets. */
  image: string;
  /** Accessible label / visible caption. */
  label: string;
  /** Alt text for the thumbnail. */
  alt: string;
}

interface PlaceholderTile {
  kind: "placeholder";
  id: string;
  label: string;
}

type Tile = LinkTile | PlaceholderTile;

const TILES: readonly Tile[] = [
  {
    kind: "link",
    id: "delulu",
    href: "https://delulu.game",
    image: "/assets/also-on-ic/delulu.png",
    label: "delulu.game",
    alt: "Delulu Canyon — an isometric pixel-art multiplayer game on the IC",
  },
  {
    kind: "link",
    id: "piko",
    href: "https://www.piko.network",
    image: "/assets/also-on-ic/piko.png",
    label: "piko.network",
    alt: "Piko Network — a fair-launch proof-of-work token on the IC",
  },
  {
    kind: "link",
    id: "icp-flags",
    href: "https://icp-flags.fans",
    image: "/assets/also-on-ic/icp-flags.png",
    label: "icp-flags.fans",
    alt: "ICP Flags — a cluster of circular national flags on the IC",
  },
  { kind: "placeholder", id: "suggestion-1", label: "open to suggestions" },
  { kind: "placeholder", id: "suggestion-2", label: "open to suggestions" },
  { kind: "placeholder", id: "suggestion-3", label: "open to suggestions" },
];

/* --- Info content ------------------------------------------------------- */

/**
 * InfoContent — the explanatory panel revealed by the header Info toggle.
 *
 * Exported so a caller that renders the window embedded (no header, no Info
 * button) can still surface this content from outside the component — e.g. the
 * board view overlay's own INFO button.
 */
export function AlsoOnIcInfoContent() {
  return (
    <div
      data-ocid="also_on_ic.info_content"
      className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-3 py-3 text-sm leading-relaxed text-foreground"
    >
      <p className="font-semibold">Other things happening on the IC</p>
      <p>
        A short list of other projects running on the Internet Computer. Tap a
        tile to open it in a new browser tab.
      </p>
      <p>
        The last three tiles are open to suggestions — if you know a project
        that belongs here, say so in the chat.
      </p>
    </div>
  );
}

/* --- Tiles -------------------------------------------------------------- */

function LinkTileCard({ tile }: { tile: LinkTile }) {
  return (
    <a
      href={tile.href}
      target="_blank"
      rel="noopener noreferrer"
      data-ocid={`also_on_ic.tile.${tile.id}`}
      className="also-on-ic-tile group flex flex-col overflow-hidden rounded-md border border-border bg-background transition-smooth hover:border-primary/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="also-on-ic-thumb block w-full overflow-hidden bg-muted">
        <img
          src={tile.image}
          alt={tile.alt}
          loading="lazy"
          className="h-full w-full object-cover transition-smooth group-hover:scale-105"
        />
      </span>
      <span className="also-on-ic-caption block truncate px-2 py-1.5 text-xs font-semibold text-foreground">
        {tile.label}
      </span>
    </a>
  );
}

function PlaceholderTileCard({ tile }: { tile: PlaceholderTile }) {
  return (
    <div
      data-ocid={`also_on_ic.tile.${tile.id}`}
      className="also-on-ic-tile also-on-ic-tile-placeholder flex flex-col overflow-hidden rounded-md border border-dashed border-border bg-muted/30"
    >
      <span className="also-on-ic-thumb flex w-full items-center justify-center bg-muted/40">
        <span
          className="text-2xl leading-none text-muted-foreground"
          aria-hidden="true"
        >
          +
        </span>
      </span>
      <span className="also-on-ic-caption block truncate px-2 py-1.5 text-xs font-medium italic text-muted-foreground">
        {tile.label}
      </span>
    </div>
  );
}

/* --- Component ---------------------------------------------------------- */

export interface AlsoOnIcWindowProps {
  /** When true, render only the body — no collapsible header, no chevron, no
   * per-window theme dots — and treat the window as always open. The old
   * per-window localStorage open key is neither read nor written on this path.
   * When absent, the component behaves exactly as before. */
  embedded?: boolean;
}

export function AlsoOnIcWindow({ embedded = false }: AlsoOnIcWindowProps) {
  const [open, setOpen] = useState<boolean>(() =>
    embedded ? true : readStoredOpen(),
  );
  const [showInfo, setShowInfo] = useState<boolean>(false);
  const { windowTheme, setWindowTheme, rootRef } =
    useWindowTheme("also_on_ic_window");

  // Persist React state → localStorage whenever it changes. Skipped on the
  // embedded path so the old per-window open key is never written.
  useEffect(() => {
    if (embedded) return;
    writeStoredOpen(open);
  }, [open, embedded]);

  // The body renders whenever the window is open; on the embedded path it is
  // always shown.
  const bodyOpen = embedded || open;

  return (
    <div
      ref={rootRef}
      data-ocid="also_on_ic_window"
      className="flex w-full flex-col bg-card overflow-hidden"
    >
      {/* Header — three-part flex row: left shrink-0 toggle button, centred
       * per-window theme dots, right shrink-0 info button. Skipped entirely on
       * the embedded path. */}
      {embedded ? null : (
        <div className="relative flex w-full items-center justify-between border-b border-border">
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            data-ocid="also_on_ic_window.header"
            aria-expanded={open}
            aria-controls="also-on-ic-window-body"
            className="flex min-w-0 shrink-0 items-center gap-1.5 px-4 py-3 text-left transition-smooth hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <ChevronRight
              className={`size-4 shrink-0 text-muted-foreground transition-smooth ${
                open ? "hidden" : "block"
              }`}
              aria-hidden="true"
            />
            <ChevronDown
              className={`size-4 shrink-0 text-muted-foreground transition-smooth ${
                open ? "block" : "hidden"
              }`}
              aria-hidden="true"
            />
            <span className="window-heading text-sm font-semibold">
              Also on the IC
            </span>
          </button>

          <WindowThemeDots
            value={windowTheme}
            onChange={setWindowTheme}
            label="Also on the IC"
            ocidPrefix="also_on_ic_window"
          />

          <button
            type="button"
            onClick={() => setShowInfo((current) => !current)}
            data-ocid="also_on_ic_window.info_button"
            aria-pressed={showInfo}
            aria-label="Toggle Also on the IC information"
            className={`flex shrink-0 items-center gap-1.5 px-4 py-3 text-xs font-semibold uppercase tracking-wide transition-smooth hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
              showInfo ? "text-accent" : "text-muted-foreground"
            }`}
          >
            <Info className="size-4" aria-hidden="true" />
            Info
          </button>
        </div>
      )}

      {/* Body — conditionally UNMOUNTED when collapsed. On the embedded path
       * it is always shown. */}
      {bodyOpen ? (
        <div
          id="also-on-ic-window-body"
          className="flex w-full flex-col gap-3 px-4 py-3"
        >
          {showInfo ? <AlsoOnIcInfoContent /> : null}

          {/* Single row of six tiles. Wraps gracefully on narrow screens. */}
          <ul
            data-ocid="also_on_ic.tile_list"
            className="also-on-ic-row grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
          >
            {TILES.map((tile) => (
              <li key={tile.id} className="min-w-0">
                {tile.kind === "link" ? (
                  <LinkTileCard tile={tile} />
                ) : (
                  <PlaceholderTileCard tile={tile} />
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default AlsoOnIcWindow;
