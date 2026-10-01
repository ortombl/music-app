#include "PluginProcessor.h"

#include "PluginEditor.h"

#include <cmath>

namespace
{
juce::AudioProcessorValueTreeState::ParameterLayout createLayout()
{
    using namespace juce;
    AudioProcessorValueTreeState::ParameterLayout l;
    l.add (std::make_unique<AudioParameterChoice> (ParameterID { ids::mode, 1 }, "Mode", StringArray { "Progression", "Keys pick chord", "Keys play notes" }, 0));
    l.add (std::make_unique<AudioParameterChoice> (ParameterID { ids::rate, 1 }, "Rate", StringArray { "1/4", "1/8", "1/8 triplet", "1/16", "1/16 triplet", "1/32" }, 1));
    l.add (std::make_unique<AudioParameterChoice> (ParameterID { ids::pattern, 1 }, "Pattern", StringArray { "Voice-led", "Up", "Down", "Up & down", "Random" }, 0));
    l.add (std::make_unique<AudioParameterFloat> (ParameterID { ids::gate, 1 }, "Gate", NormalisableRange<float> (0.1f, 4.0f, 0.01f, 0.6f), 1.5f));
    l.add (std::make_unique<AudioParameterInt> (ParameterID { ids::velocity, 1 }, "Velocity", 1, 127, 100));
    l.add (std::make_unique<AudioParameterChoice> (ParameterID { ids::backing, 1 }, "Backing", StringArray { "Off", "Chord", "Chord + bass" }, 0));
    l.add (std::make_unique<AudioParameterBool> (ParameterID { ids::sound, 1 }, "Internal guitar", true));
    l.add (std::make_unique<AudioParameterFloat> (ParameterID { ids::level, 1 }, "Level", NormalisableRange<float> (-36.0f, 6.0f, 0.1f), -6.0f,
                                                  AudioParameterFloatAttributes().withLabel ("dB")));
    l.add (std::make_unique<AudioParameterFloat> (ParameterID { ids::tone, 1 }, "Tone", NormalisableRange<float> (0.0f, 1.0f, 0.01f), 0.6f));
    l.add (std::make_unique<AudioParameterFloat> (ParameterID { ids::backingLevel, 1 }, "Backing level", NormalisableRange<float> (0.0f, 1.0f, 0.01f), 0.6f));
    l.add (std::make_unique<AudioParameterFloat> (ParameterID { ids::tempo, 1 }, "Tempo", NormalisableRange<float> (40.0f, 240.0f, 1.0f), 100.0f,
                                                  AudioParameterFloatAttributes().withLabel ("BPM")));
    l.add (std::make_unique<AudioParameterInt> (ParameterID { ids::keyBase, 1 }, "First chord key", 0, 115, 48, AudioParameterIntAttributes().withStringFromValueFunction ([] (int v, int) {
        return juce::MidiMessage::getMidiNoteName (v, true, true, 4); // C3 = MIDI 48, as on the fretboard (E2 = 40)
    })));
    return l;
}

double stepBeatsFor (int rateIndex)
{
    static const double steps[] = { 1.0, 0.5, 1.0 / 3.0, 0.25, 1.0 / 6.0, 0.125 };
    return steps[juce::jlimit (0, 5, rateIndex)];
}

int choiceIndex (juce::AudioProcessorValueTreeState& p, const char* id)
{
    return juce::roundToInt (p.getRawParameterValue (id)->load());
}
} // namespace

ArpProcessor::ArpProcessor()
    : AudioProcessor (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      params (*this, nullptr, "params", createLayout())
{
    rebuild (true);
    startTimerHz (20);
}

ArpProcessor::~ArpProcessor()
{
    stopTimer();
    latest.store (nullptr);
    inUse.store (nullptr);
}

bool ArpProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto out = layouts.getMainOutputChannelSet();
    return out == juce::AudioChannelSet::stereo() || out == juce::AudioChannelSet::mono();
}

void ArpProcessor::prepareToPlay (double sampleRate, int)
{
    sampleRateHz = sampleRate > 0 ? sampleRate : 44100;
    synth.prepare (sampleRateHz);
    midiScratch.ensureSize (8192);
    numActive = 0;
    lastEndBeat = -1;
}

