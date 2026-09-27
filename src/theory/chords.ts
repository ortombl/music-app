// Chord-type dictionary and chord spelling.

import { degree, type Degree } from './intervals';
import {
  candidateSpellings,
  defaultSpelling,
  formatNote,
  mod12,
  spellWithLetter,
  type AccidentalPref,
  type PitchClass,
  type SpelledNote,
} from './notes';

export type ChordFamily =
  | 'major'
  | 'minor'
  | 'dominant'
  | 'diminished'
  | 'half-diminished'
  | 'augmented'
  | 'suspended'
  | 'power';

export interface ChordType {
  id: string;
  /** Suffix written after the root, e.g. "m7♭5". */
  symbol: string;
  /** Human readable name, e.g. "minor 7th flat 5 (half-diminished)". */
  name: string;
  degrees: string[];
  /** Degrees that may be left out of a voicing without changing the chord's name. */
  optional: string[];
  /** Rough "how common is this chord" prior, 0..1. Used to rank ambiguous interpretations. */
  prior: number;
  family: ChordFamily;
  /** Alternative spellings of the suffix (normalised ASCII) accepted by the chord-symbol parser. */
  aliases: string[];
  /** Other names shown to the user. */
  aka?: string[];
  /** Chord-scale choices (ids from scales.ts), best first. */
  scales: string[];
  /** Only used when parsing chord symbols, never proposed by the chord identifier. */
  parseOnly?: boolean;
  // Derived:
  degreeInfo: Degree[];
  mask: number;
  requiredMask: number;
}

type ChordDef = Omit<ChordType, 'degreeInfo' | 'mask' | 'requiredMask' | 'optional' | 'aliases'> & {
  optional?: string[];
  aliases?: string[];
};

const MAJOR_SCALES = ['ionian', 'lydian', 'majorPentatonic'];
const MINOR_SCALES = ['dorian', 'aeolian', 'minorPentatonic', 'phrygian'];
const DOM_SCALES = ['mixolydian', 'blues', 'lydianDominant', 'minorPentatonic'];

