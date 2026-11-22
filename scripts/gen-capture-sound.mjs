// Generates a real, non-silent, audible chess "capture" sound.
//
// Output:
//   src/frontend/public/assets/sounds/capture.wav  (16-bit PCM, 44100Hz mono)
//   src/frontend/public/assets/sounds/capture.mp3  (MPEG-1 Layer III, 128kbps CBR)
//
// The sound is a short (~220ms) wooden "thud" suitable for a chess piece
// capture: a low-frequency body (around 110Hz) with a fast attack and
// exponential decay, plus a short high-frequency noise/click transient at
// the very start to evoke pieces touching. Peak amplitude is normalized to
// ~0.85 so it is clearly audible at the hook's volume=0.6.
//
// Run:  node scripts/gen-capture-sound.mjs
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOUNDS_DIR = resolve(__dirname, "../src/frontend/public/assets/sounds");

// lamejs lives in src/frontend/node_modules (it's a devDependency of the
// frontend package). The split-module entry (src/js/index.js) has a known
// bug under Node ESM where MPEGMode is not defined globally. The bundled
// lame.all.js file defines everything inside a `function lamejs(){...}` and
// then calls itself, attaching Mp3Encoder/WavHeader as properties of that
// function object. We load it as text and run it inside a Function wrapper
// that returns the `lamejs` binding created by the source.
const lameAllPath = resolve(
  __dirname,
  "../src/frontend/node_modules/lamejs/lame.all.js"
);
const lameAllSrc = readFileSync(lameAllPath, "utf8");
// Strip the trailing self-invocation; we'll call it ourselves so we can
// capture the binding.
const trimmed = lameAllSrc.replace(/\nlamejs\(\);\s*$/, "\n");
const loader = new Function(
  trimmed + "\nreturn typeof lamejs === 'function' ? lamejs : null;"
);
const lamejsNs = loader();
if (!lamejsNs || !lamejsNs.Mp3Encoder) {
  // Some builds attach to `this`; call it explicitly.
  const ctx = {};
  const loader2 = new Function(
    "ctx",
    "var lamejs = function lamejs(){};" +
      trimmed +
      "\nlamejs();\nreturn lamejs;"
  );
  const ns2 = loader2(ctx);
  if (!ns2 || !ns2.Mp3Encoder) {
    console.error("ERROR: could not load lamejs Mp3Encoder from lame.all.js");
    process.exit(1);
  }
}
const Mp3Encoder = (lamejsNs && lamejsNs.Mp3Encoder) || null;
if (!Mp3Encoder) {
  console.error("ERROR: lamejs loaded but Mp3Encoder not found");
  process.exit(1);
}

const SAMPLE_RATE = 44100;
const DURATION_SEC = 0.22; // ~220ms
const NUM_SAMPLES = Math.floor(SAMPLE_RATE * DURATION_SEC);

// --- 1. Synthesize 16-bit PCM samples -------------------------------
// Body: a low-frequency sine burst at ~110Hz with a fast attack (6ms) and
// exponential decay. A second partial at ~220Hz adds a woody character.
// Click: a short burst of filtered noise in the first ~12ms to give the
// "tk" of pieces touching.
function synthesize() {
  const samples = new Float32Array(NUM_SAMPLES);

  const attackSamples = Math.floor(SAMPLE_RATE * 0.006); // 6ms attack
  const clickSamples = Math.floor(SAMPLE_RATE * 0.012); // 12ms click
  const bodyFreq = 110; // Hz — low thud
  const partialFreq = 220; // Hz — woody overtone

  // Deterministic pseudo-random generator so output is reproducible.
  let seed = 0x1234abcd;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed >>> 8) / 0x00ffffff; // 0..1
  };

  for (let i = 0; i < NUM_SAMPLES; i++) {
    const t = i / SAMPLE_RATE; // seconds

    // Envelope: fast attack then exponential decay over ~200ms.
    let env;
    if (i < attackSamples) {
      env = i / attackSamples; // linear attack
    } else {
      env = Math.exp(-((t - 0.006) / 0.06)); // decay tau ~60ms
    }

    // Body: fundamental + partial.
    const body =
      Math.sin(2 * Math.PI * bodyFreq * t) * 0.7 +
      Math.sin(2 * Math.PI * partialFreq * t) * 0.25;

    let sample = body * env;

    // Click transient: filtered noise in the first 12ms, decaying fast.
    if (i < clickSamples) {
      const clickEnv = Math.exp(-(t / 0.004)); // ~4ms decay
      // One-pole high-pass-ish noise: difference of consecutive randoms.
      const n = rand() * 2 - 1;
      sample += n * clickEnv * 0.5;
    }

    samples[i] = sample;
  }

  // Normalize to peak ~0.85 so it is clearly audible but not clipping.
  let peak = 0;
  for (let i = 0; i < NUM_SAMPLES; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  const target = 0.85;
  const gain = peak > 0 ? target / peak : 1;
  for (let i = 0; i < NUM_SAMPLES; i++) samples[i] *= gain;

  return samples;
}

