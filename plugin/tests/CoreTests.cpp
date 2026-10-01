// Tests for the plugin's music-theory core. Besides a few hand-written checks, it compares the C++
// port with results produced by the web app (tests/vectors.txt, written by
// scripts/plugin-vectors.gen.ts), so the plugin names, parses and rates chords like the web app.
//
// Usage: fl_core_tests [vectors.txt]
#include "../Source/core/Arrangement.h"
#include "../Source/core/Arpeggios.h"
#include "../Source/core/Song.h"
#include "../Source/core/Theory.h"

#include <cmath>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>

#ifndef FL_VECTORS_PATH
 #define FL_VECTORS_PATH "tests/vectors.txt"
#endif

namespace
{
int failures = 0, checks = 0;
std::map<char, int> mismatchByKind, totalByKind;

void check (bool ok, const std::string& what)
{
    checks++;
    if (! ok)
    {
        failures++;
        std::cout << "FAIL: " << what << "\n";
    }
}

template <typename A, typename B>
void checkEq (const A& got, const B& want, const std::string& what)
{
    checks++;
    if (! (got == want))
    {
        failures++;
        std::ostringstream s;
        s << "FAIL: " << what << "\n   got:  " << got << "\n   want: " << want << "\n";
        std::cout << s.str();
    }
}

std::vector<std::string> split (const std::string& s, char sep)
{
    std::vector<std::string> out;
    size_t start = 0;
    while (true)
    {
        const size_t p = s.find (sep, start);
        out.push_back (s.substr (start, p == std::string::npos ? std::string::npos : p - start));
        if (p == std::string::npos) break;
        start = p + 1;
    }
    return out;
}

std::string jsonUnquote (const std::string& j)
{
    std::string out;
    for (size_t i = 1; i + 1 < j.size(); ++i)
    {
        char c = j[i];
        if (c != '\\')
        {
            out += c;
            continue;
        }
        c = j[++i];
        if (c == 'n') out += '\n';
        else if (c == 't') out += '\t';
        else if (c == 'r') out += '\r';
        else if (c == 'u')
        {
            const unsigned cp = (unsigned) std::stoul (j.substr (i + 1, 4), nullptr, 16);
            i += 4;
            if (cp < 0x80) out += (char) cp;
            else if (cp < 0x800)
            {
                out += (char) (0xC0 | (cp >> 6));
                out += (char) (0x80 | (cp & 0x3F));
            }
            else
            {
                out += (char) (0xE0 | (cp >> 12));
                out += (char) (0x80 | ((cp >> 6) & 0x3F));
                out += (char) (0x80 | (cp & 0x3F));
            }
        }
        else
            out += c;
    }
    return out;
}

int maskOf (const std::vector<int>& pcs)
{
    int m = 0;
    for (int p : pcs) m |= 1 << p;
    return m;
}

std::string posText (const fl::SlotPosition& p)
{
    if (p.kind == fl::SlotPosition::Global) return "global";
    if (p.kind == fl::SlotPosition::Neck) return "neck";
    return std::to_string (p.window.start) + "-" + std::to_string (p.window.end);
}

void mismatch (char kind, const std::string& line, const std::string& got)
{
    if (mismatchByKind[kind]++ < 6) std::cout << "MISMATCH [" << kind << "] " << line << "\n   got: " << got << "\n";
}

void runVectors (const std::string& path)
{
    std::ifstream in (path);
    if (! in)
    {
        check (false, "could not open vectors file " + path);
        return;
    }
    std::string line;
    while (std::getline (in, line))
    {
        if (line.empty() || line[0] == '#') continue;
        const auto f = split (line, '\t');
        const char kind = f[0][0];
        totalByKind[kind]++;
        std::string got;
        bool ok = true;
        if (kind == 'I')
        {
            std::vector<int> midis;
            for (auto& t : split (f[1], ' ')) midis.push_back (std::stoi (t));
            auto m = fl::identifyChord (midis);
            for (size_t k = 0; k < 3 && k < m.size(); ++k) got += (k ? "\t" : "") + m[k].name;
            std::string want;
            for (size_t k = 2; k < f.size(); ++k) want += (k > 2 ? "\t" : "") + f[k];
            ok = got == want;
        }
        else if (kind == 'P')
        {
            auto c = fl::parseChordSymbol (f[1]);
            if (! c) got = "!";
            else got = c->name() + "\t" + std::to_string (maskOf (c->pcs())) + "\t" + std::to_string (c->root) + "\t" + std::to_string (c->bass);
            std::string want;
            for (size_t k = 2; k < f.size(); ++k) want += (k > 2 ? "\t" : "") + f[k];
            ok = got == want;
        }
        else if (kind == 'E')
        {
            auto c = fl::parseChordSymbol (f[1]);
            if (c)
                for (auto& a : fl::exactArpeggios (*c)) got += (got.empty() ? "" : "\t") + a.name;
            std::string want;
            for (size_t k = 2; k < f.size(); ++k) want += (k > 2 ? "\t" : "") + f[k];
            ok = c && got == want;
        }
        else if (kind == 'S')
        {
            auto c = fl::parseChordSymbol (f[1]);
            std::vector<fl::Arpeggio> subs;
            if (c) subs = fl::suggestArpeggios (*c, 20);
            const size_t wantCount = f.size() > 2 && ! f[2].empty() ? f.size() - 2 : 0;
            ok = c && subs.size() == wantCount;
            for (size_t k = 0; k < subs.size(); ++k)
            {
                const auto& a = subs[k];
                std::string notes;
                for (size_t j = 0; j < a.notes.size(); ++j) notes += (j ? " " : "") + a.notes[j].name;
                char fit[32];
                std::snprintf (fit, sizeof fit, "%.4f", a.fit);
                const std::string entry = a.name + "=" + fit + "=" + a.sound + "=" + notes;
                got += (k ? "\t" : "") + entry;
                if (k + 2 < f.size())
                {
                    const auto w = split (f[k + 2], '=');
                    if (w.size() != 4 || w[0] != a.name || std::fabs (std::stod (w[1]) - a.fit) > 6e-5 || w[2] != a.sound || w[3] != notes) ok = false;
                }
            }
        }
        else if (kind == 'A')
        {
            auto c = fl::parseChordSymbol (f[1]);
            auto r = fl::parseArpInput (f[2]);
            if (! r.ok) got = "!";
            else
            {
                auto a = fl::analyzeArpeggio (*c, r.chord);
                char fit[32];
                std::snprintf (fit, sizeof fit, "%.4f", a.fit);
                got = r.chord.name() + "\t" + r.recognisedFrom + "\t" + fit + "\t" + a.sound + "\t" + a.description + "\t" + a.warning;
            }
            std::string want;
            for (size_t k = 3; k < f.size(); ++k) want += (k > 3 ? "\t" : "") + f[k];
            ok = got == want;
        }
        else if (kind == 'F')
        {
            const auto parsed = fl::parseArrangementText (jsonUnquote (f[1]));
            const auto& d = parsed.doc;
            std::string tuning;
            for (size_t k = 0; k < d.tuning.size(); ++k) tuning += (k ? " " : "") + std::to_string (d.tuning[k]);
            got = std::to_string (d.tempo.value_or (0)) + "\t" + (! d.hasPosition ? "unset" : fl::positionText (d.position)) + "\t" + tuning + "\t"
                  + std::to_string (parsed.errors.size());
            for (size_t k = 0; k < d.chords.size(); ++k)
                got += "\t" + d.chords[k] + "~" + (d.slots[k].arp.empty() ? "-" : d.slots[k].arp) + "~" + posText (d.slots[k].pos) + "~" + std::to_string (d.slots[k].beats);
            std::string want;
            for (size_t k = 2; k < f.size(); ++k) want += (k > 2 ? "\t" : "") + f[k];
            ok = got == want;
        }
        checks++;
        if (! ok)
        {
            failures++;
            mismatch (kind, line, got);
        }
    }
    for (auto& [k, total] : totalByKind)
        std::cout << "vectors [" << k << "]: " << total - mismatchByKind[k] << "/" << total << " match\n";
}

void handWritten()
{
    using namespace fl;
    // Chord identification
    checkEq (identifyChord ({ 40, 43, 47, 50 })[0].name, std::string ("Em7"), "E G B D is Em7");
    checkEq (identifyChord ({ 51, 57, 58 })[0].name, std::string ("E\xE2\x99\xAD(add\xE2\x99\xAF" "11, no3)"), "Eb A Bb");
    // Parsing round trip
    auto c = parseChordSymbol ("Eb(add#11,no3)");
    check (c.has_value(), "parse Eb(add#11,no3)");
    if (c) checkEq (c->name(), std::string ("E\xE2\x99\xAD(add\xE2\x99\xAF" "11, no3)"), "name of Eb(add#11,no3)");
    // Arpeggio input
    auto in = parseArpInput ("E G B D");
    check (in.ok && in.chord.name() == "Em7" && in.recognisedFrom == "E G B D", "E G B D typed as an arpeggio is Em7");
    // Arrangement round trip
    Song song;
    song.chords = { "Dm7", "G7", "Cmaj7" };
    song.slots = { { "Fmaj7", SlotPosition::frets (0, 4), 4 }, { "", SlotPosition::global(), 2 }, { "E G B D", SlotPosition::neck(), 8 } };
    song.tuning = { 38, 45, 50, 55, 59, 64 };
    song.tuningId = matchTuningId (song.tuning);
    checkEq (song.tuningId, std::string ("dropD"), "drop D preset");
    std::vector<ResolvedSlot> res;
    for (size_t i = 0; i < song.chords.size(); ++i) res.push_back (resolveSlot (song.chords[i], song.slotAt (i)));
    check (res[0].kind == ResolvedSlot::Kind::Suggested, "Fmaj7 is one of the suggestions over Dm7");
    check (res[2].kind != ResolvedSlot::Kind::Own && res[2].arp.name == "Em7", "E G B D over Cmaj7");
    const auto text = exportArrangementText (toDoc (song), exportInfo (song, res, "today"));
    check (text.find ("chord: Dm7 | arpeggio: Fmaj7 | position: 0-4 | length: 4") != std::string::npos, "export line 1:\n" + text);
    check (text.find ("chord: Cmaj7 | arpeggio: E G B D | position: neck | length: 8") != std::string::npos, "export line 3");
    check (text.find ("tuning: D2 A2 D3 G3 B3 E4") != std::string::npos, "export tuning");
    const auto back = parseArrangementText (text);
    check (back.errors.empty(), "re-import has no errors");
    Song song2;
    std::vector<std::string> problems;
    check (applyDoc (song2, back.doc, problems) && problems.empty(), "applyDoc without problems");
    check (song2.chords == song.chords && song2.tuning == song.tuning && song2.position == song.position, "round trip keeps chords/tuning/position");
    for (size_t i = 0; i < 3; ++i)
        check (song2.slots[i].arp == song.slots[i].arp && song2.slots[i].pos == song.slots[i].pos && song2.slots[i].beats == song.slots[i].beats,
               "round trip slot " + std::to_string (i));
    // Phrase
    PhraseOptions po;
    auto ph = buildPhrase (song, res, po);
    checkEq (ph.length, 14.0, "phrase length in beats");
    checkEq (ph.notes.size(), (size_t) 28, "eighth notes over 14 beats");
    bool inWindow = true;
    for (auto& n : ph.notes)
        if (n.slot == 0 && (n.fret < 0 || n.fret > 4)) inWindow = false;
    check (inWindow, "chord 1 is played in frets 0-4");
    for (auto pat : { Pattern::Up, Pattern::Down, Pattern::UpDown, Pattern::Random })
    {
        po.pattern = pat;
        po.backing = 2;
        auto p2 = buildPhrase (song, res, po);
        check (p2.notes.size() > 28, "pattern + backing produces notes");
    }
}
} // namespace

int main (int argc, char** argv)
{
    handWritten();
    runVectors (argc > 1 ? argv[1] : FL_VECTORS_PATH);
    std::cout << (checks - failures) << "/" << checks << " checks passed\n";
    return failures == 0 ? 0 : 1;
}
