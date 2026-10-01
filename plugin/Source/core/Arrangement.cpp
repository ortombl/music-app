#include "Arrangement.h"

#include "Theory.h"

#include <algorithm>
#include <cctype>
#include <regex>

namespace fl
{
namespace
{
std::string lower (std::string s)
{
    std::transform (s.begin(), s.end(), s.begin(), [] (unsigned char c) { return (char) std::tolower (c); });
    return s;
}

void replaceAll (std::string& s, const std::string& from, const std::string& to)
{
    size_t pos = 0;
    while ((pos = s.find (from, pos)) != std::string::npos)
    {
        s.replace (pos, from.size(), to);
        pos += to.size();
    }
}

/** Width in characters (UTF-8 code points), as the web app's [...s].length. */
size_t width (const std::string& s)
{
    size_t n = 0;
    for (unsigned char c : s)
        if ((c & 0xC0) != 0x80) n++;
    return n;
}

std::string table (const std::vector<std::string>& header, const std::vector<std::vector<std::string>>& rows)
{
    std::vector<size_t> widths;
    for (size_t c = 0; c < header.size(); ++c)
    {
        size_t w = width (header[c]);
        for (auto& r : rows) w = std::max (w, width (r[c]));
        widths.push_back (w);
    }
    auto line = [&] (const std::vector<std::string>& cells) {
        std::string s;
        for (size_t c = 0; c < cells.size(); ++c)
        {
            if (c) s += "  ";
            s += cells[c] + std::string (widths[c] > width (cells[c]) ? widths[c] - width (cells[c]) : 0, ' ');
        }
        while (! s.empty() && s.back() == ' ') s.pop_back();
        return s;
    };
    std::vector<std::string> dashes;
    for (auto w : widths) dashes.push_back (std::string (w, '-'));
    std::string out = line (header) + "\n" + line (dashes);
    for (auto& r : rows) out += "\n" + line (r);
    return out;
}

std::optional<SlotPosition> parsePosition (const std::string& v)
{
    std::string t = lower (trim (v));
    replaceAll (t, "\xE2\x80\x93", "-"); // en dash
    if (t.empty() || t == "all" || t == "same" || t == "global" || t == "same as all") return SlotPosition::global();
    if (t == "neck" || t == "whole neck" || t == "whole") return SlotPosition::neck();
    t = std::regex_replace (t, std::regex ("^frets?\\s*"), "");
    std::smatch m;
    if (std::regex_match (t, m, std::regex ("([0-9]{1,2})\\s*-\\s*([0-9]{1,2})")))
    {
        const int start = std::stoi (m[1].str()), end = std::stoi (m[2].str());
        if (end >= start) return SlotPosition::frets (start, end);
    }
    return std::nullopt;
}

std::optional<int> parseBeats (const std::string& v)
{
    const std::string t = lower (trim (v));
    std::smatch m;
    if (std::regex_match (t, std::regex ("[0-9]+"))) return std::max (1, std::min (16, std::stoi (t.substr (0, 4))));
    if (std::regex_match (t, std::regex ("(1/2|\xC2\xBD|half)( bar)?"))) return 2;
    if (std::regex_match (t, m, std::regex ("([0-9]+)\\s*bars?"))) return std::max (1, std::min (4, std::stoi (m[1].str().substr (0, 4)))) * 4;
    return std::nullopt;
}

bool allDashes (const std::string& s) { return ! s.empty() && std::all_of (s.begin(), s.end(), [] (char c) { return c == '-'; }); }
} // namespace

std::string positionText (const SlotPosition& pos)
{
    if (pos.kind == SlotPosition::Global) return "all";
    if (pos.kind == SlotPosition::Neck) return "neck";
    return std::to_string (pos.window.start) + "-" + std::to_string (pos.window.end);
}

std::string positionText (const OptWindow& win) { return win ? std::to_string (win->start) + "-" + std::to_string (win->end) : "neck"; }

std::string beatsText (int beats)
{
    if (beats == 2) return "1/2 bar";
    if (beats == 4) return "1 bar";
    if (beats % 4 == 0) return std::to_string (beats / 4) + " bars";
    return std::to_string (beats) + " beats";
}

std::string exportArrangementText (const ArrangementDoc& doc, const ExportInfo& info)
{
    std::vector<std::string> out;
    out.push_back ("FRETBOARD LAB \xE2\x80\x94 PROGRESSION & ARPEGGIOS");
    out.push_back ("Saved: " + info.date);
    out.push_back ("Key: " + info.key);
    out.push_back ("Tuning: " + info.tuning);
    out.push_back ("Tempo: " + std::to_string (info.tempo) + " BPM");
    out.push_back ("Position for all chords: " + info.position);
    out.push_back ("");
    std::vector<std::vector<std::string>> rows;
    for (size_t i = 0; i < info.rows.size(); ++i)
    {
        auto& r = info.rows[i];
        rows.push_back ({ std::to_string (i + 1), r.chord, r.roman, r.arpeggio, r.notes, r.fit, r.sound, r.position, r.length });
    }
    out.push_back (table ({ "#", "Chord", "Roman", "Arpeggio", "Notes", "Fit", "Sound", "Position", "Length" }, rows));
    out.push_back ("");
    std::string text;
    for (size_t i = 0; i < out.size(); ++i) text += out[i] + "\n";
    return text + arrangementDataText (doc);
}

std::string arrangementDataText (const ArrangementDoc& doc)
{
    std::vector<std::string> out;
    out.push_back ("[data]");
    out.push_back ("# Read by Fretboard Lab's Import button. You can edit it: one \"chord:\" line per chord, in order.");
    out.push_back ("# arpeggio: chord symbol or notes, \"-\" = the chord's own arpeggio \xC2\xB7 position: all | neck | 5-9 \xC2\xB7 length: beats (2, 4, 8)");
    if (! doc.tuning.empty()) out.push_back ("tuning: " + tuningText (doc.tuning));
    if (doc.tempo) out.push_back ("tempo: " + std::to_string (*doc.tempo));
    if (doc.hasPosition) out.push_back ("position: " + positionText (doc.position));
    for (size_t i = 0; i < doc.chords.size(); ++i)
    {
        const Slot s = i < doc.slots.size() ? doc.slots[i] : Slot {};
        out.push_back ("chord: " + toAscii (doc.chords[i]) + " | arpeggio: " + (s.arp.empty() ? "-" : toAscii (s.arp)) + " | position: " + positionText (s.pos)
                       + " | length: " + std::to_string (s.beats));
    }
    std::string text;
    for (auto& l : out) text += l + "\n";
    return text;
}

std::vector<std::string> tokenizeProgression (const std::string& text)
{
    std::vector<std::string> out;
    std::string cur;
    int depth = 0;
    for (char ch : text)
    {
        if (ch == '(') depth++;
        else if (ch == ')') depth = std::max (0, depth - 1);
        if (depth == 0 && (std::isspace ((unsigned char) ch) || ch == '|' || ch == ',' || ch == ';'))
        {
            if (! cur.empty()) out.push_back (cur);
            cur.clear();
            continue;
        }
        cur += ch;
    }
    if (! trim (cur).empty()) out.push_back (trim (cur));
    return out;
}

ParsedArrangement parseArrangementText (const std::string& textIn)
{
    std::string text = textIn;
    text.erase (std::remove (text.begin(), text.end(), '\r'), text.end());
    if (text.compare (0, 3, "\xEF\xBB\xBF") == 0) text.erase (0, 3); // UTF-8 BOM
    std::vector<std::string> all;
    {
        size_t pos = 0;
        while (true)
        {
            const size_t nl = text.find ('\n', pos);
            all.push_back (text.substr (pos, nl == std::string::npos ? std::string::npos : nl - pos));
            if (nl == std::string::npos) break;
            pos = nl + 1;
        }
    }
    int dataAt = -1;
    for (size_t i = 0; i < all.size(); ++i)
        if (lower (trim (all[i])) == "[data]")
        {
            dataAt = (int) i;
            break;
        }

    ParsedArrangement r;
    auto& doc = r.doc;
    std::vector<std::string> loose;
    static const std::regex reComment ("\\s#.*$"), reArrow ("^(.+?)\\s*(?:->|=>|\xE2\x86\x92)\\s*(.+)$"), reChordLine ("^chord\\s*:.*", std::regex::icase),
        rePart ("^\\s*([a-zA-Z]+)\\s*:\\s*(.*?)\\s*$"), reKv ("^([a-zA-Z]+)\\s*:\\s*(.*)$");
    for (size_t n = dataAt >= 0 ? (size_t) dataAt + 1 : 0; n < all.size(); ++n)
    {
        const std::string line = trim (std::regex_replace (all[n], reComment, ""));
        if (line.empty() || line[0] == '#') continue;
        const std::string lineNo = std::to_string (n + 1);
        std::smatch m;
        const bool hasBar = line.find ('|') != std::string::npos;
        if (! hasBar && std::regex_match (line, m, reArrow))
        {
            doc.chords.push_back (trim (m[1].str()));
            Slot s;
            const std::string a = trim (m[2].str());
            s.arp = allDashes (a) ? "" : a;
            doc.slots.push_back (s);
            continue;
        }
        if (hasBar && std::regex_match (line, reChordLine))
        {
            Slot slot;
            std::string chord;
            size_t start = 0;
            while (start <= line.size())
            {
                size_t bar = line.find ('|', start);
                const std::string part = line.substr (start, bar == std::string::npos ? std::string::npos : bar - start);
                std::smatch pm;
                if (std::regex_match (part, pm, rePart))
                {
                    const std::string k = lower (pm[1].str()), v = pm[2].str();
                    if (k == "chord") chord = v;
                    else if (k == "arpeggio" || k == "arp") slot.arp = v.empty() || allDashes (v) ? "" : v;
                    else if (k == "position" || k == "pos")
                    {
                        if (auto p = parsePosition (v)) slot.pos = *p;
                        else r.errors.push_back ("Line " + lineNo + ": position \"" + v + "\" not understood (use all, neck or e.g. 5-9).");
                    }
                    else if (k == "length" || k == "beats")
                    {
                        if (auto b = parseBeats (v)) slot.beats = *b;
                        else r.errors.push_back ("Line " + lineNo + ": length \"" + v + "\" not understood (use beats, e.g. 4).");
                    }
                }
                if (bar == std::string::npos) break;
                start = bar + 1;
            }
            if (chord.empty()) r.errors.push_back ("Line " + lineNo + ": missing \"chord:\".");
            else
            {
                doc.chords.push_back (chord);
                doc.slots.push_back (slot);
            }
            continue;
        }
        if (std::regex_match (line, m, reKv))
        {
            const std::string k = lower (m[1].str()), v = trim (m[2].str());
            if (k == "tempo")
            {
                std::smatch tm;
                const int t = std::regex_search (v, tm, std::regex ("^[0-9]{1,4}")) ? std::stoi (tm[0].str()) : 0;
                if (t >= 30 && t <= 300) doc.tempo = t;
                else r.errors.push_back ("Line " + lineNo + ": tempo \"" + v + "\" should be 30\xE2\x80\x93" "300.");
            }
            else if (k == "position")
            {
                auto p = parsePosition (v);
                if (! p) r.errors.push_back ("Line " + lineNo + ": position \"" + v + "\" not understood.");
                else
                {
                    doc.hasPosition = true;
                    doc.position = p->kind == SlotPosition::Window ? OptWindow (p->window) : std::nullopt;
                }
            }
            else if (k == "tuning")
            {
                std::vector<int> notes;
                bool ok = true;
                std::string tok;
                for (size_t i = 0; i <= v.size(); ++i)
                {
                    const char c = i < v.size() ? v[i] : ' ';
                    if (std::isspace ((unsigned char) c) || c == ',')
                    {
                        if (! tok.empty())
                        {
                            if (auto mm = parseMidiName (tok)) notes.push_back (*mm);
                            else ok = false;
                            tok.clear();
                        }
                    }
                    else
                        tok += c;
                }
                if (ok && notes.size() >= 3) doc.tuning = notes;
                else if (dataAt >= 0)
                    r.errors.push_back ("Line " + lineNo + ": tuning \"" + v + "\" not understood (use notes with octaves, e.g. E2 A2 D3 G3 B3 E4).");
            }
            else if (k == "chord")
            {
                doc.chords.push_back (v);
                doc.slots.push_back ({});
            }
            // other "key: value" lines (Key:, Saved:, …) are informational
            continue;
        }
        loose.push_back (line);
    }
    if (doc.chords.empty())
        for (auto& l : loose)
            for (auto& tok : tokenizeProgression (l))
            {
                doc.chords.push_back (tok);
                doc.slots.push_back ({});
            }
    return r;
}
} // namespace fl
