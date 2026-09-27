// Key / tonal-centre detection and Roman-numeral analysis for chord progressions.
//
// Every tonic (12) × mode (major, minor, Dorian, Mixolydian, Lydian, Phrygian) is scored by:
//   - how diatonic the chords are (harmonic-minor V/vii°, secondary dominants and borrowed
//     chords get partial credit),
//   - tonic emphasis (first chord, last chord, how often the tonic chord appears),
//   - cadences into the tonic (V→I, bVII→I in Mixolydian, IV→i in Dorian...),
//   - a small prior for how common the mode is.
// Scores are turned into probabilities with a softmax.

import { chordName, chordPcs, chordType, isMinorish, type ChordSpec } from './chords';
import { formatNote, mod12, type AccidentalPref, type PitchClass, type SpelledNote } from './notes';
import { chooseScaleRoot, modeOf, scalePcs, scaleType, spellScale } from './scales';
import type { ScaleContext } from './arpeggios';

export type KeyMode = 'major' | 'minor' | 'dorian' | 'mixolydian' | 'lydian' | 'phrygian';

interface ModeInfo {
  scale: string;
  label: string;
  minorTonic: boolean;
  prior: number;
}

export const MODES: Record<KeyMode, ModeInfo> = {
  major: { scale: 'ionian', label: 'major', minorTonic: false, prior: 0.9 },
  minor: { scale: 'aeolian', label: 'minor', minorTonic: true, prior: 0.75 },
  dorian: { scale: 'dorian', label: 'Dorian', minorTonic: true, prior: 0.4 },
  mixolydian: { scale: 'mixolydian', label: 'Mixolydian', minorTonic: false, prior: 0.4 },
  lydian: { scale: 'lydian', label: 'Lydian', minorTonic: false, prior: -0.3 },
  phrygian: { scale: 'phrygian', label: 'Phrygian', minorTonic: true, prior: -0.3 },
};

export interface KeyCandidate {
  tonicPc: PitchClass;
  mode: KeyMode;
  tonic: SpelledNote;
  name: string; // "A minor", "G Mixolydian"
  scaleId: string;
  score: number;
  probability: number;
  reasons: string[];
  /** The tonic chord is a dominant 7th (blues). */
  bluesy: boolean;
}

const setOf = (xs: number[]) => new Set(xs);
const subset = (pcs: number[], s: Set<number>) => pcs.every((p) => s.has(p));

function isDominantQuality(c: ChordSpec): boolean {
  const d = c.type.degrees;
  return d.includes('3') && !d.includes('7') && (d.includes('b7') || c.type.id === 'maj');
}

/** Diatonic triad quality on each degree of a 7-note scale: 'maj' | 'm' | 'dim' | 'aug'. */
function diatonicTriadQuality(scale: number[], rootPc: number): string | null {
  const sorted = [...scale];
  const i = sorted.indexOf(rootPc);
  if (i < 0 || sorted.length !== 7) return null;
  const third = mod12(sorted[(i + 2) % 7] - rootPc);
  const fifth = mod12(sorted[(i + 4) % 7] - rootPc);
  if (third === 4 && fifth === 7) return 'maj';
  if (third === 3 && fifth === 7) return 'm';
  if (third === 3 && fifth === 6) return 'dim';
  if (third === 4 && fifth === 8) return 'aug';
  return null;
}

type FitKind = 'diatonic' | 'harmonic' | 'melodic' | 'secondary' | 'tonicDominant' | 'borrowed' | 'chromatic';

function chordFit(c: ChordSpec, tonic: number, mode: KeyMode): { fit: number; kind: FitKind } {
  const pcs = chordPcs(c);
  const scale = scalePcs(tonic, MODES[mode].scale);
  const S = setOf(scale);
  if (subset(pcs, S)) return { fit: 1, kind: 'diatonic' };
  if (mode === 'minor') {
    if (subset(pcs, setOf(scalePcs(tonic, 'harmonicMinor')))) return { fit: 0.95, kind: 'harmonic' };
    if (subset(pcs, setOf(scalePcs(tonic, 'melodicMinor')))) return { fit: 0.7, kind: 'melodic' };
  }
  if (isDominantQuality(c) && !(c.rootPc === tonic && c.type.id === 'maj')) {
    const target = mod12(c.rootPc + 5);
    if (target === tonic) return { fit: 0.5, kind: 'tonicDominant' };
    const q = diatonicTriadQuality(scale, target);
    if (q === 'maj' || q === 'm') return { fit: 0.55, kind: 'secondary' };
  }
  if (mode === 'major' && subset(pcs, setOf(scalePcs(tonic, 'aeolian')))) return { fit: 0.3, kind: 'borrowed' };
  if (mode === 'minor' && subset(pcs, setOf(scalePcs(tonic, 'ionian')))) return { fit: 0.3, kind: 'borrowed' };
  const frac = pcs.filter((p) => S.has(p)).length / pcs.length;
  return { fit: 0.6 * frac - 0.4, kind: 'chromatic' };
}

