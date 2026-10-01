// A small plucked-string synthesiser (Karplus–Strong with an all-pass tuning filter), so the
// plugin makes a guitar-like sound on its own. The same notes are also sent as MIDI, so any other
// instrument can be played instead.
#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

#include <array>
#include <cstdint>
#include <vector>

class GuitarSynth
{
public:
    void prepare (double sampleRate);
    void noteOn (int midi, float velocity, int channel, float pan, float tone);
    void noteOff (int midi, int channel);
    void allNotesOff (bool immediately);
    /** Adds the voices into the buffer (sample range [start, start + num)). */
    void render (juce::AudioBuffer<float>& buffer, int start, int num, float gainArp, float gainBacking);
    bool isSilent() const;

private:
    struct Voice
    {
        std::vector<float> ring;
        int length = 0, index = 0;
        float rho = 0.99f, rhoRelease = 0.9f;
        float apC = 0, apX1 = 0, apY1 = 0, lastOut = 0;
        float gainL = 0.7f, gainR = 0.7f;
        float level = 0; // running peak estimate, for freeing the voice
        int midi = -1, channel = 0;
        bool active = false, released = false;
        int64_t age = 0;
        int samplesPlayed = 0;
    };

    std::array<Voice, 24> voices;
    double sr = 44100;
    int64_t counter = 0;
    juce::Random random;
};
