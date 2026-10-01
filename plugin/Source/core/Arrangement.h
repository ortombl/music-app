// The arrangement — a progression plus, for every chord, its arpeggio, position and length — and
// the plain-text export / import format shared with the web app (src/theory/arrangement.ts).
#pragma once

#include "Fretboard.h"

#include <optional>
#include <string>
#include <vector>

namespace fl
{
struct SlotPosition
{
    enum Kind { Global, Neck, Window } kind = Global;
    FretWindow window;

    static SlotPosition global() { return {}; }
    static SlotPosition neck() { return { Neck, {} }; }
    static SlotPosition frets (int start, int end) { return { Window, { start, end } }; }
    bool operator== (const SlotPosition& o) const { return kind == o.kind && (kind != Window || window == o.window); }
    bool operator!= (const SlotPosition& o) const { return ! (*this == o); }
};

struct Slot
{
    std::string arp; // chord symbol or notes as typed; empty = the chord's own arpeggio
    SlotPosition pos;
    int beats = 4; // 4 = one bar of 4/4
};

struct ArrangementDoc
{
    std::vector<std::string> chords;
    std::vector<Slot> slots;
    std::optional<int> tempo;
    bool hasPosition = false;
    OptWindow position; // the shared position ("same as all"); nullopt = whole neck
    std::vector<int> tuning;
};

struct ExportRow
{
    std::string chord, roman, arpeggio, notes, fit, sound, position, length;
};

struct ExportInfo
{
    std::string key = "\xE2\x80\x94", tuning, position, date;
    int tempo = 100;
    std::vector<ExportRow> rows;
};

std::string positionText (const SlotPosition& pos); // all | neck | 5-9
std::string positionText (const OptWindow& win);    // neck | 5-9
std::string beatsText (int beats);                  // "1 bar", "1/2 bar", "2 bars"

/** A readable summary followed by a [data] section that Import (web app or plugin) reads back. */
std::string exportArrangementText (const ArrangementDoc& doc, const ExportInfo& info);
/** Only the machine-readable [data] section (used for the plugin's saved state). */
std::string arrangementDataText (const ArrangementDoc& doc);

struct ParsedArrangement
{
    ArrangementDoc doc;
    std::vector<std::string> errors;
};

/** Reads exported files, "Dm7 -> Fmaj7" lines and plain progressions ("Am F C G"). */
ParsedArrangement parseArrangementText (const std::string& text);

/** Split "Am7 | D7 | Gmaj7 Cmaj7" into symbols (spaces inside parentheses are kept). */
std::vector<std::string> tokenizeProgression (const std::string& text);
} // namespace fl
