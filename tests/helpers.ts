import { findTuning } from '../src/theory/tunings';

/**
 * Build MIDI notes from a tab-style fingering, low → high string.
 * "x32010" (one char per string) or "10 12 12 x x x" (space separated).
 */
export function shape(frets: string, tuningId = 'standard'): number[] {
  const strings = findTuning(tuningId)!.strings;
  const parts = frets.includes(' ') ? frets.split(' ') : frets.split('');
  if (parts.length !== strings.length) throw new Error(`shape ${frets} does not fit ${tuningId}`);
  return parts.flatMap((f, i) => (f === 'x' ? [] : [strings[i] + parseInt(f, 10)]));
}