PlayMode ArpProcessor::getMode() const
{
    return (PlayMode) juce::jlimit (0, 2, juce::roundToInt (params.getRawParameterValue (ids::mode)->load()));
}

// ---- Document ----------------------------------------------------------------------------------
fl::Song ArpProcessor::getSong() const
{
    std::lock_guard<std::mutex> lock (songMutex);
    return song;
}

void ArpProcessor::setSong (const fl::Song& s)
{
    {
        std::lock_guard<std::mutex> lock (songMutex);
        song = s;
        if (song.chords.empty())
        {
            song.chords = { "C" };
            song.slots = { {} };
        }
        song.slots.resize (song.chords.size());
        if (song.tuning.size() < 3) song.tuning = { 40, 45, 50, 55, 59, 64 };
        song.numFrets = juce::jlimit (12, 27, song.numFrets);
    }
    rebuild (true);
}

fl::PhraseOptions ArpProcessor::currentPhraseOptions() const
{
    auto& p = const_cast<juce::AudioProcessorValueTreeState&> (params);
    fl::PhraseOptions o;
    o.stepBeats = stepBeatsFor (choiceIndex (p, ids::rate));
    o.pattern = (fl::Pattern) juce::jlimit (0, 4, choiceIndex (p, ids::pattern));
    o.backing = juce::jlimit (0, 2, choiceIndex (p, ids::backing));
    o.seed = 7;
    return o;
}

void ArpProcessor::rebuild (bool resolveAgain)
{
    fl::Song s;
    std::vector<fl::ResolvedSlot> res;
    {
        std::lock_guard<std::mutex> lock (songMutex);
        s = song;
        if (! resolveAgain && resolved.size() == s.chords.size()) res = resolved; // only the playing options changed
        else resolveAgain = true;
    }
    if (resolveAgain)
        for (size_t i = 0; i < s.chords.size(); ++i) res.push_back (fl::resolveSlot (s.chords[i], s.slotAt (i)));
    const auto opts = currentPhraseOptions();
    auto pd = std::make_unique<PhraseData>();
    pd->phrase = fl::buildPhrase (s, res, opts);
    pd->tuning = s.tuning;
    pd->numFrets = s.numFrets;
    pd->globalWindow = s.position;
    for (size_t i = 0; i < s.chords.size(); ++i) pd->windows.push_back (s.windowFor (i));
    pd->stepBeats = opts.stepBeats;
    pd->pattern = opts.pattern;
    const auto& notes = pd->phrase.notes;
    for (size_t i = 0; i < s.chords.size(); ++i)
    {
        size_t first = notes.size(), last = 0;
        for (size_t k = 0; k < notes.size(); ++k)
            if (notes[k].slot == (int) i)
            {
                first = std::min (first, k);
                last = k + 1;
            }
        if (first > last) first = last;
        pd->slotFirst.push_back (first);
        pd->slotLast.push_back (last);
    }
    {
        std::lock_guard<std::mutex> lock (songMutex);
        resolved = std::move (res);
        if (resolveAgain) songVersion++;
        builtWith = opts;
        builtOnce = true;
    }
    publish (std::move (pd));
}

void ArpProcessor::publish (std::unique_ptr<PhraseData> data)
{
    PhraseData* raw = data.get();
    owned.push_back (std::move (data));
    latest.store (raw);
    // Free phrases the audio thread can no longer be using (see acquirePhrase).
    PhraseData* live = inUse.load();
    owned.erase (std::remove_if (owned.begin(), owned.end(), [&] (auto& p) { return p.get() != raw && p.get() != live; }), owned.end());
}

ArpProcessor::PhraseData* ArpProcessor::acquirePhrase()
{
    // Announce which phrase we use, then confirm it is still the latest one: a phrase that was
    // replaced in between may already be freed, so we only use one that passed the re-check.
    PhraseData* p;
    do
    {
        p = latest.load();
        inUse.store (p);
    } while (p != latest.load());
    return p;
}

