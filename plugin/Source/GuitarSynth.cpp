#include "GuitarSynth.h"

#include <cmath>

void GuitarSynth::prepare (double sampleRate)
{
    sr = sampleRate > 0 ? sampleRate : 44100;
    const int maxLen = (int) std::ceil (sr / 20.0) + 4; // down to 20 Hz
    for (auto& v : voices)
    {
        v.ring.assign ((size_t) maxLen, 0.0f);
        v.active = false;
    }
}

void GuitarSynth::noteOn (int midi, float velocity, int channel, float pan, float tone)
{
    // Re-striking a ringing note: reuse its voice, like a string being picked again.
    Voice* voice = nullptr;
    for (auto& v : voices)
        if (v.active && v.midi == midi && v.channel == channel) voice = &v;
    if (voice == nullptr)
        for (auto& v : voices)
            if (! v.active)
            {
                voice = &v;
                break;
            }
    if (voice == nullptr) // steal the quietest released voice, else the oldest one
    {
        voice = &voices[0];
        for (auto& v : voices)
            if ((v.released && ! voice->released) || (v.released == voice->released && v.age < voice->age)) voice = &v;
    }
    if (voice->ring.empty()) return;

    const double freq = 440.0 * std::pow (2.0, (midi - 69) / 12.0);
    const double period = sr / freq;
    // Loop delay = N (ring) + 0.5 (averaging filter) + d (all-pass), d in [0.1, 1.1).
    int n = (int) std::floor (period - 0.6);
    n = juce::jlimit (2, (int) voice->ring.size() - 1, n);
    const double d = juce::jlimit (0.1, 1.1, period - 0.5 - n);
    voice->apC = (float) ((1.0 - d) / (1.0 + d));
    voice->apX1 = voice->apY1 = voice->lastOut = 0;
    voice->length = n;
    voice->index = 0;

    // Excitation: low-passed noise — softer (darker) for quiet notes and a low tone setting.
    const float bright = juce::jlimit (0.05f, 1.0f, 0.25f + 0.55f * tone + 0.2f * velocity);
    const float a = 1.0f - bright * 0.85f;
    float prev = 0, mean = 0;
    for (int i = 0; i < n; ++i)
    {
        const float r = random.nextFloat() * 2.0f - 1.0f;
        prev = prev * a + r * (1.0f - a);
        voice->ring[(size_t) i] = prev;
        mean += prev;
    }
    mean /= (float) n;
    float peak = 0;
    for (int i = 0; i < n; ++i)
    {
        voice->ring[(size_t) i] -= mean;
        peak = std::max (peak, std::abs (voice->ring[(size_t) i]));
    }
    const float amp = (0.15f + 0.85f * velocity) * 0.5f / std::max (peak, 1.0e-4f);
    for (int i = 0; i < n; ++i) voice->ring[(size_t) i] *= amp;

    // Higher notes die away faster, as on a real guitar (same curve as the web app).
    const double halfLife = std::max (0.18, 0.95 - 0.22 * std::log2 (freq / 82.0)) * 2.2;
    voice->rho = (float) std::pow (0.5, 1.0 / (freq * halfLife));
    voice->rhoRelease = (float) std::pow (0.5, 1.0 / (freq * 0.07));
    const float p = juce::jlimit (-1.0f, 1.0f, pan);
    voice->gainL = std::cos ((p + 1.0f) * juce::MathConstants<float>::pi * 0.25f);
    voice->gainR = std::sin ((p + 1.0f) * juce::MathConstants<float>::pi * 0.25f);
    voice->midi = midi;
    voice->channel = channel;
    voice->active = true;
    voice->released = false;
    voice->level = 0.5f;
    voice->age = ++counter;
    voice->samplesPlayed = 0;
}

void GuitarSynth::noteOff (int midi, int channel)
{
    for (auto& v : voices)
        if (v.active && ! v.released && v.midi == midi && v.channel == channel) v.released = true;
}

void GuitarSynth::allNotesOff (bool immediately)
{
    for (auto& v : voices)
    {
        if (immediately) v.active = false;
        else v.released = true;
    }
}

bool GuitarSynth::isSilent() const
{
    for (auto& v : voices)
        if (v.active) return false;
    return true;
}

void GuitarSynth::render (juce::AudioBuffer<float>& buffer, int start, int num, float gainArp, float gainBacking)
{
    if (num <= 0) return;
    auto* left = buffer.getWritePointer (0, start);
    auto* right = buffer.getNumChannels() > 1 ? buffer.getWritePointer (1, start) : nullptr;
    const int maxSamples = (int) (sr * 6.0);
    for (auto& v : voices)
    {
        if (! v.active) continue;
        const float g = v.channel == 0 ? gainArp : gainBacking;
        const float gl = g * v.gainL, gr = g * v.gainR;
        const float rho = v.released ? v.rhoRelease : v.rho;
        float level = v.level;
        float* ring = v.ring.data();
        int idx = v.index;
        const int len = v.length;
        float apX1 = v.apX1, apY1 = v.apY1, lastOut = v.lastOut;
        const float c = v.apC;
        for (int i = 0; i < num; ++i)
        {
            const float out = ring[idx];
            const float avg = 0.5f * (out + lastOut);
            lastOut = out;
            const float ap = c * avg + apX1 - c * apY1;
            apX1 = avg;
            apY1 = ap;
            ring[idx] = rho * ap;
            if (++idx >= len) idx = 0;
            left[i] += out * gl;
            if (right != nullptr) right[i] += out * gr;
            level = std::max (std::abs (out), level * 0.9995f);
        }
        v.index = idx;
        v.apX1 = apX1;
        v.apY1 = apY1;
        v.lastOut = lastOut;
        v.level = level;
        v.samplesPlayed += num;
        if (level < 1.0e-4f || v.samplesPlayed > maxSamples) v.active = false;
    }
}