const DEFS: ChordDef[] = [
  // Triads & dyads
  { id: 'maj', symbol: '', name: 'major', degrees: ['1', '3', '5'], optional: ['5'], prior: 1, family: 'major', aliases: ['', 'maj', 'major', 'M'], scales: ['ionian', 'mixolydian', 'lydian', 'majorPentatonic'] },
  { id: 'm', symbol: 'm', name: 'minor', degrees: ['1', 'b3', '5'], optional: ['5'], prior: 1, family: 'minor', aliases: ['m', 'min', 'minor'], scales: ['aeolian', 'dorian', 'minorPentatonic', 'phrygian'] },
  { id: 'dim', symbol: 'dim', name: 'diminished', degrees: ['1', 'b3', 'b5'], prior: 0.7, family: 'diminished', aliases: ['dim', 'o'], aka: ['°'], scales: ['dimWH', 'locrian'] },
  { id: 'aug', symbol: 'aug', name: 'augmented', degrees: ['1', '3', '#5'], prior: 0.6, family: 'augmented', aliases: ['aug', '+', '#5', 'augmented'], aka: ['+'], scales: ['wholeTone', 'lydianAugmented'] },
  { id: 'sus2', symbol: 'sus2', name: 'suspended 2nd', degrees: ['1', '2', '5'], prior: 0.7, family: 'suspended', aliases: ['sus2'], scales: ['ionian', 'mixolydian', 'dorian'] },
  { id: 'sus4', symbol: 'sus4', name: 'suspended 4th', degrees: ['1', '4', '5'], prior: 0.75, family: 'suspended', aliases: ['sus4', 'sus'], scales: ['mixolydian', 'ionian', 'dorian'] },
  { id: '5', symbol: '5', name: 'power chord (root + 5th)', degrees: ['1', '5'], prior: 0.8, family: 'power', aliases: ['5', 'no3'], scales: ['aeolian', 'minorPentatonic', 'ionian', 'mixolydian', 'blues'] },
  { id: 'b5', symbol: '(♭5)', name: 'major flat 5', degrees: ['1', '3', 'b5'], prior: 0.3, family: 'major', aliases: ['b5', 'majb5'], scales: ['lydianDominant', 'wholeTone'] },

  // Sixths
  { id: '6', symbol: '6', name: 'major 6th', degrees: ['1', '3', '5', '6'], optional: ['5'], prior: 0.7, family: 'major', aliases: ['6', 'maj6', 'add6'], scales: MAJOR_SCALES },
  { id: 'm6', symbol: 'm6', name: 'minor 6th', degrees: ['1', 'b3', '5', '6'], optional: ['5'], prior: 0.65, family: 'minor', aliases: ['m6', 'madd6'], scales: ['dorian', 'melodicMinor'] },
  { id: '6/9', symbol: '6/9', name: 'six-nine', degrees: ['1', '3', '5', '6', '9'], optional: ['5'], prior: 0.55, family: 'major', aliases: ['6/9', '69', '6add9'], scales: MAJOR_SCALES },
  { id: 'm6/9', symbol: 'm6/9', name: 'minor six-nine', degrees: ['1', 'b3', '5', '6', '9'], optional: ['5'], prior: 0.4, family: 'minor', aliases: ['m6/9', 'm69', 'm6add9'], scales: ['dorian', 'melodicMinor'] },

  // Sevenths
  { id: '7', symbol: '7', name: 'dominant 7th', degrees: ['1', '3', '5', 'b7'], optional: ['5'], prior: 0.95, family: 'dominant', aliases: ['7', 'dom7', 'dom'], scales: DOM_SCALES },
  { id: 'maj7', symbol: 'maj7', name: 'major 7th', degrees: ['1', '3', '5', '7'], optional: ['5'], prior: 0.9, family: 'major', aliases: ['maj7', 'j7'], aka: ['Δ7', 'M7'], scales: MAJOR_SCALES },
  { id: 'm7', symbol: 'm7', name: 'minor 7th', degrees: ['1', 'b3', '5', 'b7'], optional: ['5'], prior: 0.95, family: 'minor', aliases: ['m7'], aka: ['-7'], scales: MINOR_SCALES },
  { id: 'm7b5', symbol: 'm7♭5', name: 'half-diminished (minor 7th flat 5)', degrees: ['1', 'b3', 'b5', 'b7'], prior: 0.75, family: 'half-diminished', aliases: ['m7b5', 'halfdim', 'h7', 'h'], aka: ['ø7'], scales: ['locrian', 'locrianNat2'] },
  { id: 'dim7', symbol: 'dim7', name: 'diminished 7th', degrees: ['1', 'b3', 'b5', 'bb7'], prior: 0.7, family: 'diminished', aliases: ['dim7', 'o7'], aka: ['°7'], scales: ['dimWH', 'ultralocrian'] },
  { id: 'mmaj7', symbol: 'm(maj7)', name: 'minor-major 7th', degrees: ['1', 'b3', '5', '7'], optional: ['5'], prior: 0.45, family: 'minor', aliases: ['mmaj7', 'm/maj7', 'm#7', 'minmaj7'], aka: ['mΔ7'], scales: ['melodicMinor', 'harmonicMinor'] },
  { id: '7#5', symbol: '7♯5', name: 'augmented 7th', degrees: ['1', '3', '#5', 'b7'], prior: 0.5, family: 'dominant', aliases: ['7#5', 'aug7', '7aug', '+7', '7+'], aka: ['+7'], scales: ['wholeTone', 'altered'] },
  { id: 'maj7#5', symbol: 'maj7♯5', name: 'augmented major 7th', degrees: ['1', '3', '#5', '7'], prior: 0.35, family: 'augmented', aliases: ['maj7#5', 'augmaj7', '+maj7', 'maj7aug', 'maj7+'], scales: ['lydianAugmented'] },
  { id: '7b5', symbol: '7♭5', name: 'dominant 7th flat 5', degrees: ['1', '3', 'b5', 'b7'], prior: 0.4, family: 'dominant', aliases: ['7b5'], scales: ['wholeTone', 'lydianDominant', 'altered'] },
  { id: '7sus4', symbol: '7sus4', name: 'dominant 7th suspended 4th', degrees: ['1', '4', '5', 'b7'], optional: ['5'], prior: 0.7, family: 'suspended', aliases: ['7sus4', '7sus', 'sus7'], scales: ['mixolydian', 'dorian'] },
  { id: '7sus2', symbol: '7sus2', name: 'dominant 7th suspended 2nd', degrees: ['1', '2', '5', 'b7'], prior: 0.35, family: 'suspended', aliases: ['7sus2'], scales: ['mixolydian', 'dorian'] },

  // Added-note chords
  { id: 'add9', symbol: 'add9', name: 'major add 9', degrees: ['1', '3', '5', '9'], optional: ['5'], prior: 0.7, family: 'major', aliases: ['add9', 'add2', '2'], scales: MAJOR_SCALES },
  { id: 'madd9', symbol: 'm(add9)', name: 'minor add 9', degrees: ['1', 'b3', '5', '9'], optional: ['5'], prior: 0.6, family: 'minor', aliases: ['madd9', 'madd2', 'm2'], scales: ['aeolian', 'dorian'] },
  { id: 'add11', symbol: 'add11', name: 'major add 11', degrees: ['1', '3', '5', '11'], optional: ['5'], prior: 0.4, family: 'major', aliases: ['add11', 'add4'], scales: ['ionian', 'mixolydian'] },
  { id: 'madd11', symbol: 'm(add11)', name: 'minor add 11', degrees: ['1', 'b3', '5', '11'], optional: ['5'], prior: 0.4, family: 'minor', aliases: ['madd11', 'madd4'], scales: ['aeolian', 'dorian', 'minorPentatonic'] },

  // Ninths
  { id: '9', symbol: '9', name: 'dominant 9th', degrees: ['1', '3', '5', 'b7', '9'], optional: ['5'], prior: 0.8, family: 'dominant', aliases: ['9', 'dom9'], scales: DOM_SCALES },
  { id: 'maj9', symbol: 'maj9', name: 'major 9th', degrees: ['1', '3', '5', '7', '9'], optional: ['5'], prior: 0.75, family: 'major', aliases: ['maj9', 'j9'], aka: ['Δ9'], scales: MAJOR_SCALES },
  { id: 'm9', symbol: 'm9', name: 'minor 9th', degrees: ['1', 'b3', '5', 'b7', '9'], optional: ['5'], prior: 0.75, family: 'minor', aliases: ['m9'], scales: ['dorian', 'aeolian', 'minorPentatonic'] },
  { id: 'mmaj9', symbol: 'm(maj9)', name: 'minor-major 9th', degrees: ['1', 'b3', '5', '7', '9'], optional: ['5'], prior: 0.25, family: 'minor', aliases: ['mmaj9', 'm/maj9'], scales: ['melodicMinor', 'harmonicMinor'] },
  { id: '7b9', symbol: '7♭9', name: 'dominant 7th flat 9', degrees: ['1', '3', '5', 'b7', 'b9'], optional: ['5'], prior: 0.55, family: 'dominant', aliases: ['7b9'], scales: ['phrygianDominant', 'dimHW'] },
  { id: '7#9', symbol: '7♯9', name: 'dominant 7th sharp 9 ("Hendrix chord")', degrees: ['1', '3', '5', 'b7', '#9'], optional: ['5'], prior: 0.6, family: 'dominant', aliases: ['7#9'], scales: ['altered', 'dimHW', 'blues', 'minorPentatonic'] },
  { id: '9sus4', symbol: '9sus4', name: 'dominant 9th suspended 4th', degrees: ['1', '4', '5', 'b7', '9'], optional: ['5'], prior: 0.55, family: 'suspended', aliases: ['9sus4', '9sus', 'sus9'], aka: ['11 (no 3rd)'], scales: ['mixolydian', 'dorian'] },
  { id: 'm9b5', symbol: 'm9♭5', name: 'half-diminished 9th', degrees: ['1', 'b3', 'b5', 'b7', '9'], prior: 0.25, family: 'half-diminished', aliases: ['m9b5'], aka: ['ø9'], scales: ['locrianNat2'] },
  { id: '7#5#9', symbol: '7♯5♯9', name: 'altered dominant (♯5 ♯9)', degrees: ['1', '3', '#5', 'b7', '#9'], prior: 0.3, family: 'dominant', aliases: ['7#5#9', '7#9#5', 'aug7#9', '+7#9'], scales: ['altered'] },
  { id: '7#5b9', symbol: '7♯5♭9', name: 'altered dominant (♯5 ♭9)', degrees: ['1', '3', '#5', 'b7', 'b9'], prior: 0.25, family: 'dominant', aliases: ['7#5b9', '7b9#5', 'aug7b9', '+7b9'], scales: ['altered'] },
  { id: '7b5b9', symbol: '7♭5♭9', name: 'dominant 7th flat 5 flat 9', degrees: ['1', '3', 'b5', 'b7', 'b9'], prior: 0.2, family: 'dominant', aliases: ['7b5b9', '7b9b5'], scales: ['dimHW', 'altered'] },
  { id: '7alt', symbol: '7alt', name: 'altered dominant', degrees: ['1', '3', 'b7', '#9', 'b13'], prior: 0.3, family: 'dominant', aliases: ['alt', '7alt'], scales: ['altered'], parseOnly: true },

  // Elevenths
  { id: '11', symbol: '11', name: 'dominant 11th', degrees: ['1', '3', '5', 'b7', '9', '11'], optional: ['5', '9'], prior: 0.35, family: 'dominant', aliases: ['11', 'dom11'], scales: ['mixolydian'] },
  { id: 'm11', symbol: 'm11', name: 'minor 11th', degrees: ['1', 'b3', '5', 'b7', '9', '11'], optional: ['5', '9'], prior: 0.55, family: 'minor', aliases: ['m11'], scales: ['dorian', 'aeolian', 'minorPentatonic'] },
  { id: 'maj11', symbol: 'maj11', name: 'major 11th', degrees: ['1', '3', '5', '7', '9', '11'], optional: ['5', '9'], prior: 0.15, family: 'major', aliases: ['maj11'], scales: ['ionian'] },
  { id: 'maj7#11', symbol: 'maj7♯11', name: 'major 7th sharp 11 (Lydian)', degrees: ['1', '3', '5', '7', '#11'], optional: ['5'], prior: 0.4, family: 'major', aliases: ['maj7#11', 'maj7+11'], aka: ['Δ7♯11'], scales: ['lydian'] },
  { id: 'maj9#11', symbol: 'maj9♯11', name: 'major 9th sharp 11', degrees: ['1', '3', '5', '7', '9', '#11'], optional: ['5'], prior: 0.25, family: 'major', aliases: ['maj9#11'], scales: ['lydian'] },
  { id: '7#11', symbol: '7♯11', name: 'dominant 7th sharp 11 (Lydian dominant)', degrees: ['1', '3', '5', 'b7', '#11'], optional: ['5'], prior: 0.4, family: 'dominant', aliases: ['7#11', '7+11'], scales: ['lydianDominant'] },
  { id: '9#11', symbol: '9♯11', name: 'dominant 9th sharp 11', degrees: ['1', '3', '5', 'b7', '9', '#11'], optional: ['5'], prior: 0.3, family: 'dominant', aliases: ['9#11', '9+11'], scales: ['lydianDominant'] },

  // Thirteenths
  { id: '13', symbol: '13', name: 'dominant 13th', degrees: ['1', '3', '5', 'b7', '9', '13'], optional: ['5', '9'], prior: 0.55, family: 'dominant', aliases: ['13', 'dom13'], scales: ['mixolydian', 'lydianDominant', 'blues'] },
  { id: 'maj13', symbol: 'maj13', name: 'major 13th', degrees: ['1', '3', '5', '7', '9', '13'], optional: ['5', '9'], prior: 0.35, family: 'major', aliases: ['maj13'], scales: ['ionian', 'lydian'] },
  { id: 'm13', symbol: 'm13', name: 'minor 13th', degrees: ['1', 'b3', '5', 'b7', '9', '11', '13'], optional: ['5', '9', '11'], prior: 0.35, family: 'minor', aliases: ['m13'], scales: ['dorian'] },
  { id: '7b13', symbol: '7♭13', name: 'dominant 7th flat 13', degrees: ['1', '3', '5', 'b7', 'b13'], optional: ['5'], prior: 0.3, family: 'dominant', aliases: ['7b13'], scales: ['mixolydianB6', 'phrygianDominant'] },
  { id: '13b9', symbol: '13♭9', name: 'dominant 13th flat 9', degrees: ['1', '3', '5', 'b7', 'b9', '13'], optional: ['5'], prior: 0.25, family: 'dominant', aliases: ['13b9'], scales: ['dimHW'] },
  { id: '13#11', symbol: '13♯11', name: 'dominant 13th sharp 11', degrees: ['1', '3', '5', 'b7', '9', '#11', '13'], optional: ['5', '9'], prior: 0.2, family: 'dominant', aliases: ['13#11'], scales: ['lydianDominant'] },
];

