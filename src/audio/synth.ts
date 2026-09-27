// A tiny plucked-string synthesiser (Karplus–Strong) built on the Web Audio API.
// No samples are needed, so the app stays a single small file and works offline.

import { midiToFreq } from '../theory/notes';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<number, AudioBuffer>();

function audio(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.55;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 5200;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(tone).connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function pluckBuffer(midi: number): AudioBuffer {
  const cached = buffers.get(midi);
  if (cached) return cached;
  const ac = audio();
  const sr = ac.sampleRate;
  const freq = midiToFreq(midi);
  const duration = 2.4;
  const len = Math.floor(sr * duration);
  const buf = ac.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);
  // The two-point averaging filter adds half a sample of delay.
  const N = Math.max(2, Math.round(sr / freq - 0.5));
  const ring = new Float32Array(N);
  let prev = 0;
  for (let i = 0; i < N; i++) {
    const r = Math.random() * 2 - 1;
    prev = prev * 0.45 + r * 0.55; // slightly low-passed excitation = softer pick
    ring[i] = prev;
  }
  // Higher notes die away faster, as on a real guitar.
  const halfLife = Math.max(0.18, 0.95 - 0.22 * Math.log2(freq / 82));
  const rho = Math.pow(0.5, 1 / (freq * halfLife));
  let idx = 0;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const cur = ring[idx];
    const nxt = ring[(idx + 1) % N];
    ring[idx] = rho * 0.5 * (cur + nxt);
    out[i] = cur;
    if (Math.abs(cur) > peak) peak = Math.abs(cur);
    idx = (idx + 1) % N;
  }
  const norm = peak > 0 ? 0.9 / peak : 1;
  const fade = Math.floor(sr * 0.08);
  for (let i = 0; i < len; i++) {
    let g = norm;
    if (i > len - fade) g *= (len - i) / fade;
    out[i] *= g;
  }
  buffers.set(midi, buf);
  return buf;
}

export interface NoteEvent {
  /** Seconds from the start of playback. */
  time: number;
  midis: number[];
  /** Seconds between strummed notes (0 = together). */
  strum?: number;
  /** Seconds the note(s) ring before being damped. */
  duration?: number;
  gain?: number;
  onStart?: () => void;
}

interface Playback {
  sources: AudioBufferSourceNode[];
  timers: number[];
  onEnd?: () => void;
}

let current: Playback | null = null;

export function stopAll(): void {
  if (!current) return;
  const p = current;
  current = null;
  for (const t of p.timers) window.clearTimeout(t);
  const ac = ctx;
  for (const s of p.sources) {
    try {
      if (ac) s.stop(ac.currentTime + 0.02);
      else s.stop();
    } catch {
      /* already stopped */
    }
  }
  p.onEnd?.();
}

/** Schedule a list of note events. Any previous playback is stopped first. */
export function play(events: NoteEvent[], onEnd?: () => void): void {
  stopAll();
  const ac = audio();
  const out = master!;
  const start = ac.currentTime + 0.06;
  const pb: Playback = { sources: [], timers: [], onEnd };
  current = pb;
  let end = 0;
  for (const ev of events) {
    const dur = ev.duration ?? 1.6;
    ev.midis.forEach((m, i) => {
      const t = start + ev.time + (ev.strum ?? 0) * i;
      const src = ac.createBufferSource();
      src.buffer = pluckBuffer(m);
      const g = ac.createGain();
      const level = (ev.gain ?? 0.8) / Math.sqrt(Math.max(1, ev.midis.length) * 0.6);
      g.gain.setValueAtTime(level, t);
      g.gain.setValueAtTime(level, t + dur);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur + 0.12);
      src.connect(g).connect(out);
      src.start(t);
      src.stop(t + dur + 0.15);
      pb.sources.push(src);
    });
    end = Math.max(end, ev.time + (ev.strum ?? 0) * ev.midis.length + dur);
    if (ev.onStart) {
      const cb = ev.onStart;
      pb.timers.push(window.setTimeout(() => current === pb && cb(), (ev.time + 0.06) * 1000));
    }
  }
  pb.timers.push(
    window.setTimeout(() => {
      if (current === pb) {
        current = null;
        onEnd?.();
      }
    }, (end + 0.2) * 1000),
  );
}

/** Strum a chord (low → high). */
export function strum(midis: number[], onEnd?: () => void): void {
  const sorted = [...midis].sort((a, b) => a - b);
  play([{ time: 0, midis: sorted, strum: 0.035, duration: 2.2 }], onEnd);
}

/** Play notes one after another. */
export function sequence(midis: number[], bpm: number, onStep?: (i: number) => void, onEnd?: () => void): void {
  const step = 60 / bpm / 2; // eighth notes
  play(
    midis.map((m, i) => ({ time: i * step, midis: [m], duration: Math.max(0.35, step * 1.8), gain: 0.9, onStart: onStep ? () => onStep(i) : undefined })),
    onEnd,
  );
}