/** Weight (0..1) with which a chord acts as the tonic chord of the key. */
function tonicWeight(c: ChordSpec, tonic: number, mode: KeyMode): number {
  if (c.rootPc !== tonic) return 0;
  const fam = c.type.family;
  if (fam === 'power') return 0.8;
  if (MODES[mode].minorTonic) return fam === 'minor' ? 1 : 0;
  if (fam === 'major' || fam === 'suspended') return 1;
  if (fam === 'dominant') return mode === 'mixolydian' ? 1 : 0.5; // blues-style I7
  return 0;
}

export function keyName(tonic: SpelledNote, mode: KeyMode): string {
  return `${formatNote(tonic)} ${MODES[mode].label}`;
}

export function detectKey(chords: ChordSpec[], pref: AccidentalPref = 'auto'): KeyCandidate[] {
  if (chords.length === 0) return [];
  const n = chords.length;
  const out: KeyCandidate[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of Object.keys(MODES) as KeyMode[]) {
      const info = MODES[mode];
      const reasons: string[] = [];
      const tonicDom = chords.filter((c) => c.rootPc === tonic && c.type.family === 'dominant').length;
      const tonicPlain = chords.filter((c) => c.rootPc === tonic && c.type.family === 'major').length;
      const bluesy = (mode === 'major' || mode === 'mixolydian') && tonicDom > 0 && tonicDom >= tonicPlain;
      const fits = chords.map((c) => chordFit(c, tonic, mode));
      const meanFit = fits.reduce((s, f) => s + f.fit, 0) / n;
      let score = 4 * meanFit + info.prior;
      const diatonicCount = fits.filter((f) => f.kind === 'diatonic').length;
      if (diatonicCount === n) reasons.push('Every chord belongs to the scale');
      else reasons.push(`${diatonicCount} of ${n} chords are diatonic`);
      if (fits.some((f) => f.kind === 'harmonic')) reasons.push('Uses the major V / vii° of harmonic minor');

      const tw = chords.map((c) => tonicWeight(c, tonic, mode));
      if (tw[0] > 0) {
        score += 1.5 * tw[0];
        reasons.push('Starts on the tonic chord');
      }
      if (n > 1 && tw[n - 1] > 0) {
        // Smaller than the first-chord bonus: people often enter loops, where the last chord
        // leads back to the first rather than being the point of rest.
        score += 0.7 * tw[n - 1];
        reasons.push('Ends on the tonic chord');
      }
      const tonicShare = tw.reduce((s, x) => s + x, 0) / n;
      score += 1.5 * tonicShare;
      if (tonicShare === 0) score -= 1.2;

      // Prominence of the tonic triad's notes across all chords.
      const triad = [tonic, mod12(tonic + (info.minorTonic ? 3 : 4)), mod12(tonic + 7)];
      const pcsList = chords.map((c) => chordPcs(c));
      const prominence = triad.reduce((s, p) => s + pcsList.filter((ps) => ps.includes(p)).length, 0) / (3 * n);
      score += 1.5 * prominence;

      // Cadences (including the loop back from the last chord to the first, at half weight).
      let cad = 0;
      const cadNames = new Set<string>();
      for (let i = 0; i < n; i++) {
        const loop = i === n - 1;
        if (loop && n < 2) break;
        const a = chords[i];
        const b = chords[(i + 1) % n];
        if (tonicWeight(b, tonic, mode) === 0) continue;
        const w = loop ? 0.5 : 1;
        const deg = mod12(a.rootPc - tonic);
        const fam = a.type.family;
        if ((mode === 'major' || mode === 'minor' || (mode === 'mixolydian' && bluesy)) && deg === 7 && (fam === 'dominant' || fam === 'major' || fam === 'suspended')) {
          cad += (fam === 'dominant' ? 1.2 : 0.9) * w;
          cadNames.add('V → I (authentic cadence)');
          if (i > 0 && mod12(chords[i - 1].rootPc - tonic) === 2) {
            cad += 0.3 * w;
            cadNames.add('ii – V – I');
          }
        } else if ((mode === 'major' || mode === 'minor') && deg === 11 && (fam === 'diminished' || fam === 'half-diminished')) {
          cad += 0.6 * w;
          cadNames.add('vii° → I (leading-tone resolution)');
        } else if (deg === 5 && (mode === 'major' || mode === 'dorian' || mode === 'mixolydian')) {
          cad += (mode === 'dorian' ? 0.4 : 0.3) * w;
          cadNames.add(mode === 'dorian' ? 'IV → i (Dorian cadence)' : 'IV → I (plagal cadence)');
        } else if (deg === 10 && (mode === 'mixolydian' || mode === 'minor' || mode === 'major')) {
          cad += (mode === 'major' ? 0.4 : 0.5) * w;
          cadNames.add(mode === 'major' ? '♭VII → I (borrowed "rock" cadence)' : '♭VII → I');
        } else if (deg === 1 && mode === 'phrygian') {
          cad += 0.6 * w;
          cadNames.add('♭II → i (Phrygian cadence)');
        } else if (deg === 2 && mode === 'lydian' && fam !== 'minor') {
          cad += 0.5 * w;
          cadNames.add('II → I (Lydian)');
        }
      }
      score += Math.min(cad, 2.5);
      for (const c of cadNames) reasons.push(`Cadence: ${c}`);

      const tonicSp = chooseScaleRoot(tonic, info.scale, pref);
      out.push({
        tonicPc: tonic,
        mode,
        tonic: tonicSp,
        name: keyName(tonicSp, mode),
        scaleId: info.scale,
        score,
        probability: 0,
        reasons,
        bluesy,
      });
    }
  }
  out.sort((a, b) => b.score - a.score);
  const top = out[0].score;
  let total = 0;
  for (const k of out) {
    k.probability = Math.exp((k.score - top) / 0.75);
    total += k.probability;
  }
  for (const k of out) k.probability /= total;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Roman-numeral analysis
