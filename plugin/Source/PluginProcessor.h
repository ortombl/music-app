// Fretboard Lab Arp — the audio processor: plays the arpeggios of a chord progression in sync
// with the host (or its own clock), lets MIDI keys pick a chord or play notes as a guitar
// arpeggio, sounds them with a built-in plucked-string synth and sends them out as MIDI.
#pragma once

#include "GuitarSynth.h"
#include "core/Song.h"

#include <juce_audio_processors/juce_audio_processors.h>

#include <array>
#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>

namespace ids
{
inline constexpr const char* mode = "mode";
inline constexpr const char* rate = "rate";
inline constexpr const char* pattern = "pattern";
inline constexpr const char* gate = "gate";
inline constexpr const char* velocity = "velocity";
inline constexpr const char* backing = "backing";
inline constexpr const char* sound = "sound";
inline constexpr const char* level = "level";
inline constexpr const char* tone = "tone";
inline constexpr const char* backingLevel = "backingLevel";
inline constexpr const char* tempo = "tempo";
inline constexpr const char* keyBase = "keyBase";
} // namespace ids

enum class PlayMode { Progression = 0, KeysPickChord = 1, KeysPlayNotes = 2 };

/** What the playing engine is doing right now — read by the editor's 30 Hz timer. */
struct PlayState
{
    std::atomic<int> slot { -1 };          // chord being played (-1 = none)
    std::atomic<int> noteMidi { -1 };      // last arpeggio note
    std::atomic<int> noteString { -1 }, noteFret { -1 };
    std::atomic<uint32_t> noteSerial { 0 }; // increments with every note
    std::atomic<bool> hostPlaying { false }, running { false };
    std::atomic<uint64_t> heldLow { 0 }, heldHigh { 0 }; // MIDI keys held (bit per note)
    std::atomic<double> beat { 0 };                       // position in the progression (beats)
};

class ArpProcessor : public juce::AudioProcessor, private juce::Timer
{
public:
    ArpProcessor();
    ~ArpProcessor() override;

    // AudioProcessor
    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    using AudioProcessor::processBlock;
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return "Fretboard Lab Arp"; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return true; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 3.0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return "Default"; }
    void changeProgramName (int, const juce::String&) override {}
    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    // ---- Used by the editor (message thread) ----------------------------------------------------
    juce::AudioProcessorValueTreeState params;
    PlayState play;

    fl::Song getSong() const;
    /** Replace the document; re-resolves the arpeggios and rebuilds the phrase. */
    void setSong (const fl::Song& song);
    const std::vector<fl::ResolvedSlot>& getResolved() const { return resolved; }
    /** Bumped whenever the song changes (the editor refreshes when it sees a new value). */
    int getSongVersion() const { return songVersion; }

    /** Export text (readable table + [data]) for the current song — same format as the web app. */
    std::string exportText() const;
    /** Import text; returns a status message. */
    juce::String importText (const std::string& text, bool& ok);

    /** The progression's arpeggios (track 1, channel 1) and backing (track 2, channel 2) as a
        Standard MIDI File at the current tempo — to drag or save into the DAW. */
    juce::MidiFile createMidiFile() const;

    void setRunning (bool shouldRun);
    bool isRunning() const { return internalRun.load(); }
    /** Sound a note picked on the fretboard (and send it as MIDI). */
    void audition (int midi, int string, int fret);

    PlayMode getMode() const;

    // Selected chord in the editor — also the chord "Keys play notes" uses for its position.
    std::atomic<int> selectedSlot { 0 };

private:
    void timerCallback() override;
    void rebuild (bool resolveAgain);
    fl::PhraseOptions currentPhraseOptions() const;

    // --- phrase hand-off (message thread → audio thread, lock-free) ---
    struct PhraseData
    {
        fl::Phrase phrase;
        std::vector<int> tuning;
        int numFrets = 22;
        fl::OptWindow globalWindow;
        std::vector<fl::OptWindow> windows; // per slot
        std::vector<size_t> slotFirst, slotLast; // note index ranges per slot
        double stepBeats = 0.5;
        fl::Pattern pattern = fl::Pattern::VoiceLed;
    };
    void publish (std::unique_ptr<PhraseData> data);
    PhraseData* acquirePhrase();
    std::atomic<PhraseData*> latest { nullptr }, inUse { nullptr };
    std::vector<std::unique_ptr<PhraseData>> owned; // message thread only

    // --- document (message thread; the mutex also covers get/setStateInformation) ---
    mutable std::mutex songMutex;
    fl::Song song;
    std::vector<fl::ResolvedSlot> resolved;
    int songVersion = 0;
    fl::PhraseOptions builtWith;
    bool builtOnce = false;

    // --- audio thread state ---
    struct Active
    {
        int midi = 0, channel = 0;
        int64_t offAt = 0; // absolute sample
    };
    struct Event
    {
        int offset;
        bool on;
        int midi, channel;
        float velocity, pan;
    };
    void startNote (int offset, int midi, int channel, float velocity, float pan, double lengthSamples, juce::MidiBuffer& midiOut);
    void flushNoteOffs (int numSamples, juce::MidiBuffer& midiOut);
    void allNotesOff (int offset, juce::MidiBuffer& midiOut);
    void scheduleRange (const PhraseData& pd, double b0, double b1, double samplesPerBeat, int numSamples, float velScale, int onlySlot,
                        juce::MidiBuffer& midiOut);
    void playNotesMode (const PhraseData& pd, double b0, double b1, double samplesPerBeat, int numSamples, juce::MidiBuffer& midiOut);

    GuitarSynth synth;
    std::array<Active, 128> active {};
    int numActive = 0;
    std::array<Event, 512> events {};
    int numEvents = 0;
    int64_t sampleClock = 0;
    double sampleRateHz = 44100;
    double internalBeat = 0, keysBeat = 0, notesClock = 0, lastEndBeat = -1;
    bool wasRunning = false;
    std::atomic<bool> internalRun { false }, resetInternal { false };
    juce::MidiBuffer midiScratch;
    PlayMode lastMode = PlayMode::Progression;

    std::array<bool, 128> held {};
    std::array<uint8_t, 128> heldVelocity {};
    int lastKey = -1, keysSlot = -1;
    // "Keys play notes": the guitar line through the held notes
    std::array<int, 96> notePool {};
    int notePoolSize = 0, poolIndex = 0, poolDir = 1, lastPoolNote = -1, heldSignature = -1;
    unsigned rng = 12345;

    // fretboard clicks (message thread → audio thread)
    juce::AbstractFifo auditionFifo { 64 };
    std::array<std::array<int, 3>, 64> auditionQueue {};

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (ArpProcessor)
};
