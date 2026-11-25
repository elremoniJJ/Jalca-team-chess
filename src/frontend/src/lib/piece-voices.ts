/**
 * piece-voices — plays the short spoken lines of the 32 named chess pieces
 * (files in /audio/pieces, listed in manifest.json).
 *
 * - A new move calls playVoices(..., true): it CUTS OFF whatever is playing and
 *   plays its own clips in order (capturer first, then the captured piece).
 * - A game-ending line calls playVoices(..., false): it waits its turn.
 * - Respects the browser's audio unlock (lib/audio-unlock) and a mute switch
 *   remembered in localStorage.
 */
import { isAudioUnlocked } from "./audio-unlock";

export type VoiceEvent = "move" | "capture" | "captured";
export interface VoiceClip {
  id: string;
  event: VoiceEvent;
}

type Manifest = Record<string, Partial<Record<VoiceEvent, string | null>>>;

const BASE = "/audio/pieces/";
const VOLUME = 0.8;
const MUTE_KEY = "piece-voices-muted";

let manifest: Manifest | null = null;
let manifestPromise: Promise<void> | null = null;

export function loadManifest(): Promise<void> {
  if (manifest) return Promise.resolve();
  if (!manifestPromise) {
    manifestPromise = fetch(`${BASE}manifest.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: Manifest) => {
        manifest = j;
      })
      .catch(() => {
        // Try again on the next request.
        manifestPromise = null;
      });
  }
  return manifestPromise;
}

/* ---------------------------- mute switch ----------------------------- */

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

let muted = readMuted();
const listeners = new Set<() => void>();

export function isVoiceMuted(): boolean {
  return muted;
}

export function subscribeVoiceMuted(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function setVoiceMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // Storage unavailable: the switch still works for this visit.
  }
  if (value) stopVoices();
  for (const l of listeners) l();
}

/* ------------------------------- player ------------------------------- */

let current: HTMLAudioElement | null = null;
let queue: string[] = [];
let generation = 0;

function stopCurrent(): void {
  if (current) {
    current.onended = null;
    current.onerror = null;
    current.pause();
    current = null;
  }
}

export function stopVoices(): void {
  generation += 1;
  queue = [];
  stopCurrent();
}

function playNext(): void {
  const src = queue.shift();
  if (!src) {
    current = null;
    return;
  }
  const audio = new Audio(src);
  audio.volume = VOLUME;
  current = audio;
  audio.onended = () => playNext();
  audio.onerror = () => playNext();
  audio.play().catch(() => playNext());
}

/** Play `clips` in order. With `interrupt`, anything already playing or queued
 *  is dropped first. Does nothing when muted or the browser has not been
 *  unlocked by a click yet. */
export function playVoices(clips: VoiceClip[], interrupt: boolean): void {
  if (muted || clips.length === 0) return;
  if (interrupt) generation += 1;
  const myGeneration = generation;
  void loadManifest().then(() => {
    if (muted || !manifest || !isAudioUnlocked()) return;
    // A newer move arrived while the manifest was loading: this one is stale.
    if (myGeneration !== generation) return;
    const files: string[] = [];
    for (const c of clips) {
      const f = manifest[c.id]?.[c.event];
      if (f) files.push(`${BASE}${f}`);
    }
    if (files.length === 0) return;
    if (interrupt) {
      stopCurrent();
      queue = files;
      playNext();
    } else {
      queue.push(...files);
      if (!current) playNext();
    }
  });
}
