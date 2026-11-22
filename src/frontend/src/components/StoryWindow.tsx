import { useInternetIdentity } from "@caffeineai/core-infrastructure";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  LogIn,
  LogOut,
  PenLine,
  Plus,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { StoryRow } from "../backend";
import {
  useAppendStorySection,
  useFillStoryGap,
  usePressStoryDelete,
  usePressStoryKeep,
  useStorySections,
} from "../hooks/use-story";
import { useWindowTheme } from "../hooks/use-window-theme";
import { WindowThemeDots } from "./WindowThemeDots";

/**
 * StoryWindow — a collapsible window at the bottom of the game page that
 * renders the shared JALCA story.
 *
 * The story is a communal text: the first section is the permanent "Forever"
 * section (the JALCA medieval fool story) which has NO buttons and NO edit
 * path for anyone, including the writer. Every section added after it carries
 * Delete and Keep buttons with their counters beneath them. A section is only
 * removed once Delete reaches 10 presses AND has at least three times the Keep
 * count; a removed section leaves a permanent visible gap until the writer
 * rewrites into it.
 *
 * Identity: the Delete/Keep buttons are gated by Internet Identity connection
 * (NOT the Oisy wallet and NOT the guest gameplay identity). The Story window
 * carries its OWN Internet Identity sign-in affordance in the window BODY,
 * directly above the Forever section — a "Sign in" button when signed out and
 * the reader's principal with a "Sign out" control when signed in — so there
 * is no separate app-level sign-in window. The writer composer is shown only
 * when the signed-in Internet Identity principal equals the hardcoded writer
 * principal.
 *
 * Collapse — matches the PredictionBetWindow template exactly: a full-width
 * header button with a chevron (ChevronRight collapsed / ChevronDown expanded,
 * both always mounted, toggled via Tailwind hidden/block, size-4
 * text-muted-foreground transition-smooth) and aria-expanded; the body is
 * conditionally UNMOUNTED when collapsed. Open state is persisted to
 * localStorage key "tco-story-open".
 *
 * Data loading — the sections are fetched through useStorySections(open), which
 * has NO refetchInterval and is enabled ONLY while the panel is open, so the
 * story never joins the 1500ms game poll.
 */

/* --- Open/collapsed persistence (tco-story-open) ----------------------- */

const OPEN_KEY = "tco-story-open";
const DEFAULT_OPEN = false; // collapsed by default — story loads on open

/* --- Pagination --------------------------------------------------------- */

/**
 * Sections shown per page AFTER the Forever page. Page 1 holds the Forever
 * section alone; every later page holds exactly this many live sections (the
 * final page holds the remaining 1-3 when the live count is not a multiple of
 * four).
 */
const SECTIONS_PER_PAGE = 4;

/**
 * The Forever section (position 0) always occupies page 1 by itself, so the
 * live sections start at index 1 and the first live page is page 2.
 */
const FOREVER_PAGE_COUNT = 1;

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

/* --- Writer identity ---------------------------------------------------- */

/**
 * The sole writer/editor principal, hardcoded in the backend. The frontend
 * compares the signed-in Internet Identity principal against this same literal
 * to decide whether to show the composer.
 */
const WRITER_PRINCIPAL =
  "bejgi-icebs-xhnvn-bqcpt-tx23r-ubev7-bm6mq-uonbp-mpsg7-rstfj-6ae";

/* --- Info content ------------------------------------------------------- */

/**
 * InfoContent — the explanatory panel revealed by the header Info toggle.
 *
 * Exported so a caller that renders the window embedded (no header, no Info
 * button) can still surface this content from outside the component — e.g. the
 * board view overlay's own INFO button.
 */
export function StoryInfoContent() {
  return (
    <div
      data-ocid="story.info_content"
      className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-3 py-3 text-sm leading-relaxed text-foreground"
    >
      <p className="font-semibold">How the story can be affected</p>
      <p>
        The story is written by everyone who reads it. Any visitor can press{" "}
        <span className="font-semibold">Delete</span> or{" "}
        <span className="font-semibold">Keep</span> on a section — you must be
        signed in with Internet Identity for the buttons to work.
      </p>
      <p>
        Each signed-in reader gets{" "}
        <span className="font-semibold">one vote per section</span>. Once you
        press Delete or Keep, both controls lock for you on that section and
        show that you've already voted.
      </p>
      <p>
        A section is only removed once its Delete count reaches{" "}
        <span className="font-semibold">10 presses</span> and it has at least{" "}
        <span className="font-semibold">three times</span> the Keep count.
        Otherwise the section stands.
      </p>
      <p>
        A removed section leaves a permanent gap in the story until the writer
        rewrites into it. The first section — the Forever section — can never be
        deleted or edited by anyone.
      </p>
    </div>
  );
}

