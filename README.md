# Fretboard Lab 🎸

A guitar chord finder, arpeggio coach and chord-progression analyser that works in **any tuning** —
standard, drop, open, 7-string, 8-string, baritone, bass, or your own custom tuning.

- **Chord finder** — a schematic fretboard with every note labelled. Click frets (or open strings) to
  build a shape, and the app names the most likely chord, with alternative interpretations ranked
  by likelihood (e.g. `Am7` vs `C6/A`), the chord tones, formula, inversion and omitted notes.
  **Any combination of two or more notes gets a name** — anything outside the chord dictionary is
  described as a base chord plus additions, altered fifths and omissions, e.g. E♭ A B♭ →
  `E♭(add♯11, no3)`, C G B → `Cmaj7(no3)`, C E B♭ D♭ F♯ → `C7♭9(♯11)`.
- **Arpeggios** — one click shows, side by side:
  - the chord's **own arpeggio** (plus simpler 7th/triad "core" versions), and
  - **suggested arpeggios** that sound good over it, each explained: *"Em7 over Cmaj7 — built on the
    3rd, adds the 9 → Cmaj9 sound"*, *"Em7♭5 over C7 → C9"*, *"G♯dim7 over E7 → E7♭9"*…
  - the **scales** that fit the chord (Dorian, Mixolydian, Lydian, altered, pentatonics…).
  - Everything is shown across the whole neck or in a 5-fret playing position, colour-coded by
    interval, and can be played back.
- **Other voicings** — playable fingerings of the detected chord generated for the current tuning.
- **Progression builder** — type a progression (`Am7 | D7 | Gmaj7 Cmaj7`), load an example, add
  chords from the finder, or use *Quick add* (root, quality, added note, omitted notes, slash bass).
  Symbols with modifiers are understood: `Eb(add#11,no3)`, `C7(b9,#11)`, `G7sus4(b9)`, `C9(b5)`,
  `Cmaj7(no3)`, `Dm(add b6)`, `C(omit3)`… The app works out:
  - the **most likely key / tonal centre**, the **root note (tonic)** and the **base (tonic) chord**,
    with a confidence score, alternative readings you can switch to, and the reasons (cadences, etc.);
  - modes (Dorian vamps, Mixolydian rock, blues), harmonic-minor V chords, secondary dominants
    (`V7/ii`), borrowed chords, tritone substitutes and figured-bass inversions;
  - a chord-by-chord table: Roman numeral, function (tonic / subdominant / dominant), chord tones,
    chord-scale and arpeggio ideas;
  - **every scale in the library (41, from major and pentatonic to Phrygian dominant, Hungarian
    minor, Hirajoshi, bebop, symmetrical scales…) ranked by how closely it fits the progression**,
    each with a fit %, mood tags (happy, bright, dreamy, soulful, jazzy, bluesy, sad, dark, spicy,
    exotic, tense, mysterious, eerie…), and a comment on what clashes (*"F♯ rubs against F (F)"*) or
    what it leaves out; filter by mood and open any scale on the fretboard;
  - **arpeggios through the changes**: every chord's arpeggio (or a substitute) in the *same
    position* so you can practise connecting them, plus voicing diagrams for your tuning;
  - playback of the chords or the arpeggios at any tempo.
- **Tunings** — 24 presets plus a string-by-string editor (3–10 strings). Changing the tuning
  re-computes everything: chord names (the bass is the lowest *pitch*, which matters in drop and open
  tunings), arpeggio maps, positions and voicings.
- Note names / notes + octave / intervals / fret numbers labels, ♯/♭ preference (with correct
  enharmonic spelling, e.g. `D♯m7` over B major but `E♭maj7` in B♭), left-handed mode, light/dark theme.

## Web app or .exe? — Recommendation: **web app**

This is built as a web application, and the build output is a **single self-contained HTML file**
(≈100 kB gzipped, no internet or server needed). That gives you the best of both worlds:

| | Web app (this project) | Windows .exe |
|---|---|---|
| Runs on | Windows, macOS, Linux, iPad/Android tablets, phones | Windows only |
| Install | None — open a link, or double-click the downloaded `.html` | Installer; unsigned `.exe` files trigger SmartScreen/antivirus warnings |
| Offline | Yes (single-file build) | Yes |
| Updates | Instant for everyone | Re-download / re-install |
| Sharing with students or band mates | Send a link | Send a binary |
| Sound | Web Audio API (built-in plucked-string synth) | Would need an audio library |

