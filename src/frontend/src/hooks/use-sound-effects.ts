import { useCallback, useEffect, useRef } from "react";
import type { GameStateSnapshot } from "../backend";
import { getSharedAudioContext, isAudioUnlocked } from "../lib/audio-unlock";
import type { Move } from "../types/chess";

/**
 * Sound effects hook — plays short local audio cues on detected state
 * change, NOT on every poll.
 *
 * Triggers:
 *  - Move sound: when a new move appears (the derived move list grows).
 *  - Capture sound: when the new move was a capture (Move.captured
 *    non-null). The capture sound REPLACES the move sound (not stacked).
 *  - Check sound: when the resulting position is check (derived locally
 *    via chess-logic.getCheckSquare). Played after the move/capture
 *    sound.
 *
 * Autoplay policy: audio is unlocked by the module-level singleton in
 * lib/audio-unlock.ts, which attaches window-level listeners at module
 * load time and is also explicitly invoked from the login button's
 * onClick. This hook does NOT own the AudioContext warm-up or the gate
 * listeners — it only reads `isAudioUnlocked()` before playing.
 *
 * Sounds use local bundled files in /assets/sounds/. We create a FRESH
 * HTMLAudioElement per cue (NOT cloneNode — cloneNode of an element
 * whose source hasn't finished loading produces a silent play() in
 * Chrome). A fresh element with preload="auto" + load() reliably
 * decodes and plays. The browser HTTP-caches the file, so repeated
 * construction is cheap.
 *
 * The hook does NOT provide a volume control or mute toggle (excluded
 * by the build spec).
 */

interface UseSoundEffectsArgs {
  /** Latest game snapshot from the poll. */
  snapshot: GameStateSnapshot | undefined;
  /** Derived move list (grown by diffing snapshots in use-game-state). */
  moves: Move[];
  /** Derived check square for the side to move, or null. */
  checkSquare: number | null;
}

const MOVE_SRC = "/assets/sounds/move.mp3";
const CAPTURE_SRC_M4A = "/assets/sounds/capture.m4a";
const CAPTURE_SRC_MP3 = "/assets/sounds/capture.mp3";
const CHECK_SRC = "/assets/sounds/check.mp3";

type CueKey = "move" | "capture" | "check";

export function useSoundEffects({
  snapshot,
  moves,
  checkSquare,
}: UseSoundEffectsArgs): void {
  // Track the last move count we played a sound for, so we only fire on
  // genuine growth (a new move appeared), not on every 2s poll.
  const lastPlayedCountRef = useRef<number>(0);

  // Play a single cue from a known-good source. Returns a promise that
  // resolves to true on success or false on rejection, so callers can
  // chain an mp3 fallback for the capture cue.
  const playSingle = useCallback(
    (src: string, key: CueKey): Promise<boolean> => {
      // eslint-disable-next-line no-console
      console.log("[useSoundEffects] playCue", key, src);
      const instance = new Audio(src);
      instance.preload = "auto";
      instance.volume = 0.6;
      // Explicit load() kicks off decoding even if the browser would
      // have deferred it; this matters for the very first play of a cue.
      instance.load();
      instance.currentTime = 0;
      return instance
        .play()
        .then(() => {
          // eslint-disable-next-line no-console
          console.log("[useSoundEffects] play() ok", key);
          if (key === "capture") {
            // eslint-disable-next-line no-console
            console.log(`[capture-sound] SUCCESS playing ${src} (key=${key})`);
          }
          return true;
        })
        .catch((err: unknown) => {
          // Log as an ERROR (not warn) so failures are visible in the
          // browser console without filtering. Common causes: autoplay
          // still blocked (no prior user gesture on this top-level
          // document), file missing, or decode error.
          // eslint-disable-next-line no-console
          console.error(
            `[useSoundEffects] play() failed for "${key}" (${src}):`,
            err,
          );
          if (key === "capture") {
            const e = err as { name?: string; message?: string; code?: number };
            // eslint-disable-next-line no-console
            console.warn(`[capture-sound] REJECTED playing ${src}`, {
              name: e?.name,
              message: e?.message,
              code: e?.code,
            });
          }
          return false;
        });
    },
    [],
  );

  // Play a cue, with an mp3 FALLBACK for the capture cue. Silently
  // no-ops if audio has not been unlocked yet (autoplay policy).
  const playCue = useCallback(
    (src: string, key: CueKey) => {
      if (!isAudioUnlocked()) {
        // eslint-disable-next-line no-console
        console.warn("[useSoundEffects] skipping cue — audio not unlocked");
        return;
      }
      // Touch the shared AudioContext to ensure it's resumed (the
      // singleton already did this on first gesture, but a defensive
      // resume here covers edge cases where the context was suspended
      // by the browser after a long idle period).
      const ctx = getSharedAudioContext();
      if (ctx && ctx.state === "suspended") {
        void ctx.resume().catch(() => {});
      }

      if (key === "capture") {
        // Try m4a first; on rejection, fall back to mp3. Log which
        // source succeeded/failed so we can diagnose codec issues
        // (Samsung Internet has historically had spotty m4a support).
        // eslint-disable-next-line no-console
        console.log(`[capture-sound] attempting PRIMARY ${src}`);
        void playSingle(src, "capture").then((ok) => {
          if (!ok) {
            // eslint-disable-next-line no-console
            console.log(
              "[useSoundEffects] capture m4a failed, trying mp3 fallback",
            );
            // eslint-disable-next-line no-console
            console.log(
              `[capture-sound] PRIMARY failed — firing FALLBACK ${CAPTURE_SRC_MP3}`,
            );
            void playSingle(CAPTURE_SRC_MP3, "capture").then((ok2) => {
              // eslint-disable-next-line no-console
              console.log(
                `[capture-sound] FALLBACK ${ok2 ? "succeeded" : "also failed"}`,
              );
            });
          } else {
            // eslint-disable-next-line no-console
            console.log(
              "[capture-sound] PRIMARY succeeded — fallback NOT triggered",
            );
          }
        });
      } else {
        void playSingle(src, key);
      }
    },
    [playSingle],
  );

  useEffect(() => {
    if (!snapshot) return;
    const count = moves.length;
    if (count <= lastPlayedCountRef.current) {
      // No new move (or a reset). Update the baseline so we don't fire a
      // burst after a reset/reconnect.
      lastPlayedCountRef.current = count;
      return;
    }

    // New move(s) appeared. Play a cue for the most recent move only —
    // playing a burst for every missed move after a reconnect would be
    // noisy.
    const latestMove = moves[count - 1];
    lastPlayedCountRef.current = count;

    if (!latestMove) return;

    // Capture sound takes precedence over the plain move sound.
    if (latestMove.captured !== null) {
      // eslint-disable-next-line no-console
      console.log("[useSoundEffects] capture detected", {
        unlocked: isAudioUnlocked(),
        move: latestMove,
      });
      playCue(CAPTURE_SRC_M4A, "capture");
    } else {
      playCue(MOVE_SRC, "move");
    }

    // Check sound: if the side to move is now in check, play the check
    // cue shortly after the move/capture cue so both are audible.
    if (checkSquare !== null) {
      window.setTimeout(() => playCue(CHECK_SRC, "check"), 120);
    }
  }, [snapshot, moves, checkSquare, playCue]);
}
