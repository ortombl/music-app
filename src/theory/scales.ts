// Scale definitions (used for arpeggio substitutions, key detection and soloing suggestions).

import { degree } from './intervals';
import { candidateSpellings, defaultSpelling, formatNote, mod12, spellWithLetter, type PitchClass, type SpelledNote } from './notes';

export type Mood =
  | 'happy'
  | 'bright'
  | 'dreamy'
  | 'soulful'
  | 'jazzy'
  | 'bluesy'
  | 'rock'
  | 'sad'
  | 'bittersweet'
  | 'dark'
  | 'epic'
  | 'cinematic'
  | 'spicy'
  | 'exotic'
  | 'tense'
  | 'mysterious'
  | 'eerie'
  | 'safe';

export interface ScaleType {
  id: string;
  name: string;
  degrees: string[];
  semis: number[];
  /** Character of the scale, e.g. ["dark", "spicy"]. */
  moods: Mood[];
  /** Short description of its sound and typical use. */
  info: string;
  /** How commonly it is used (0..1) — a tie-breaker when ranking. */
  prior: number;
}

const DEFS: Omit<ScaleType, 'semis'>[] = [
  // Major modes
  { id: 'ionian', name: 'Major (Ionian)', degrees: ['1', '2', '3', '4', '5', '6', '7'], moods: ['happy', 'bright'], prior: 1, info: 'The classic major sound — happy, stable and singable.' },
  { id: 'dorian', name: 'Dorian', degrees: ['1', '2', 'b3', '4', '5', '6', 'b7'], moods: ['soulful', 'jazzy'], prior: 0.9, info: 'Minor with a bright natural 6th — cool, hopeful minor (Santana, funk, jazz). The classic m7 sound.' },
  { id: 'phrygian', name: 'Phrygian', degrees: ['1', 'b2', 'b3', '4', '5', 'b6', 'b7'], moods: ['dark', 'spicy'], prior: 0.6, info: 'Dark minor with a ♭2 — Spanish, flamenco and metal flavour.' },
  { id: 'lydian', name: 'Lydian', degrees: ['1', '2', '3', '#4', '5', '6', '7'], moods: ['dreamy', 'bright'], prior: 0.7, info: 'Major with a raised 4th — floating, magical, film-score sound. Great over maj7.' },
  { id: 'mixolydian', name: 'Mixolydian', degrees: ['1', '2', '3', '4', '5', '6', 'b7'], moods: ['bluesy', 'rock'], prior: 0.9, info: 'Major with a ♭7 — laid-back rock, blues, funk; the dominant 7th sound.' },
  { id: 'aeolian', name: 'Natural minor (Aeolian)', degrees: ['1', '2', 'b3', '4', '5', 'b6', 'b7'], moods: ['sad', 'epic'], prior: 1, info: 'The natural minor scale — melancholic, emotional, epic.' },
  { id: 'locrian', name: 'Locrian', degrees: ['1', 'b2', 'b3', '4', 'b5', 'b6', 'b7'], moods: ['dark', 'tense'], prior: 0.35, info: 'The darkest mode (♭2 and ♭5) — unstable; the scale for m7♭5 chords.' },
  // Minor-scale families
  { id: 'harmonicMinor', name: 'Harmonic minor', degrees: ['1', '2', 'b3', '4', '5', 'b6', '7'], moods: ['exotic', 'dark'], prior: 0.8, info: 'Minor with a raised 7th — dramatic, neoclassical, a Middle-Eastern tinge. Gives the major V chord in minor keys.' },
  { id: 'melodicMinor', name: 'Melodic minor', degrees: ['1', '2', 'b3', '4', '5', '6', '7'], moods: ['jazzy', 'bittersweet'], prior: 0.65, info: 'Jazz minor (raised 6th and 7th) — smooth and sophisticated; great over m6 and m(maj7).' },
  { id: 'phrygianDominant', name: 'Phrygian dominant', degrees: ['1', 'b2', '3', '4', '5', 'b6', 'b7'], moods: ['spicy', 'exotic'], prior: 0.6, info: 'Flamenco, klezmer, Middle-Eastern, metal — the V7(♭9) of a minor key.' },
  { id: 'lydianDominant', name: 'Lydian dominant', degrees: ['1', '2', '3', '#4', '5', '6', 'b7'], moods: ['bright', 'jazzy'], prior: 0.5, info: 'Mixolydian with a ♯4 — quirky, bright fusion sound (7♯11 chords).' },
  { id: 'altered', name: 'Altered (super-locrian)', degrees: ['1', 'b2', '#2', '3', '#4', 'b6', 'b7'], moods: ['tense', 'jazzy'], prior: 0.45, info: 'Maximum tension over a dominant chord (all tensions altered) — resolve it!' },
  { id: 'locrianNat2', name: 'Locrian ♮2', degrees: ['1', '2', 'b3', '4', 'b5', 'b6', 'b7'], moods: ['dark', 'jazzy'], prior: 0.35, info: 'Half-diminished with a natural 9 — smoother than Locrian.' },
  { id: 'mixolydianB6', name: 'Mixolydian ♭6', degrees: ['1', '2', '3', '4', '5', 'b6', 'b7'], moods: ['bittersweet', 'cinematic'], prior: 0.35, info: 'Major turning minor at the top (Aeolian dominant) — nostalgic, cinematic.' },
  { id: 'lydianAugmented', name: 'Lydian augmented', degrees: ['1', '2', '3', '#4', '#5', '6', '7'], moods: ['dreamy', 'mysterious'], prior: 0.25, info: 'Lydian with a ♯5 — weightless and mysterious (maj7♯5 chords).' },
  { id: 'ultralocrian', name: 'Ultralocrian', degrees: ['1', 'b2', 'b3', 'b4', 'b5', 'b6', 'bb7'], moods: ['dark', 'tense'], prior: 0.2, info: '7th mode of harmonic minor — for the vii°7 chord; extremely dark.' },
  { id: 'dorianB2', name: 'Dorian ♭2 (Phrygian ♮6)', degrees: ['1', 'b2', 'b3', '4', '5', '6', 'b7'], moods: ['dark', 'jazzy'], prior: 0.25, info: 'Phrygian with a natural 6th — dark but not hopeless; modern jazz/metal.' },
  { id: 'harmonicMajor', name: 'Harmonic major', degrees: ['1', '2', '3', '4', '5', 'b6', '7'], moods: ['bittersweet', 'cinematic'], prior: 0.3, info: 'Major with a ♭6 — nostalgic, film-like, a touch of melancholy.' },
  // Exotic / world
  { id: 'doubleHarmonic', name: 'Double harmonic (Byzantine)', degrees: ['1', 'b2', '3', '4', '5', 'b6', '7'], moods: ['exotic', 'spicy'], prior: 0.3, info: 'Arabic / Byzantine scale with two augmented 2nds — unmistakably exotic.' },
  { id: 'hungarianMinor', name: 'Hungarian minor', degrees: ['1', '2', 'b3', '#4', '5', 'b6', '7'], moods: ['exotic', 'dark'], prior: 0.3, info: 'Gypsy minor — dramatic, dark and passionate.' },
  { id: 'hungarianMajor', name: 'Hungarian major', degrees: ['1', '#2', '3', '#4', '5', '6', 'b7'], moods: ['exotic', 'spicy'], prior: 0.15, info: 'Unusual major-ish scale with ♯2 and ♯4 — fiery and exotic.' },
  { id: 'ukrainianDorian', name: 'Ukrainian Dorian (Romanian minor)', degrees: ['1', '2', 'b3', '#4', '5', '6', 'b7'], moods: ['exotic', 'soulful'], prior: 0.2, info: 'Dorian with a ♯4 — Eastern-European folk and klezmer.' },
  { id: 'neapolitanMinor', name: 'Neapolitan minor', degrees: ['1', 'b2', 'b3', '4', '5', 'b6', '7'], moods: ['dark', 'cinematic'], prior: 0.2, info: 'Harmonic minor with a ♭2 — operatic, brooding and grand.' },
  { id: 'neapolitanMajor', name: 'Neapolitan major', degrees: ['1', 'b2', 'b3', '4', '5', '6', '7'], moods: ['mysterious', 'tense'], prior: 0.15, info: 'Melodic minor with a ♭2 — strange, tense elegance.' },
  { id: 'persian', name: 'Persian', degrees: ['1', 'b2', '3', '4', 'b5', 'b6', '7'], moods: ['exotic', 'tense'], prior: 0.15, info: 'Very chromatic Middle-Eastern scale — intense and spicy.' },
  { id: 'enigmatic', name: 'Enigmatic', degrees: ['1', 'b2', '3', '#4', '#5', '#6', '7'], moods: ['mysterious', 'eerie'], prior: 0.1, info: 'Verdi’s puzzle scale — hovering, strange and unresolved.' },
  { id: 'hirajoshi', name: 'Hirajoshi', degrees: ['1', '2', 'b3', '5', 'b6'], moods: ['sad', 'exotic'], prior: 0.25, info: 'Japanese pentatonic — haunting and melancholic.' },
  { id: 'insen', name: 'In-sen', degrees: ['1', 'b2', '4', '5', 'b7'], moods: ['dark', 'mysterious'], prior: 0.2, info: 'Japanese pentatonic with a ♭2 — sparse, haunting, meditative.' },
  { id: 'iwato', name: 'Iwato', degrees: ['1', 'b2', '4', 'b5', 'b7'], moods: ['eerie', 'dark'], prior: 0.15, info: 'Japanese pentatonic with ♭2 and ♭5 — eerie and unsettling.' },
  { id: 'egyptian', name: 'Suspended pentatonic (Egyptian)', degrees: ['1', '2', '4', '5', 'b7'], moods: ['safe', 'mysterious'], prior: 0.3, info: 'Pentatonic with no 3rd — open, ancient, fits both major and minor sus sounds.' },
  { id: 'prometheus', name: 'Prometheus', degrees: ['1', '2', '3', '#4', '6', 'b7'], moods: ['dreamy', 'mysterious'], prior: 0.1, info: 'Scriabin’s mystic scale — luminous and otherworldly.' },
  // Symmetrical
  { id: 'dimHW', name: 'Half-whole diminished', degrees: ['1', 'b2', '#2', '3', '#4', '5', '6', 'b7'], moods: ['tense', 'jazzy'], prior: 0.45, info: 'Symmetrical scale for 7♭9 / 13♭9 chords — slick jazz tension.' },
  { id: 'dimWH', name: 'Whole-half diminished', degrees: ['1', '2', 'b3', '4', 'b5', 'b6', '6', '7'], moods: ['tense', 'eerie'], prior: 0.35, info: 'Symmetrical scale for diminished 7th chords — suspense and horror.' },
  { id: 'wholeTone', name: 'Whole tone', degrees: ['1', '2', '3', '#4', '#5', 'b7'], moods: ['dreamy', 'eerie'], prior: 0.35, info: 'All whole steps — dream sequences, floating and ambiguous (aug / 7♯5 chords).' },
  { id: 'augmented', name: 'Augmented (hexatonic)', degrees: ['1', '#2', '3', '5', '#5', '7'], moods: ['mysterious', 'eerie'], prior: 0.1, info: 'Alternating minor 3rds and half steps — modern, symmetrical, strange.' },
  // Pentatonic & blues
  { id: 'majorPentatonic', name: 'Major pentatonic', degrees: ['1', '2', '3', '5', '6'], moods: ['happy', 'safe'], prior: 0.95, info: 'Five-note major scale with no avoid notes — country, pop, singable and safe.' },
  { id: 'minorPentatonic', name: 'Minor pentatonic', degrees: ['1', 'b3', '4', '5', 'b7'], moods: ['rock', 'bluesy', 'safe'], prior: 1, info: 'The rock and blues staple — five notes, hard to hit a wrong one.' },
  { id: 'blues', name: 'Blues', degrees: ['1', 'b3', '4', 'b5', '5', 'b7'], moods: ['bluesy', 'rock'], prior: 0.9, info: 'Minor pentatonic plus the ♭5 "blue note" — gritty and expressive.' },
  { id: 'majorBlues', name: 'Major blues', degrees: ['1', '2', 'b3', '3', '5', '6'], moods: ['bluesy', 'happy'], prior: 0.6, info: 'Major pentatonic plus the ♭3 blue note — country, southern rock, happy blues.' },
  // Bebop
  { id: 'bebopDominant', name: 'Bebop dominant', degrees: ['1', '2', '3', '4', '5', '6', 'b7', '7'], moods: ['jazzy', 'bluesy'], prior: 0.4, info: 'Mixolydian plus a passing major 7th — swing lines land chord tones on the beat.' },
  { id: 'bebopMajor', name: 'Bebop major', degrees: ['1', '2', '3', '4', '5', '#5', '6', '7'], moods: ['jazzy', 'happy'], prior: 0.35, info: 'Major plus a passing ♯5 — smooth, swinging major lines.' },
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
    const n = spellWithLetter(pc, root.letter + d.step);
    // Avoid double sharps/flats in scales (E♭ blues uses A, not B♭♭).
    if (!n || Math.abs(n.acc) > 1) return defaultSpelling(pc, root.acc < 0 ? 'flat' : root.acc > 0 ? 'sharp' : 'auto');
    return n;
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
