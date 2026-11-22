import { X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { clearGuidePending } from "../lib/guide-preference";

/**
 * GuidedTour — an 8-step, non-blocking walkthrough of the /game windows and
 * the header's OpenChat wizard icon.
 *
 * Each step targets an existing element by its `data-ocid` marker (never by
 * editing the window component). The tour never expands a window or touches a
 * window's localStorage keys — it only highlights the collapsed window card.
 *
 * Rendering — the card is portaled to `document.body` at z-[80] so it sits
 * above every window and overlay. The dimmed backdrop (`bg-background/70`) at
 * z-40 blocks page clicks for the duration of the tour while leaving the
 * highlighted target sharp — it deliberately carries no blur. The card itself uses the
 * global theme (`.window-card` + `.window-heading`, `--primary` for Next,
 * `--font-display` / `--font-body`) — NOT any window's per-window theme.
 *
 * Placement — when a step opens the page is scrolled ONCE so the highlighted
 * window and the card can share the viewport. The card sits below the highlight
 * when there is room, above it when there is not, and beside the visible
 * portion of a window taller than the viewport. It is always clamped fully
 * inside the viewport and never overlaps the highlight ring. The card's
 * position is derived from the target's live on-screen rect, so it keeps
 * tracking the highlighted window while the page scrolls — the card and the
 * highlight ring stay aligned. The one-time scroll is keyed on the step alone
 * (with a last-scrolled-step ref as a backstop), so neither scrolling the page
 * nor a parent re-render nor a resize scrolls it back up away from the card;
 * viewport/resize changes only reposition the card.
 *
 * Sizing — the card's real rendered height is measured from the DOM (and kept
 * current with a ResizeObserver, so a late web-font reflow cannot leave the
 * card taller than the height the placement math assumed). The card is hidden
 * until the target rect is known, so it never flashes at a stale position. Its
 * height is capped to the viewport so a tall card scrolls internally instead
 * of being cut off below the fold.
 *
 * Lifecycle — the parent (game route) mounts this component only while the
 * tour should run. Finishing, skipping, or pressing Escape calls `onEnd`,
 * which clears the pending flag so the tour does not auto-start again.
 */

export interface GuidedTourStep {
  /** The `data-ocid` of the window this step highlights. */
  targetOcid: string;
  title: string;
  /** One or more short lines of copy. */
  lines: string[];
}

export const GUIDED_TOUR_STEPS: GuidedTourStep[] = [
  {
    targetOcid: "brand.wordmark.top",
    title: "JALCA",
    lines: [
      "This is a multiplayer game without bots. A game can only begin when at least two players are logged in.",
    ],
  },
  {
    targetOcid: "window.voting",
    title: "Vote on next game",
    lines: [
      "Choose whether spells should used or not, and if you prefer Standard Opening or a Random Opening",
    ],
  },
  {
    targetOcid: "window.status",
    title: "Game status",
    lines: ["See whose turn it is and how long they have to move."],
  },
  {
    targetOcid: "window.board",
    title: "Board",
    lines: ["Play your moves here when it's your turn."],
  },
  {
    targetOcid: "window.wallet",
    title: "NFT Spell burning",
    lines: [
      "Connect your Oisy wallet before a game ends for a chance to win NFTs.",
      "Place a bet for a guaranteed NFT, win or lose, once your ICP reaches escrow (bets are in Prediction Bet, below).",
      "Connect Oisy to burn spells and cast them. Only the Move Maker can cast. Tap the info icon for more.",
    ],
  },
  {
    targetOcid: "window.players",
    title: "Players",
    lines: ["See who's in the game and vote to kick."],
  },
  {
    targetOcid: "window.story",
    title: "Story",
    lines: [
      "Read and, if signed in with Internet Identity, choose which pieces should be kept or deleted",
    ],
  },
  {
    targetOcid: "window.leaderboard",
    title: "Leaderboard",
    lines: [
      "Sign in with Internet Identity and get ranked with accumulated wins. Watch out for prize competitions.",
    ],
  },
  {
    targetOcid: "header.openchat_link",
    title: "OpenChat wizard",
    lines: ["Click the wizard to open the JALCA OpenChat channel."],
  },
];

export interface GuidedTourProps {
  /** Called when the tour finishes, is skipped, or is ended externally. */
  onEnd: () => void;
}

// Gap between the card and the highlight ring. The ring is drawn 4px outside
// the target rect (ring-4 + ring-offset-2), so 16px leaves a clear 6px of
// daylight and the card can never overlap it.
const CARD_GAP = 16;
// Gap between the card and the viewport edge.
const EDGE_MARGIN = 8;
const CARD_MAX_WIDTH = 384; // 24rem

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function readRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The visible viewport height. `window.visualViewport.height` reflects the
 * actually-visible area on mobile (excluding browser chrome and the on-screen
 * keyboard) and is the correct reference for keeping the card on screen;
 * `window.innerHeight` is the fallback where visualViewport is unavailable.
 */
function readViewportHeight(): number {
  if (typeof window === "undefined") return 768;
  const vv = window.visualViewport;
  if (vv && typeof vv.height === "number" && vv.height > 0) return vv.height;
  return window.innerHeight;
}

function readViewportWidth(): number {
  if (typeof window === "undefined") return 1024;
  const vv = window.visualViewport;
  if (vv && typeof vv.width === "number" && vv.width > 0) return vv.width;
  return window.innerWidth;
}

/**
 * The document scroll position that lets the target and the card share the
 * viewport. The card is placed below the target when the whole target plus the
 * card fit; otherwise (a target taller than the space left for it) the target's
 * top is shown with the card above it, falling back to the target's bottom with
 * the card below when the target sits too close to the top of the document to
 * be pushed down. The result is clamped to the scrollable range.
 *
 * `cardHeight` is the card's effective (viewport-capped) height, so a card
 * taller than the viewport still leaves the target's visible portion on screen.
 */
function computeScrollTarget(
  elTop: number,
  elHeight: number,
  cardHeight: number,
  viewportH: number,
  maxScroll: number,
): number {
  const fitsTogether =
    elHeight + cardHeight + CARD_GAP + 2 * EDGE_MARGIN <= viewportH;
  if (fitsTogether) {
    // Whole target + card fit: target near the top, card below it.
    return clamp(elTop - EDGE_MARGIN, 0, maxScroll);
  }
  // Tall target: show its top with the card above when the target can be
  // pushed down enough; otherwise show its bottom with the card below.
  const aboveY = elTop - (EDGE_MARGIN + cardHeight + CARD_GAP);
  if (aboveY >= 0) return clamp(aboveY, 0, maxScroll);
  const belowY =
    elTop + elHeight + CARD_GAP + cardHeight + EDGE_MARGIN - viewportH;
  return clamp(belowY, 0, maxScroll);
}

/**
 * The card's viewport position for a settled target rect: below the target when
 * there is room, above it when there is not, always clamped fully inside the
 * viewport and horizontally centred on the target. The card never overlaps the
 * highlight ring because the chosen side always leaves at least CARD_GAP.
 */
function computeCardPlacement(
  target: Rect,
  cardHeight: number,
  cardWidth: number,
  viewportW: number,
  viewportH: number,
): { top: number; left: number } {
  const spaceBelow = viewportH - (target.top + target.height);
  const spaceAbove = target.top;
  let top: number;
  if (spaceBelow >= cardHeight + CARD_GAP) {
    top = target.top + target.height + CARD_GAP;
  } else if (spaceAbove >= cardHeight + CARD_GAP) {
    top = target.top - cardHeight - CARD_GAP;
  } else {
    // Safety net: the placement-aware scroll normally guarantees one side
    // fits. Pin to the roomier side and clamp inside the viewport.
    top =
      spaceBelow >= spaceAbove
        ? viewportH - cardHeight - EDGE_MARGIN
        : EDGE_MARGIN;
  }
  const maxTop = Math.max(EDGE_MARGIN, viewportH - cardHeight - EDGE_MARGIN);
  const maxLeft = Math.max(EDGE_MARGIN, viewportW - cardWidth - EDGE_MARGIN);
  return {
    top: clamp(top, EDGE_MARGIN, maxTop),
    left: clamp(
      target.left + target.width / 2 - cardWidth / 2,
      EDGE_MARGIN,
      maxLeft,
    ),
  };
}

export function GuidedTour({ onEnd }: GuidedTourProps) {
  const [stepIndex, setStepIndex] = useState(0);
  // The target's live on-screen rect — drives the highlight ring AND the card
  // placement, so both keep tracking the window while the page scrolls.
  const [liveRect, setLiveRect] = useState<Rect | null>(null);
  // The card's measured height, read after mount so the placement math can
  // keep the card fully inside the viewport. Kept current by a ResizeObserver
  // so a late web-font reflow cannot leave the card taller than assumed.
  const [cardHeight, setCardHeight] = useState(0);
  const [viewport, setViewport] = useState(() => ({
    w: readViewportWidth(),
    h: readViewportHeight(),
  }));
  // Bumped on every resize event so the card re-reads the target's rect even
  // when the viewport dimensions themselves are unchanged (the highlighted
  // window may have moved without the viewport changing size).
  const [resizeNonce, setResizeNonce] = useState(0);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const nextButtonRef = useRef<HTMLButtonElement | null>(null);
  // The element that had focus before the tour opened, restored on end.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  // Backstop for the one-time placement scroll: the step key whose scroll has
  // already run. Even if the scroll effect re-runs for the same step (a
  // StrictMode double-invoke or a remount), the page is never scrolled twice.
  const lastScrolledStepRef = useRef<string | null>(null);

  const step = GUIDED_TOUR_STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === GUIDED_TOUR_STEPS.length - 1;

  // End the tour: clear the pending flag and hand control back to the parent.
  const endTour = useCallback(() => {
    clearGuidePending();
    onEnd();
  }, [onEnd]);

  // The positioning effect must not re-run when the parent re-renders (the
  // game route polls, so `onEnd` gets a new identity every second). Reading
  // the latest `endTour` through a ref keeps the effect keyed only on the step
  // and the viewport, so a parent re-render never re-scrolls the page.
  const endTourRef = useRef(endTour);
  useEffect(() => {
    endTourRef.current = endTour;
  }, [endTour]);

  // Capture the previously-focused element once, on mount.
  useEffect(() => {
    previouslyFocusedRef.current =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;
  }, []);

  // Restore focus when the tour unmounts.
  useEffect(() => {
    return () => {
      const el = previouslyFocusedRef.current;
      if (el && typeof el.focus === "function") el.focus();
    };
  }, []);

  // Track the viewport size so the card repositions on resize. `visualViewport`
  // is preferred on mobile because it reflects the actually-visible area as the
  // browser chrome shows/hides; `window.resize` is the fallback.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => {
      const w = readViewportWidth();
      const h = readViewportHeight();
      setViewport((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      setResizeNonce((n) => n + 1);
    };
    window.addEventListener("resize", onResize);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      vv?.removeEventListener("resize", onResize);
    };
  }, []);

  // Keep the card's measured height current. The card's content can reflow
  // after the first paint (web fonts, wrapping), so a one-time read is not
  // enough — a ResizeObserver re-reads the real height and the placement math
  // re-clamps the card fully inside the viewport.
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const h = el.getBoundingClientRect().height;
      if (h > 0) setCardHeight((prev) => (prev === h ? prev : h));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Position the card for the current step. Runs before paint so the card
  // never flashes at a stale position. Scrolls the page ONCE so the highlight
  // and the card can share the viewport, then records the target's settled
  // rect. The card's position is derived from that live rect (see below), so
  // it keeps tracking the target on scroll.
  //
  // Keyed on the step ALONE — never on the viewport, the measured card height,
  // or a parent re-render. The viewport height and the card's measured height
  // are read directly here (a pure function and a ref) rather than through
  // state, so a resize or a late reflow cannot re-run this effect and scroll
  // the page back up away from the highlighted window. `lastScrolledStepRef`
  // is a second guard: even a StrictMode double-invoke scrolls only once.
  useLayoutEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }
    const el = document.querySelector(`[data-ocid="${step.targetOcid}"]`);
    if (!el) {
      // Skip a step whose target is missing; end the tour if none remain.
      if (stepIndex < GUIDED_TOUR_STEPS.length - 1) {
        setStepIndex((i) => i + 1);
      } else {
        endTourRef.current();
      }
      return;
    }

    const viewportH = readViewportHeight();
    const cardEl = cardRef.current;
    const measuredHeight = cardEl ? cardEl.getBoundingClientRect().height : 0;
    if (measuredHeight > 0) setCardHeight(measuredHeight);

    // The effective card height is capped to the viewport so a card taller
    // than the screen still leaves the target's visible portion on screen.
    const effectiveCardHeight = Math.min(
      measuredHeight,
      Math.max(0, viewportH - 2 * EDGE_MARGIN),
    );

    // Scroll once so the target and the card can both be on screen. The
    // last-scrolled-step ref makes this a true one-time scroll per step.
    const stepKey = `${step.targetOcid}:${stepIndex}`;
    if (lastScrolledStepRef.current !== stepKey) {
      lastScrolledStepRef.current = stepKey;
      const before = el.getBoundingClientRect();
      const elTop = before.top + window.scrollY;
      const maxScroll = Math.max(
        0,
        document.documentElement.scrollHeight - viewportH,
      );
      const desiredScroll = computeScrollTarget(
        elTop,
        before.height,
        effectiveCardHeight,
        viewportH,
        maxScroll,
      );
      if (typeof window.scrollTo === "function") {
        window.scrollTo({ top: desiredScroll, behavior: "auto" });
      }
    }

    // Record the settled rect; the card placement is derived from it.
    setLiveRect(readRect(el));
  }, [step.targetOcid, stepIndex]);

  // Reposition the card when the viewport changes (a resize, or mobile browser
  // chrome showing/hiding). This effect ONLY updates the card's position — it
  // never scrolls the page, so a resize cannot pull the page back up away from
  // the highlighted window. `resizeNonce` is read so a resize re-runs this even
  // when the viewport dimensions themselves are unchanged.
  useEffect(() => {
    // Read the viewport and resize nonce so a resize re-runs this effect even
    // when the target's own rect is unchanged; the body only repositions.
    void viewport.w;
    void viewport.h;
    void resizeNonce;
    if (typeof window === "undefined") return;
    const el = document.querySelector(`[data-ocid="${step.targetOcid}"]`);
    if (!el) return;
    setLiveRect(readRect(el));
  }, [step.targetOcid, viewport.w, viewport.h, resizeNonce]);

  // Keep the highlight ring AND the card tracking the target while the user
  // scrolls, and when the target itself resizes. Both are derived from
  // `liveRect`, so they stay aligned with the highlighted window.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = document.querySelector(`[data-ocid="${step.targetOcid}"]`);
    if (!el) return;
    const update = () => setLiveRect(readRect(el));
    window.addEventListener("scroll", update, true);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(update);
      observer.observe(el);
    }
    return () => {
      window.removeEventListener("scroll", update, true);
      observer?.disconnect();
    };
  }, [step.targetOcid]);

  // Focus the Next button whenever a step opens. `stepIndex` is read so the
  // effect re-runs on each step change (the button element is stable).
  useEffect(() => {
    void stepIndex;
    nextButtonRef.current?.focus();
  }, [stepIndex]);

  // Capture-phase Escape listener: stopPropagation so child popup handlers
  // (wallet, captured tray, player list, promotion, etc.) do not also fire.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        endTourRef.current();
        return;
      }
      if (e.key === "ArrowRight") {
        e.stopPropagation();
        setStepIndex((i) => Math.min(i + 1, GUIDED_TOUR_STEPS.length - 1));
        return;
      }
      if (e.key === "ArrowLeft") {
        e.stopPropagation();
        setStepIndex((i) => Math.max(i - 1, 0));
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // Keep Tab within the card (no focus-trap helper exists in the app).
  const onCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const el = cardRef.current;
    if (!el) return;
    const focusables = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const goNext = () => {
    if (isLast) {
      endTour();
      return;
    }
    setStepIndex((i) => i + 1);
  };

  const goBack = () => {
    setStepIndex((i) => Math.max(i - 1, 0));
  };

  const cardWidth = Math.min(
    CARD_MAX_WIDTH,
    Math.max(0, viewport.w - 2 * EDGE_MARGIN),
  );

  // The card's effective height: its measured height capped to the viewport so
  // a tall card scrolls internally rather than being cut off below the fold.
  const effectiveCardHeight = Math.min(
    cardHeight,
    Math.max(0, viewport.h - 2 * EDGE_MARGIN),
  );

  // The card's viewport position, derived from the target's live rect so the
  // card and the highlight ring stay aligned as the page scrolls. Recomputed
  // whenever the target moves (scroll/resize) or the viewport changes. The
  // card is shown as soon as the target rect is known; the measured height
  // (0 until the first read) only refines the clamp.
  const placement = useMemo(
    () =>
      liveRect
        ? computeCardPlacement(
            liveRect,
            effectiveCardHeight,
            cardWidth,
            viewport.w,
            viewport.h,
          )
        : null,
    [liveRect, effectiveCardHeight, cardWidth, viewport.w, viewport.h],
  );

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      {/* Dimmed backdrop — blocks page clicks for the tour's duration (z-40,
       * matching InformationModal). Deliberately unblurred so the highlighted
       * target stays sharp while a step is active. The highlight ring is
       * drawn as a separate pointer-events-none layer above it. */}
      <div
        data-ocid="guided_tour.backdrop"
        className="fixed inset-0 z-40 bg-background/70"
        aria-hidden="true"
      />

      {/* Highlight ring over the current target. pointer-events-none so it
       * never intercepts clicks; the backdrop below it already blocks them.
       * Tracks the target's live on-screen rect while the page scrolls. */}
      {liveRect && (
        <div
          data-ocid="guided_tour.highlight"
          aria-hidden="true"
          className="pointer-events-none fixed z-40 rounded-lg ring-4 ring-primary ring-offset-2 ring-offset-background motion-safe:transition-all motion-safe:duration-200"
          style={{
            top: liveRect.top - 4,
            left: liveRect.left - 4,
            width: liveRect.width + 8,
            height: liveRect.height + 8,
          }}
        />
      )}

      {/* Tour card — portaled to body at z-[80], above every window and
       * overlay. Uses the global theme via .window-card / .window-heading.
       * Positioned from the target's live rect, so it stays aligned with the
       * highlighted window as the page scrolls. Hidden until the target rect
       * is known, so it never flashes at a stale position. */}
      <div
        ref={cardRef}
        data-ocid="guided_tour.card"
        // biome-ignore lint/a11y/useSemanticElements: overlay card requires a div for fixed positioning
        role="dialog"
        aria-modal="true"
        aria-labelledby="guided-tour-title"
        onKeyDown={onCardKeyDown}
        className="window-card fixed z-[80] flex flex-col gap-3 p-4 motion-safe:transition-all motion-safe:duration-200"
        style={{
          // Inline `position: fixed` so no stylesheet rule — including
          // `.window-card`'s `position: relative` — can override it. The card
          // lives in viewport coordinates from getBoundingClientRect().
          position: "fixed",
          top: placement?.top ?? 0,
          left: placement?.left ?? 0,
          width: cardWidth,
          maxHeight: Math.max(0, viewport.h - 2 * EDGE_MARGIN),
          overflowY: "auto",
          visibility: placement ? "visible" : "hidden",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p
              data-ocid="guided_tour.step_counter"
              className="font-body text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              {stepIndex + 1} of {GUIDED_TOUR_STEPS.length}
            </p>
            <h2
              id="guided-tour-title"
              className={
                isFirst
                  ? "window-heading mt-0.5 inline-block rounded-md bg-primary/15 px-2 py-0.5 text-base font-semibold text-primary ring-1 ring-primary/30"
                  : "window-heading mt-0.5 text-base font-semibold"
              }
            >
              {step.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={endTour}
            data-ocid="guided_tour.skip_button"
            aria-label="Skip the guide"
            title="Skip the guide"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-smooth"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          {step.lines.map((line) => (
            <p
              key={line}
              className="font-body text-sm leading-relaxed text-foreground"
            >
              {line}
            </p>
          ))}
        </div>

        <div className="mt-1 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={goBack}
            disabled={isFirst}
            data-ocid="guided_tour.back_button"
            className="inline-flex items-center justify-center rounded-md border border-border bg-background px-3 py-1.5 font-body text-sm font-medium text-foreground hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 transition-smooth"
          >
            Back
          </button>
          <button
            ref={nextButtonRef}
            type="button"
            onClick={goNext}
            data-ocid="guided_tour.next_button"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-1.5 font-body text-sm font-semibold text-primary-foreground hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-smooth"
          >
            {isLast ? "Finish and play" : "Next"}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

export default GuidedTour;
