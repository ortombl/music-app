// Scale definitions (used for arpeggio substitutions, key detection and soloing suggestions).

import { degree } from './intervals';
import { candidateSpellings, defaultSpelling, formatNote, mod12, spellWithLetter, type PitchClass, type SpelledNote } from './notes';

export interface ScaleType {
  id: string;
  name: string;
  degrees: string[];
  semis: number[];
  /** Short description shown as a tooltip. */
  info: string;
}

const DEFS: Omit<ScaleType, 'semis'>[] = [
  { id: 'ionian', name: 'Major (Ionian)', degrees: ['1', '2', '3', '4', '5', '6', '7'], info: 'The major scale.' },
  { id: 'dorian', name: 'Dorian', degrees: ['1', '2', 'b3', '4', '5', '6', 'b7'], info: 'Minor scale with a bright natural 6th — the classic m7 sound.' },
  { id: 'phrygian', name: 'Phrygian', degrees: ['1', 'b2', 'b3', '4', '5', 'b6', 'b7'], info: 'Dark minor scale with a ♭2 (Spanish/metal flavour).' },
  { id: 'lydian', name: 'Lydian', degrees: ['1', '2', '3', '#4', '5', '6', '7'], info: 'Major scale with a dreamy ♯4 — great over maj7.' },
  { id: 'mixolydian', name: 'Mixolydian', degrees: ['1', '2', '3', '4', '5', '6', 'b7'], info: 'Major scale with a ♭7 — the dominant 7th sound.' },
  { id: 'aeolian', name: 'Natural minor (Aeolian)', degrees: ['1', '2', 'b3', '4', '5', 'b6', 'b7'], info: 'The natural minor scale.' },
  { id: 'locrian', name: 'Locrian', degrees: ['1', 'b2', 'b3', '4', 'b5', 'b6', 'b7'], info: 'The scale for half-diminished (m7♭5) chords.' },
  { id: 'harmonicMinor', name: 'Harmonic minor', degrees: ['1', '2', 'b3', '4', '5', 'b6', '7'], info: 'Minor scale with a raised 7th (gives the major V chord in minor keys).' },
  { id: 'melodicMinor', name: 'Melodic minor', degrees: ['1', '2', 'b3', '4', '5', '6', '7'], info: 'Minor scale with raised 6th and 7th (jazz minor).' },
  { id: 'phrygianDominant', name: 'Phrygian dominant', degrees: ['1', 'b2', '3', '4', '5', 'b6', 'b7'], info: '5th mode of harmonic minor — the V7(♭9) of a minor key.' },
  { id: 'lydianDominant', name: 'Lydian dominant', degrees: ['1', '2', '3', '#4', '5', '6', 'b7'], info: 'Mixolydian with a ♯4 — for 7♯11 chords.' },
  { id: 'altered', name: 'Altered (super-locrian)', degrees: ['1', 'b2', '#2', '3', '#4', 'b6', 'b7'], info: 'All tensions altered — for 7alt chords resolving to a tonic.' },
  { id: 'locrianNat2', name: 'Locrian ♮2', degrees: ['1', '2', 'b3', '4', 'b5', 'b6', 'b7'], info: 'Half-diminished scale with a natural 9.' },
  { id: 'mixolydianB6', name: 'Mixolydian ♭6', degrees: ['1', '2', '3', '4', '5', 'b6', 'b7'], info: '5th mode of melodic minor — for 7♭13 chords.' },
  { id: 'lydianAugmented', name: 'Lydian augmented', degrees: ['1', '2', '3', '#4', '#5', '6', '7'], info: 'For maj7♯5 chords.' },
  { id: 'ultralocrian', name: 'Ultralocrian', degrees: ['1', 'b2', 'b3', 'b4', 'b5', 'b6', 'bb7'], info: '7th mode of harmonic minor — for the vii°7 chord.' },
  { id: 'dimHW', name: 'Half-whole diminished', degrees: ['1', 'b2', '#2', '3', '#4', '5', '6', 'b7'], info: 'Symmetrical scale for 7♭9 / 13♭9 dominant chords.' },
  { id: 'dimWH', name: 'Whole-half diminished', degrees: ['1', '2', 'b3', '4', 'b5', 'b6', '6', '7'], info: 'Symmetrical scale for diminished 7th chords.' },
  { id: 'wholeTone', name: 'Whole tone', degrees: ['1', '2', '3', '#4', '#5', 'b7'], info: 'Symmetrical scale for augmented and 7♯5 chords.' },
  { id: 'majorPentatonic', name: 'Major pentatonic', degrees: ['1', '2', '3', '5', '6'], info: 'Five-note major scale — no avoid notes.' },
  { id: 'minorPentatonic', name: 'Minor pentatonic', degrees: ['1', 'b3', '4', '5', 'b7'], info: 'Five-note minor scale — the rock/blues staple.' },
  { id: 'blues', name: 'Blues', degrees: ['1', 'b3', '4', 'b5', '5', 'b7'], info: 'Minor pentatonic plus the ♭5 "blue note".' },
];

