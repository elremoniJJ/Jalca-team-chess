import { useCallback, useEffect, useRef, useState } from "react";
import type { Theme } from "../hooks/use-theme";

/*
 * WindowThemeDots — the per-window theme picker rendered in each of the eight
 * window headers.
 *
 * Layout contract:
 *   - A single, non-wrapping row of six theme dots, centred on the TRUE
 *     horizontal middle of the window panel. The row is absolutely positioned
 *     at the header's 50% mark (left-1/2 -translate-x-1/2) rather than being a
 *     flex child, so its position does not depend on how long the left-hand
 *     window title is. Every window therefore places the row at the same
 *     horizontal position.
 *   - Each dot is a visible circle (~14-16px) inside a larger transparent
 *     hit area so it stays comfortably tappable.
 *   - On narrow widths the dots shrink first, down to a ~12px minimum. Only
 *     if the row still cannot fit does it shift off-centre (aligned to the
 *     trailing edge of the free space, i.e. just left of the right-side
 *     controls) so it never overlaps the left title or the right-side
 *     controls.
 *   - The picker is shown only in horizontal/landscape view. In
 *     vertical/portrait view it renders nothing, so the header keeps its
 *     title and right-side controls with no leftover empty gap. Visibility
 *     follows the live viewport orientation and updates when the device is
 *     rotated.
 *
 * The component measures the FREE space between the header's shrink-0
 * siblings (the left title and the right-side controls) and the natural width
 * of the row, then picks the largest dot size in [MIN_DOT, MAX_DOT] that
 * fits. While the row fits, it stays on the true panel middle; if the true
 * middle would collide with a sibling, the row is clamped to the nearest free
 * edge so it never overlaps either side. If even MIN_DOT does not fit, it
 * switches to the off-centre alignment, pinned just inside the right-side
 * controls.
 */

/** Visible dot diameter bounds, in px. */
const MIN_DOT = 12;
const MAX_DOT = 16;
/** Transparent hit-area padding around each visible dot, in px. */
const HIT_PADDING = 6;
/** Gap between adjacent hit areas, in px. */
const GAP = 2;

const THEME_ORDER: readonly Theme[] = [
  "light",
  "dark",
  "dark-neon",
  "fire",
  "water",
  "bubblegum",
];

const THEME_LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  "dark-neon": "Neon",
  fire: "Fire",
  water: "Water",
  bubblegum: "Bubblegum",
};

/**
 * The visible dot fill for each theme. These are fixed swatches (not theme
 * tokens) so the picker reads identically in every theme — a dot must show
 * what its theme looks like, not what the current theme looks like.
 */
const THEME_DOT_COLORS: Record<Theme, string> = {
  light: "oklch(0.97 0.005 120)",
  dark: "oklch(0.28 0.02 120)",
  "dark-neon": "oklch(0.72 0.2 320)",
  fire: "oklch(0.62 0.18 28)",
  water: "oklch(0.62 0.14 230)",
  bubblegum: "oklch(0.78 0.1 210)",
};

interface WindowThemeDotsProps {
  /** The window's current pick, or null when it inherits the global theme. */
  value: Theme | null;
  /** Called with the chosen theme id. */
  onChange: (theme: Theme) => void;
  /** Accessible label prefix, e.g. "Game status". */
  label: string;
  /** data-ocid prefix for deterministic testing, e.g. "status_window". */
  ocidPrefix: string;
}

/**
 * Track whether the viewport is currently in landscape orientation. Uses
 * matchMedia so the value updates live when the device is rotated, and falls
 * back to a width/height comparison when matchMedia is unavailable.
 */
function useIsLandscape(): boolean {
  const [isLandscape, setIsLandscape] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    if (typeof window.matchMedia === "function") {
      return window.matchMedia("(orientation: landscape)").matches;
    }
    return window.innerWidth >= window.innerHeight;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof window.matchMedia === "function") {
      const query = window.matchMedia("(orientation: landscape)");
      const onChange = (event: MediaQueryListEvent) =>
        setIsLandscape(event.matches);
      setIsLandscape(query.matches);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    }
    const onResize = () =>
      setIsLandscape(window.innerWidth >= window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return isLandscape;
}

/**
 * Horizontal translate (px) that keeps a row of `rowWidth` centred on the
 * true panel middle while never crossing into the left title or the
 * right-side controls. When the true middle already fits inside the free
 * space the offset is 0; otherwise the row is clamped to the nearest free
 * edge.
 */
function clampOffset(
  headerWidth: number,
  leftWidth: number,
  rightWidth: number,
  rowWidth: number,
): number {
  const trueLeft = (headerWidth - rowWidth) / 2;
  const minLeft = leftWidth;
  const maxLeft = headerWidth - rightWidth - rowWidth;
  let left = trueLeft;
  if (left < minLeft) left = minLeft;
  if (left > maxLeft) left = maxLeft;
  return left - trueLeft;
}