// ---------------------------------------------------------------------------------------------

const NUMERALS = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];

function numeralFor(rootPc: number, tonic: number, minorish: boolean, dimLike: boolean): string {
  const deg = mod12(rootPc - tonic);
  let num = NUMERALS[deg];
  if (deg === 6 && !dimLike) num = '♭V';
  return minorish ? num.toLowerCase() : num;
}

function romanSuffix(c: ChordSpec): string {
  const t = c.type;
  switch (t.id) {
    case 'maj':
    case 'm':
      return '';
    case 'dim':
      return '°';
    case 'aug':
      return '+';
    case 'm7b5':
      return 'ø7';
    case 'dim7':
      return '°7';
    default:
      if (isMinorish(t) && t.symbol.startsWith('m') && !t.symbol.startsWith('maj')) return t.symbol.slice(1);
      return t.symbol;
  }
}

function inversionFigure(c: ChordSpec): string {
  if (c.bassPc === undefined) return '';
  const semi = mod12(c.bassPc - c.rootPc);
  const d = c.type.degreeInfo.find((x) => x.semi === semi);
  if (!d) return '';
  const isTriad = c.type.degrees.length === 3;
  const isSeventh = c.type.degrees.length === 4 && c.type.degrees.some((l) => l.endsWith('7'));
  if (isTriad) return d.num === 3 ? '⁶' : d.num === 5 ? '⁶₄' : '';
  if (isSeventh) return d.num === 3 ? '⁶₅' : d.num === 5 ? '⁴₃' : d.num === 7 ? '⁴₂' : '';
  return '';
}

export type HarmonicFunction = 'T' | 'S' | 'D' | '';

export interface ChordAnalysis {
  roman: string;
  func: HarmonicFunction;
  funcLabel: string;
  diatonic: boolean;
  note: string;
  scale: ScaleContext;
}

function simpleRoman(c: ChordSpec, tonic: number): string {
  const minorish = isMinorish(c.type);
  const dimLike = c.type.family === 'diminished' || c.type.family === 'half-diminished';
  let base = numeralFor(c.rootPc, tonic, minorish, dimLike);
  let suffix = romanSuffix(c);
  const fig = inversionFigure(c);
  if (fig) {
    // Figured-bass inversion symbols replace the plain "7".
    suffix = suffix.replace(/7$/, '');
    base += suffix + fig;
    return base;
  }
  return base + suffix;
}