export const SCALES: ScaleType[] = DEFS.map((d) => ({ ...d, semis: d.degrees.map((l) => degree(l).semi) }));
export const SCALE_BY_ID = new Map(SCALES.map((s) => [s.id, s]));

export function scaleType(id: string): ScaleType {
  const s = SCALE_BY_ID.get(id);
  if (!s) throw new Error(`Unknown scale ${id}`);
  return s;
}

export function scalePcs(rootPc: PitchClass, id: string): PitchClass[] {
  return scaleType(id).semis.map((s) => mod12(rootPc + s));
}

export function spellScale(root: SpelledNote, rootPc: PitchClass, id: string): SpelledNote[] {
  return scaleType(id).degrees.map((l) => {
    const d = degree(l);
    const pc = mod12(rootPc + d.semi);
    return spellWithLetter(pc, root.letter + d.step) ?? defaultSpelling(pc);
  });
}

export function scaleNoteNames(root: SpelledNote, rootPc: PitchClass, id: string): string {
  return spellScale(root, rootPc, id).map(formatNote).join(' ');
}

/** Heptatonic modes of the major scale, in order, starting from each degree. */
export const MAJOR_MODES = ['ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian'];

/**
 * If `pcs` (absolute pitch classes) all belong to the scale `parentId` on `parentRoot`,
 * return the mode of that parent scale that starts on `modeRoot` — as a scale id when it is
 * one of the known scales, else null.
 */
export function modeOf(parentRoot: PitchClass, parentId: string, modeRoot: PitchClass): string | null {
  const parent = scalePcs(parentRoot, parentId);
  if (!parent.includes(modeRoot)) return null;
  const rel = parent.map((p) => mod12(p - modeRoot)).sort((a, b) => a - b);
  for (const s of SCALES) {
    if (s.semis.length !== rel.length) continue;
    const sorted = [...s.semis].sort((a, b) => a - b);
    if (sorted.every((v, i) => v === rel[i])) return s.id;
  }
  return null;
}

/** Choose the spelling of a scale's root that gives the scale the fewest accidentals. */
export function chooseScaleRoot(rootPc: PitchClass, id: string, pref: 'auto' | 'sharp' | 'flat' = 'auto'): SpelledNote {
  const cands = candidateSpellings(rootPc);
  if (cands.length === 1) return cands[0];
  if (pref === 'sharp') return cands.find((c) => c.acc > 0) ?? cands[0];
  if (pref === 'flat') return cands.find((c) => c.acc < 0) ?? cands[0];
  let best = cands[0];
  let bestCost = Infinity;
  for (const c of cands) {
    const cost =
      spellScale(c, rootPc, id).reduce((s, n) => s + Math.abs(n.acc) + (Math.abs(n.acc) > 1 ? 3 : 0), 0) +
      (c.acc > 0 ? 0.01 : 0); // tie → flats (F major-ish keys are more common than their sharp twins)
    if (cost < bestCost) {
      bestCost = cost;
      best = c;
    }
  }
  return best;
}