/* --- In-window Internet Identity sign-in -------------------------------- */

/**
 * The Story window's own Internet Identity affordance. Signing in here
 * authenticates the reader against Internet Identity and the window reflects
 * the signed-in state immediately (the hook's context updates on success).
 *
 * Signed out: a "Sign in" button that opens the Internet Identity flow.
 * Signed in: the reader's principal (truncated) with a "Sign out" control.
 *
 * `principalText` is supplied by StoryWindow — the SAME value it uses for the
 * writing-privilege decision — so the identity shown here and the privilege
 * gate always agree. This component never re-derives the principal itself.
 *
 * This lives INSIDE the Story window body — there is no separate app-level
 * sign-in window. It is rendered directly above the Forever section so it sits
 * with the story content rather than in the window header.
 */
/**
 * Extract the real underlying failure reason from the hook's `loginError`.
 *
 * The provider stores an `Error` (see useInternetIdentity), but the value is
 * typed loosely enough that a plain string can reach us too, so both shapes
 * are handled without `any`. When no usable message exists we fall back to the
 * generic sentence so the error surface is never blank.
 */
function signInErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Sign-in failed. Please try again.";
}

/**
 * Extract the real underlying failure reason from a mutation error so the
 * writer sees the actual backend trap (e.g. the writer-gate rejection) instead
 * of a generic sentence. The provider/agent wraps traps in an `Error` whose
 * message carries the canister text; a plain string is handled too. When no
 * usable message exists we fall back to the supplied generic sentence so the
 * error surface is never blank.
 */
function mutationErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function IdentityControl({ principalText }: { principalText: string | null }) {
  const { isAuthenticated, isLoggingIn, login, clear, loginError } =
    useInternetIdentity();

  if (isAuthenticated && principalText) {
    return (
      <div className="flex min-w-0 flex-col items-end gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Signed in
          </span>
          <button
            type="button"
            data-ocid="story.sign_out_button"
            onClick={() => clear()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground transition-smooth hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LogOut className="size-3.5" aria-hidden="true" />
            Sign out
          </button>
        </div>
        {/* Full principal — never truncated or ellipsised, so the reader can
         * read and copy it in its entirety. `break-all` wraps the long string
         * instead of clipping it, and `select-all` makes a single click select
         * the whole value for copying. */}
        <code
          data-ocid="story.principal_indicator"
          title={principalText}
          className="block w-full select-all break-all rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-left font-mono text-xs leading-relaxed text-foreground"
        >
          {principalText}
        </code>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        data-ocid="story.sign_in_button"
        onClick={() => login()}
        disabled={isLoggingIn}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground transition-smooth hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isLoggingIn ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <LogIn className="size-3.5" aria-hidden="true" />
        )}
        {isLoggingIn ? "Signing in…" : "Sign in"}
      </button>
      {loginError ? (
        <p
          data-ocid="story.sign_in_error"
          className="max-w-[14rem] text-right text-xs text-destructive"
        >
          {signInErrorMessage(loginError)}
        </p>
      ) : null}
    </div>
  );
}

/* --- Section voting controls ------------------------------------------- */