void ArpProcessor::timerCallback()
{
    const auto opts = currentPhraseOptions();
    bool stale, changed;
    {
        std::lock_guard<std::mutex> lock (songMutex);
        stale = ! builtOnce;
        changed = std::abs (opts.stepBeats - builtWith.stepBeats) > 1e-9 || opts.pattern != builtWith.pattern || opts.backing != builtWith.backing;
    }
    if (stale || changed) rebuild (stale);
    else if (owned.size() > 1)
    {
        PhraseData* live = inUse.load();
        PhraseData* newest = latest.load();
        owned.erase (std::remove_if (owned.begin(), owned.end(), [&] (auto& p) { return p.get() != newest && p.get() != live; }), owned.end());
    }
}

std::string ArpProcessor::exportText() const
{
    std::lock_guard<std::mutex> lock (songMutex);
    fl::Song s = song;
    s.tempo = juce::roundToInt (params.getRawParameterValue (ids::tempo)->load());
    const auto date = juce::Time::getCurrentTime().toString (true, true, false, true).toStdString();
    return fl::exportArrangementText (fl::toDoc (s), fl::exportInfo (s, resolved, date));
}

juce::String ArpProcessor::importText (const std::string& text, bool& ok)
{
    const auto parsed = fl::parseArrangementText (text);
    fl::Song s = getSong();
    auto problems = parsed.errors;
    ok = fl::applyDoc (s, parsed.doc, problems);
    juce::StringArray issues;
    for (auto& p : problems) issues.add (juce::String::fromUTF8 (p.c_str()));
    if (! ok) return "No chords found." + (issues.isEmpty() ? juce::String() : " " + issues.joinIntoString ("; ") + ".");
    setSong (s);
    if (parsed.doc.tempo)
        if (auto* t = params.getParameter (ids::tempo)) t->setValueNotifyingHost (t->convertTo0to1 ((float) *parsed.doc.tempo));
    selectedSlot = 0;
    juce::String msg = "Imported " + juce::String ((int) s.chords.size()) + " chords with their arpeggios.";
    if (! parsed.doc.tuning.empty()) msg << " Tuning: " << juce::String::fromUTF8 (fl::tuningText (s.tuning).c_str()) << ".";
    if (! issues.isEmpty()) msg << " " << issues.joinIntoString ("; ") << ".";
    return msg;
}

juce::MidiFile ArpProcessor::createMidiFile() const
{
    juce::MidiFile file;
    const PhraseData* pd = latest.load(); // message thread: only this thread frees phrases
    if (pd == nullptr) return file;
    const int tpq = 960;
    file.setTicksPerQuarterNote (tpq);
    const double bpm = params.getRawParameterValue (ids::tempo)->load();
    const float gate = params.getRawParameterValue (ids::gate)->load();
    const float vel = (float) params.getRawParameterValue (ids::velocity)->load() / 127.0f;
    juce::MidiMessageSequence tracks[2];
    tracks[0].addEvent (juce::MidiMessage::tempoMetaEvent (juce::roundToInt (60000000.0 / bpm)), 0);
    tracks[0].addEvent (juce::MidiMessage::timeSignatureMetaEvent (4, 4), 0);
    tracks[0].addEvent (juce::MidiMessage::textMetaEvent (3, "Fretboard Lab Arp - arpeggios"), 0);
    tracks[1].addEvent (juce::MidiMessage::textMetaEvent (3, "Fretboard Lab Arp - backing"), 0);
    const auto& notes = pd->phrase.notes;
    for (size_t i = 0; i < notes.size(); ++i)
    {
        const auto& n = notes[i];
        const double start = n.start * tpq;
        double len = n.length * tpq * (n.channel == 0 ? gate : 1.0f);
        // A note must end before the same pitch is struck again on its channel.
        for (size_t k = i + 1; k < notes.size(); ++k)
            if (notes[k].midi == n.midi && notes[k].channel == n.channel)
            {
                len = std::min (len, notes[k].start * tpq - start - 1);
                break;
            }
        len = std::max (1.0, std::min (len, pd->phrase.length * tpq - start));
        const auto v = (juce::uint8) juce::jlimit (1, 127, juce::roundToInt (n.velocity * vel * 127.0f));
        auto& t = tracks[n.channel == 0 ? 0 : 1];
        t.addEvent (juce::MidiMessage::noteOn (n.channel + 1, n.midi, v), start);
        t.addEvent (juce::MidiMessage::noteOff (n.channel + 1, n.midi), start + len);
    }
    for (auto& t : tracks)
    {
        t.sort();
        t.updateMatchedPairs();
    }
    file.addTrack (tracks[0]);
    if (tracks[1].getNumEvents() > 1) file.addTrack (tracks[1]);
    return file;
}