function maskOf(semis: number[]): number {
  let m = 0;
  for (const s of semis) m |= 1 << mod12(s);
  return m;
}

export const CHORD_TYPES: ChordType[] = DEFS.map((d) => {
  const optional = d.optional ?? [];
  const degreeInfo = d.degrees.map(degree);
  return {
    ...d,
    optional,
    aliases: d.aliases ?? [],
    degreeInfo,
    mask: maskOf(degreeInfo.map((x) => x.semi)),
    requiredMask: maskOf(degreeInfo.filter((x) => !optional.includes(x.label)).map((x) => x.semi)),
  };
});

export const CHORD_TYPE_BY_ID = new Map(CHORD_TYPES.map((t) => [t.id, t]));

export function chordType(id: string): ChordType {
  const t = CHORD_TYPE_BY_ID.get(id);
  if (!t) throw new Error(`Unknown chord type ${id}`);
  return t;
}

export function isMinorish(t: ChordType): boolean {
  return t.family === 'minor' || t.family === 'diminished' || t.family === 'half-diminished';
}

/** A concrete chord: root + type (+ optional bass note for slash chords). */
export interface ChordSpec {
  rootPc: PitchClass;
  type: ChordType;
  bassPc?: PitchClass;
  /** Preferred root spelling (e.g. from user input); otherwise chosen automatically. */
  rootSpelling?: SpelledNote;
  bassSpelling?: SpelledNote;
}