// --- 2. Write a 16-bit PCM WAV file --------------------------------
function writeWav(samples, outPath) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (SAMPLE_RATE * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // PCM fmt size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    const intSample = s < 0 ? s * 0x8000 : s * 0x7fff;
    buffer.writeInt16LE(intSample | 0, 44 + i * 2);
  }

  writeFileSync(outPath, buffer);
  return buffer.length;
}

// --- 3. Encode MP3 with lamejs -------------------------------------
function encodeMp3(samples, outPath) {
  const mp3encoder = new Mp3Encoder(1, SAMPLE_RATE, 128); // mono, 128kbps
  const blockSize = 1152; // lame frame size
  const chunks = [];

  // Convert float [-1,1] to 16-bit PCM Int16Array.
  const pcm16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  for (let i = 0; i < pcm16.length; i += blockSize) {
    const chunk = pcm16.subarray(i, i + blockSize);
    const mp3buf = mp3encoder.encodeBuffer(chunk);
    if (mp3buf.length > 0) chunks.push(Buffer.from(mp3buf));
  }
  const end = mp3encoder.flush();
  if (end.length > 0) chunks.push(Buffer.from(end));

  const out = Buffer.concat(chunks);
  writeFileSync(outPath, out);
  return out.length;
}

// --- 4. Verify non-silence -----------------------------------------
function verifyNonSilent(samples) {
  let nonZero = 0;
  let maxAbs = 0;
  let sumAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > 1e-4) nonZero++;
    if (a > maxAbs) maxAbs = a;
    sumAbs += a;
  }
  return {
    totalSamples: samples.length,
    nonZeroSamples: nonZero,
    maxAbsAmplitude: maxAbs.toFixed(4),
    meanAbsAmplitude: (sumAbs / samples.length).toFixed(4),
    silentRatio: (1 - nonZero / samples.length).toFixed(4),
  };
}

// --- Run ------------------------------------------------------------
const samples = synthesize();
const stats = verifyNonSilent(samples);

const wavPath = resolve(SOUNDS_DIR, "capture.wav");
const mp3Path = resolve(SOUNDS_DIR, "capture.mp3");

const wavBytes = writeWav(samples, wavPath);
const mp3Bytes = encodeMp3(samples, mp3Path);

console.log("Capture sound synthesis complete.");
console.log("  Duration:           ", DURATION_SEC * 1000, "ms");
console.log("  Sample rate:        ", SAMPLE_RATE, "Hz");
console.log("  Channels:           1 (mono)");
console.log("  Non-silence stats:  ", stats);
console.log("  WAV written:        ", wavPath, "(", wavBytes, "bytes )");
console.log("  MP3 written:        ", mp3Path, "(", mp3Bytes, "bytes )");

if (stats.maxAbsAmplitude < 0.1) {
  console.error("ERROR: synthesized audio is effectively silent. Aborting.");
  process.exit(1);
}
if (mp3Bytes < 2000) {
  console.error("ERROR: MP3 output is suspiciously small (<2KB). Aborting.");
  process.exit(1);
}
console.log("OK: capture sound is non-silent and audible.");