void ArpProcessor::setRunning (bool shouldRun)
{
    if (shouldRun && ! internalRun.load()) resetInternal = true; // restart from the top
    internalRun = shouldRun;
}

void ArpProcessor::audition (int midi, int string, int fret)
{
    const auto scope = auditionFifo.write (1);
    if (scope.blockSize1 > 0) auditionQueue[(size_t) scope.startIndex1] = { midi, string, fret };
    else if (scope.blockSize2 > 0) auditionQueue[(size_t) scope.startIndex2] = { midi, string, fret };
}

// ---- State -------------------------------------------------------------------------------------
void ArpProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    juce::ValueTree st ("FretboardLabArp");
    st.setProperty ("version", 1, nullptr);
    st.appendChild (params.copyState(), nullptr);
    {
        std::lock_guard<std::mutex> lock (songMutex);
        fl::Song s = song;
        s.tempo = juce::roundToInt (params.getRawParameterValue (ids::tempo)->load());
        st.setProperty ("arrangement", juce::String::fromUTF8 (fl::arrangementDataText (fl::toDoc (s)).c_str()), nullptr);
        st.setProperty ("tuningId", juce::String (s.tuningId), nullptr);
        st.setProperty ("frets", s.numFrets, nullptr);
    }
    st.setProperty ("selected", selectedSlot.load(), nullptr);
    if (auto xml = st.createXml()) copyXmlToBinary (*xml, destData);
}

void ArpProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    auto xml = getXmlFromBinary (data, sizeInBytes);
    if (xml == nullptr) return;
    auto st = juce::ValueTree::fromXml (*xml);
    if (! st.hasType ("FretboardLabArp")) return;
    auto p = st.getChildWithName (params.state.getType());
    if (p.isValid()) params.replaceState (p);
    fl::Song s;
    const auto parsed = fl::parseArrangementText (st.getProperty ("arrangement").toString().toStdString());
    std::vector<std::string> problems;
    fl::applyDoc (s, parsed.doc, problems);
    s.numFrets = (int) st.getProperty ("frets", 22);
    const std::string tid = st.getProperty ("tuningId", "").toString().toStdString();
    if (auto* t = fl::tuningById (tid); t && t->strings == s.tuning) s.tuningId = tid;
    selectedSlot = juce::jlimit (0, (int) std::max<size_t> (1, s.chords.size()) - 1, (int) st.getProperty ("selected", 0));
    if (juce::MessageManager::getInstanceWithoutCreating() != nullptr && juce::MessageManager::getInstance()->isThisTheMessageThread())
        setSong (s);
    else
    {
        {
            std::lock_guard<std::mutex> lock (songMutex);
            song = s;
            builtOnce = false; // the timer rebuilds on the message thread
        }
    }
}

// ---- Audio -------------------------------------------------------------------------------------
void ArpProcessor::startNote (int offset, int midi, int channel, float velocity, float pan, double lengthSamples, juce::MidiBuffer& midiOut)
{
    if (midi < 0 || midi > 127) return;
    for (int i = 0; i < numActive; ++i)
        if (active[(size_t) i].midi == midi && active[(size_t) i].channel == channel)
        {
            midiOut.addEvent (juce::MidiMessage::noteOff (channel + 1, midi), offset);
            active[(size_t) i] = active[(size_t) --numActive];
            break;
        }
    if (numActive >= (int) active.size()) return;
    const auto vel = (juce::uint8) juce::jlimit (1, 127, juce::roundToInt (velocity * 127.0f));
    midiOut.addEvent (juce::MidiMessage::noteOn (channel + 1, midi, vel), offset);
    active[(size_t) numActive++] = { midi, channel, sampleClock + offset + std::max<int64_t> (1, (int64_t) lengthSamples) };
    if (numEvents < (int) events.size()) events[(size_t) numEvents++] = { offset, true, midi, channel, velocity, pan };
}