export interface SpelledChord {
  root: SpelledNote;
  tones: { degree: Degree; note: SpelledNote; pc: PitchClass }[];
  bass?: SpelledNote;
  name: string;
}

function spellTones(root: SpelledNote, rootPc: PitchClass, t: ChordType) {
  return t.degreeInfo.map((d) => {
    const pc = mod12(rootPc + d.semi);
    const note = spellWithLetter(pc, root.letter + d.step) ?? defaultSpelling(pc);
    return { degree: d, note, pc };
  });
}

const TIE_PREFERENCE_FLAT = new Set([1, 3, 8, 10]); // D♭, E♭, A♭, B♭ preferred over C♯, D♯, G♯, A♯

/** Pick the best spelling for a chord root (fewest accidentals among the chord tones). */
export function chooseRootSpelling(rootPc: PitchClass, t: ChordType, pref: AccidentalPref = 'auto'): SpelledNote {
  const cands = candidateSpellings(rootPc);
  if (cands.length === 1) return cands[0];
  if (pref === 'sharp') return cands.find((c) => c.acc > 0) ?? cands[0];
  if (pref === 'flat') return cands.find((c) => c.acc < 0) ?? cands[0];
  let best = cands[0];
  let bestCost = Infinity;
  for (const c of cands) {
    const tones = spellTones(c, rootPc, t);
    let cost = 0;
    for (const x of tones) cost += Math.abs(x.note.acc) + (Math.abs(x.note.acc) > 1 ? 3 : 0);
    // tie-break towards the conventional spelling
    const tieBreak = (c.acc < 0) === TIE_PREFERENCE_FLAT.has(rootPc) ? -0.1 : 0;
    if (cost + tieBreak < bestCost) {
      bestCost = cost + tieBreak;
      best = c;
    }
  }
  return best;
}

