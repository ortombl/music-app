#include "Song.h"

#include <algorithm>
#include <cmath>

namespace fl
{
OptWindow Song::windowFor (size_t i) const
{
    const Slot s = slotAt (i);
    FretWindow w;
    if (s.pos.kind == SlotPosition::Global)
    {
        if (! position) return std::nullopt;
        w = *position;
    }
    else if (s.pos.kind == SlotPosition::Neck)
        return std::nullopt;
    else
        w = s.pos.window;
    const int end = std::min (w.end, numFrets);
    return FretWindow { std::max (0, std::min (w.start, std::max (0, end - 4))), end };
}

double Song::totalBeats() const
{
    double t = 0;
    for (size_t i = 0; i < chords.size(); ++i) t += slotAt (i).beats;
    return t;
}

bool sameNotes (const Chord& a, const Chord& b)
{
    auto mask = [] (const Chord& c) {
        int m = 0;
        for (int p : c.pcs()) m |= 1 << p;
        return m;
    };
    return a.root == b.root && mask (a) == mask (b);
}

ResolvedSlot resolveSlot (const std::string& chordText, const Slot& slot, int suggestionLimit)
{
    ResolvedSlot r;
    auto c = parseChordSymbol (chordText);
    if (! c)
    {
        // A chord written as notes ("E G B D") is recognised too.
        auto in = parseArpInput (chordText);
        if (in.ok && ! in.recognisedFrom.empty()) c = in.chord;
    }
    if (! c)
    {
        r.chordName = trim (chordText);
        r.error = "Chord \"" + trim (chordText) + "\" not recognised.";
        return r;
    }
    r.chordOk = true;
    r.chord = *c;
    r.chordName = c->name();
    r.exact = exactArpeggios (*c);
    r.subs = suggestArpeggios (*c, suggestionLimit);
    r.arp = r.exact.front();
    if (trim (slot.arp).empty()) return r;
    const auto in = parseArpInput (slot.arp);
    if (! in.ok)
    {
        r.error = in.error;
        return r;
    }
    r.recognisedFrom = in.recognisedFrom;
    for (size_t k = 0; k < r.subs.size(); ++k)
        if (sameNotes (r.subs[k].chord, in.chord))
        {
            r.kind = ResolvedSlot::Kind::Suggested;
            r.subIndex = (int) k;
            r.arp = r.subs[k];
            return r;
        }
    r.kind = ResolvedSlot::Kind::Custom;
    r.arp = analyzeArpeggio (*c, in.chord);
    return r;
}

std::string matchTuningId (const std::vector<int>& strings)
{
    for (auto& t : tunings())
        if (t.strings == strings) return t.id;
    return "custom";
}

const Tuning* tuningById (const std::string& id)
{
    for (auto& t : tunings())
        if (t.id == id) return &t;
    return nullptr;
}

std::string tuningDescription (const Song& song)
{
    std::string notes;
    for (size_t i = 0; i < song.tuning.size(); ++i) notes += (i ? " " : "") + pcName (song.tuning[i]);
    const Tuning* t = tuningById (song.tuningId);
    return (t && t->strings == song.tuning ? t->name : std::string ("Custom")) + " (" + notes + " \xC2\xB7 " + tuningText (song.tuning) + ")";
}

ArrangementDoc toDoc (const Song& song)
{
    ArrangementDoc d;
    d.chords = song.chords;
    for (size_t i = 0; i < song.chords.size(); ++i) d.slots.push_back (song.slotAt (i));
    d.tempo = song.tempo;
    d.hasPosition = true;
    d.position = song.position;
    d.tuning = song.tuning;
    return d;
}

ExportInfo exportInfo (const Song& song, const std::vector<ResolvedSlot>& resolved, const std::string& date)
{
    ExportInfo info;
    info.date = date;
    info.tuning = tuningDescription (song);
    info.tempo = song.tempo;
    auto fretsText = [] (const FretWindow& w) { return "frets " + std::to_string (w.start) + "\xE2\x80\x93" + std::to_string (w.end); };
    info.position = song.position ? fretsText (*song.position) : "whole neck";
    for (size_t i = 0; i < song.chords.size() && i < resolved.size(); ++i)
    {
        const auto& r = resolved[i];
        const Slot s = song.slotAt (i);
        ExportRow row;
        row.chord = r.chordName;
        if (r.chordOk)
        {
            row.arpeggio = r.arp.name + (r.kind == ResolvedSlot::Kind::Own ? " (chord)" : r.kind == ResolvedSlot::Kind::Custom ? " (own)" : "");
            for (size_t k = 0; k < r.arp.notes.size(); ++k) row.notes += (k ? " " : "") + r.arp.notes[k].name;
            row.fit = r.kind == ResolvedSlot::Kind::Own ? "\xE2\x80\x94" : std::to_string ((int) std::lround (r.arp.fit * 100)) + "%";
            row.sound = r.arp.sound != r.chordName ? r.arp.sound : "";
        }
        if (s.pos.kind == SlotPosition::Global) row.position = song.position ? fretsText (*song.position) + " (all)" : "whole neck (all)";
        else if (s.pos.kind == SlotPosition::Neck) row.position = "whole neck";
        else row.position = fretsText (s.pos.window);
        row.length = beatsText (s.beats);
        info.rows.push_back (row);
    }
    return info;
}

bool applyDoc (Song& song, const ArrangementDoc& doc, std::vector<std::string>& problems)
{
    std::vector<std::string> chords;
    std::vector<Slot> slots;
    for (size_t i = 0; i < doc.chords.size(); ++i)
    {
        const std::string& c = doc.chords[i];
        auto rs = resolveSlot (c, {}, 0);
        if (! rs.chordOk)
        {
            problems.push_back ("chord \"" + c + "\" not recognised \xE2\x80\x94 skipped");
            continue;
        }
        Slot slot = i < doc.slots.size() ? doc.slots[i] : Slot {};
        if (! slot.arp.empty() && ! parseArpInput (slot.arp).ok)
        {
            problems.push_back ("arpeggio \"" + slot.arp + "\" for " + c + " not recognised \xE2\x80\x94 using the chord's own");
            slot.arp.clear();
        }
        chords.push_back (c);
        slots.push_back (slot);
    }
    if (chords.empty()) return false;
    song.chords = chords;
    song.slots = slots;
    if (doc.tempo) song.tempo = *doc.tempo;
    if (doc.hasPosition) song.position = doc.position;
    if (! doc.tuning.empty())
    {
        song.tuning = doc.tuning;
        song.tuningId = matchTuningId (doc.tuning);
    }
    return true;
}

int Phrase::slotAtBeat (double beat) const
{
    for (size_t i = 0; i < slotStart.size(); ++i)
        if (beat >= slotStart[i] && beat < slotStart[i] + slotBeats[i]) return (int) i;
    return slotStart.empty() ? -1 : (int) slotStart.size() - 1;
}

namespace
{
int rootIndex (const std::vector<int>& pool, int rootPc, bool highest)
{
    int idx = -1;
    for (int k = 0; k < (int) pool.size(); ++k)
        if (mod12 (pool[(size_t) k]) == mod12 (rootPc))
        {
            idx = k;
            if (! highest) break;
        }
    if (idx < 0) return highest ? (int) pool.size() - 1 : 0;
    return idx;
}

/** A simple strummable voicing: the bass (root or slash bass) with the chord tones stacked above. */
std::vector<int> backingVoicing (const Chord& c, const std::vector<int>& tuning)
{
    const int lowest = tuning.empty() ? 40 : tuning.front();
    const int bassPc = c.bass >= 0 ? c.bass : c.root;
    int bass = lowest;
    while (mod12 (bass) != bassPc) bass++;
    std::vector<int> v { bass };
    int prev = bass + 6; // keep the first upper note a 5th or more above the bass
    for (int pc : c.pcs())
    {
        if (pc == bassPc || v.size() >= 5) continue;
        int m = prev + 1;
        while (mod12 (m) != pc) m++;
        v.push_back (m);
        prev = m;
    }
    return v;
}
} // namespace

Phrase buildPhrase (const Song& song, const std::vector<ResolvedSlot>& resolved, const PhraseOptions& opts)
{
    Phrase ph;
    const size_t n = std::min (song.chords.size(), resolved.size());
    const double step = std::max (1.0 / 16, opts.stepBeats);
    std::vector<std::vector<int>> pools;
    std::vector<int> roots, counts;
    double t = 0;
    for (size_t i = 0; i < n; ++i)
    {
        const Slot s = song.slotAt (i);
        ph.slotStart.push_back (t);
        ph.slotBeats.push_back (s.beats);
        t += s.beats;
        const auto& r = resolved[i];
        pools.push_back (r.chordOk ? pitchPool (song.tuning, song.numFrets, r.arp.pcs(), song.windowFor (i)) : std::vector<int> {});
        roots.push_back (r.chordOk ? r.arp.chord.root : 0);
        counts.push_back ((int) std::floor (s.beats / step + 1e-6));
    }
    ph.length = t;

    std::vector<std::vector<int>> lines;
    if (opts.pattern == Pattern::VoiceLed) lines = voiceLedLines (pools, roots, counts);
    else
    {
        unsigned rng = opts.seed * 2654435761u + 12345u;
        auto next = [&rng] { return (rng = rng * 1664525u + 1013904223u) >> 8; };
        for (size_t i = 0; i < n; ++i)
        {
            const auto& pool = pools[i];
            std::vector<int> line;
            const int size = (int) pool.size();
            if (size > 0)
            {
                if (opts.pattern == Pattern::Up || opts.pattern == Pattern::UpDown)
                {
                    const int start = rootIndex (pool, roots[i], false);
                    int idx = start, dir = 1;
                    for (int k = 0; k < counts[i]; ++k)
                    {
                        line.push_back (pool[(size_t) idx]);
                        if (size == 1) continue;
                        if (opts.pattern == Pattern::Up) idx = idx + 1 < size ? idx + 1 : start;
                        else
                        {
                            if (idx + dir < 0 || idx + dir >= size) dir = -dir;
                            idx += dir;
                        }
                    }
                }
                else if (opts.pattern == Pattern::Down)
                {
                    const int start = rootIndex (pool, roots[i], true);
                    int idx = start;
                    for (int k = 0; k < counts[i]; ++k)
                    {
                        line.push_back (pool[(size_t) idx]);
                        idx = idx > 0 ? idx - 1 : start;
                    }
                }
                else // Random, never the same note twice in a row
                {
                    int prev = -1;
                    for (int k = 0; k < counts[i]; ++k)
                    {
                        int idx = (int) (next() % (unsigned) size);
                        if (size > 1 && idx == prev) idx = (idx + 1 + (int) (next() % (unsigned) (size - 1))) % size;
                        line.push_back (pool[(size_t) idx]);
                        prev = idx;
                    }
                }
            }
            lines.push_back (line);
        }
    }

    for (size_t i = 0; i < n; ++i)
    {
        const double t0 = ph.slotStart[i];
        const auto win = song.windowFor (i);
        for (size_t k = 0; k < lines[i].size(); ++k)
        {
            PhraseNote pn;
            pn.start = t0 + (double) k * step;
            pn.length = step;
            pn.midi = lines[i][k];
            const double beatPos = pn.start - std::floor (pn.start + 1e-9);
            pn.velocity = k == 0 ? 1.0f : beatPos < 1e-6 ? 0.9f : 0.78f;
            pn.channel = 0;
            pn.slot = (int) i;
            if (auto pos = positionForMidi (song.tuning, song.numFrets, pn.midi, win))
            {
                pn.string = pos->string;
                pn.fret = pos->fret;
            }
            ph.notes.push_back (pn);
        }
        if (opts.backing > 0 && resolved[i].chordOk)
        {
            const auto voicing = backingVoicing (resolved[i].chord, song.tuning);
            const double beats = ph.slotBeats[i];
            for (double at = 0; at < beats - 1e-9; at += 2)
            {
                const bool first = at == 0;
                const double dur = std::min (2.0, beats - at);
                for (size_t k = 0; k < voicing.size(); ++k)
                {
                    PhraseNote pn;
                    pn.start = t0 + at + 0.03 * (double) k; // strum
                    pn.length = dur - 0.03 * (double) k;
                    pn.midi = voicing[k];
                    pn.velocity = first ? 0.62f : 0.48f;
                    pn.channel = 1;
                    pn.slot = (int) i;
                    ph.notes.push_back (pn);
                }
                if (opts.backing > 1)
                {
                    PhraseNote pn;
                    pn.start = t0 + at;
                    pn.length = dur * 0.96;
                    const int pc = resolved[i].chord.bass >= 0 ? resolved[i].chord.bass : resolved[i].chord.root;
                    pn.midi = 28 + mod12 (pc - 4); // E1..D♯2, below any guitar voicing
                    pn.velocity = first ? 0.75f : 0.6f;
                    pn.channel = 1;
                    pn.slot = (int) i;
                    ph.notes.push_back (pn);
                }
            }
        }
    }
    std::stable_sort (ph.notes.begin(), ph.notes.end(), [] (auto& a, auto& b) { return a.start < b.start; });
    return ph;
}
} // namespace fl
