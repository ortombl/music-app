// Arpeggios over a chord — a C++ port of the web app's src/theory/arpeggios.ts: the chord's own
// arpeggio (plus simpler reductions) and substitute arpeggios rated with the same fit % formula.
#pragma once

#include "Theory.h"

namespace fl
{
struct ArpNote
{
    int pc = 0;
    std::string label; // degree relative to the target chord's root, e.g. "9"
    bool chordTone = false;
    std::string name;
};

struct Arpeggio
{
    enum class Kind { Exact, Reduction, Substitute };

    std::string id;
    Chord chord;
    std::string name;
    Kind kind = Kind::Exact;
    std::vector<ArpNote> notes;
    std::vector<std::string> adds; // good tensions added on top of the chord, e.g. {"9"}
    std::string sound;             // resulting sound over the chord's root, e.g. "Cmaj9"
    std::string description;
    std::string scaleLabel;
    std::string warning;
    double fit = 1; // 0..1, 1 = the chord's own arpeggio

    std::vector<int> pcs() const;
};

/** The chord's own arpeggio first, then its 7th-chord / triad "core" versions. */
std::vector<Arpeggio> exactArpeggios (const Chord& target);
/** Substitute arpeggios over the chord, best fit first. */
std::vector<Arpeggio> suggestArpeggios (const Chord& target, int limit = 20);
/** Rate any arpeggio (e.g. one the user typed or clicked) over the chord. */
Arpeggio analyzeArpeggio (const Chord& target, const Chord& arp);

/** "E♭ Dorian"-style label of a scale on a root. */
std::string scaleLabel (int rootPc, const std::string& scaleId);
} // namespace fl
