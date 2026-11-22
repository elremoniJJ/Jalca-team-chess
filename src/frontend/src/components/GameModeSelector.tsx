import { type GameMode, useGameMode } from "../hooks/use-game-mode";

/*
 * GameModeSelector — three separate mutually-exclusive game-mode buttons that
 * replace the single cycling smiley toggle. Selecting one button deselects
 * the other two (only one mode is active at a time):
 *
 *   - Just for Fun   (smiley)    -> mode "off"       (default, no toasts)
 *   - Exercise Game  (dumbbell)  -> mode "exercise"  (exercise toasts)
 *   - Drinking Game  (martini)   -> mode "drinking"  (drinking toasts)
 *
 * The selected mode is owned by useGameMode (localStorage key "game-mode",
 * values "off" | "exercise" | "drinking", default "off"). Each button calls
 * setMode with its own mode, so clicking one writes that mode and the others
 * read as inactive — preserving the existing three-mode state model and
 * persistence. The wiring task (game.tsx) reads the persisted value via a
 * 150ms polling + storage-event listener so the route reacts to mode changes
 * made here without stale state.
 *
 * The buttons render at the LARGE size (min-h-[44px], text-sm, font-semibold)
 * — the size the six board-view buttons used before the layout swap. The
 * selector sits at the top of the game screen, above the Game status area.
 */

const MODE_OPTIONS: {
  mode: GameMode;
  label: string;
  title: string;
}[] = [
  { mode: "off", label: "Just for Fun", title: "Just for Fun" },
  { mode: "exercise", label: "Exercise Game", title: "Exercise Game" },
  { mode: "drinking", label: "Drinking Game", title: "Drinking Game" },
];

function ModeIcon({ mode }: { mode: GameMode }) {
  if (mode === "exercise") {
    // Dumbbell icon — exercise toasts are displayed.
    return (
      <svg
        className="size-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* Central bar */}
        <path d="M5 12h14" />
        {/* Left weight plates (outer + inner) */}
        <path d="M3 9v6" />
        <path d="M6 7.5v9" />
        {/* Right weight plates (outer + inner) */}
        <path d="M21 9v6" />
        <path d="M18 7.5v9" />
      </svg>
    );
  }
  if (mode === "drinking") {
    // Martini glass icon — drinking toasts are displayed.
    return (
      <svg
        className="size-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* Glass bowl — V-shaped triangle, well-proportioned */}
        <path d="M4 4h16l-8 9z" />
        {/* Stem — two parallel lines for appropriate thickness */}
        <path d="M10.8 13l2.4 0" />
        <path d="M11 13v6" />
        <path d="M13 13v6" />
        {/* Base — wider, more substantial than a single line */}
        <path d="M7.5 21h9" />
        <path d="M9 19.5h6" />
        {/* Olive on a toothpick */}
        <path d="M12 4V1" />
        <circle cx="12" cy="2.5" r="0.7" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  // Smiley-face icon — mode is OFF (default), no toasts.
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  );
}

export function GameModeSelector() {
  const { mode, setMode } = useGameMode();

  return (
    <fieldset
      data-ocid="game_mode_selector.panel"
      className="flex flex-wrap items-center justify-center gap-2"
    >
      <legend className="sr-only">Game style</legend>
      {MODE_OPTIONS.map((option) => {
        const isActive = mode === option.mode;
        return (
          <button
            key={option.mode}
            type="button"
            onClick={() => setMode(option.mode)}
            data-ocid={`game_mode_selector.${option.mode}.button`}
            aria-pressed={isActive}
            aria-label={`${option.label}${isActive ? " (active)" : ""}`}
            title={option.title}
            className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-semibold transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              isActive
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <ModeIcon mode={option.mode} />
            <span>{option.label}</span>
          </button>
        );
      })}
    </fieldset>
  );
}

export default GameModeSelector;
