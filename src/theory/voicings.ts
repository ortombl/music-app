// Chord-voicing generator: finds playable fingerings of a chord for *any* tuning / string count.
//
// A 4-fret window is slid along the neck; within each window every string may be muted, open, or
// fretted on a chord tone. Candidates must contain all required chord tones, have the correct
// bass note as the lowest pitch, need at most four fingers (a barre counts as one) and avoid
// awkward gaps. They are ranked by fullness, ease and how idiomatic they are.

import { chordPcs, chordRequiredPcs, type ChordSpec } from './chords';
import { mod12 } from './notes';

export interface Voicing {
  /** Fret per string (low → high string), null = muted. */
  frets: (number | null)[];
  midis: number[];
  score: number;
  /** Lowest fretted fret (0 when only open strings). */
  minFret: number;
  maxFret: number;
  barre: boolean;
}

export interface VoicingOptions {
  limit?: number;
  maxSpan?: number;
}

export function generateVoicings(chord: ChordSpec, tuning: number[], numFrets: number, opts: VoicingOptions = {}): Voicing[] {
  const limit = opts.limit ?? 12;
  const maxSpan = opts.maxSpan ?? 3;
  const n = tuning.length;
  const allPcs = new Set(chordPcs(chord));
  const required = new Set(chordRequiredPcs(chord));
  const optional = [...allPcs].filter((p) => !required.has(p));
  const bassPc = chord.bassPc ?? chord.rootPc;
  const power = chord.type.id === '5';
  const minPlayed = power ? 2 : Math.min(n, Math.max(3, Math.min(required.size, 4)));

  const found = new Map<string, Voicing>();

  const evaluate = (frets: (number | null)[]) => {
    const played: number[] = [];
    for (let i = 0; i < n; i++) if (frets[i] !== null) played.push(i);
    if (played.length < minPlayed) return;
    const midis = played.map((i) => tuning[i] + (frets[i] as number));
    const lowest = Math.min(...midis);
    if (mod12(lowest) !== bassPc) return;
    const covered = new Set(midis.map(mod12));
    for (const r of required) if (!covered.has(r)) return;

    // Gaps: muted strings between played strings.
    const first = played[0];
    const last = played[played.length - 1];
    let interior = 0;
    for (let i = first; i <= last; i++) if (frets[i] === null) interior++;
    if (interior > 1) return;
    const trebleMutes = n - 1 - last;
    const bassMutes = first;

    const fretted = played.filter((i) => (frets[i] as number) > 0);
    const fv = fretted.map((i) => frets[i] as number);
    const minF = fv.length ? Math.min(...fv) : 0;
    const maxF = fv.length ? Math.max(...fv) : 0;
    if (maxF - minF > maxSpan) return;

    // Fingers: one finger per fretted note, except that one barre (a finger laid across a run of
    // adjacent strings at the same fret) can cover several notes. Within a barre run every string
    // must be fretted at or above the barre fret; open or muted strings break the run.
    let bestSaving = 0;
    let barreWidth = 0;
    let barreFret = -1;
    for (const f of new Set(fv)) {
      // The index finger (lowest fret) can only barre if it covers *every* note at that fret.
      const totalAtF = fv.filter((x) => x === f).length;
      let runCount = 0;
      let runLo = -1;
      let runHi = -1;
      const flush = () => {
        const allowed = f !== minF || runCount === totalAtF;
        if (allowed && runCount - 1 > bestSaving) {
          bestSaving = runCount - 1;
          barreWidth = runHi - runLo + 1;
          barreFret = f;
        }
        runCount = 0;
        runLo = -1;
      };
      for (let i = 0; i < n; i++) {
        const fr = frets[i];
        if (fr === null || fr < f) {
          flush();
          continue;
        }
        if (fr === f) {
          if (runLo < 0) runLo = i;
          runHi = i;
          runCount++;
        }
      }
      flush();
    }
    const fingers = fretted.length - bestSaving;
    if (fingers > 4) return;
    const barre = bestSaving > 0 && fretted.length > 4;
    // Several separate fingers on the lowest fret (without a barre) is awkward.
    const awkwardMinFret = fv.filter((x) => x === minF).length >= 2 && barreFret !== minF;

    const openCount = played.filter((i) => frets[i] === 0).length;
    const optCovered = optional.filter((p) => covered.has(p)).length;
    let score = 0;
    score += 2.5 * optCovered;
    if (power) {
      // Power chords: compact shapes on the low strings are the idiom.
      score += 1.0 * Math.min(played.length, 3) - 0.6 * Math.max(0, played.length - 3);
      score -= 0.3 * first;
    } else {
      score += 1.0 * Math.min(played.length, 4) + 0.5 * Math.max(0, Math.min(played.length, 6) - 4);
      score -= 0.4 * trebleMutes;
      score -= n > 6 ? 0 : 0.2 * bassMutes;
    }
    score -= 0.6 * (maxF - minF);
    score -= 2.5 * interior;
    if (maxF <= 4) score += 0.6 * openCount;
    else {
      // Open strings with high frets are only idiomatic as a low open bass (drop tunings).
      for (const i of played) {
        if (frets[i] !== 0) continue;
        const isBassPedal = played.filter((j) => j < i).every((j) => frets[j] === 0);
        score += isBassPedal ? 0.3 - 0.05 * maxF : -0.5 - 0.08 * maxF;
      }
    }
    score -= 0.12 * minF;
    if (barre) score -= barreWidth >= 4 ? 0.8 : 0.3;
    if (fingers > 3) score -= 0.5;
    if (awkwardMinFret) score -= 1.0;
    // Small bonus when the root is doubled (stronger, more "grounded" sound).
    if (midis.filter((m) => mod12(m) === chord.rootPc).length >= 2) score += 0.3;

    const key = frets.map((f) => (f === null ? 'x' : f)).join(',');
    if (!found.has(key)) found.set(key, { frets: [...frets], midis, score, minFret: minF, maxFret: maxF, barre });
  };

  const cur: (number | null)[] = new Array(n).fill(null);
  for (let start = 1; start <= Math.max(1, numFrets - maxSpan); start++) {
    const end = Math.min(numFrets, start + maxSpan);
    const options: (number | null)[][] = tuning.map((open) => {
      const o: (number | null)[] = [null];
      if (allPcs.has(mod12(open))) o.push(0);
      for (let f = start; f <= end; f++) if (allPcs.has(mod12(open + f))) o.push(f);
      return o;
    });
    const dfs = (i: number) => {
      if (i === n) {
        evaluate(cur);
        return;
      }
      for (const o of options[i]) {
        cur[i] = o;
        dfs(i + 1);
      }
      cur[i] = null;
    };
    dfs(0);
  }

  // Pick the best voicings, skipping ones that are merely a subset of an already chosen shape.
  const sorted = [...found.values()].sort((a, b) => b.score - a.score);
  const chosen: Voicing[] = [];
  for (const v of sorted) {
    const redundant = chosen.some((c) => v.frets.every((f, i) => f === null || f === c.frets[i]));
    if (redundant) continue;
    chosen.push(v);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

export function voicingToString(v: Voicing): string {
  const big = v.frets.some((f) => f !== null && f > 9);
  return v.frets.map((f) => (f === null ? 'x' : String(f))).join(big ? ' ' : '');
}
