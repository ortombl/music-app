import { DEGREE_COLORS, DEGREE_NAMES } from './colors';

export function Legend({ only }: { only?: number[] }) {
  const cats = only ?? [1, 2, 3, 4, 5, 6, 7];
  return (
    <ul className="legend" aria-label="Colour legend">
      {cats.map((c) => (
        <li key={c}>
          <span className="legend-dot" style={{ background: DEGREE_COLORS[c] }} />
          {DEGREE_NAMES[c]}
        </li>
      ))}
    </ul>
  );
}
