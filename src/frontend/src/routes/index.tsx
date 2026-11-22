import { useInternetIdentity } from "@caffeineai/core-infrastructure";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoute, useNavigate } from "@tanstack/react-router";
import { Eye, Loader2, LogIn, Swords } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type GameStateSnapshot, WalletSource } from "../backend";
import { OpenChatIcon } from "../components/OpenChatIcon";
import { Wordmark } from "../components/Wordmark";
import {
  clearRankedIdentity,
  clearRankedSession,
  generateRankedKey,
  readRankedIdentity,
  setRankedIdentity,
  setRankedSession,
  startSpectating,
  useGuestIdentity,
} from "../hooks/use-guest-identity";
import { useTheme } from "../hooks/use-theme";
import { unlockAudio } from "../lib/audio-unlock";
import { getActor, useActorState } from "../lib/backend-actor";
import {
  readGuidePref,
  writeGuidePending,
  writeGuidePref,
} from "../lib/guide-preference";
import { getGamePollMs } from "../lib/poll-interval";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: LoginRoute,
});

/**
 * Translates a ranked-login failure into plain words for the player.
 *
 * The backend traps (Runtime.trap) rather than returning a typed rejection, so
 * the caught error is a generic Error whose `message` is the trap string. We
 * match the known rejection reasons and return a plain-language explanation;
 * any unrecognised reason falls back to a clear generic message so the failure
 * is never silent.
 */
export function describeRankedLoginError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const message = raw.toLowerCase();

  if (message.includes("already in use by a guest")) {
    return "That name is already in use by a guest. Sign in as a guest or pick another name.";
  }
  if (message.includes("bound to a different internet identity")) {
    return "That name is already linked to a different Internet Identity account. Pick another name.";
  }
  if (message.includes("bound to an internet identity account")) {
    return "That name is linked to an Internet Identity account. Sign in with Internet Identity to use it.";
  }
  if (message.includes("invalid roster key")) {
    return "This sign-in key is not valid. Please try again.";
  }
  if (message.includes("requires a signed-in internet identity")) {
    return "Ranked play needs a signed-in Internet Identity. Please sign in and try again.";
  }
  return "Could not join the game. Please try again.";
}