function SectionVotes({
  section,
  canVote,
}: {
  section: StoryRow;
  canVote: boolean;
}) {
  const deleteMutation = usePressStoryDelete();
  const keepMutation = usePressStoryKeep();
  const pending = deleteMutation.isPending || keepMutation.isPending;

  // Caller-relative vote state from the backend. Defensive `=== true` so a
  // missing field (older fixture) reads as "not yet voted" rather than
  // disabling the controls.
  const hasVotedDelete = section.hasVotedDelete === true;
  const hasVotedKeep = section.hasVotedKeep === true;
  const hasVoted = hasVotedDelete || hasVotedKeep;

  const deleteDisabled = !canVote || pending || hasVoted;
  const keepDisabled = !canVote || pending || hasVoted;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-ocid={`story.delete_button.${Number(section.index)}`}
          onClick={() => deleteMutation.mutate(section.index)}
          disabled={deleteDisabled}
          aria-pressed={hasVotedDelete}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${
            hasVotedDelete
              ? "border-destructive bg-destructive/15 text-destructive"
              : "border-border bg-background text-destructive hover:bg-destructive/10"
          }`}
        >
          <ThumbsDown className="size-3.5" aria-hidden="true" />
          {hasVotedDelete ? "Delete · voted" : "Delete"}
        </button>
        <button
          type="button"
          data-ocid={`story.keep_button.${Number(section.index)}`}
          onClick={() => keepMutation.mutate(section.index)}
          disabled={keepDisabled}
          aria-pressed={hasVotedKeep}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${
            hasVotedKeep
              ? "border-primary bg-primary/15 text-primary"
              : "border-border bg-background text-foreground hover:bg-muted/60"
          }`}
        >
          <ThumbsUp className="size-3.5" aria-hidden="true" />
          {hasVotedKeep ? "Keep · voted" : "Keep"}
        </button>
      </div>
      <p
        data-ocid={`story.counters.${Number(section.index)}`}
        className="font-mono text-xs text-muted-foreground"
      >
        Delete {section.deleteCount.toString()} · Keep{" "}
        {section.keepCount.toString()}
      </p>
      {!canVote ? (
        <p className="text-xs text-muted-foreground">
          Sign in with Internet Identity to press Delete or Keep.
        </p>
      ) : hasVoted ? (
        <p
          data-ocid={`story.voted_state.${Number(section.index)}`}
          className="text-xs text-muted-foreground"
        >
          You've already voted on this section.
        </p>
      ) : null}
    </div>
  );
}

/* --- Writer gap-fill control ------------------------------------------- */

