// Fretboard geometry and practice lines — a port of src/theory/fretboard.ts and lines.ts.
#pragma once

#include <optional>
#include <string>
#include <vector>

namespace fl
{
struct FretWindow
{
    int start = 0, end = 4;
    bool operator== (const FretWindow& o) const { return start == o.start && end == o.end; }
    bool operator!= (const FretWindow& o) const { return ! (*this == o); }
};
using OptWindow = std::optional<FretWindow>; // nullopt = whole neck

struct FretNote
{
    int string = 0; // 0 = lowest string
    int fret = 0;
    int midi = 0;
};

std::vector<FretNote> notesOnBoard (const std::vector<int>& tuning, int numFrets, const std::vector<int>& pcs, OptWindow window);

/** 5-fret playing positions anchored on the root on one of the three lowest strings. */
std::vector<FretWindow> rootPositions (const std::vector<int>& tuning, int numFrets, int rootPc, int span = 4);

/** Every distinct pitch of the pitch classes in the window (or a two-octave middle register). */
std::vector<int> pitchPool (const std::vector<int>& tuning, int numFrets, const std::vector<int>& pcs, OptWindow window);

/** Fret position for a pitch in the window (lowest fret wins, as in the web app). */
std::optional<FretNote> positionForMidi (const std::vector<int>& tuning, int numFrets, int midi, OptWindow window);

/** Arpeggio lines through a progression with voice leading (the web app's playback). */
std::vector<std::vector<int>> voiceLedLines (const std::vector<std::vector<int>>& pools, const std::vector<int>& rootPcs, const std::vector<int>& counts);

std::string tuningText (const std::vector<int>& tuning); // "E2 A2 D3 G3 B3 E4"
} // namespace fl