export function WindowThemeDots({
  value,
  onChange,
  label,
  ocidPrefix,
}: WindowThemeDotsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dotSize, setDotSize] = useState<number>(MAX_DOT);
  const [offCentre, setOffCentre] = useState<boolean>(false);
  const [offset, setOffset] = useState<number>(0);
  const isLandscape = useIsLandscape();

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const header = el.parentElement;
    if (!header) return;
    const headerWidth = header.clientWidth;
    if (headerWidth <= 0) return;

    // The overlay spans the full header, so the space actually available to
    // the row is the header width minus the shrink-0 siblings on each side
    // (the left title and the right-side controls). Siblings before the
    // overlay in DOM order sit on the left; those after it sit on the right.
    let leftWidth = 0;
    let rightWidth = 0;
    let seenSelf = false;
    for (const child of Array.from(header.children)) {
      if (child === el) {
        seenSelf = true;
        continue;
      }
      const width = (child as HTMLElement).getBoundingClientRect().width;
      if (seenSelf) rightWidth += width;
      else leftWidth += width;
    }
    const available = Math.max(0, headerWidth - leftWidth - rightWidth);

    // Natural row width at a given dot size: six hit areas + five gaps.
    const rowWidth = (size: number) =>
      THEME_ORDER.length * (size + HIT_PADDING * 2) +
      (THEME_ORDER.length - 1) * GAP;

    if (rowWidth(MAX_DOT) <= available) {
      setDotSize(MAX_DOT);
      setOffCentre(false);
      setOffset(
        clampOffset(headerWidth, leftWidth, rightWidth, rowWidth(MAX_DOT)),
      );
      return;
    }
    if (rowWidth(MIN_DOT) <= available) {
      // Shrink to the largest size that still fits, clamped to the minimum.
      const fit = Math.floor(
        (available -
          (THEME_ORDER.length - 1) * GAP -
          THEME_ORDER.length * HIT_PADDING * 2) /
          THEME_ORDER.length,
      );
      const size = Math.max(MIN_DOT, Math.min(MAX_DOT, fit));
      setDotSize(size);
      setOffCentre(false);
      setOffset(
        clampOffset(headerWidth, leftWidth, rightWidth, rowWidth(size)),
      );
      return;
    }
    // Even the minimum does not fit — keep the minimum and shift off-centre,
    // pinned just inside the right-side controls so it never covers them.
    setDotSize(MIN_DOT);
    setOffCentre(true);
    setOffset(-rightWidth);
  }, []);

  useEffect(() => {
    if (!isLandscape) return;
    measure();
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    // Observe the header, not just the overlay: the overlay always spans the
    // full header, so sibling (title/controls) width changes only surface on
    // the header box.
    observer.observe(el.parentElement ?? el);
    return () => observer.disconnect();
  }, [measure, isLandscape]);

  // Vertical/portrait view hides the picker entirely — no leftover gap.
  if (!isLandscape) return null;

  return (
    <div
      ref={containerRef}
      data-ocid={`${ocidPrefix}.theme_dots`}
      className={`pointer-events-none absolute inset-x-0 inset-y-0 flex items-center ${
        offCentre ? "justify-end" : "justify-center"
      }`}
    >
      <fieldset
        className="pointer-events-auto flex flex-nowrap items-center"
        style={{ gap: `${GAP}px`, transform: `translateX(${offset}px)` }}
      >
        <legend className="sr-only">{`${label} theme`}</legend>
        {THEME_ORDER.map((theme, index) => {
          const isActive = theme === value;
          const labelText = THEME_LABELS[theme];
          return (
            <button
              key={theme}
              type="button"
              data-ocid={`${ocidPrefix}.theme_dot.${index + 1}`}
              aria-label={`${labelText} theme${isActive ? " (active)" : ""}`}
              aria-pressed={isActive}
              title={labelText}
              onClick={() => onChange(theme)}
              className="flex shrink-0 items-center justify-center rounded-full transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{
                width: `${dotSize + HIT_PADDING * 2}px`,
                height: `${dotSize + HIT_PADDING * 2}px`,
              }}
            >
              <span
                aria-hidden="true"
                className={`block rounded-full border transition-smooth ${
                  isActive
                    ? "border-foreground ring-2 ring-ring"
                    : "border-border"
                }`}
                style={{
                  width: `${dotSize}px`,
                  height: `${dotSize}px`,
                  backgroundColor: THEME_DOT_COLORS[theme],
                }}
              />
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}

export default WindowThemeDots;
