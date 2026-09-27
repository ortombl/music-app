// Tuning presets. Strings are listed from the lowest-pitched string to the highest, as MIDI notes.

import { midiName, parseMidiName } from './notes';

export interface Tuning {
  id: string;
  name: string;
  group: string;
  strings: number[];
}

const t = (id: string, name: string, group: string, notes: string): Tuning => ({
  id,
  name,
  group,
  strings: notes.split(' ').map((n) => {
    const m = parseMidiName(n);
    if (m === null) throw new Error(`bad tuning note ${n}`);
    return m;
  }),
});

export const TUNINGS: Tuning[] = [
  t('standard', 'Standard', '6-string', 'E2 A2 D3 G3 B3 E4'),
  t('dropD', 'Drop D', '6-string', 'D2 A2 D3 G3 B3 E4'),
  t('dropC#', 'Drop C♯', '6-string', 'C#2 G#2 C#3 F#3 A#3 D#4'),
  t('dropC', 'Drop C', '6-string', 'C2 G2 C3 F3 A3 D4'),
  t('dropB', 'Drop B', '6-string', 'B1 F#2 B2 E3 G#3 C#4'),
  t('dropA', 'Drop A', '6-string', 'A1 E2 A2 D3 F#3 B3'),
  t('ebStandard', 'E♭ Standard (half step down)', '6-string', 'D#2 G#2 C#3 F#3 A#3 D#4'),
  t('dStandard', 'D Standard (whole step down)', '6-string', 'D2 G2 C3 F3 A3 D4'),
  t('cStandard', 'C Standard', '6-string', 'C2 F2 A#2 D#3 G3 C4'),
  t('dadgad', 'DADGAD', '6-string', 'D2 A2 D3 G3 A3 D4'),
  t('openG', 'Open G', '6-string', 'D2 G2 D3 G3 B3 D4'),
  t('openD', 'Open D', '6-string', 'D2 A2 D3 F#3 A3 D4'),
  t('openE', 'Open E', '6-string', 'E2 B2 E3 G#3 B3 E4'),
  t('openC', 'Open C', '6-string', 'C2 G2 C3 G3 C4 E4'),
  t('7standard', '7-string Standard', '7-string', 'B1 E2 A2 D3 G3 B3 E4'),
  t('7dropA', '7-string Drop A', '7-string', 'A1 E2 A2 D3 G3 B3 E4'),
  t('7aStandard', '7-string A Standard', '7-string', 'A1 D2 G2 C3 F3 A3 D4'),
  t('8standard', '8-string Standard', '8-string', 'F#1 B1 E2 A2 D3 G3 B3 E4'),
  t('8dropE', '8-string Drop E', '8-string', 'E1 B1 E2 A2 D3 G3 B3 E4'),
  t('baritoneB', 'Baritone B Standard', 'Baritone', 'B1 E2 A2 D3 F#3 B3'),
  t('baritoneA', 'Baritone A Standard', 'Baritone', 'A1 D2 G2 C3 E3 A3'),
  t('baritoneDropA', 'Baritone Drop A', 'Baritone', 'A1 E2 A2 D3 F#3 B3'),
  t('bass4', '4-string Bass', 'Bass', 'E1 A1 D2 G2'),
  t('bass5', '5-string Bass', 'Bass', 'B0 E1 A1 D2 G2'),
];

export const TUNING_GROUPS = [...new Set(TUNINGS.map((x) => x.group))];

export function findTuning(id: string): Tuning | undefined {
  return TUNINGS.find((x) => x.id === id);
}

/** e.g. "E A D G B E" (low → high) */
export function tuningNotes(strings: number[]): string {
  return strings.map((m) => midiName(m).replace(/-?\d+$/, '')).join(' ');
}

/** e.g. "E2 A2 D3 G3 B3 E4" */
export function tuningNotesWithOctave(strings: number[]): string {
  return strings.map((m) => midiName(m)).join(' ');
}

/** Find a preset that matches a list of strings exactly (used to label custom tunings). */
export function matchPreset(strings: number[]): Tuning | undefined {
  return TUNINGS.find((x) => x.strings.length === strings.length && x.strings.every((v, i) => v === strings[i]));
}