Musicians often want the tool on a laptop *and* on a tablet on the music stand — only a web app does
both. If a real desktop program is ever wanted, the same code can be wrapped with
[Tauri](https://tauri.app) (≈5–10 MB `.exe`/`.dmg`) without rewriting anything.

## Using it

**Option 1 — just open it.** Run `npm run build` (see below) and double-click `dist/index.html`. It
works straight from disk, offline. You can copy that one file anywhere (USB stick, Dropbox, email).
The CI workflow also attaches this file as a downloadable artifact called `fretboard-lab-offline`
on every run.

**Option 2 — host it on GitHub Pages (free).** In the repository go to *Settings → Pages → Build and
deployment → Source* and choose **GitHub Actions**. Every push to `main` then publishes the app at
`https://<user>.github.io/<repo>/`. The hosted page has a *Download for offline use* link in the
footer.

## Development

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev        # start the dev server with hot reload (http://localhost:5173)
npm test           # run the music-theory unit tests (vitest)
npm run build      # type-check and build the single-file app into dist/index.html
npm run preview    # serve the production build locally
```

### Project layout

```
src/
  theory/            pure TypeScript music-theory engine (no UI code, fully unit-tested)
    notes.ts         pitch classes, MIDI, enharmonic spelling
    intervals.ts     degree labels (♭3, ♯11, ♭♭7 …) and naming notes relative to a chord
    chords.ts        53 chord types, chord spelling
    custom.ts        names any note set as base chord + add/alterations/no (E♭(add♯11, no3))
    identify.ts      chord identification from sounding notes, with ranking
    parse.ts         chord-symbol parser (Am7, C#m7b5, Bbmaj7/D, G7(#9), F6/9, Eø, D-7 …)
    scales.ts        41 scales/modes with mood tags
    scaleFit.ts      ranks scales by how closely they fit a progression
    arpeggios.ts     exact arpeggios + substitute-arpeggio suggestions + chord-scales
    key.ts           key/tonal-centre detection, Roman numerals, harmonic function
    voicings.ts      playable-voicing generator for any tuning
    tunings.ts       tuning presets
    fretboard.ts     fretboard geometry, positions, arpeggio runs
  audio/synth.ts     Karplus–Strong plucked-string synth (Web Audio API)
  components/        React UI (SVG fretboard, chord diagrams, finder, explorer, progression)
  state/settings.ts  settings persisted in localStorage
tests/               vitest suites (identification, parsing, keys, arpeggios, voicings, robustness)
```

### How the analysis works (short version)

- **Chord identification**: every sounding pitch class is tried as the root; the interval set is
  matched against the chord dictionary (required vs optional tones, e.g. the 5th may be omitted).
  Candidates are ranked by how common the chord is, omitted tones, and — most importantly — the bass
  note (root position > 1st inversion > 2nd inversion > other slash chords). Slash chords with a
  non-chord bass (`D/C`, `G/A`) are also considered.
- **Substitute arpeggios**: candidate triads and 7th chords are drawn from the chord-scale (or from
  the key, inside a progression) and scored by chord tones, guide tones (3rds/7ths), colour tones
  added (9, 11, 13, ♯11, ♭9…), avoid notes (e.g. natural 11 over a major 3rd) and the classic
  "build it on the 3rd/5th/7th" relationships. The resulting sound (`Em7` over `C` = `Cmaj9`) is
  named by re-running the identifier.
- **Generic chord names**: when the dictionary has no exact match, the notes are described as the
  dictionary chord needing the fewest changes plus modifiers (`add♯11`, `♭5`, `no3`). The name is
  always parseable, so every result can be added to a progression; a test checks all 4,083
  possible note sets round-trip exactly.
- **Scale ranking**: each scale is placed on the tonic and compared with a weighted profile of the
  chord tones (roots/3rds/7ths count more): coverage of the harmony, minus clashes (a scale note a
  half step from a chord tone the scale lacks), minus a small cost for colour notes (more if they
  are avoid notes). In a blues, the ♭3/♭5 blue notes count as idiomatic rather than clashes.
- **Key detection**: all 12 tonics × major, minor, Dorian, Mixolydian, Lydian, Phrygian and Phrygian
  dominant are scored
  on diatonic fit (with partial credit for harmonic-minor V, secondary dominants and borrowed
  chords), tonic emphasis (first/last chord, frequency, prominence of the tonic triad), cadences
  (V→I, ii–V–I, ♭VII→I, IV→i …) and a small prior for how common each mode is.
- **Voicings**: a 4-fret window slides along the neck; each string may be muted, open or fretted on
  a chord tone. Shapes must contain the required tones with the right bass, need ≤ 4 fingers (a barre
  counts as one) and avoid awkward gaps; they are ranked for fullness and ease.
