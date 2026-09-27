// Scale-degree labels such as "b3", "#11" or "bb7", and how they map to semitones.

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

export interface Degree {
  label: string; // e.g. "b7"
  num: number; // 1..13
  step: number; // letter steps above the root, 0..6
  semi: number; // semitones above the root, 0..11
}

const cache = new Map<string, Degree>();

export function degree(label: string): Degree {
  const hit = cache.get(label);
  if (hit) return hit;
  const m = /^(bb|b|##|#)?(\d{1,2})$/.exec(label);
  if (!m) throw new Error(`Bad degree label: ${label}`);
  const acc = m[1] === 'b' ? -1 : m[1] === 'bb' ? -2 : m[1] === '#' ? 1 : m[1] === '##' ? 2 : 0;
  const num = parseInt(m[2], 10);
  const step = (num - 1) % 7;
  const semi = (((MAJOR_STEPS[step] + acc) % 12) + 12) % 12;
  const d: Degree = { label, num, step, semi };
  cache.set(label, d);
  return d;
}

/** Pretty version of a degree label using ♭/♯. */
export function prettyDegree(label: string): string {
  return label.replace(/bb/g, '𝄫').replace(/b/g, '♭').replace(/#/g, '♯').replace(/𝄫/g, '♭♭');
}

/**
 * Colour category of a degree: 1 (root), 2 (2nd/9th), 3, 4 (4th/11th), 5, 6 (6th/13th), 7.
 * Used for consistent colour coding across the app.
 */
export function degreeCategory(label: string): number {
  const d = degree(label);
  return d.step + 1;
}

/**
 * Name an interval (in semitones above a chord root) in the context of a chord.
 * `chordDegrees` are the chord's own degree labels; chord tones keep their names,
 * everything else is named as a tension relative to the chord quality.
 */
export function labelInChord(semi: number, chordDegrees: string[]): string {
  const s = ((semi % 12) + 12) % 12;
  for (const l of chordDegrees) if (degree(l).semi === s) return l;
  const has = (l: string) => chordDegrees.includes(l);
  const hasMajor3 = has('3');
  const hasPerfect5 = has('5');
  const hasSeventh = has('7') || has('b7') || has('bb7');
  switch (s) {
    case 0:
      return '1';
    case 1:
      return 'b9';
    case 2:
      return '9';
    case 3:
      return hasMajor3 ? '#9' : 'b3';
    case 4:
      return '3';
    case 5:
      return has('b3') || hasMajor3 ? '11' : '4';
    case 6:
      return hasPerfect5 || hasMajor3 ? '#11' : 'b5';
    case 7:
      return '5';
    case 8:
      return hasMajor3 && !hasPerfect5 && !has('b5') ? '#5' : 'b13';
    case 9:
      return hasSeventh ? '13' : '6';
    case 10:
      return 'b7';
    default:
      return '7';
  }
}
