// Rank scales by how closely they fit a chord progression.
//
// Every scale type is placed on the tonic and compared with the progression's harmony:
//   - coverage: how much of the harmony (chord tones, with roots/3rds/7ths weighted more) the
//     scale contains;
//   - clashes: scale notes that sit a half step from a chord tone the scale lacks (e.g. F♯ in
//     C Lydian against an F major chord) — these sound "wrong", so they are penalised;
//   - colour: scale notes the chords never use — neutral, they are the scale's flavour, but a
//     scale full of them is a looser fit.
// The result is a 0–100 % "closeness", plus comments on what clashes or is missing.

import { chordName, chordPcs, spellChord, type ChordSpec } from './chords';
import { degree } from './intervals';
import { formatNote, mod12, pcName, type AccidentalPref, type PitchClass, type SpelledNote } from './notes';
import { chooseScaleRoot, MAJOR_MODES, SCALES, scaleType, spellScale, type Mood } from './scales';
import type { ScaleContext } from './arpeggios';

export interface ScaleClash {
  scaleNote: string;
  against: string;
  chords: string[];
}

export interface ScaleFit {
  ctx: ScaleContext;
  label: string;
  notes: string;
  /** 0..1 */
  closeness: number;
  moods: Mood[];
  info: string;
  missing: string[];
  clashes: ScaleClash[];
  colour: string[];
  comment: string;
  /** Other names for the same notes, e.g. "same notes as A minor pentatonic". */
  sameAs?: string;
  root: SpelledNote;
}

function toneWeight(label: string): number {
  const n = degree(label).num;
  if (n === 1) return 1.5;
  if (n === 3) return 1.3;
  if (n === 7 || label === '6') return 1.0;
  if (n === 5) return 0.8;
  return 0.9;
}

export interface RankOptions {
  pref?: AccidentalPref;
  /** Blues context (dominant-7th tonic): the ♭3/♭5 "blue notes" are idiomatic, not clashes. */
  bluesy?: boolean;
  /** Spelling of the tonic (so every scale uses the key's spelling, e.g. E♭ not D♯). */
  tonic?: SpelledNote;
}

const BLUES_SCALES = new Set(['blues', 'minorPentatonic', 'majorBlues']);