function GapFillControl({ index }: { index: bigint }) {
  const [text, setText] = useState("");
  const fillMutation = useFillStoryGap();
  const trimmed = text.trim();

  const handleSubmit = () => {
    if (!trimmed) return;
    const captured = trimmed;
    setText("");
    fillMutation.mutate(
      { index, text: captured },
      {
        onError: () => {
          setText((current) => (current === "" ? captured : current));
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={`story-gap-fill-${Number(index)}`}
        className="window-heading text-xs font-semibold uppercase tracking-wide"
      >
        Fill this gap
      </label>
      <textarea
        id={`story-gap-fill-${Number(index)}`}
        data-ocid={`story.gap_fill_textarea.${Number(index)}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Rewrite this section…"
        className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <button
        type="button"
        data-ocid={`story.gap_fill_button.${Number(index)}`}
        onClick={handleSubmit}
        disabled={!trimmed || fillMutation.isPending}
        className="inline-flex items-center justify-center gap-1.5 self-start rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-smooth hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        {fillMutation.isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <PenLine className="size-4" aria-hidden="true" />
        )}
        {fillMutation.isPending ? "Filling…" : "Fill this gap"}
      </button>
      {fillMutation.isError ? (
        <p
          data-ocid={`story.gap_fill_error.${Number(index)}`}
          className="text-xs text-destructive"
        >
          {mutationErrorMessage(
            fillMutation.error,
            "Couldn't fill this gap. Please try again.",
          )}
        </p>
      ) : null}
    </div>
  );
}

/* --- Writer composer ---------------------------------------------------- */

function WriterComposer() {
  const [text, setText] = useState("");
  const appendMutation = useAppendStorySection();
  const trimmed = text.trim();

  const handleSubmit = () => {
    if (!trimmed) return;
    const captured = trimmed;
    setText("");
    appendMutation.mutate(captured, {
      onError: () => {
        setText((current) => (current === "" ? captured : current));
      },
    });
  };

  return (
    <div
      data-ocid="story.composer"
      className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-3 py-3"
    >
      <label
        htmlFor="story-new-section"
        className="window-heading text-xs font-semibold uppercase tracking-wide"
      >
        Add a new section
      </label>
      <textarea
        id="story-new-section"
        data-ocid="story.composer_textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="Continue the story…"
        className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <button
        type="button"
        data-ocid="story.add_section_button"
        onClick={handleSubmit}
        disabled={!trimmed || appendMutation.isPending}
        className="inline-flex items-center justify-center gap-1.5 self-start rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-smooth hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        {appendMutation.isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Plus className="size-4" aria-hidden="true" />
        )}
        {appendMutation.isPending ? "Adding…" : "Add section"}
      </button>
      {appendMutation.isError ? (
        <p
          data-ocid="story.add_section_error"
          className="text-xs text-destructive"
        >
          {mutationErrorMessage(
            appendMutation.error,
            "Couldn't add the section. Please try again.",
          )}
        </p>
      ) : null}
    </div>
  );
}

/* --- Component ---------------------------------------------------------- */

export interface StoryWindowProps {
  /** When true, render only the body — no collapsible header, no chevron, no
   * per-window theme dots — and treat the window as always open, so the story
   * is fetched while the component is mounted. The old per-window localStorage
   * open key is neither read nor written on this path. When absent, the
   * component behaves exactly as before. */
  embedded?: boolean;
}

export function StoryWindow({ embedded = false }: StoryWindowProps) {
  const [open, setOpen] = useState<boolean>(() =>
    embedded ? true : readStoredOpen(),
  );
  const [showInfo, setShowInfo] = useState<boolean>(false);
  const [page, setPage] = useState<number>(0);
  const { windowTheme, setWindowTheme, rootRef } =
    useWindowTheme("story_window");

  // The signed-in principal is derived ONCE here and is the single value used
  // both for the header's displayed identity (passed to IdentityControl) and
  // for the writing-privilege decision below. Because the display and the gate
  // read the exact same string, they can never disagree.
  const { identity, isAuthenticated } = useInternetIdentity();
  const principalText = identity ? identity.getPrincipal().toText() : null;
  const isWriter = principalText === WRITER_PRINCIPAL;

  // Persist React state → localStorage whenever it changes. Skipped on the
  // embedded path so the old per-window open key is never written.
  useEffect(() => {
    if (embedded) return;
    writeStoredOpen(open);
  }, [open, embedded]);

  // The body renders whenever the window is open; on the embedded path it is
  // always shown, so the story is fetched while the component is mounted.
  const bodyOpen = embedded || open;

  // Fetch only while the panel is showing — no refetchInterval, so the story
  // never joins the 1500ms game poll. The principal is part of the query key,
  // so signing in/out refetches the caller-relative vote flags.
  const { sections, isLoading, error, refetch } = useStorySections(
    bodyOpen,
    principalText,
  );

  // Pagination over the full ordered section list. The Forever section
  // (position 0) renders ALONE on page 1; every page after it holds exactly
  // SECTIONS_PER_PAGE live sections, with the final page holding the remaining
  // 1-3 when the live count is not a multiple of four. `totalPages` is at
  // least 1 so the indicator reads "1 of 1" for an empty/short story.
  // `currentPage` is CLAMPED against the live section count rather than stored
  // raw, so when a section is appended or deleted the view falls back to the
  // last valid page instead of rendering an empty page. The stored `page` is
  // only ever moved by the back/forward controls.
  const liveSectionCount = Math.max(0, sections.length - FOREVER_PAGE_COUNT);
  const totalPages = Math.max(
    1,
    FOREVER_PAGE_COUNT + Math.ceil(liveSectionCount / SECTIONS_PER_PAGE),
  );
  const currentPage = Math.min(page, totalPages - 1);
  // Page 1 is the Forever section alone; later pages slice the live sections
  // (which begin at index 1) in groups of SECTIONS_PER_PAGE.
  const pageStart =
    currentPage === 0
      ? 0
      : FOREVER_PAGE_COUNT + (currentPage - 1) * SECTIONS_PER_PAGE;
  const pageEnd =
    currentPage === 0 ? FOREVER_PAGE_COUNT : pageStart + SECTIONS_PER_PAGE;
  const pageSections = sections.slice(pageStart, pageEnd);
  const isFirstPage = currentPage === 0;
  const isLastPage = currentPage >= totalPages - 1;

  return (
    <div
      ref={rootRef}
      data-ocid="story_window"
      className="flex w-full flex-col bg-card overflow-hidden"
    >
      {/* Header — three-part flex row: left shrink-0 toggle button, centred
       * per-window theme dots, right shrink-0 info button. The dots stay
       * centred and never overlap either side. The Internet Identity sign-in
       * affordance lives in the body, above the Forever section. Skipped
       * entirely on the embedded path. */}
      {embedded ? null : (
        <div className="relative flex w-full items-center justify-between border-b border-border">
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            data-ocid="story_window.header"
            aria-expanded={open}
            aria-controls="story-window-body"
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
            <span className="window-heading text-sm font-semibold">Story</span>
          </button>

          <WindowThemeDots
            value={windowTheme}
            onChange={setWindowTheme}
            label="Story"
            ocidPrefix="story_window"
          />

          <button
            type="button"
            onClick={() => setShowInfo((current) => !current)}
            data-ocid="story_window.info_button"
            aria-pressed={showInfo}
            aria-label="Toggle story information"
            className={`flex shrink-0 items-center gap-1.5 px-4 py-3 text-xs font-semibold uppercase tracking-wide transition-smooth hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
              showInfo ? "text-accent" : "text-muted-foreground"
            }`}
          >
            <Info className="size-4" aria-hidden="true" />
            Info
          </button>
        </div>
      )}

      {/* In-window Internet Identity sign-in — a persistent strip in the
       * window body, directly above the collapsible story content. It is
       * ALWAYS mounted (whether the panel is open or collapsed) so the
       * affordance stays reachable without expanding the panel. */}
      <div className="flex w-full items-center justify-end border-b border-border px-4 py-2">
        <IdentityControl principalText={principalText} />
      </div>

      {/* Body — conditionally UNMOUNTED when collapsed, so no story request
       * runs while the panel is closed. On the embedded path it is always
       * shown. */}
      {bodyOpen ? (
        <div
          id="story-window-body"
          className="flex w-full flex-col gap-3 px-4 py-3"
        >
          {showInfo ? <StoryInfoContent /> : null}

          {isLoading ? (
            <div
              data-ocid="story.loading_state"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading the story…
            </div>
          ) : error ? (
            <div
              data-ocid="story.error_state"
              className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-3 py-3"
            >
              <p className="text-sm text-destructive">
                Couldn't load the story. Please try again.
              </p>
              <button
                type="button"
                data-ocid="story.retry_button"
                onClick={() => void refetch()}
                className="inline-flex items-center justify-center gap-1.5 self-start rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition-smooth hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Retry
              </button>
            </div>
          ) : sections.length === 0 ? (
            <p
              data-ocid="story.empty_state"
              className="text-sm text-muted-foreground"
            >
              The story hasn't started yet.
            </p>
          ) : (
            <>
              <ol className="flex flex-col gap-3">
                {pageSections.map((section, pagePosition) => {
                  // Global position in the full ordered list — the Forever
                  // section is always position 0, and the ocid markers stay
                  // stable across pages.
                  const position = pageStart + pagePosition;
                  const isForever = position === 0;
                  return (
                    <li
                      key={section.index.toString()}
                      data-ocid={`story.section.${position + 1}`}
                      className="flex flex-col gap-2"
                    >
                      {isForever ? (
                        /* Forever section — permanent, no buttons, no counters,
                         * no edit path for anyone. */
                        <div
                          data-ocid="story.forever_section"
                          className="rounded-md border border-border bg-muted/40 px-3 py-3"
                        >
                          <p className="window-heading mb-1.5 text-xs font-semibold uppercase tracking-wide">
                            Forever
                          </p>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                            {section.text}
                          </p>
                        </div>
                      ) : section.deleted ? (
                        /* Deleted section — permanent visible gap until the
                         * writer rewrites into it. */
                        <div
                          data-ocid={`story.gap.${Number(section.index)}`}
                          className="flex flex-col gap-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-3"
                        >
                          <p className="text-sm italic text-muted-foreground">
                            This section was removed and awaits rewriting.
                          </p>
                          {isWriter ? (
                            <GapFillControl index={section.index} />
                          ) : null}
                        </div>
                      ) : (
                        <>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                            {section.text}
                          </p>
                          <SectionVotes
                            section={section}
                            canVote={isAuthenticated}
                          />
                        </>
                      )}
                    </li>
                  );
                })}
              </ol>

              {/* Pagination — back/forward controls and a page indicator,
               * styled to match the window's other bordered controls. */}
              <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                <button
                  type="button"
                  data-ocid="story.pagination_prev"
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                  disabled={isFirstPage}
                  aria-label="Previous page of story sections"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition-smooth hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ChevronLeft className="size-3.5" aria-hidden="true" />
                  Back
                </button>
                <p
                  data-ocid="story.page_indicator"
                  className="font-mono text-xs text-muted-foreground"
                >
                  Page {currentPage + 1} of {totalPages}
                </p>
                <button
                  type="button"
                  data-ocid="story.pagination_next"
                  onClick={() =>
                    setPage((current) => Math.min(totalPages - 1, current + 1))
                  }
                  disabled={isLastPage}
                  aria-label="Next page of story sections"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition-smooth hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Forward
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </>
          )}

          {/* Writer composer — only the hardcoded writer principal sees it.
           * Non-writers see no add/fill controls at all. */}
          {isWriter ? <WriterComposer /> : null}
        </div>
      ) : null}
    </div>
  );
}

export default StoryWindow;