/** The chord-scale that fits a chord in the context of a key. */
export function chordScaleInKey(c: ChordSpec, key: KeyCandidate): ScaleContext {
  const pcs = chordPcs({ ...c, bassPc: undefined });
  const parents = key.mode === 'minor' ? ['aeolian', 'harmonicMinor', 'melodicMinor'] : [key.scaleId];
  for (const p of parents) {
    const S = setOf(scalePcs(key.tonicPc, p));
    if (subset(pcs, S)) {
      const m = modeOf(key.tonicPc, p, c.rootPc);
      if (m) return { rootPc: c.rootPc, scaleId: m };
    }
  }
  return { rootPc: c.rootPc, scaleId: c.type.scales[0] };
}

export function analyzeChord(c: ChordSpec, key: KeyCandidate, next?: ChordSpec, pref: AccidentalPref = 'auto'): ChordAnalysis {
  const tonic = key.tonicPc;
  const mode = key.mode;
  const fit = chordFit(c, tonic, mode);
  const deg = mod12(c.rootPc - tonic);
  const scale = chordScaleInKey(c, key);
  let roman = simpleRoman(c, tonic);
  let note = '';
  let func: HarmonicFunction = '';
  const minorKey = MODES[mode].minorTonic;
  const fam = c.type.family;

  const resolvesToIV = deg === 0 && next !== undefined && mod12(next.rootPc - tonic) === 5;
  if (key.bluesy && fam === 'dominant' && (deg === 0 || deg === 5 || deg === 7) && !resolvesToIV) {
    return {
      roman,
      func: deg === 0 ? 'T' : deg === 5 ? 'S' : 'D',
      funcLabel: deg === 0 ? 'Tonic' : deg === 5 ? 'Subdominant' : 'Dominant',
      diatonic: true,
      note: `Blues ${deg === 0 ? 'I7' : deg === 5 ? 'IV7' : 'V7'} — dominant 7th chords on I, IV and V are the blues sound`,
      scale: { rootPc: c.rootPc, scaleId: 'mixolydian' },
    };
  }

  const functionByDegree = (): HarmonicFunction => {
    const majorMap: Record<number, HarmonicFunction> = { 0: 'T', 4: 'T', 9: 'T', 2: 'S', 5: 'S', 7: 'D', 11: 'D' };
    const minorMap: Record<number, HarmonicFunction> = { 0: 'T', 3: 'T', 8: 'S', 2: 'S', 5: 'S', 7: 'D', 11: 'D', 10: 'D' };
    if (mode === 'mixolydian' && deg === 10) return 'S';
    if (mode === 'phrygian' && deg === 1) return 'D';
    return (minorKey ? minorMap : majorMap)[deg] ?? '';
  };

  switch (fit.kind) {
    case 'diatonic':
      func = functionByDegree();
      if (deg === 0) note = 'Tonic chord — home base';
      else if (mode === 'dorian' && deg === 5 && !isMinorish(c.type)) note = 'Characteristic Dorian IV chord (natural 6th)';
      else if (mode === 'mixolydian' && deg === 10) note = 'Characteristic Mixolydian ♭VII chord';
      else if (mode === 'lydian' && deg === 2) note = 'Characteristic Lydian II chord (♯4)';
      else if (mode === 'phrygian' && deg === 1) note = 'Characteristic Phrygian ♭II chord';
      else if (mode === 'minor' && deg === 7) note = 'Minor v chord (natural minor)';
      break;
    case 'harmonic':
      func = deg === 7 || deg === 11 ? 'D' : functionByDegree();
      note = deg === 7 ? 'Major V from harmonic minor — strong pull back to the tonic' : 'From harmonic minor (raised 7th)';
      break;
    case 'melodic':
      func = functionByDegree();
      note = 'From melodic minor (raised 6th/7th)';
      break;
    case 'tonicDominant':
      func = 'D';
      note = `Dominant of the tonic — resolves to ${formatNote(key.tonic)}`;
      break;
    case 'secondary': {
      const target = mod12(c.rootPc + 5);
      const scale7 = scalePcs(tonic, MODES[mode].scale);
      const q = diatonicTriadQuality(scale7, target);
      const targetRoman = numeralFor(target, tonic, q === 'm' || q === 'dim', q === 'dim');
      const hasSeventh = c.type.degrees.includes('b7');
      roman = `V${hasSeventh ? '7' : ''}/${targetRoman}`;
      func = 'D';
      const resolves = next && next.rootPc === target;
      note = `Secondary dominant of ${targetRoman}${resolves ? ' — resolves as expected' : ''}`;
      break;
    }
    case 'borrowed':
      func = functionByDegree() || (deg === 8 || deg === 5 || deg === 10 || deg === 2 ? 'S' : deg === 3 ? 'T' : '');
      note = `Borrowed from ${formatNote(key.tonic)} ${minorKey ? 'major' : 'minor'} (modal interchange)`;
      break;
    default: {
      if (fam === 'dominant' && (deg === 0 || deg === 5 || deg === 7)) {
        func = deg === 7 ? 'D' : deg === 5 ? 'S' : 'T';
        note = 'Bluesy dominant 7th (I7/IV7/V7 blues sound)';
      } else if (deg === 1 && c.type.id === 'maj') {
        func = 'S';
        note = 'Neapolitan ♭II chord';
      } else if (fam === 'dominant' && next && mod12(c.rootPc - 1) === next.rootPc) {
        func = 'D';
        roman = 'subV7';
        note = `Tritone substitute — resolves down a half step to ${chordName(next, pref)}`;
      } else if ((fam === 'diminished' || fam === 'half-diminished') && next && mod12(c.rootPc + 1) === next.rootPc) {
        func = 'D';
        note = `Passing diminished chord — leads up a half step to ${chordName(next, pref)}`;
      } else {
        note = 'Chromatic chord (outside the key)';
      }
    }
  }
  const funcLabel = func === 'T' ? 'Tonic' : func === 'S' ? 'Subdominant' : func === 'D' ? 'Dominant' : '—';
  return { roman, func, funcLabel, diatonic: fit.kind === 'diatonic' || fit.kind === 'harmonic', note, scale };
}

