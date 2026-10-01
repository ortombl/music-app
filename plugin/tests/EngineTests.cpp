// End-to-end tests of the plugin's processor (and a snapshot of its editor), run as a console app:
// plays the progression against a fake host transport and checks the MIDI that comes out, the
// keyboard modes, import / export in the web app's format and saving / restoring the state.
//
// Usage: fl_engine_tests [snapshot-dir]   (the editor snapshots need a display, e.g. xvfb-run)
#include "../Source/PluginEditor.h"
#include "../Source/PluginProcessor.h"

#include <cstdlib>
#include <iostream>

namespace
{
int failures = 0, checks = 0;

void check (bool ok, const juce::String& what)
{
    checks++;
    if (! ok)
    {
        failures++;
        std::cout << "FAIL: " << what << "\n";
    }
    else
        std::cout << "ok:   " << what << "\n";
}

struct FakeHost : juce::AudioPlayHead
{
    double bpm = 120, ppq = 0;
    bool playing = true;
    juce::Optional<PositionInfo> getPosition() const override
    {
        PositionInfo p;
        p.setBpm (bpm);
        p.setPpqPosition (ppq);
        p.setIsPlaying (playing);
        p.setTimeSignature (TimeSignature { 4, 4 });
        return p;
    }
};

struct Note
{
    double beat;
    int midi, channel, velocity;
};

/** Run the processor for `beats` beats; returns the note-ons (with their beat position). */
std::vector<Note> run (ArpProcessor& p, FakeHost& host, double beats, juce::MidiBuffer* input = nullptr, double* rms = nullptr)
{
    const double sr = 48000;
    const int block = 480;
    std::vector<Note> notes;
    juce::AudioBuffer<float> buffer (2, block);
    const double samplesPerBeat = sr * 60.0 / host.bpm;
    const int blocks = (int) std::ceil (beats * samplesPerBeat / block);
    double sum = 0;
    int64_t count = 0;
    for (int b = 0; b < blocks; ++b)
    {
        juce::MidiBuffer midi;
        if (input != nullptr && b == 0) midi = *input;
        p.processBlock (buffer, midi);
        for (const auto m : midi)
        {
            const auto msg = m.getMessage();
            if (msg.isNoteOn()) notes.push_back ({ host.ppq + m.samplePosition / samplesPerBeat, msg.getNoteNumber(), msg.getChannel(), msg.getVelocity() });
        }
        for (int i = 0; i < block; ++i) sum += (double) buffer.getSample (0, i) * buffer.getSample (0, i);
        count += block;
        if (host.playing) host.ppq += block / samplesPerBeat;
    }
    if (rms != nullptr) *rms = std::sqrt (sum / std::max<int64_t> (1, count));
    return notes;
}

juce::String dump (const std::vector<Note>& notes)
{
    juce::String s;
    for (auto& n : notes) s << "\n      beat " << juce::String (n.beat, 3) << " ch" << n.channel << " " << juce::MidiMessage::getMidiNoteName (n.midi, true, true, 3);
    return s;
}

bool allIn (const std::vector<Note>& notes, double from, double to, const std::vector<int>& pcs, int channel = 1)
{
    int n = 0;
    for (auto& x : notes)
        if (x.channel == channel && x.beat >= from - 1e-3 && x.beat < to - 1e-3)
        {
            n++;
            if (std::find (pcs.begin(), pcs.end(), x.midi % 12) == pcs.end()) return false;
        }
    return n > 0;
}

int countIn (const std::vector<Note>& notes, double from, double to, int channel)
{
    int n = 0;
    for (auto& x : notes)
        if (x.channel == channel && x.beat >= from - 1e-3 && x.beat < to - 1e-3) n++;
    return n;
}

/** Let the processor's timer rebuild the phrase after a parameter change (waits up to 5 s). */
void waitForRebuild (ArpProcessor& p, int before)
{
    for (int i = 0; i < 100 && p.getPhraseVersion() == before; ++i) juce::MessageManager::getInstance()->runDispatchLoopUntil (50);
}

void snapshot (ArpProcessor& p, const juce::File& dir, const juce::String& name)
{
    std::unique_ptr<juce::AudioProcessorEditor> ed (p.createEditor());
    ed->setVisible (true);
    for (int i = 0; i < 3; ++i) juce::MessageManager::getInstance()->runDispatchLoopUntil (40);
    auto img = ed->createComponentSnapshot (ed->getLocalBounds(), true, 1.0f);
    juce::File f = dir.getChildFile (name + ".png");
    f.deleteFile();
    juce::FileOutputStream out (f);
    juce::PNGImageFormat png;
    check (out.openedOk() && png.writeImageToStream (img, out), "editor snapshot " + f.getFullPathName());
}
} // namespace

