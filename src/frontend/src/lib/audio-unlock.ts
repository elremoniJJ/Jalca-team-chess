/**
 * audio-unlock — module-level singleton that unlocks HTMLAudioElement
 * playback as early as possible in the app lifecycle.
 *
 * Why a module-level singleton (not a React hook)?
 *  - The autoplay policy requires a user gesture to unlock audio. The
 *    earliest, most reliable gesture is the login button tap on the "/"
 *    route, which happens BEFORE the /game route mounts and BEFORE any
 *    sound-effects hook could attach its own listeners.
 *  - A module-scope singleton attaches window-level listeners at MODULE
 *    LOAD time (i.e. as soon as the app bundle is parsed), so the very
 *    first click/keydown/touchstart/pointerdown ANYWHERE in the app flips
 *    the unlocked flag and primes the shared AudioContext.
 *  - The singleton survives route changes (module scope is not torn down
 *    on navigation), so the unlock persists from login through the game.
 *
 * Captures arrive via a 1500ms poll (not a direct user gesture), which
 * Samsung Internet blocks unless audio was unlocked on an earlier
 * gesture. This module guarantees that by the time a capture is
 * detected, audio has already been unlocked by the login tap.
 */

let unlocked = false;
let sharedCtx: AudioContext | null = null;

/**
 * Resolve the AudioContext constructor across vendor prefixes.
 * Returns null if the browser exposes neither AudioContext nor
 * webkitAudioContext (very old / restricted environments).
 */
function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext ??
    null
  );
}

/**
 * Create (if needed) and resume the shared AudioContext, then run a
 * brief zero-gain oscillator warm-up. This satisfies browsers that
 * require an AudioContext to be resumed within a user gesture before
 * they will allow media elements (HTMLAudioElement) to play.
 *
 * Safe to call multiple times — subsequent calls just ensure the
 * context is resumed.
 */
function warmUpAudioContext(): void {
  try {
    const Ctor = getAudioContextCtor();
    if (!Ctor) return;
    if (!sharedCtx) {
      sharedCtx = new Ctor();
    }
    if (sharedCtx.state === "suspended") {
      void sharedCtx.resume().catch(() => {
        // Resume can reject if the context is being closed; ignore.
      });
    }
    // Brief silent oscillator to flush the audio graph. Some browsers
    // require an actual audio node to be started within the gesture
    // before they consider the context "running".
    const osc = sharedCtx.createOscillator();
    const gain = sharedCtx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(sharedCtx.destination);
    osc.start();
    osc.stop(sharedCtx.currentTime + 0.01);
  } catch {
    // AudioContext unavailable or blocked — not fatal. HTMLAudioElement
    // may still play on its own once the user has interacted.
  }
}

/**
 * Internal: mark audio as unlocked and warm up the AudioContext.
 * Idempotent — only does the warm-up on the first call.
 */
function performUnlock(): void {
  if (unlocked) return;
  unlocked = true;
  warmUpAudioContext();
  // Detach the window-level gate listeners now that we're unlocked.
  // (once:true would handle this per-listener, but we attach four
  // listeners and want to clear all of them on the first fire.)
  window.removeEventListener("click", onFirstGesture, true);
  window.removeEventListener("keydown", onFirstGesture, true);
  window.removeEventListener("touchstart", onFirstGesture, true);
  window.removeEventListener("pointerdown", onFirstGesture, true);
}

/**
 * Window-level gate handler. Attached at module load with capture:true
 * and passive:true so it fires before route-level handlers and never
 * blocks the gesture.
 */
function onFirstGesture(): void {
  performUnlock();
}

// Attach the gate listeners at MODULE LOAD time. This runs as soon as
// the app bundle is parsed (before any route mounts), so the very first
// user gesture anywhere in the app unlocks audio.
if (typeof window !== "undefined") {
  const opts: AddEventListenerOptions = {
    once: true,
    passive: true,
    capture: true,
  };
  window.addEventListener("click", onFirstGesture, opts);
  window.addEventListener("keydown", onFirstGesture, opts);
  window.addEventListener("touchstart", onFirstGesture, opts);
  window.addEventListener("pointerdown", onFirstGesture, opts);
}

/** Returns true once a user gesture has unlocked audio. */
export function isAudioUnlocked(): boolean {
  return unlocked;
}

/**
 * Force the unlock synchronously from within a known user-gesture
 * handler (e.g. a button onClick). Safe to call multiple times —
 * no-op after the first successful unlock.
 *
 * Call this at the START of an onClick (before any await) so the
 * unlock happens within the gesture's microtask window.
 */
export function unlockAudio(): void {
  performUnlock();
}

/**
 * Returns the shared AudioContext (created during the first unlock),
 * or null if audio has not been unlocked yet or the browser does not
 * support AudioContext.
 */
export function getSharedAudioContext(): AudioContext | null {
  return sharedCtx;
}