function LoginRoute() {
  // The guest key: the guest pseudo-principal from the guest slot
  // (`team-chess-principal`), which `useGuestIdentity()` returns for a
  // non-spectator. Guest login must use this key — never the ranked key from
  // the ranked slot — so a guest join never reuses a ranked identity. The
  // ranked path mints its own key and writes it to the ranked slot separately.
  const guestKey = useGuestIdentity();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    actor,
    isLoading: actorLoading,
    error: actorError,
    retry,
  } = useActorState();
  const { theme } = useTheme();

  // Live "players online" count. Polls getGameState every 1500ms (the same
  // cadence and query key as useGameState on the game route, so the cache is
  // shared). The backend's cleanupStalePlayers removes idle players (lastPing
  // older than 15s) from the players array on every getGameState, so
  // players.length reflects currently-online players. We deliberately count
  // the full array rather than filtering by isFresh: isFresh is a
  // game-readiness flag (a player becomes stale at game conclusion but is
  // still online), so filtering on it would undercount online players.
  const onlineQuery = useQuery({
    queryKey: ["gameState", guestKey],
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getGameState(guestKey) as Promise<GameStateSnapshot>;
    },
    enabled: !!actor,
    refetchInterval: getGamePollMs(),
  });
  const onlineCount = onlineQuery.data?.players.length ?? 0;
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Player/Spectator mode — a single choice that governs BOTH entry paths
  // (the guest "Just Play" button and the Internet Identity ranked button).
  // Player is the default. Spectator mode is a visitor watching the live game
  // without logging in: the flag plus a stable per-spectator suffix are
  // persisted to localStorage (mirroring the wallet-address pattern) so
  // spectator state survives a refresh on /game. A spectator never calls
  // login/loginRanked, never seeds the gameState cache, and never arms the
  // guided tour.
  const [mode, setMode] = useState<"player" | "spectator">("player");
  const [spectating, setSpectating] = useState(false);
  // Set when a signed-in Internet Identity user taps Just Play. Guest login is
  // guest mode and does not count for the competition, so we never switch the
  // user silently: the confirm step below asks them to choose. Guest login
  // proceeds only after "Continue as guest"; "Play ranked" starts the normal
  // Internet Identity ranked path.
  const [confirmGuest, setConfirmGuest] = useState(false);

  // "Show guide" toggle — on by default (an absent tco-guide-pref means true).
  // Persisted to localStorage as a JSON boolean using the same read/write
  // pattern as LeaderboardWindow. When on, a successful guest or ranked login
  // sets tco-guide-pending so the /game route auto-starts the tour.
  const [showGuide, setShowGuide] = useState<boolean>(() => readGuidePref());
  const handleToggleGuide = () => {
    setShowGuide((current) => {
      const next = !current;
      writeGuidePref(next);
      return next;
    });
  };

  // Internet Identity sign-in for ranked play. The player enters a username,
  // taps the Internet Identity option, and signs in with the SAME flow the
  // Story window uses (useInternetIdentity().login()). Once the identity is
  // available we mint a fresh ranked key, write it into the ranked slot, and
  // call loginRanked through the Internet Identity-authenticated actor.
  const { identity, isAuthenticated, isLoggingIn, login, loginError } =
    useInternetIdentity();
  // Set when the player taps the Internet Identity option, so the effect below
  // only runs the ranked login for a deliberate ranked sign-in — never for a
  // restored session or a Story-window sign-in.
  const [rankedPending, setRankedPending] = useState(false);
  // Guards against the effect firing twice for the same sign-in (e.g. a
  // re-render while the identity is already available).
  const rankedStartedRef = useRef(false);

  // Spectator entry point. Persists the spectator flag plus a stable suffix
  // and navigates straight to /game — no actor.login, no cache seeding, no
  // guide arming. The /game route reads the flag and renders the live game
  // read-only.
  const handleSpectate = () => {
    unlockAudio();
    if (loading) return;
    setError(null);
    setSpectating(true);
    startSpectating();
    navigate({ to: "/game" });
  };

  const handleLogin = async () => {
    // Spectator mode: the guest entry point starts spectator mode instead of
    // logging in. No actor.login, no cache seeding, no guide arming.
    if (mode === "spectator") {
      handleSpectate();
      return;
    }
    // A signed-in Internet Identity user tapping Just Play is about to enter
    // guest mode, which does not count for the competition. Never switch them
    // silently: show the confirm step and let them choose. Guest login runs
    // only after "Continue as guest" (handleContinueAsGuest).
    if (isAuthenticated) {
      setConfirmGuest(true);
      return;
    }
    await runGuestLogin();
  };

  // The actual guest login, unchanged. Split out so the confirm step can run it
  // only after the user chooses "Continue as guest".
  const runGuestLogin = async () => {
    // Unlock audio synchronously within this user gesture (the earliest,
    // most reliable one in the app). Must run BEFORE any await so it
    // executes inside the click's microtask window. The window-level
    // listeners in audio-unlock.ts also catch this, but calling
    // unlockAudio() here guarantees the unlock even if the listeners
    // somehow missed the event.
    unlockAudio();
    const trimmed = username.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      // A guest session must never inherit a leftover ranked identity: clear
      // the ranked slot and the ranked session flag BEFORE the guest login, so
      // the guest key is the only identity in play and a stale ranked key can
      // never make this guest session play under it.
      clearRankedIdentity();
      clearRankedSession();
      const actor = await getActor();
      // No wallet address is collected on the login page, so the backend
      // receives null with walletSource=#none.
      const result = await actor.login(
        guestKey,
        trimmed,
        null,
        WalletSource.none,
      );
      // Seed the React Query cache with the post-login snapshot so the game
      // route renders immediately instead of waiting for the first poll.
      // The query key MUST match useGameState's key exactly: guestKey is the
      // same guest key from useGuestIdentity() used in routes/game.tsx.
      if (result?.gameState) {
        queryClient.setQueryData(["gameState", guestKey], result.gameState);
      }
      // Arm the guided tour only when the toggle is on. The flag is read by
      // the /game route, which starts the tour once the board is ready.
      if (showGuide) writeGuidePending(true);
      navigate({ to: "/game" });
    } catch (e) {
      console.error(e);
      setError("Could not join the game. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // "Continue as guest" from the confirm step: dismiss the step and run the
  // normal guest login exactly as today.
  const handleContinueAsGuest = () => {
    setConfirmGuest(false);
    void runGuestLogin();
  };

  // "Play ranked" from the confirm step: dismiss the step and start the normal
  // Internet Identity ranked path.
  const handlePlayRankedFromConfirm = () => {
    setConfirmGuest(false);
    handleRankedLogin();
  };

  // Ranked sign-in: the player taps the Internet Identity option, which opens
  // the Internet Identity flow. This effect runs the ranked login once the
  // identity becomes available. It mirrors the guest path exactly — same
  // cache seeding, same navigation — but calls loginRanked with the ranked key
  // held in the ranked slot.
  //
  // The key is minted ONLY when the ranked slot is empty, and it is written to
  // the slot BEFORE the login attempt. A failed attempt therefore leaves the
  // slot intact, so a retry reuses the exact same key instead of minting a
  // fresh one. The session flag — not the mere presence of the ranked slot —
  // is what marks this session as ranked, and it is still written only after
  // the backend accepts the login.
  useEffect(() => {
    if (!rankedPending || !isAuthenticated || !identity) return;
    if (rankedStartedRef.current) return;
    const trimmed = username.trim();
    if (!trimmed) return;
    rankedStartedRef.current = true;
    setLoading(true);
    setError(null);
    // Reuse the key already in the ranked slot; mint and persist one only when
    // the slot is empty. Persisting before the attempt is what lets a retry
    // send the same key after a failure.
    const existingKey = readRankedIdentity();
    const rankedKey = existingKey ?? generateRankedKey();
    if (existingKey === null) setRankedIdentity(rankedKey);
    void (async () => {
      try {
        const actor = await getActor();
        const result = await actor.loginRanked(
          rankedKey,
          trimmed,
          null,
          WalletSource.none,
        );
        // The backend accepted the login: mark this session as ranked. The
        // session flag is set only here, after acceptance, so a failed call
        // never marks the session ranked. The ranked slot itself was already
        // written above and is left intact on failure so a retry reuses it.
        setRankedSession();
        if (result?.gameState) {
          queryClient.setQueryData(["gameState", rankedKey], result.gameState);
        }
        // Arm the guided tour only when the toggle is on (same as guest).
        if (showGuide) writeGuidePending(true);
        navigate({ to: "/game" });
      } catch (e) {
        console.error(e);
        setError(describeRankedLoginError(e));
        // The ranked slot is deliberately left intact so the next attempt
        // reuses the same minted key. Reset the guard so a second tap of the
        // Internet Identity option can retry the ranked login in the same
        // session. Without this the effect's `if (rankedStartedRef.current)
        // return;` guard would short-circuit every subsequent attempt until a
        // page reload.
        rankedStartedRef.current = false;
        setRankedPending(false);
      } finally {
        setLoading(false);
      }
    })();
  }, [
    rankedPending,
    isAuthenticated,
    identity,
    username,
    navigate,
    queryClient,
    showGuide,
  ]);

  const handleRankedLogin = () => {
    // Spectator mode: the Internet Identity entry point also starts spectator
    // mode — no Internet Identity flow, no loginRanked, no cache seeding.
    if (mode === "spectator") {
      handleSpectate();
      return;
    }
    unlockAudio();
    const trimmed = username.trim();
    if (!trimmed || loading) return;
    setError(null);
    setRankedPending(true);
    login();
  };

  // Escape dismisses the guest confirm step without choosing either path, so
  // the user is never forced into a silent switch.
  useEffect(() => {
    if (!confirmGuest) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirmGuest(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmGuest]);

  // While the actor initializes, show a minimal connecting state so the user
  // never sees a blank or non-functional form.
  if (actorLoading) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center bg-background px-4 gap-4"
        data-ocid="login.loading_state"
      >
        <span
          className="block w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary motion-safe:animate-spin"
          aria-hidden="true"
        />
        <p className="text-sm font-body text-muted-foreground">
          Connecting to the game server…
        </p>
      </div>
    );
  }

  // If the actor failed to initialize, surface the error with a retry path
  // instead of a login form that would silently fail on submit.
  if (actorError) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center bg-background px-4 gap-4 text-center"
        data-ocid="login.error_state"
      >
        <div
          className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center text-destructive text-2xl"
          aria-hidden="true"
        >
          !
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-display font-semibold text-foreground">
            Failed to connect to the game server
          </h1>
          <p className="text-sm font-body text-muted-foreground max-w-md">
            The app could not reach its backend. This usually means the
            deployment configuration is missing or invalid. You can retry, or
            reload the page if the problem persists.
          </p>
          <p className="text-xs font-mono text-muted-foreground/80 break-words max-w-md pt-1">
            {actorError.message}
          </p>
        </div>
        <button
          type="button"
          onClick={retry}
          data-ocid="login.retry_button"
          className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring transition-smooth"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm bg-card rounded-xl shadow-lg p-8 border border-border">
        <div className="flex flex-col items-center text-center mb-8">
          <div
            className="w-14 h-14 rounded-xl bg-primary flex items-center justify-center mb-4 shadow-sm"
            aria-hidden="true"
          >
            <span className="text-3xl text-primary-foreground">♞</span>
          </div>
          {/* Shared Wordmark component — renders `jalca v<version>` from
           * the single JALCA_VERSION constant in lib/version.ts. Rendered
           * as an <h1> for page-heading semantics; the `.login-wordmark`
           * class preserves the login card's existing per-theme CSS
           * treatment (text-transform:none so the version renders
           * verbatim). The data-theme hook lets `.login-wordmark`'s
           * per-theme variants apply; data-ocid keeps the deterministic
           * test marker. */}
          {/* OpenChat channel icon — sits immediately LEFT of the wordmark
           * and scales with the header font size (em-based sizing). */}
          <div className="flex w-full flex-wrap items-center justify-center gap-2">
            <OpenChatIcon data-ocid="login.openchat_link" />
            <Wordmark
              as="h1"
              className="login-wordmark min-w-0 max-w-full text-2xl text-foreground"
              data-theme={theme}
              data-ocid="login.wordmark"
            />
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Pick a name and join the board.
          </p>
          <span
            data-ocid="login.online_count"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-foreground"
          >
            <span
              className="size-1.5 rounded-full bg-emerald-500"
              aria-hidden="true"
            />
            {onlineCount} {onlineCount === 1 ? "wizard" : "wizards"} inside
          </span>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="username"
              className="text-sm font-medium text-foreground"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              autoComplete="off"
              maxLength={24}
              aria-label="Username"
              data-ocid="login.input"
              className="w-full px-4 py-3 rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-smooth"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLogin();
              }}
            />
          </div>

          {/* "Show guide" toggle — on by default, remembered in localStorage.
           * When on, a successful login arms the guided tour on /game. It is
           * a button-based switch (not a checkbox input) so the username
           * field stays the only text input on the page. */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
            <span
              id="show-guide-label"
              className="text-sm font-medium text-foreground"
            >
              Tour guide
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={showGuide}
              aria-labelledby="show-guide-label"
              onClick={handleToggleGuide}
              data-ocid="login.guide_toggle"
              className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-muted transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-checked:bg-primary"
            >
              <span
                aria-hidden="true"
                className={`size-4 rounded-full bg-background shadow-sm transition-smooth ${
                  showGuide ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          {error && (
            <p
              role="alert"
              data-ocid="login.error_state"
              className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2"
            >
              {error}
            </p>
          )}

          {/* Player/Spectator toggle — one choice that governs BOTH entry
           * paths below (guest "Just Play" and Internet Identity ranked).
           * Player is the default. Selecting Spectator and then entering
           * starts spectator mode: no login, no cache seeding, no guide. */}
          <fieldset
            data-ocid="login.mode_toggle"
            className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1"
          >
            <legend className="sr-only">Entry mode</legend>
            <button
              type="button"
              aria-pressed={mode === "player"}
              onClick={() => setMode("player")}
              data-ocid="login.mode_toggle.player"
              className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                mode === "player"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Swords className="size-4" aria-hidden="true" />
              Player
            </button>
            <button
              type="button"
              aria-pressed={mode === "spectator"}
              onClick={() => setMode("spectator")}
              data-ocid="login.mode_toggle.spectator"
              className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                mode === "spectator"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Eye className="size-4" aria-hidden="true" />
              Spectator
            </button>
          </fieldset>

          <button
            type="button"
            onClick={handleLogin}
            disabled={
              loading || spectating || (mode === "player" && !username.trim())
            }
            data-ocid="login.primary_button"
            className="w-full px-4 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-smooth"
          >
            {mode === "spectator"
              ? spectating
                ? "Entering…"
                : "Watch as spectator"
              : loading
                ? "Joining…"
                : "Just Play"}
          </button>

          {/* Guest helper text — makes the guest/ranked distinction explicit
           * right under the guest entry point. */}
          <p
            data-ocid="login.guest_helper"
            className="text-xs text-muted-foreground text-center"
          >
            Guest. Your wins do not count for the competition or the prize.
          </p>

          {/* Internet Identity option — joins RANKED play. Uses the same
           * Internet Identity flow as the Story window. The username field
           * above is shared by both paths; guest login is untouched. In
           * Spectator mode this entry point also starts spectator mode. */}
          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              or
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <button
            type="button"
            onClick={handleRankedLogin}
            disabled={
              loading ||
              spectating ||
              isLoggingIn ||
              (mode === "player" && !username.trim())
            }
            data-ocid="login.internet_identity_button"
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-border bg-background text-foreground font-medium hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-smooth"
          >
            {isLoggingIn ? (
              <Loader2
                className="size-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
            ) : (
              <LogIn className="size-4" aria-hidden="true" />
            )}
            {isLoggingIn ? "Signing in…" : "Internet Identity Ranked Play"}
          </button>

          {/* Ranked helper text — the counterpart to the guest helper above. */}
          <p
            data-ocid="login.ranked_helper"
            className="text-xs text-muted-foreground text-center"
          >
            Ranked. Your wins count for the competition and the prize.
          </p>

          {loginError && (
            <p
              role="alert"
              data-ocid="login.internet_identity_error"
              className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2"
            >
              {loginError.message.trim() || "Sign-in failed. Please try again."}
            </p>
          )}
        </div>

        <p className="text-xs text-muted-foreground text-center mt-6">
          Guest mode · no account needed · wins do not count for the competition
          or the prize
        </p>
      </div>

      {/* Confirm step for a signed-in Internet Identity user who taps Just
       * Play. Guest mode does not count for the competition, so we never
       * switch them silently: they choose "Play ranked" (the normal ranked
       * path) or "Continue as guest" (the normal guest login). */}
      {confirmGuest && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm px-4"
          data-ocid="login.guest_confirm_modal"
        >
          <div
            // biome-ignore lint/a11y/useSemanticElements: overlay requires div for fixed positioning
            role="dialog"
            aria-modal="true"
            aria-labelledby="guest-confirm-title"
            className="w-full max-w-sm bg-card rounded-xl shadow-lg p-6 border border-border"
          >
            <h2
              id="guest-confirm-title"
              className="text-base font-display font-semibold text-foreground"
            >
              You are signed in. Just Play is guest mode and your wins will not
              count. Play ranked instead?
            </h2>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={handlePlayRankedFromConfirm}
                data-ocid="login.guest_confirm.ranked_button"
                className="w-full px-4 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring transition-smooth"
              >
                Play ranked
              </button>
              <button
                type="button"
                onClick={handleContinueAsGuest}
                data-ocid="login.guest_confirm.guest_button"
                className="w-full px-4 py-3 rounded-lg border border-border bg-background text-foreground font-medium hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring transition-smooth"
              >
                Continue as guest
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
