// The plugin's document — chords, per-chord arpeggio slots, tuning — and the note phrase that the
// audio engine plays from it. Plain C++ (no JUCE), shared by the processor, the editor and tests.
#pragma once

#include "Arpeggios.h"
#include "Arrangement.h"

namespace fl
{
struct Song
{
    std::vector<std::string> chords { "Am7", "D7", "Gmaj7", "Cmaj7" };
    std::vector<Slot> slots { {}, {}, {}, {} };
    OptWindow position = FretWindow { 5, 9 }; // "same as all"; nullopt = whole neck
    int tempo = 100;
    std::string tuningId = "standard"; // "custom" when the strings match no preset
    std::vector<int> tuning { 40, 45, 50, 55, 59, 64 };
    int numFrets = 22;

    Slot slotAt (size_t i) const { return i < slots.size() ? slots[i] : Slot {}; }
    /** The fret window a chord's arpeggio is played in (nullopt = whole neck), clamped to the neck. */
    OptWindow windowFor (size_t i) const;
    double totalBeats() const;
};

struct ResolvedSlot
{
    enum class Kind { Own, Suggested, Custom };

    bool chordOk = false;
    Chord chord;
    std::string chordName; // display name ("E♭(add♯11, no3)") or the text as typed when unreadable
    Arpeggio arp;
    Kind kind = Kind::Own;
    int subIndex = -1;
    std::string recognisedFrom; // when the arpeggio was typed/clicked as notes
    std::string error;          // the saved arpeggio could not be read
    std::vector<Arpeggio> exact, subs;
};

/** Resolve a chord's arpeggio like the web app: its own, a suggestion, or the user's own. */
ResolvedSlot resolveSlot (const std::string& chordText, const Slot& slot, int suggestionLimit = 20);

/** Is this the same set of notes on the same root? */
bool sameNotes (const Chord& a, const Chord& b);

/** Find a tuning preset by its strings ("custom" if none matches). */
std::string matchTuningId (const std::vector<int>& strings);
const Tuning* tuningById (const std::string& id);
std::string tuningDescription (const Song& song); // "Standard (E A D G B E · E2 A2 D3 G3 B3 E4)"

ArrangementDoc toDoc (const Song& song);
ExportInfo exportInfo (const Song& song, const std::vector<ResolvedSlot>& resolved, const std::string& date);

/** Apply an imported document (unreadable chords are skipped and listed in `problems`).
    Returns false — leaving the song unchanged — when no chord could be read. */
bool applyDoc (Song& song, const ArrangementDoc& doc, std::vector<std::string>& problems);

// ---- Phrase -------------------------------------------------------------------------------------
enum class Pattern { VoiceLed, Up, Down, UpDown, Random };

struct PhraseOptions
{
    double stepBeats = 0.5; // 1/8 notes
    Pattern pattern = Pattern::VoiceLed;
    int backing = 0; // 0 = off, 1 = strummed chord, 2 = strummed chord + bass
    unsigned seed = 1;
};

struct PhraseNote
{
    double start = 0, length = 0; // in beats
    int midi = 60;
    float velocity = 1; // relative (accents); the velocity parameter scales it
    int channel = 0;    // 0 = arpeggio, 1 = backing
    int slot = 0;
    int string = -1, fret = -1; // position on the fretboard (arpeggio notes)
};

struct Phrase
{
    std::vector<PhraseNote> notes; // sorted by start
    std::vector<double> slotStart, slotBeats;
    double length = 0; // beats
    int slotAtBeat (double beat) const;
};

Phrase buildPhrase (const Song& song, const std::vector<ResolvedSlot>& resolved, const PhraseOptions& opts);
} // namespace fl