void ArpProcessor::flushNoteOffs (int numSamples, juce::MidiBuffer& midiOut)
{
    for (int i = 0; i < numActive;)
    {
        auto& a = active[(size_t) i];
        if (a.offAt < sampleClock + numSamples)
        {
            const int offset = (int) juce::jlimit<int64_t> (0, numSamples - 1, a.offAt - sampleClock);
            midiOut.addEvent (juce::MidiMessage::noteOff (a.channel + 1, a.midi), offset);
            if (numEvents < (int) events.size()) events[(size_t) numEvents++] = { offset, false, a.midi, a.channel, 0, 0 };
            active[(size_t) i] = active[(size_t) --numActive];
        }
        else
            ++i;
    }
}

void ArpProcessor::allNotesOff (int offset, juce::MidiBuffer& midiOut)
{
    for (int i = 0; i < numActive; ++i)
    {
        midiOut.addEvent (juce::MidiMessage::noteOff (active[(size_t) i].channel + 1, active[(size_t) i].midi), offset);
        if (numEvents < (int) events.size()) events[(size_t) numEvents++] = { offset, false, active[(size_t) i].midi, active[(size_t) i].channel, 0, 0 };
    }
    numActive = 0;
}

void ArpProcessor::scheduleRange (const PhraseData& pd, double b0, double b1, double samplesPerBeat, int numSamples, float velScale, int onlySlot,
                                  juce::MidiBuffer& midiOut)
{
    const auto& notes = pd.phrase.notes;
    size_t first = 0, last = notes.size();
    double loopLen = pd.phrase.length, origin = 0;
    if (onlySlot >= 0)
    {
        if (onlySlot >= (int) pd.slotFirst.size()) return;
        first = pd.slotFirst[(size_t) onlySlot];
        last = pd.slotLast[(size_t) onlySlot];
        loopLen = pd.phrase.slotBeats[(size_t) onlySlot];
        origin = pd.phrase.slotStart[(size_t) onlySlot];
    }
    if (loopLen <= 0 || first >= last) return;
    const float gate = params.getRawParameterValue (ids::gate)->load();
    const float vel = (float) params.getRawParameterValue (ids::velocity)->load() / 127.0f;
    const int nStrings = (int) pd.tuning.size();
    for (double k = std::floor (b0 / loopLen); k * loopLen < b1; k += 1)
    {
        const double base = k * loopLen - origin;
        for (size_t i = first; i < last; ++i)
        {
            const auto& n = notes[i];
            const double t = base + n.start;
            if (t < b0 || t >= b1) continue;
            const int offset = juce::jlimit (0, numSamples - 1, (int) std::floor ((t - b0) * samplesPerBeat));
            const double len = n.length * samplesPerBeat * (n.channel == 0 ? gate : 1.0);
            const float pan = n.channel == 0 && n.string >= 0 && nStrings > 1 ? ((float) n.string / (float) (nStrings - 1) - 0.5f) * 0.6f : 0.0f;
            startNote (offset, n.midi, n.channel, juce::jlimit (0.01f, 1.0f, n.velocity * vel * velScale), pan, len, midiOut);
            if (n.channel == 0)
            {
                play.noteMidi = n.midi;
                play.noteString = n.string;
                play.noteFret = n.fret;
                play.slot = n.slot;
                play.noteSerial++;
            }
        }
    }
}

