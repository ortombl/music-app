// Music theory core of the Fretboard Lab Arp plugin — a C++ port of the parts of the web app's
// TypeScript engine (src/theory) that the plugin needs: note spelling, the chord dictionary,
// chord-symbol parsing (including "Eb(add#11,no3)"-style modifiers), chord identification from
// notes and generic names for any set of notes. Plain C++17, no JUCE, so it can be unit-tested.
#pragma once

#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace fl
{
inline int mod12 (int n) { return ((n % 12) + 12) % 12; }

// ---- Notes ------------------------------------------------------------------------------------
struct Spelled
{
    int letter = 0; // 0..6 = C..B
    int acc = 0;    // -2..2
};

int pcOf (Spelled n);
std::string formatNote (Spelled n);                  // "E♭", "F♯"
std::optional<Spelled> spellWithLetter (int pc, int letter);
/** pref: 0 = the usual chart spelling (C C♯ D E♭ E F F♯ G A♭ A B♭ B), 1 = sharps, -1 = flats. */
Spelled defaultSpelling (int pc, int pref = 0);
std::string pcName (int pc);
std::string midiName (int midi);                     // "E2" (ASCII sharps/flats: "Eb2", "F#3")

struct ParsedNote
{
    Spelled note;
    size_t length = 0; // bytes consumed
};
/** A note name at `pos`: letter + accidentals (#, b, ♯, ♭, x). */
std::optional<ParsedNote> parseNoteName (const std::string& s, size_t pos = 0);
/** "E2", "F#1", "Bb3" → MIDI number. */
std::optional<int> parseMidiName (const std::string& s);

// ---- Degrees ----------------------------------------------------------------------------------
int degreeNum (const std::string& label);  // "b7" → 7
int degreeStep (const std::string& label); // letter steps above the root, 0..6
int degreeSemi (const std::string& label); // "b7" → 10
std::string prettyDegree (const std::string& label); // "b7" → "♭7"
/** Name an interval above a chord root in the context of the chord's degrees (as in the web app). */
std::string labelInChord (int semi, const std::vector<std::string>& chordDegrees);

// ---- Chord types --------------------------------------------------------------------------------
struct ChordType
{
    std::string id, symbol, name, family;
    std::vector<std::string> degrees, optional, aliases;
    std::vector<std::string> scales; // chord-scale ids, best first
    double prior = 0.2;
    bool parseOnly = false;
    int mask = 0, requiredMask = 0;
};
using ChordTypePtr = std::shared_ptr<const ChordType>;

const std::vector<ChordTypePtr>& chordTypes();
ChordTypePtr chordTypeById (const std::string& id);

// ---- Scales and tunings -------------------------------------------------------------------------
struct ScaleType
{
    std::string id, name;
    std::vector<std::string> degrees;
    std::vector<int> semis;
    double prior = 0.5;
};
const std::vector<ScaleType>& scaleTypes();
const ScaleType* scaleById (const std::string& id);
std::vector<int> scalePcs (int rootPc, const std::string& id);

struct Tuning
{
    std::string id, name, group;
    std::vector<int> strings; // MIDI notes, lowest string first
};
const std::vector<Tuning>& tunings();

struct Chord
{
    int root = 0;
    ChordTypePtr type;
    int bass = -1; // -1 = root position
    std::optional<Spelled> rootSpelling;

    std::vector<int> pcs() const;  // chord tones in degree order (+ slash bass)
    std::string name() const;      // "Dm7", "E♭(add♯11, no3)", "D/F♯"
    Spelled spelledRoot() const;
    std::vector<std::string> toneNames() const; // spelled chord tones (degree order)
    bool valid() const { return type != nullptr; }
};

/** "Am7", "C#m7b5", "Bbmaj7/D", "G7(#9)", "Eb(add#11,no3)" … */
std::optional<Chord> parseChordSymbol (const std::string& s);

struct GenericName
{
    ChordTypePtr type;
    std::vector<std::string> omittedSilent;
    double cost = 0;
};
/** Name any set of intervals above a root (bit mask). exact = name exactly these notes. */
GenericName nameFromSemis (int mask, bool exact);
/** Best dictionary chord type for these pitch classes over a fixed root (or nullptr). */
ChordTypePtr nameOverRoot (int rootPc, const std::vector<int>& pcs);

struct ChordMatch
{
    Chord chord;
    std::string name;
    double score = 0;
};
/** All interpretations of the sounding notes, most likely first (needs ≥ 2 pitch classes). */
std::vector<ChordMatch> identifyChord (const std::vector<int>& midis);

/** Best chord for a set of pitch classes, preferring `preferredRoot` as the root (if present). */
std::optional<Chord> chordFromPcs (const std::vector<int>& pcs, int preferredRoot);

struct ArpInput
{
    bool ok = false;
    Chord chord;
    std::string recognisedFrom; // set when the input was a list of notes
    std::string error;
};
/** An arpeggio typed as a chord symbol ("Bbmaj7") or a list of notes ("E G B D"). */
ArpInput parseArpInput (const std::string& text);

/** Pitch classes written as note names ("F A C E"), in the given order. */
std::string notesText (const std::vector<int>& pcs, const Chord* spellingContext = nullptr);
/** Parse "F A C E" / "F-A-C-E" into pitch classes (empty if any token is not a note). */
std::vector<int> parseNotesList (const std::string& text);

std::string trim (const std::string& s);
std::string toAscii (const std::string& s); // ♭→b, ♯→#
} // namespace fl