int main (int argc, char** argv)
{
    juce::ScopedJuceInitialiser_GUI gui;
    const juce::File snapDir = argc > 1 ? juce::File (juce::String (argv[1])) : juce::File();

    ArpProcessor p;
    FakeHost host;
    p.setPlayHead (&host);
    p.prepareToPlay (48000, 480);

    // 1) Progression synced to the host: Am7 | D7 | Gmaj7 | Cmaj7, one bar each, 1/8 notes.
    {
        fl::Song s;
        s.chords = { "Am7", "D7", "Gmaj7", "Cmaj7" };
        s.slots = { {}, {}, {}, {} };
        s.position = fl::FretWindow { 5, 9 };
        p.setSong (s);
        double rms = 0;
        auto notes = run (p, host, 16, nullptr, &rms);
        check (countIn (notes, 0, 16, 1) == 32, "32 eighth notes in 4 bars (got " + juce::String (countIn (notes, 0, 16, 1)) + ")");
        check (allIn (notes, 0, 4, { 9, 0, 4, 7 }), "bar 1 plays Am7 notes");
        check (allIn (notes, 4, 8, { 2, 6, 9, 0 }), "bar 2 plays D7 notes");
        check (allIn (notes, 8, 12, { 7, 11, 2, 6 }), "bar 3 plays Gmaj7 notes");
        check (allIn (notes, 12, 16, { 0, 4, 7, 11 }), "bar 4 plays Cmaj7 notes");
        bool inPosition = true;
        for (auto& n : notes)
            if (n.midi < 40 + 5 || n.midi > 64 + 9) inPosition = false;
        check (inPosition, "notes lie in frets 5-9 of standard tuning");
        check (rms > 0.005, "the internal guitar makes sound (rms " + juce::String (rms, 4) + ")");
        check (! notes.empty() && notes.front().beat < 0.01 && notes.front().midi % 12 == 9, "first note is the root A on beat 1");
    }

    // 2) Per-chord arpeggio, position and length, and backing on channel 2.
    {
        fl::Song s;
        s.chords = { "Dm7", "G7", "Cmaj7" };
        s.slots = { { "Fmaj7", fl::SlotPosition::frets (0, 4), 2 }, { "Bdim", fl::SlotPosition::global(), 2 }, { "E G B D", fl::SlotPosition::neck(), 4 } };
        s.position = fl::FretWindow { 7, 11 };
        p.setSong (s);
        int v = p.getPhraseVersion();
        p.params.getParameter (ids::backing)->setValueNotifyingHost (p.params.getParameter (ids::backing)->convertTo0to1 (2));
        p.params.getParameter (ids::rate)->setValueNotifyingHost (p.params.getParameter (ids::rate)->convertTo0to1 (3)); // 1/16
        waitForRebuild (p, v); // the timer rebuilds the phrase
        host.ppq = 0;
        auto notes = run (p, host, 8);
        check (countIn (notes, 0, 8, 1) == 32, "1/16 notes: 32 in 8 beats (got " + juce::String (countIn (notes, 0, 8, 1)) + ")");
        check (allIn (notes, 0, 2, { 5, 9, 0, 4 }), "chord 1 plays its Fmaj7 arpeggio");
        bool lowFrets = true;
        for (auto& n : notes)
            if (n.channel == 1 && n.beat < 2 && (n.midi < 40 || n.midi > 64 + 4)) lowFrets = false;
        check (lowFrets, "chord 1 is played in frets 0-4");
        check (allIn (notes, 2, 4, { 11, 2, 5 }), "chord 2 plays Bdim" + (std::getenv ("FL_DUMP") ? dump (notes) : juce::String()));
        check (allIn (notes, 4, 8, { 4, 7, 11, 2 }), "chord 3 plays the typed notes E G B D");
        std::vector<Note> backing;
        for (auto& n : notes)
            if (n.channel == 2) backing.push_back (n);
        const bool backingOk = countIn (notes, 0, 8, 2) >= 12 && allIn (notes, 0, 1.9, { 2, 5, 9, 0 }, 2) && allIn (notes, 2.0, 3.9, { 7, 11, 2, 5 }, 2);
        check (backingOk, "backing chord + bass on channel 2" + (backingOk ? juce::String() : dump (backing)));
        v = p.getPhraseVersion();
        p.params.getParameter (ids::backing)->setValueNotifyingHost (0);
        p.params.getParameter (ids::rate)->setValueNotifyingHost (p.params.getParameter (ids::rate)->convertTo0to1 (1));
        waitForRebuild (p, v);
    }

    // MIDI file of the phrase (with backing on track 2).
    {
        int v = p.getPhraseVersion();
        p.params.getParameter (ids::backing)->setValueNotifyingHost (p.params.getParameter (ids::backing)->convertTo0to1 (2));
        waitForRebuild (p, v);
        const auto file = p.createMidiFile();
        int arpNotes = 0, backNotes = 0;
        bool paired = true;
        for (int t = 0; t < file.getNumTracks(); ++t)
            for (auto* e : *file.getTrack (t))
                if (e->message.isNoteOn())
                {
                    (e->message.getChannel() == 1 ? arpNotes : backNotes)++;
                    if (e->noteOffObject == nullptr || e->noteOffObject->message.getTimeStamp() <= e->message.getTimeStamp()) paired = false;
                }
        check (file.getNumTracks() == 2 && arpNotes == 16 && backNotes > 0 && paired,
               "MIDI file: 2 tracks, 16 arpeggio notes (got " + juce::String (arpNotes) + "), backing, every note has an end");
        v = p.getPhraseVersion();
        p.params.getParameter (ids::backing)->setValueNotifyingHost (0);
        waitForRebuild (p, v);
    }

    // 3) Export → import round trip in the web app's format.
    {
        const auto text = p.exportText();
        check (juce::String (text).contains ("chord: Dm7 | arpeggio: Fmaj7 | position: 0-4 | length: 2"), "export has the [data] line for chord 1");
        check (juce::String (text).contains ("chord: Cmaj7 | arpeggio: E G B D | position: neck | length: 4"), "export keeps typed notes");
        check (juce::String (text).contains ("tuning: E2 A2 D3 G3 B3 E4"), "export has the tuning");
        ArpProcessor q;
        bool ok = false;
        const auto msg = q.importText (text, ok);
        check (ok, "import of the exported text: " + msg);
        const auto a = p.getSong(), b = q.getSong();
        bool same = a.chords == b.chords && a.position == b.position && a.tuning == b.tuning;
        for (size_t i = 0; i < a.chords.size() && same; ++i)
            same = a.slots[i].arp == b.slots[i].arp && a.slots[i].pos == b.slots[i].pos && a.slots[i].beats == b.slots[i].beats;
        check (same, "round trip keeps chords, arpeggios, positions, lengths");

        // A file written by the web app (with a drop-D tuning and a tempo).
        const std::string web = "FRETBOARD LAB \xE2\x80\x94 PROGRESSION & ARPEGGIOS\nKey: D minor\n\n#  Chord  Arpeggio\n-  -----  --------\n1  Dm7    Fmaj9\n\n[data]\n"
                                "tuning: D2 A2 D3 G3 B3 E4\ntempo: 84\nposition: 3-7\nchord: Dm7 | arpeggio: Fmaj9 | position: all | length: 4\n"
                                "chord: Eb(add#11, no3) | arpeggio: - | position: neck | length: 8\nchord: G7(b9) | arpeggio: Abdim7 | position: 2-6 | length: 2\n";
        ArpProcessor r;
        const auto msg2 = r.importText (web, ok);
        const auto s = r.getSong();
        check (ok && s.chords.size() == 3 && s.tuningId == "dropD" && s.position == fl::OptWindow (fl::FretWindow { 3, 7 }), "import a web-app file: " + msg2);
        check (juce::approximatelyEqual (r.params.getRawParameterValue (ids::tempo)->load(), 84.0f), "import sets the tempo");
        check (r.getResolved()[1].chordName == "E\xE2\x99\xAD(add\xE2\x99\xAF" "11, no3)", "Eb(add#11, no3) is understood");
        check (r.getResolved()[2].arp.name == "A\xE2\x99\xAD" "dim7", "G7(b9) plays Abdim7");

        // A plain progression
        const auto msg3 = r.importText ("Am F C G", ok);
        check (ok && r.getSong().chords.size() == 4, "import a plain progression: " + msg3);
        r.importText ("this is not music", ok);
        check (! ok && r.getSong().chords.size() == 4, "unreadable text is rejected and keeps the song");
    }

    // 4) State save / restore.
    {
        juce::MemoryBlock state;
        p.params.getParameter (ids::pattern)->setValueNotifyingHost (p.params.getParameter (ids::pattern)->convertTo0to1 (3));
        p.getStateInformation (state);
        ArpProcessor q;
        q.setStateInformation (state.getData(), (int) state.getSize());
        const auto a = p.getSong(), b = q.getSong();
        check (a.chords == b.chords && a.tuning == b.tuning && a.position == b.position && a.slots[0].arp == b.slots[0].arp, "state restores the song");
        check (juce::roundToInt (q.params.getRawParameterValue (ids::pattern)->load()) == 3, "state restores the parameters");
    }

    // 5) Keys pick chord: C3 = chord 1, C#3 = chord 2 …
    {
        fl::Song s;
        s.chords = { "Am7", "D7", "Gmaj7" };
        s.slots = { {}, {}, {} };
        p.setSong (s);
        p.params.getParameter (ids::mode)->setValueNotifyingHost (p.params.getParameter (ids::mode)->convertTo0to1 (1));
        host.playing = false;
        juce::MidiBuffer in;
        in.addEvent (juce::MidiMessage::noteOn (1, 49, (juce::uint8) 100), 0); // C#3 → chord 2 (D7)
        auto notes = run (p, host, 4, &in);
        check (countIn (notes, -1, 100, 1) >= 7 && allIn (notes, -1, 100, { 2, 6, 9, 0 }), "key C#3 plays chord 2 (D7) while held");
        juce::MidiBuffer off;
        off.addEvent (juce::MidiMessage::noteOff (1, 49), 0);
        auto after = run (p, host, 2, &off);
        check (countIn (after, -1, 100, 1) == 0, "releasing the key stops it");
    }

    // 6) Keys play notes: hold C E G B → a guitar arpeggio of those notes.
    {
        p.params.getParameter (ids::mode)->setValueNotifyingHost (p.params.getParameter (ids::mode)->convertTo0to1 (2));
        juce::MidiBuffer in;
        for (int n : { 60, 64, 67, 71 }) in.addEvent (juce::MidiMessage::noteOn (1, n, (juce::uint8) 110), 0);
        auto notes = run (p, host, 4, &in);
        check (countIn (notes, -1, 100, 1) >= 7 && allIn (notes, -1, 100, { 0, 4, 7, 11 }), "held C E G B are arpeggiated (" + juce::String (countIn (notes, -1, 100, 1)) + " notes)");
        juce::MidiBuffer off;
        for (int n : { 60, 64, 67, 71 }) off.addEvent (juce::MidiMessage::noteOff (1, n), 0);
        run (p, host, 1, &off);
        p.params.getParameter (ids::mode)->setValueNotifyingHost (0);
    }

    // 7) Plugin's own clock (Play button) when the host is stopped.
    {
        host.playing = false;
        p.setRunning (true);
        auto notes = run (p, host, 3.9); // notes on beats 0, 0.5 … 3.5
        check (countIn (notes, -1, 100, 1) == 8, "Play button: 8 eighth notes per bar at the plugin's tempo (got " + juce::String (countIn (notes, -1, 100, 1)) + ")" + (std::getenv ("FL_DUMP") ? dump (notes) : juce::String()));
        p.setRunning (false);
        run (p, host, 0.5);
        auto quiet = run (p, host, 2);
        check (quiet.empty(), "Stop silences the arpeggio");
    }

    // 8) The internal guitar is in tune: pick A4 / E2 / E5 and measure the pitch.
    for (int midi : { 69, 40, 76 })
    {
        ArpProcessor g;
        FakeHost stopped;
        stopped.playing = false;
        g.setPlayHead (&stopped);
        g.prepareToPlay (48000, 480);
        g.audition (midi, -1, -1);
        juce::AudioBuffer<float> buf (2, 480);
        std::vector<float> wave;
        for (int b = 0; b < 40; ++b)
        {
            juce::MidiBuffer m;
            g.processBlock (buf, m);
            for (int i = 0; i < 480; ++i) wave.push_back (buf.getSample (0, i));
        }
        // Autocorrelation over 0.1 s, after the attack.
        const double freq = 440.0 * std::pow (2.0, (midi - 69) / 12.0);
        const size_t start = 4800, len = 4800;
        double best = -1e9;
        int bestLag = 0;
        const int minLag = (int) (48000 / (freq * 1.5)), maxLag = (int) (48000 / (freq / 1.5));
        for (int lag = minLag; lag <= maxLag; ++lag)
        {
            double s = 0;
            for (size_t i = start; i < start + len; ++i) s += (double) wave[i] * wave[i + (size_t) lag];
            if (s > best)
            {
                best = s;
                bestLag = lag;
            }
        }
        // refine with a parabola through the peak
        auto ac = [&] (int lag) {
            double s = 0;
            for (size_t i = start; i < start + len; ++i) s += (double) wave[i] * wave[i + (size_t) lag];
            return s;
        };
        const double y0 = ac (bestLag - 1), y1 = ac (bestLag), y2 = ac (bestLag + 1);
        const double lag = bestLag + 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2);
        const double measured = 48000.0 / lag;
        const double cents = 1200.0 * std::log2 (measured / freq);
        check (std::abs (cents) < 5, "internal guitar " + juce::MidiMessage::getMidiNoteName (midi, true, true, 4) + " in tune (" + juce::String (measured, 2) + " Hz, " + juce::String (cents, 1) + " cents)");
    }

    // 9) Editor snapshots (needs a display).
    if (snapDir.getFullPathName().isNotEmpty() && juce::Desktop::getInstance().getDisplays().getPrimaryDisplay() != nullptr)
    {
        fl::Song s;
        s.chords = { "Dm7", "G7(b9)", "Cmaj7", "Eb(add#11,no3)" };
        s.slots = { { "Fmaj9", fl::SlotPosition::global(), 4 }, { "Abdim7", fl::SlotPosition::global(), 4 }, { "E G B D", fl::SlotPosition::neck(), 8 }, {} };
        s.position = fl::FretWindow { 3, 7 };
        p.setSong (s);
        p.selectedSlot = 0;
        snapshot (p, snapDir, "editor-standard");
        s.tuning = fl::tuningById ("8standard")->strings;
        s.tuningId = "8standard";
        s.numFrets = 24;
        p.setSong (s);
        p.selectedSlot = 2;
        snapshot (p, snapDir, "editor-8string");
    }

    std::cout << (checks - failures) << "/" << checks << " checks passed\n";
    return failures == 0 ? 0 : 1;
}