void ArpProcessor::playNotesMode (const PhraseData& pd, double b0, double b1, double samplesPerBeat, int numSamples, juce::MidiBuffer& midiOut)
{
    // Pitch classes held, and the lowest key (taken as the root of the line).
    int mask = 0, lowest = -1, maxVel = 0;
    for (int n = 0; n < 128; ++n)
        if (held[(size_t) n])
        {
            mask |= 1 << (n % 12);
            if (lowest < 0) lowest = n;
            maxVel = std::max (maxVel, (int) heldVelocity[(size_t) n]);
        }
    if (mask == 0)
    {
        heldSignature = -1;
        return;
    }
    const int sel = selectedSlot.load();
    const fl::OptWindow win = sel >= 0 && sel < (int) pd.windows.size() ? pd.windows[(size_t) sel] : pd.globalWindow;
    const int signature = mask | ((win ? win->start * 32 + win->end + 1 : 0) << 12);
    if (signature != heldSignature)
    {
        // The held notes on the fretboard, in the position (allocation-free).
        std::array<bool, 128> marks {};
        const int lo = win ? win->start : 0, hi = win ? std::min (win->end, pd.numFrets) : pd.numFrets;
        for (int s = 0; s < (int) pd.tuning.size(); ++s)
            for (int f = lo; f <= hi; ++f)
            {
                const int m = pd.tuning[(size_t) s] + f;
                if (m >= 0 && m < 128 && (mask & (1 << (m % 12)))) marks[(size_t) m] = true;
            }
        const int low = pd.tuning.size() > 1 ? pd.tuning[1] : 40;
        notePoolSize = 0;
        for (int m = 0; m < 128 && notePoolSize < (int) notePool.size(); ++m)
            if (marks[(size_t) m] && (win || (m >= low && m <= low + 24))) notePool[(size_t) notePoolSize++] = m;
        // Voice leading: continue from the note nearest to the last one played, else the lowest root.
        poolIndex = 0;
        if (lastPoolNote >= 0 && heldSignature >= 0)
        {
            int best = 1 << 30;
            for (int i = 0; i < notePoolSize; ++i)
                if (std::abs (notePool[(size_t) i] - lastPoolNote) < best)
                {
                    best = std::abs (notePool[(size_t) i] - lastPoolNote);
                    poolIndex = i;
                }
        }
        else
            for (int i = 0; i < notePoolSize; ++i)
                if (notePool[(size_t) i] % 12 == lowest % 12)
                {
                    poolIndex = i;
                    break;
                }
        if (heldSignature < 0)
        {
            keysBeat = b0; // first step right now
            poolDir = 1;
        }
        heldSignature = signature;
    }
    if (notePoolSize == 0) return;
    const double step = pd.stepBeats;
    if (keysBeat < b0 - step || keysBeat > b1 + step) keysBeat = b0; // the clock jumped (host loop, start/stop)
    const float gate = params.getRawParameterValue (ids::gate)->load();
    const float vel = (float) params.getRawParameterValue (ids::velocity)->load() / 127.0f * (float) maxVel / 127.0f;
    const int nStrings = (int) pd.tuning.size();
    while (keysBeat < b1)
    {
        if (keysBeat >= b0 - 1e-9)
        {
            const int midi = notePool[(size_t) poolIndex];
            // Position on the fretboard: the lowest fret in the window.
            int string = -1, fret = 1 << 20;
            const int lo = win ? win->start : 0, hi = win ? std::min (win->end, pd.numFrets) : pd.numFrets;
            for (int s = 0; s < nStrings; ++s)
            {
                const int f = midi - pd.tuning[(size_t) s];
                if (f >= lo && f <= hi && f < fret)
                {
                    fret = f;
                    string = s;
                }
            }
            const int offset = juce::jlimit (0, numSamples - 1, (int) std::floor ((keysBeat - b0) * samplesPerBeat));
            const float pan = string >= 0 && nStrings > 1 ? ((float) string / (float) (nStrings - 1) - 0.5f) * 0.6f : 0.0f;
            startNote (offset, midi, 0, juce::jlimit (0.01f, 1.0f, vel), pan, step * samplesPerBeat * gate, midiOut);
            play.noteMidi = midi;
            play.noteString = string;
            play.noteFret = string >= 0 ? fret : -1;
            play.noteSerial++;
            lastPoolNote = midi;
            // Next note of the pattern.
            if (notePoolSize > 1)
            {
                switch (pd.pattern)
                {
                    case fl::Pattern::Up: poolIndex = (poolIndex + 1) % notePoolSize; break;
                    case fl::Pattern::Down: poolIndex = (poolIndex + notePoolSize - 1) % notePoolSize; break;
                    case fl::Pattern::Random:
                    {
                        rng = rng * 1664525u + 1013904223u;
                        poolIndex = (poolIndex + 1 + (int) ((rng >> 8) % (unsigned) (notePoolSize - 1))) % notePoolSize;
                        break;
                    }
                    case fl::Pattern::VoiceLed:
                    case fl::Pattern::UpDown:
                    default:
                        if (poolIndex + poolDir < 0 || poolIndex + poolDir >= notePoolSize) poolDir = -poolDir;
                        poolIndex += poolDir;
                        break;
                }
            }
        }
        keysBeat += step;
    }
}

void ArpProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midiMessages)
{
    juce::ScopedNoDenormals noDenormals;
    const int numSamples = buffer.getNumSamples();
    buffer.clear();
    numEvents = 0;
    auto& midiOut = midiScratch;
    midiOut.clear();
    PhraseData* pd = acquirePhrase();

    const PlayMode mode = getMode();
    double bpm = params.getRawParameterValue (ids::tempo)->load();
    bool hostPlaying = false;
    std::optional<double> ppq;
    if (auto* ph = getPlayHead())
        if (auto pos = ph->getPosition())
        {
            if (auto b = pos->getBpm()) bpm = *b;
            hostPlaying = pos->getIsPlaying();
            if (hostPlaying)
                if (auto q = pos->getPpqPosition()) ppq = *q;
        }
    bpm = juce::jlimit (20.0, 400.0, bpm);
    const double samplesPerBeat = sampleRateHz * 60.0 / bpm;
    const double blockBeats = numSamples / samplesPerBeat;
    play.hostPlaying = hostPlaying;

    if (mode != lastMode)
    {
        allNotesOff (0, midiOut);
        held.fill (false);
        keysSlot = -1;
        heldSignature = -1;
        lastEndBeat = -1;
        lastMode = mode;
    }

    // Incoming MIDI: keys pick a chord / are arpeggiated; other messages pass through.
    const int keyBase = juce::roundToInt (params.getRawParameterValue (ids::keyBase)->load());
    const int numSlots = pd != nullptr ? (int) pd->slotFirst.size() : 0;
    for (const auto meta : midiMessages)
    {
        const auto msg = meta.getMessage();
        const int offset = juce::jlimit (0, numSamples - 1, meta.samplePosition);
        if (msg.isNoteOn())
        {
            const int n = msg.getNoteNumber();
            const bool wasAnyHeld = std::find (held.begin(), held.end(), true) != held.end();
            held[(size_t) n] = true;
            heldVelocity[(size_t) n] = msg.getVelocity();
            lastKey = n;
            if (mode == PlayMode::KeysPickChord && n >= keyBase && n - keyBase < numSlots)
            {
                if (keysSlot != n - keyBase || ! wasAnyHeld) keysBeat = -(offset / samplesPerBeat); // the chord starts at the key press
                keysSlot = n - keyBase;
                selectedSlot = keysSlot;
            }
            else if (mode == PlayMode::KeysPlayNotes && ! wasAnyHeld)
                heldSignature = -1;
        }
        else if (msg.isNoteOff())
        {
            held[(size_t) msg.getNoteNumber()] = false;
            if (mode == PlayMode::KeysPickChord)
            {
                // Fall back to another key that is still held, else stop.
                int other = -1;
                for (int n = 0; n < 128; ++n)
                    if (held[(size_t) n] && n >= keyBase && n - keyBase < numSlots) other = n;
                if (other < 0) keysSlot = -1;
                else if (other - keyBase != keysSlot)
                {
                    keysSlot = other - keyBase;
                    keysBeat = -(offset / samplesPerBeat);
                }
            }
        }
        else if (msg.isAllNotesOff() || msg.isAllSoundOff())
        {
            held.fill (false);
            keysSlot = -1;
            allNotesOff (offset, midiOut);
        }
        else
            midiOut.addEvent (msg, offset);
    }
    {
        uint64_t lowBits = 0, highBits = 0;
        for (int n = 0; n < 64; ++n)
            if (held[(size_t) n]) lowBits |= (uint64_t) 1 << n;
        for (int n = 64; n < 128; ++n)
            if (held[(size_t) n]) highBits |= (uint64_t) 1 << (n - 64);
        play.heldLow = lowBits;
        play.heldHigh = highBits;
    }

    // Fretboard clicks.
    {
        const auto scope = auditionFifo.read (auditionFifo.getNumReady());
        auto playOne = [&] (int idx) {
            const auto& a = auditionQueue[(size_t) idx];
            const int nStrings = pd != nullptr ? (int) pd->tuning.size() : 6;
            const float pan = nStrings > 1 && a[1] >= 0 ? ((float) a[1] / (float) (nStrings - 1) - 0.5f) * 0.6f : 0.0f;
            startNote (0, a[0], 0, (float) params.getRawParameterValue (ids::velocity)->load() / 127.0f, pan, sampleRateHz * 1.5, midiOut);
            play.noteMidi = a[0];
            play.noteString = a[1];
            play.noteFret = a[2];
            play.noteSerial++;
        };
        for (int i = 0; i < scope.blockSize1; ++i) playOne (scope.startIndex1 + i);
        for (int i = 0; i < scope.blockSize2; ++i) playOne (scope.startIndex2 + i);
    }

    bool running = false;
    if (pd != nullptr)
    {
        if (mode == PlayMode::Progression)
        {
            double b0 = 0;
            if (hostPlaying && ppq)
            {
                b0 = *ppq;
                running = true;
            }
            else if (internalRun.load())
            {
                if (resetInternal.exchange (false)) internalBeat = 0;
                b0 = internalBeat;
                internalBeat += blockBeats;
                running = true;
            }
            if (running)
            {
                if (lastEndBeat >= 0 && std::abs (b0 - lastEndBeat) > 0.02) allNotesOff (0, midiOut); // the host jumped
                scheduleRange (*pd, b0, b0 + blockBeats, samplesPerBeat, numSamples, 1.0f, -1, midiOut);
                lastEndBeat = b0 + blockBeats;
                const double L = pd->phrase.length;
                if (L > 0)
                {
                    const double inLoop = std::fmod (std::fmod (b0, L) + L, L);
                    play.beat = inLoop;
                    play.slot = pd->phrase.slotAtBeat (inLoop);
                }
            }
            else
                lastEndBeat = -1;
        }
        else if (mode == PlayMode::KeysPickChord)
        {
            if (keysSlot >= 0)
            {
                running = true;
                const float velScale = lastKey >= 0 ? (float) heldVelocity[(size_t) lastKey] / 127.0f : 1.0f;
                scheduleRange (*pd, keysBeat, keysBeat + blockBeats, samplesPerBeat, numSamples, velScale, keysSlot, midiOut);
                keysBeat += blockBeats;
                play.slot = keysSlot;
            }
        }
        else
        {
            // Steps follow the host's beat while it plays, else the plugin's own clock.
            const double b0 = hostPlaying && ppq ? *ppq : notesClock;
            notesClock = b0 + blockBeats;
            playNotesMode (*pd, b0, b0 + blockBeats, samplesPerBeat, numSamples, midiOut);
            running = heldSignature >= 0;
        }
    }
    if (wasRunning && ! running)
    {
        if (mode == PlayMode::Progression) allNotesOff (0, midiOut);
        play.slot = -1;
    }
    wasRunning = running;
    play.running = running;

    flushNoteOffs (numSamples, midiOut);

    // Render the internal guitar, sample-accurately between note events.
    const bool soundOn = params.getRawParameterValue (ids::sound)->load() > 0.5f;
    const float tone = params.getRawParameterValue (ids::tone)->load();
    const float gain = juce::Decibels::decibelsToGain (params.getRawParameterValue (ids::level)->load(), -36.0f);
    const float backingGain = params.getRawParameterValue (ids::backingLevel)->load();
    for (int i = 1; i < numEvents; ++i) // insertion sort by offset (stable; few events)
    {
        const Event e = events[(size_t) i];
        int j = i - 1;
        while (j >= 0 && events[(size_t) j].offset > e.offset)
        {
            events[(size_t) j + 1] = events[(size_t) j];
            --j;
        }
        events[(size_t) j + 1] = e;
    }
    int cursor = 0;
    for (int i = 0; i < numEvents; ++i)
    {
        const auto& e = events[(size_t) i];
        if (e.offset > cursor)
        {
            synth.render (buffer, cursor, e.offset - cursor, gain, gain * backingGain);
            cursor = e.offset;
        }
        if (e.on)
        {
            if (soundOn) synth.noteOn (e.midi, e.velocity, e.channel, e.pan, tone);
        }
        else
            synth.noteOff (e.midi, e.channel);
    }
    synth.render (buffer, cursor, numSamples - cursor, gain, gain * backingGain);
    for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
    {
        auto* d = buffer.getWritePointer (ch);
        for (int i = 0; i < numSamples; ++i) d[i] = std::tanh (d[i]); // gentle safety limiter
    }

    sampleClock += numSamples;
    midiMessages.swapWith (midiOut);
}

juce::AudioProcessorEditor* ArpProcessor::createEditor() { return new ArpEditor (*this); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new ArpProcessor(); }
