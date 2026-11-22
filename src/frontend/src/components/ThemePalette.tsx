import { Check, Palette } from "lucide-react";
import { type ReactElement, useState } from "react";
import { type Theme, useTheme } from "../hooks/use-theme";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/**
 * ThemePalette — the six-theme color selector (Radix Popover). Moved up from
 * the board control row into the top brand buffer next to the JALCA title.
 * Retains its existing 6-colour-style reveal functionality unchanged: a
 * trigger button opens a popover with six theme swatches (Light / Dark /
 * Neon / Fire / Water / Bubblegum); selecting one applies the theme class to
 * <html> and persists it to localStorage via useTheme.
 */

interface ThemeIconProps {
  className?: string;
}

function SunIcon({ className }: ThemeIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function MoonIcon({ className }: ThemeIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9c0 0 0 0 0 0" />
    </svg>
  );
}

function BoltIcon({ className }: ThemeIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function FireIcon({ className }: ThemeIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

function WaveIcon({ className }: ThemeIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
    </svg>
  );
}

function BalloonIcon({ className }: ThemeIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3a6 6 0 0 0 0 12c3.314 0 6-2.686 6-6a6 6 0 0 0-6-6z" />
      <path d="M12 15l-1 2" />
      <path d="M11 17h2" />
      <path d="M12 17l1 3" />
    </svg>
  );
}

interface ThemeSwatch {
  id: Theme;
  label: string;
  Icon: (props: ThemeIconProps) => ReactElement;
}

const THEME_SWATCHES: ThemeSwatch[] = [
  { id: "light", label: "Light", Icon: SunIcon },
  { id: "dark", label: "Dark", Icon: MoonIcon },
  { id: "dark-neon", label: "Neon", Icon: BoltIcon },
  { id: "fire", label: "Fire", Icon: FireIcon },
  { id: "water", label: "Water", Icon: WaveIcon },
  { id: "bubblegum", label: "Bubblegum", Icon: BalloonIcon },
];

export function ThemePalette() {
  const { theme, setTheme } = useTheme();
  const [themeOpen, setThemeOpen] = useState(false);

  const activeLabel =
    THEME_SWATCHES.find((s) => s.id === theme)?.label ?? "Theme";

  return (
    <Popover open={themeOpen} onOpenChange={setThemeOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-ocid="header.theme_selector"
          aria-label={`Theme: ${activeLabel}. Click to choose a theme`}
          title={`Theme: ${activeLabel}`}
          className="flex items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring transition-smooth"
        >
          <Palette className="size-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{activeLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        collisionPadding={8}
        className="w-64 p-3"
        data-ocid="header.theme_popover"
      >
        <p className="mb-2 font-display text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Theme
        </p>
        <fieldset className="grid grid-cols-3 gap-2">
          <legend className="sr-only">Theme selection</legend>
          {THEME_SWATCHES.map((swatch, index) => {
            const isActive = swatch.id === theme;
            const { Icon } = swatch;
            return (
              <button
                key={swatch.id}
                type="button"
                data-ocid={`header.theme_swatch.${index + 1}`}
                aria-label={`${swatch.label} theme${
                  isActive ? " (active)" : ""
                }`}
                aria-pressed={isActive}
                onClick={() => {
                  setTheme(swatch.id);
                  setThemeOpen(false);
                }}
                className={`group relative flex items-center justify-center rounded-md border p-2 transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive
                    ? "border-primary bg-muted text-foreground ring-1 ring-primary"
                    : "border-border bg-background text-foreground hover:bg-muted"
                }`}
              >
                <Icon className="size-7 [color:oklch(var(--foreground))]" />
                {isActive && (
                  <Check
                    className="absolute right-1 top-1 size-3.5 text-primary"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}

export default ThemePalette;