export interface ScaleAdvice {
  label: string;
  notes: string;
  why: string;
  ctx: ScaleContext;
}

/** Scales to solo with over the whole progression. */
export function progressionScales(key: KeyCandidate, chords: ChordSpec[], pref: AccidentalPref = 'auto'): ScaleAdvice[] {
  const out: ScaleAdvice[] = [];
  const add = (rootPc: number, scaleId: string, why: string) => {
    if (out.some((o) => o.ctx.rootPc === rootPc && o.ctx.scaleId === scaleId)) return;
    const root = chooseScaleRoot(rootPc, scaleId, pref);
    out.push({
      label: `${formatNote(root)} ${scaleType(scaleId).name}`,
      notes: spellScale(root, rootPc, scaleId).map(formatNote).join(' '),
      why,
      ctx: { rootPc, scaleId },
    });
  };
  const t = key.tonicPc;
  const bluesy = chords.some((c) => c.rootPc === t && c.type.family === 'dominant');
  if (bluesy) {
    add(t, 'blues', 'Dominant tonic chord — blues sound');
    add(t, 'minorPentatonic', 'Classic blues/rock choice');
  }
  add(t, key.scaleId, 'Parent scale of the key — fits every diatonic chord');
  switch (key.mode) {
    case 'major':
      add(t, 'majorPentatonic', 'Safe, no avoid notes');
      add(mod12(t + 9), 'minorPentatonic', 'Relative minor pentatonic (same notes as major pentatonic)');
      break;
    case 'minor':
      add(t, 'minorPentatonic', 'Safe, no avoid notes');
      add(t, 'blues', 'Adds the ♭5 blue note');
      if (chords.some((c) => chordFit(c, t, 'minor').kind === 'harmonic')) add(t, 'harmonicMinor', 'Over the major V chord');
      break;
    case 'dorian':
      add(t, 'minorPentatonic', 'Safe choice; add the natural 6th for Dorian colour');
      break;
    case 'mixolydian':
      add(t, 'majorPentatonic', 'Safe choice');
      add(t, 'minorPentatonic', 'Bluesy/rock option');
      break;
    case 'lydian':
      add(t, 'majorPentatonic', 'Safe choice; add the ♯4 for Lydian colour');
      break;
    case 'phrygian':
      add(t, 'minorPentatonic', 'Safe choice; add the ♭2 for Phrygian colour');
      break;
  }
  return out;
}

/** The tonic ("home") chord of the key, preferring a version that appears in the progression. */
export function tonicChord(key: KeyCandidate, chords: ChordSpec[]): ChordSpec {
  const inProg = chords
    .filter((c) => tonicWeight(c, key.tonicPc, key.mode) > 0)
    .sort((a, b) => tonicWeight(b, key.tonicPc, key.mode) - tonicWeight(a, key.tonicPc, key.mode));
  if (inProg.length) return { ...inProg[0], bassPc: undefined, bassSpelling: undefined };
  return { rootPc: key.tonicPc, type: chordType(MODES[key.mode].minorTonic ? 'm' : 'maj'), rootSpelling: key.tonic };
}
