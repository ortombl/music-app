// Pitch classes, note spelling and MIDI helpers.
//
// Conventions used throughout the theory engine:
//  - pitch class (pc): integer 0..11, C = 0
//  - MIDI note number: C4 = 60, E2 (low E on a standard guitar) = 40
//  - spelled note: a letter (0..6 = C..B) plus an accidental (-2..+2)

export type PitchClass = number;
export type AccidentalPref = 'auto' | 'sharp' | 'flat';

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
export const LETTER_PC = [0, 2, 4, 5, 7, 9, 11] as const;

export interface SpelledNote {
  letter: number; // 0..6
  acc: number; // -2..2
}

export const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/** Signed distance in semitones in the range -6..5. */
export const signedMod12 = (n: number): number => {
  const m = mod12(n);
  return m > 5 ? m - 12 : m;
};

export const pcOf = (n: SpelledNote): PitchClass => mod12(LETTER_PC[n.letter] + n.acc);

export function accidentalText(acc: number): string {
  if (acc === 0) return '';
  if (acc > 0) return '♯'.repeat(acc);
  return '♭'.repeat(-acc);
}

export function formatNote(n: SpelledNote): string {
  return LETTERS[n.letter] + accidentalText(n.acc);
}

/** Spell a pitch class using a given letter, or null if that needs more than a double accidental. */
export function spellWithLetter(pc: PitchClass, letter: number): SpelledNote | null {
  const l = ((letter % 7) + 7) % 7;
  const acc = signedMod12(pc - LETTER_PC[l]);
  if (Math.abs(acc) > 2) return null;
  return { letter: l, acc };
}

const SHARP_SPELL: SpelledNote[] = [
  { letter: 0, acc: 0 }, { letter: 0, acc: 1 }, { letter: 1, acc: 0 }, { letter: 1, acc: 1 },
  { letter: 2, acc: 0 }, { letter: 3, acc: 0 }, { letter: 3, acc: 1 }, { letter: 4, acc: 0 },
  { letter: 4, acc: 1 }, { letter: 5, acc: 0 }, { letter: 5, acc: 1 }, { letter: 6, acc: 0 },
];
const FLAT_SPELL: SpelledNote[] = [
  { letter: 0, acc: 0 }, { letter: 1, acc: -1 }, { letter: 1, acc: 0 }, { letter: 2, acc: -1 },
  { letter: 2, acc: 0 }, { letter: 3, acc: 0 }, { letter: 4, acc: -1 }, { letter: 4, acc: 0 },
  { letter: 5, acc: -1 }, { letter: 5, acc: 0 }, { letter: 6, acc: -1 }, { letter: 6, acc: 0 },
];
/** The spelling most commonly used on fretboard charts when there is no key context. */
const COMMON_SPELL: SpelledNote[] = [
  SHARP_SPELL[0], SHARP_SPELL[1], SHARP_SPELL[2], FLAT_SPELL[3], SHARP_SPELL[4], SHARP_SPELL[5],
  SHARP_SPELL[6], SHARP_SPELL[7], FLAT_SPELL[8], SHARP_SPELL[9], FLAT_SPELL[10], SHARP_SPELL[11],
];

export function defaultSpelling(pc: PitchClass, pref: AccidentalPref = 'auto'): SpelledNote {
  const p = mod12(pc);
  if (pref === 'sharp') return SHARP_SPELL[p];
  if (pref === 'flat') return FLAT_SPELL[p];
  return COMMON_SPELL[p];
}

/** Both reasonable spellings (natural notes have one; black keys have a sharp and a flat one). */
export function candidateSpellings(pc: PitchClass): SpelledNote[] {
  const p = mod12(pc);
  const s = SHARP_SPELL[p];
  const f = FLAT_SPELL[p];
  return s.letter === f.letter ? [s] : [s, f];
}

export function pcName(pc: PitchClass, pref: AccidentalPref = 'auto'): string {
  return formatNote(defaultSpelling(pc, pref));
}

export const midiOctave = (midi: number): number => Math.floor(midi / 12) - 1;

export function midiName(midi: number, pref: AccidentalPref = 'auto', spelled?: SpelledNote): string {
  const n = spelled ?? defaultSpelling(mod12(midi), pref);
  // Octave numbers follow the letter (B♯3 is the same pitch as C4).
  const naturalMidi = midi - n.acc;
  return formatNote(n) + midiOctave(naturalMidi);
}

export const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * Parse a note name at the start of a string, e.g. "C#", "Bb", "E♭", "F##".
 * Returns the spelled note and the remainder of the string.
 */
export function parseNoteName(input: string): { note: SpelledNote; rest: string } | null {
  const m = /^([A-Ga-g])((?:#|♯|b|♭|x|𝄪|𝄫){0,2})/.exec(input);
  if (!m) return null;
  const letter = LETTERS.indexOf(m[1].toUpperCase() as (typeof LETTERS)[number]);
  let acc = 0;
  for (const ch of m[2]) {
    if (ch === '#' || ch === '♯') acc += 1;
    else if (ch === 'b' || ch === '♭') acc -= 1;
    else if (ch === 'x' || ch === '𝄪') acc += 2;
    else if (ch === '𝄫') acc -= 2;
  }
  return { note: { letter, acc }, rest: input.slice(m[0].length) };
}

/** Parse a note with octave, e.g. "E2", "F#1", "Bb3". */
export function parseMidiName(input: string): number | null {
  const m = /^([A-Ga-g](?:#|♯|b|♭)?)(-?\d)$/.exec(input.trim());
  if (!m) return null;
  const n = parseNoteName(m[1]);
  if (!n) return null;
  const octave = parseInt(m[2], 10);
  return (octave + 1) * 12 + LETTER_PC[n.note.letter] + n.note.acc;
}

export const INTERVAL_NAMES = [
  'unison / octave',
  'minor 2nd',
  'major 2nd',
  'minor 3rd',
  'major 3rd',
  'perfect 4th',
  'tritone',
  'perfect 5th',
  'minor 6th',
  'major 6th',
  'minor 7th',
  'major 7th',
];