export function spellChord(chord: ChordSpec, pref: AccidentalPref = 'auto'): SpelledChord {
  const root = chord.rootSpelling ?? chooseRootSpelling(chord.rootPc, chord.type, pref);
  const tones = spellTones(root, chord.rootPc, chord.type);
  let bass: SpelledNote | undefined;
  if (chord.bassPc !== undefined && chord.bassPc !== chord.rootPc) {
    const bassPref: AccidentalPref = pref !== 'auto' ? pref : root.acc < 0 ? 'flat' : root.acc > 0 ? 'sharp' : 'auto';
    bass =
      chord.bassSpelling ??
      tones.find((x) => x.pc === chord.bassPc)?.note ??
      defaultSpelling(chord.bassPc, bassPref);
  }
  const name = formatNote(root) + chord.type.symbol + (bass ? '/' + formatNote(bass) : '');
  return { root, tones, bass, name };
}

export function chordName(chord: ChordSpec, pref: AccidentalPref = 'auto'): string {
  return spellChord(chord, pref).name;
}

/** Pitch classes of the chord (all chord tones plus a slash bass). */
export function chordPcs(chord: ChordSpec): PitchClass[] {
  const pcs = chord.type.degreeInfo.map((d) => mod12(chord.rootPc + d.semi));
  if (chord.bassPc !== undefined && !pcs.includes(chord.bassPc)) pcs.push(chord.bassPc);
  return pcs;
}

export function chordRequiredPcs(chord: ChordSpec): PitchClass[] {
  const pcs = chord.type.degreeInfo
    .filter((d) => !chord.type.optional.includes(d.label))
    .map((d) => mod12(chord.rootPc + d.semi));
  if (chord.bassPc !== undefined && !pcs.includes(chord.bassPc)) pcs.push(chord.bassPc);
  return pcs;
}

/** Symbol shown in chord pickers, e.g. "m7♭5  —  half-diminished". */
export function chordTypeLabel(t: ChordType): string {
  return `${t.symbol || 'maj'} — ${t.name}`;
}