/** Scales ranked from closest to loosest fit, all rooted on the tonic. */
export function rankScalesForProgression(chords: ChordSpec[], tonicPc: PitchClass, opts: RankOptions = {}): ScaleFit[] {
  const pref = opts.pref ?? 'auto';
  if (!chords.length) return [];
  // Weighted pitch-class profile of the harmony; each chord counts equally.
  const weight = new Array<number>(12).fill(0);
  const usedBy: string[][] = Array.from({ length: 12 }, () => []);
  const spelled = new Map<number, string>();
  for (const c of chords) {
    const sp = spellChord(c, pref);
    const name = chordName(c, pref);
    const tones = sp.tones.map((t) => ({ pc: t.pc, w: toneWeight(t.degree.label), name: formatNote(t.note) }));
    if (c.bassPc !== undefined && !tones.some((t) => t.pc === c.bassPc)) tones.push({ pc: c.bassPc, w: 0.6, name: pcName(c.bassPc, pref) });
    const sum = tones.reduce((s, t) => s + t.w, 0);
    for (const t of tones) {
      weight[t.pc] += t.w / sum;
      if (!usedBy[t.pc].includes(name)) usedBy[t.pc].push(name);
      if (!spelled.has(t.pc) && !/[♯♭]{2}/.test(t.name)) spelled.set(t.pc, t.name);
    }
  }
  const total = weight.reduce((s, w) => s + w, 0);
  const chordSets = chords.map((c) => new Set(chordPcs(c)));
  // Share of chords over which a note is an "avoid note" (a half step above a chord tone).
  const avoidShare = (pc: number) => chordSets.filter((set) => set.has(mod12(pc - 1)) && !set.has(pc)).length / chordSets.length;
  const inHarmony = (pc: number) => weight[pc] > 0;
  const harmonyName = (pc: number) => spelled.get(pc) ?? pcName(pc, pref);

  const out: ScaleFit[] = [];
  for (const st of SCALES) {
    const root = opts.tonic ?? chooseScaleRoot(tonicPc, st.id, pref);
    const spelledScale = spellScale(root, tonicPc, st.id);
    const S = new Map<number, string>();
    st.semis.forEach((semi, i) => S.set(mod12(tonicPc + semi), formatNote(spelledScale[i])));

    let covered = 0;
    for (const [pc] of S) covered += weight[pc];
    const clashes: ScaleClash[] = [];
    let clashMass = 0;
    let colourPenalty = 0;
    const colour: string[] = [];
    const blueNotes: string[] = [];
    for (const [pc, name] of S) {
      if (inHarmony(pc)) continue;
      const neighbours = [mod12(pc - 1), mod12(pc + 1)].filter((y) => inHarmony(y) && !S.has(y));
      const rel = mod12(pc - tonicPc);
      if (neighbours.length && opts.bluesy && (rel === 3 || rel === 6 || rel === 10)) {
        blueNotes.push(name); // the idiomatic blues rub
        colourPenalty += 0.02;
      } else if (neighbours.length) {
        for (const y of neighbours) {
          clashMass += weight[y];
          clashes.push({ scaleNote: name, against: harmonyName(y), chords: usedBy[y] });
        }
      } else {
        colour.push(name);
        colourPenalty += 0.012 + 0.04 * avoidShare(pc);
      }
    }
    const missingPcs = [...Array(12).keys()].filter((pc) => inHarmony(pc) && !S.has(pc));
    const idiom = opts.bluesy && BLUES_SCALES.has(st.id) ? 0.15 : 0;
    const closeness = Math.max(0, Math.min(1, covered / total - clashMass / total - colourPenalty + idiom + 0.004 * st.prior));

    let comment: string;
    if (clashes.length) {
      comment = `Clashes: ${clashes
        .slice(0, 3)
        .map((c) => `${c.scaleNote} rubs against ${c.against} (${c.chords.slice(0, 3).join(', ')})`)
        .join('; ')}.`;
    } else if (missingPcs.length) {
      comment = `No clashes. Leaves out ${missingPcs.map(harmonyName).join(', ')} — play those over the chords that contain them.`;
    } else {
      comment = 'Contains every chord tone of the progression.';
    }
    if (colour.length) comment += ` Colour notes: ${colour.join(', ')}.`;
    if (blueNotes.length) comment += ` Blue notes ${blueNotes.join(', ')} rub against the major chords — the classic blues sound.`;
    else if (idiom) comment += ' Idiomatic blues choice — bend the ♭3 up toward the major 3rd.';

    out.push({
      ctx: { rootPc: tonicPc, scaleId: st.id },
      label: `${formatNote(root)} ${st.name}`,
      notes: spelledScale.map(formatNote).join(' '),
      closeness,
      moods: st.moods,
      info: st.info,
      missing: missingPcs.map(harmonyName),
      clashes,
      colour,
      comment,
      sameAs: sameAs(tonicPc, st.id, pref),
      root,
    });
  }
  return out.sort((a, b) => b.closeness - a.closeness);
}

/** "Same notes as C major" for modes; relative pentatonics. */
function sameAs(tonicPc: number, id: string, pref: AccidentalPref): string | undefined {
  const modeIdx = MAJOR_MODES.indexOf(id);
  if (modeIdx > 0) {
    const majorSteps = scaleType('ionian').semis;
    const parent = mod12(tonicPc - majorSteps[modeIdx]);
    return `same notes as ${formatNote(chooseScaleRoot(parent, 'ionian', pref))} major`;
  }
  if (id === 'ionian') return `same notes as ${formatNote(chooseScaleRoot(mod12(tonicPc + 9), 'aeolian', pref))} natural minor`;
  if (id === 'majorPentatonic') return `same notes as ${formatNote(chooseScaleRoot(mod12(tonicPc + 9), 'minorPentatonic', pref))} minor pentatonic`;
  if (id === 'minorPentatonic') return `same notes as ${formatNote(chooseScaleRoot(mod12(tonicPc + 3), 'majorPentatonic', pref))} major pentatonic`;
  return undefined;
}
