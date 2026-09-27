// Chord identification: which chord do these notes most likely form?
//
// For every candidate root (each sounding pitch class) the set of intervals above that root is
// matched against the chord dictionary. A chord type matches when all of its required tones are
// present and no note falls outside it. Candidates are then ranked with a musically-motivated
// score: how common the chord is, how many optional tones are omitted, and — most importantly —
// what is in the bass (root position > 1st inversion > 2nd inversion > other slash chords).

import { CHORD_TYPES, chordName, spellChord, type ChordSpec, type ChordType } from './chords';
import { degree } from './intervals';
import { mod12, type AccidentalPref, type PitchClass } from './notes';

export interface ChordMatch {
  chord: ChordSpec;
  name: string;
  /** Degree labels of the chord that are not being played. */
  omitted: string[];
  inversion: 'root' | 'inversion' | 'slash';
  /** Degree of the bass note inside the chord (e.g. "3" for 1st inversion). */
  bassDegree?: string;
  score: number;
  /** Relative likelihood among all candidates, 0..1. */
  probability: number;
}

const BASS_BONUS: Record<string, number> = { '1': 40, '3': 10, b3: 10, '5': 6, b5: 3, '#5': 3, b7: 4, '7': 3, bb7: 3, '6': 2 };

function maskFrom(pcs: Iterable<PitchClass>, root: PitchClass): number {
  let m = 0;
  for (const p of pcs) m |= 1 << mod12(p - root);
  return m;
}

function matches(t: ChordType, mask: number): boolean {
  return (mask & t.requiredMask) === t.requiredMask && (mask & ~t.mask) === 0;
}

function omittedDegrees(t: ChordType, mask: number): string[] {
  return t.degreeInfo.filter((d) => !(mask & (1 << d.semi))).map((d) => d.label);
}

/**
 * Identify chords from a list of sounding MIDI notes.
 * Returns candidates sorted from most to least likely (empty if fewer than two pitch classes).
 */
export function identifyChord(midis: number[], pref: AccidentalPref = 'auto', limit = 8): ChordMatch[] {
  if (midis.length === 0) return [];
  const pcs = [...new Set(midis.map(mod12))];
  if (pcs.length < 2) return [];
  const bassPc = mod12(Math.min(...midis));
  const out: ChordMatch[] = [];

  // 1) All notes belong to the chord (root position or inversion).
  for (const root of pcs) {
    const mask = maskFrom(pcs, root);
    for (const t of CHORD_TYPES) {
      if (t.parseOnly || !matches(t, mask)) continue;
      const omitted = omittedDegrees(t, mask);
      const bassLabel = t.degreeInfo.find((d) => mod12(root + d.semi) === bassPc)!.label;
      const isRoot = bassPc === root;
      let score = 100 * t.prior - 14 * omitted.length + (BASS_BONUS[bassLabel] ?? 0);
      // A root-less two-note "chord" is only a guess.
      if (pcs.length === 2) score -= 20;
      const chord: ChordSpec = { rootPc: root, type: t, bassPc: isRoot ? undefined : bassPc };
      out.push({
        chord,
        name: chordName(chord, pref),
        omitted,
        inversion: isRoot ? 'root' : 'inversion',
        bassDegree: bassLabel,
        score,
        probability: 0,
      });
    }
  }

  // 2) Slash chords whose bass note is not a chord tone (e.g. D/C, G/A).
  const upper = pcs.filter((p) => p !== bassPc);
  if (upper.length >= 3) {
    for (const root of upper) {
      const mask = maskFrom(upper, root);
      const bassSemi = mod12(bassPc - root);
      for (const t of CHORD_TYPES) {
        if (t.parseOnly || !matches(t, mask)) continue;
        if (t.mask & (1 << bassSemi)) continue; // would be an inversion, already covered
        const omitted = omittedDegrees(t, mask);
        const score = 100 * t.prior - 14 * omitted.length - 25;
        const chord: ChordSpec = { rootPc: root, type: t, bassPc };
        out.push({ chord, name: chordName(chord, pref), omitted, inversion: 'slash', score, probability: 0 });
      }
    }
  }

  // Deduplicate by displayed name, keep best score.
  const best = new Map<string, ChordMatch>();
  for (const m of out) {
    const prev = best.get(m.name);
    if (!prev || prev.score < m.score) best.set(m.name, m);
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score);
  const top = ranked.length ? ranked[0].score : 0;
  let total = 0;
  for (const m of ranked) {
    m.probability = Math.exp((m.score - top) / 14);
    total += m.probability;
  }
  for (const m of ranked) m.probability /= total;
  return ranked.slice(0, limit);
}

/**
 * Find the best chord type for a set of pitch classes over a fixed root (used to name the sound
 * an arpeggio produces over a chord, e.g. "Em7 over C = Cmaj9").
 */
export function nameOverRoot(rootPc: PitchClass, pcs: PitchClass[]): ChordType | null {
  const mask = maskFrom(pcs, rootPc) | 1; // the root is implied by the underlying chord
  let best: ChordType | null = null;
  let bestScore = -Infinity;
  for (const t of CHORD_TYPES) {
    if (t.parseOnly || !matches(t, mask)) continue;
    const s = 100 * t.prior - 14 * omittedDegrees(t, mask).length;
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  return best;
}

/** A description such as "1st inversion (3rd in the bass)". */
export function describeInversion(m: ChordMatch): string {
  if (m.inversion === 'root') return 'Root position';
  if (m.inversion === 'slash') return 'Slash chord (bass note outside the chord)';
  const d = m.bassDegree ? degree(m.bassDegree) : null;
  if (!d) return 'Inversion';
  if (d.num === 3) return '1st inversion (3rd in the bass)';
  if (d.num === 5) return '2nd inversion (5th in the bass)';
  if (d.num === 7) return '3rd inversion (7th in the bass)';
  return `Inversion (${m.bassDegree} in the bass)`;
}

export function spelledTones(m: ChordMatch, pref: AccidentalPref = 'auto') {
  return spellChord(m.chord, pref).tones;
}
