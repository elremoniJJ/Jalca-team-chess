import { Check, ChevronDown, ChevronRight, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { SpellUse, StartingPosition, TurnDuration } from "../backend";
import { useGameSettingsSnapshot } from "../hooks/use-voting";
import { useWindowTheme } from "../hooks/use-window-theme";
import { WindowThemeDots } from "./WindowThemeDots";

/**
 * Human-readable label for a turn-duration option. Used by both the "Turn
 * time" toggle group and the historical summary row so the two never drift.
 */
function turnDurationLabel(value: TurnDuration): string {
  switch (value) {
    case TurnDuration.NinetySeconds:
      return "1.5 minutes";
    case TurnDuration.OneMinute:
      return "1 minute";
    default:
      return "2 minutes";
  }
}

/**
 * VotingWindow — the "vote on next-game settings" panel rendered above the
 * BoardToolbar button row in the game route's top-of-page stack.
 *
 * It exposes three toggle groups:
 *   1. NFT spells — ON / OFF (default ON).
 *   2. Starting position — Standard / Random (default Random).
 *   3. Turn time — 2 minutes / 1.5 minutes / 1 minute (default 2 minutes).
 *
 * The toggles are CONTROLLED: the game route owns the current positions
 * (defaulting to ON / Random / 2 minutes) and passes them down here. There is
 * NO submit action — the player simply sets the toggles, and the route pushes
 * their positions to the backend live as they change (and again at game
 * conclusion as a safety net) via castVote.
 *
 * Below the toggles sits a HISTORICAL four-row game summary:
 *   1. `Game <n>` — the game currently in progress (the game the tally
 *      decided).
 *   2. `NFT spells: YES|OFF with <count>` — the winning NFT-spells option.
 *   3. `Starting Position: Standard|Random with <count>` — the winning
 *      starting-position option.
 *   4. `Turn time: <label> with <count>` — the winning turn-duration option.
 *
 * The summary reflects the PERSISTED end-of-previous-game snapshot, sourced
 * from getGameSettingsSnapshot() — the fixed snapshot written once at
 * startNewGame. It does NOT update as players flip their toggles during the
 * current game; only end-of-game positions determine the next game's
 * settings. Only the winning option is shown; losing counts are never
 * rendered. The separate Game # button and its pop-out are gone — the game
 * number is now row 1 of the summary.
 *
 * The toggles are built from styled buttons matching the existing
 * `bg-primary/10 text-primary border border-primary/30` active pattern used
 * by the BoardToolbar's Coords toggle, so the voting window reads as part of
 * the same control system.
 *
 * Collapsible treatment — identical to the NFT Spell burning window
 * (WalletConnectionWindow.tsx): a full-width chevron header toggle
 * (ChevronRight hidden when open, ChevronDown block when open, both size-4
 * text-muted-foreground transition-smooth), open state persisted to
 * localStorage as a JSON boolean, and the body conditionally UNMOUNTED when
 * collapsed. The Info toggle lives in the header row beside the chevron.
 */

/* --- Open/collapsed persistence (tco-voting-open) --------------------- */

const OPEN_KEY = "tco-voting-open";
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

interface ToggleOption<T extends string> {
  value: T;
  label: string;
}

interface ToggleGroupProps<T extends string> {
  label: string;
  options: ToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
  dataOcid: string;
  /** When true the toggles render read-only (spectator). */
  readOnly?: boolean;
}

function ToggleGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  dataOcid,
  readOnly = false,
}: ToggleGroupProps<T>) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <fieldset className="flex items-center gap-1.5">
        <legend className="sr-only">{label}</legend>
        {options.map((option, index) => {
          const isActive = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              data-ocid={`${dataOcid}.${index + 1}`}
              aria-pressed={isActive}
              disabled={readOnly}
              onClick={() => onChange(option.value)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isActive
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : "bg-background text-muted-foreground border border-border hover:bg-muted"
              } ${readOnly ? "cursor-not-allowed opacity-60" : ""}`}
            >
              {isActive && <Check className="size-3.5" aria-hidden="true" />}
              <span>{option.label}</span>
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}

/**
 * InfoContent — the explanatory panel revealed by the header Info toggle.
 * Describes how votes are counted and how ties are broken.
 *
 * Exported so a caller that renders the window embedded (no header, no Info
 * button) can still surface this content from outside the component — e.g. the
 * board view overlay's own INFO button.
 */
export function VotingInfoContent() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-relaxed text-foreground">
        Vote on the settings you want for the next game. Your selected options
        are recorded as you change them, so both players' choices are counted
        when the next game starts.
      </p>

      <div className="flex flex-col gap-2">
        <h3 className="window-heading text-xs font-semibold uppercase tracking-wide">
          How votes are counted
        </h3>
        <ul className="flex flex-col gap-1.5 text-sm text-foreground">
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-primary">
              •
            </span>
            <span>
              Each player's toggle positions are recorded as they change, and
              those recorded positions are what get counted.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-primary">
              •
            </span>
            <span>
              The option with the most votes becomes the setting for the next
              game.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-primary">
              •
            </span>
            <span>
              Turn time is voted the same way: choose 2 minutes, 1.5 minutes or
              1 minute per move, and the most-voted option sets the next game's
              turn length.
            </span>
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="window-heading text-xs font-semibold uppercase tracking-wide">
          Ties
        </h3>
        <p className="text-sm leading-relaxed text-foreground">
          In the event of a tie, the defaults are favoured — spells on, random
          starting position, and 2 minutes per turn.
        </p>
      </div>
    </div>
  );
}

interface VotingWindowProps {
  /** Current NFT-spells toggle position (owned by the game route). */
  spellUse: SpellUse;
  onSpellUseChange: (value: SpellUse) => void;
  /** Current starting-position toggle position (owned by the game route). */
  startingPosition: StartingPosition;
  onStartingPositionChange: (value: StartingPosition) => void;
  /** Current turn-duration toggle position (owned by the game route).
   * Optional so callers that predate the turn-time vote still render; defaults
   * to the 2-minute default. */
  turnDuration?: TurnDuration;
  onTurnDurationChange?: (value: TurnDuration) => void;
  /** Game number from the backend (getGameNumber). Display-only. */
  gameNumber: bigint | null;
  /** True while the visitor is watching as a spectator — the voting controls
   * render read-only and a note explains that spectator votes aren't counted. */
  spectator?: boolean;
  /** When true, render only the body — no collapsible header, no chevron, no
   * per-window theme dots — and treat the window as always open. The old
   * per-window localStorage open key is neither read nor written on this path.
   * When absent, the component behaves exactly as before. */
  embedded?: boolean;
}

export function VotingWindow({
  spellUse,
  onSpellUseChange,
  startingPosition,
  onStartingPositionChange,
  turnDuration = TurnDuration.TwoMinutes,
  onTurnDurationChange,
  gameNumber,
  spectator = false,
  embedded = false,
}: VotingWindowProps) {
  const [showInfo, setShowInfo] = useState(false);
  // Self-contained collapsible open state, persisted to localStorage.
  // Defaults to collapsed. On the embedded path the window is always open and
  // the stored key is ignored.
  const [open, setOpen] = useState<boolean>(() =>
    embedded ? true : readStoredOpen(),
  );
  const { windowTheme, setWindowTheme, rootRef } =
    useWindowTheme("voting_window");

  // Persist React state → localStorage whenever it changes. Mirrors the
  // WalletConnectionWindow / CapturedTray sync effect. Skipped on the embedded
  // path so the old per-window open key is never written.
  useEffect(() => {
    if (embedded) return;
    writeStoredOpen(open);
  }, [open, embedded]);

  // The body renders whenever the window is open; on the embedded path it is
  // always shown.
  const bodyOpen = embedded || open;

  // HISTORICAL end-of-previous-game snapshot. Sourced from
  // getGameSettingsSnapshot() — the fixed snapshot persisted once at
  // startNewGame — so the summary shows what won at the end of the previous
  // game and never changes as players flip their toggles during the current
  // game. This is deliberately NOT the live getVoteTally().
  const { snapshot } = useGameSettingsSnapshot();

  const gameNumberDisplay =
    gameNumber !== null ? Number(gameNumber).toString() : "—";

  // Winning NFT-spells option recorded in the snapshot. An absent snapshot
  // falls back to the default ON.
  const winningSpellUse = snapshot?.spellUse ?? SpellUse.On;
  const spellUseLabel = winningSpellUse === SpellUse.On ? "YES" : "OFF";

  // Winning starting-position option recorded in the snapshot. An absent
  // snapshot falls back to the default Random.
  const winningStartingPosition =
    snapshot?.startingPosition ?? StartingPosition.Random;
  const startingPositionLabel =
    winningStartingPosition === StartingPosition.Random ? "Random" : "Standard";

  // Counts for the winning option only, read exactly as stored in the
  // snapshot. The losing count is never read. When the snapshot is still
  // loading or unavailable, fall back to a zero count while still showing the
  // winning option.
  const spellUseCount =
    winningSpellUse === SpellUse.On
      ? Number(snapshot?.spellOnCount ?? 0n)
      : Number(snapshot?.spellOffCount ?? 0n);
  const startingPositionCount =
    winningStartingPosition === StartingPosition.Random
      ? Number(snapshot?.randomCount ?? 0n)
      : Number(snapshot?.standardCount ?? 0n);

  // Winning turn-duration option recorded in the snapshot. An absent snapshot
  // falls back to the default 2 minutes.
  const winningTurnDuration = snapshot?.turnDuration ?? TurnDuration.TwoMinutes;
  const turnDurationCount =
    winningTurnDuration === TurnDuration.NinetySeconds
      ? Number(snapshot?.ninetySecondCount ?? 0n)
      : winningTurnDuration === TurnDuration.OneMinute
        ? Number(snapshot?.oneMinuteCount ?? 0n)
        : Number(snapshot?.twoMinuteCount ?? 0n);

  return (
    <div
      ref={rootRef}
      data-ocid="voting_window.panel"
      className="flex w-full flex-col bg-card overflow-hidden"
    >
      {/* Header — full-width chevron toggle button on the left (matching the
       * NFT Spell burning window), with the Info toggle on the right and the
       * per-window theme dots centred between them. Skipped entirely on the
       * embedded path. */}
      {embedded ? null : (
        <div className="relative flex w-full items-center justify-between border-b border-border">
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            data-ocid="voting_window.header"
            aria-expanded={open}
            aria-controls="voting-window-body"
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
              Vote on next game
            </span>
          </button>

          <WindowThemeDots
            value={windowTheme}
            onChange={setWindowTheme}
            label="Vote on next game"
            ocidPrefix="voting_window"
          />

          {/* Info button — matches the header Info toggle used by the
           * Prediction Bet and Wallet Connection windows. Toggles the
           * explanatory content: selected → info shows; deselected → the
           * voting controls show. */}
          <button
            type="button"
            onClick={() => setShowInfo((current) => !current)}
            data-ocid="voting_window.info_button"
            aria-pressed={showInfo}
            aria-label="Toggle voting information"
            className={`flex shrink-0 items-center gap-1.5 px-4 py-3 text-xs font-semibold uppercase tracking-wide transition-smooth hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
              showInfo ? "text-accent" : "text-muted-foreground"
            }`}
          >
            <Info className="size-4" aria-hidden="true" />
            Info
          </button>
        </div>
      )}

      {/* Body — conditionally UNMOUNTED when collapsed (same approach as the
       * other collapsible windows). On the embedded path it is always shown. */}
      {bodyOpen ? (
        <div id="voting-window-body" className="px-4 py-3">
          {showInfo ? (
            <VotingInfoContent />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-3">
                <ToggleGroup
                  label="NFT spells"
                  options={[
                    { value: SpellUse.Off, label: "OFF" },
                    { value: SpellUse.On, label: "ON" },
                  ]}
                  value={spellUse}
                  onChange={onSpellUseChange}
                  dataOcid="voting_window.spell_toggle"
                  readOnly={spectator}
                />
                <ToggleGroup
                  label="Starting position"
                  options={[
                    { value: StartingPosition.Standard, label: "Standard" },
                    { value: StartingPosition.Random, label: "Random" },
                  ]}
                  value={startingPosition}
                  onChange={onStartingPositionChange}
                  dataOcid="voting_window.position_toggle"
                  readOnly={spectator}
                />
                <ToggleGroup
                  label="Turn time"
                  options={[
                    { value: TurnDuration.TwoMinutes, label: "2 minutes" },
                    { value: TurnDuration.NinetySeconds, label: "1.5 minutes" },
                    { value: TurnDuration.OneMinute, label: "1 minute" },
                  ]}
                  value={turnDuration}
                  onChange={onTurnDurationChange ?? (() => {})}
                  dataOcid="voting_window.turn_toggle"
                  readOnly={spectator}
                />
              </div>

              {/* Spectator note — the voting controls are read-only while
               * watching, so the visitor knows their input is not counted. */}
              {spectator && (
                <p
                  data-ocid="voting_window.spectator_note"
                  className="w-full text-xs text-muted-foreground sm:w-auto"
                >
                  Spectator votes aren't counted
                </p>
              )}

              {/* Historical game summary — the winning options and counts
               * from the persisted end-of-previous-game snapshot. Three
               * literal-text rows; only the winning option and its count are
               * shown. */}
              <div
                data-ocid="voting_window.summary"
                className="voting-window-summary w-full sm:w-auto sm:min-w-[13rem]"
              >
                <p
                  className="voting-window-summary-row"
                  data-ocid="voting_window.summary.game_number"
                >
                  Game {gameNumberDisplay}
                </p>
                <p
                  className="voting-window-summary-row"
                  data-ocid="voting_window.summary.spell_use"
                >
                  NFT spells: {spellUseLabel} with {spellUseCount}
                </p>
                <p
                  className="voting-window-summary-row"
                  data-ocid="voting_window.summary.starting_position"
                >
                  Starting Position: {startingPositionLabel} with{" "}
                  {startingPositionCount}
                </p>
                <p
                  className="voting-window-summary-row"
                  data-ocid="voting_window.summary.turn_duration"
                >
                  Turn time: {turnDurationLabel(winningTurnDuration)} with{" "}
                  {turnDurationCount}
                </p>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default VotingWindow;
