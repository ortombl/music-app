#include "Theory.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <map>
#include <regex>
#include <set>

namespace fl
{
namespace
{
struct ChordDef
{
    const char* id;
    const char* symbol;
    const char* name;
    std::vector<std::string> degrees;
    std::vector<std::string> optional;
    double prior;
    std::vector<std::string> aliases;
    bool parseOnly;
    const char* family;
    std::vector<std::string> scales;
};
struct ScaleDef
{
    const char* id;
    const char* name;
    std::vector<std::string> degrees;
    double prior;
};
struct TuningDef
{
    const char* id;
    const char* name;
    const char* group;
    std::vector<int> strings;
};
#include "GeneratedTables.inc"

const int kLetterPc[7] = { 0, 2, 4, 5, 7, 9, 11 };
const char* kLetters = "CDEFGAB";
const int kMajorSteps[7] = { 0, 2, 4, 5, 7, 9, 11 };

bool contains (const std::vector<std::string>& v, const std::string& x) { return std::find (v.begin(), v.end(), x) != v.end(); }

void replaceAll (std::string& s, const std::string& from, const std::string& to)
{
    if (from.empty()) return;
    size_t pos = 0;
    while ((pos = s.find (from, pos)) != std::string::npos)
    {
        s.replace (pos, from.size(), to);
        pos += to.size();
    }
}

int maskOfLabels (const std::vector<std::string>& labels)
{
    int m = 0;
    for (auto& l : labels) m |= 1 << degreeSemi (l);
    return m;
}

std::shared_ptr<ChordType> finish (ChordType t)
{
    auto p = std::make_shared<ChordType> (std::move (t));
    p->mask = maskOfLabels (p->degrees);
    std::vector<std::string> req;
    for (auto& d : p->degrees)
        if (! contains (p->optional, d)) req.push_back (d);
    p->requiredMask = maskOfLabels (req);
    return p;
}
} // namespace

// ---- Notes ------------------------------------------------------------------------------------
int pcOf (Spelled n) { return mod12 (kLetterPc[n.letter] + n.acc); }

std::string formatNote (Spelled n)
{
    std::string s (1, kLetters[n.letter]);
    for (int i = 0; i < n.acc; ++i) s += "\xE2\x99\xAF"; // ♯
    for (int i = 0; i < -n.acc; ++i) s += "\xE2\x99\xAD"; // ♭
    return s;
}

std::optional<Spelled> spellWithLetter (int pc, int letter)
{
    const int l = ((letter % 7) + 7) % 7;
    int acc = mod12 (pc - kLetterPc[l]);
    if (acc > 5) acc -= 12;
    if (std::abs (acc) > 2) return std::nullopt;
    return Spelled { l, acc };
}

namespace
{
const Spelled kSharpSpell[12] = { { 0, 0 }, { 0, 1 }, { 1, 0 }, { 1, 1 }, { 2, 0 }, { 3, 0 }, { 3, 1 }, { 4, 0 }, { 4, 1 }, { 5, 0 }, { 5, 1 }, { 6, 0 } };
const Spelled kFlatSpell[12] = { { 0, 0 }, { 1, -1 }, { 1, 0 }, { 2, -1 }, { 2, 0 }, { 3, 0 }, { 4, -1 }, { 4, 0 }, { 5, -1 }, { 5, 0 }, { 6, -1 }, { 6, 0 } };
const Spelled kCommonSpell[12] = { { 0, 0 }, { 0, 1 }, { 1, 0 }, { 2, -1 }, { 2, 0 }, { 3, 0 }, { 3, 1 }, { 4, 0 }, { 5, -1 }, { 5, 0 }, { 6, -1 }, { 6, 0 } };
} // namespace

Spelled defaultSpelling (int pc, int pref)
{
    const int p = mod12 (pc);
    return pref > 0 ? kSharpSpell[p] : pref < 0 ? kFlatSpell[p] : kCommonSpell[p];
}

std::string pcName (int pc) { return formatNote (defaultSpelling (pc)); }

std::string midiName (int midi)
{
    static const char* names[12] = { "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B" };
    return std::string (names[mod12 (midi)]) + std::to_string ((int) std::floor (midi / 12.0) - 1);
}

std::optional<ParsedNote> parseNoteName (const std::string& s, size_t pos)
{
    if (pos >= s.size()) return std::nullopt;
    const char c = (char) std::toupper ((unsigned char) s[pos]);
    const char* f = std::strchr (kLetters, c);
    if (c == 0 || f == nullptr) return std::nullopt;
    Spelled n { (int) (f - kLetters), 0 };
    size_t i = pos + 1;
    for (int k = 0; k < 2 && i < s.size(); ++k)
    {
        if (s[i] == '#') { n.acc++; i++; }
        else if (s[i] == 'b') { n.acc--; i++; }
        else if (s[i] == 'x') { n.acc += 2; i++; }
        else if (s.compare (i, 3, "\xE2\x99\xAF") == 0) { n.acc++; i += 3; }
        else if (s.compare (i, 3, "\xE2\x99\xAD") == 0) { n.acc--; i += 3; }
        else break;
    }
    return ParsedNote { n, i - pos };
}

std::optional<int> parseMidiName (const std::string& s)
{
    const std::string t = trim (s);
    auto n = parseNoteName (t);
    if (! n) return std::nullopt;
    const std::string rest = t.substr (n->length);
    if (rest.empty() || ! std::regex_match (rest, std::regex ("-?[0-9]"))) return std::nullopt;
    const int octave = std::stoi (rest);
    return (octave + 1) * 12 + kLetterPc[n->note.letter] + n->note.acc;
}

// ---- Degrees ----------------------------------------------------------------------------------
namespace
{
struct DegreeInfo
{
    int num = 1, step = 0, semi = 0, acc = 0;
};
DegreeInfo parseDegree (const std::string& label)
{
    DegreeInfo d;
    size_t i = 0;
    if (label.compare (0, 2, "bb") == 0) { d.acc = -2; i = 2; }
    else if (label.compare (0, 2, "##") == 0) { d.acc = 2; i = 2; }
    else if (! label.empty() && label[0] == 'b') { d.acc = -1; i = 1; }
    else if (! label.empty() && label[0] == '#') { d.acc = 1; i = 1; }
    d.num = std::max (1, std::atoi (label.c_str() + i));
    d.step = (d.num - 1) % 7;
    d.semi = mod12 (kMajorSteps[d.step] + d.acc);
    return d;
}
} // namespace

int degreeNum (const std::string& label) { return parseDegree (label).num; }
int degreeStep (const std::string& label) { return parseDegree (label).step; }
int degreeSemi (const std::string& label) { return parseDegree (label).semi; }

std::string prettyDegree (const std::string& label)
{
    std::string s = label;
    replaceAll (s, "b", "\xE2\x99\xAD");
    replaceAll (s, "#", "\xE2\x99\xAF");
    return s;
}

std::string labelInChord (int semi, const std::vector<std::string>& d)
{
    const int s = mod12 (semi);
    for (auto& l : d)
        if (degreeSemi (l) == s) return l;
    const bool major3 = contains (d, "3"), perfect5 = contains (d, "5");
    const bool seventh = contains (d, "7") || contains (d, "b7") || contains (d, "bb7");
    switch (s)
    {
        case 0: return "1";
        case 1: return "b9";
        case 2: return "9";
        case 3: return major3 ? "#9" : "b3";
        case 4: return "3";
        case 5: return contains (d, "b3") || major3 ? "11" : "4";
        case 6: return perfect5 || major3 ? "#11" : "b5";
        case 7: return "5";
        case 8: return major3 && ! perfect5 && ! contains (d, "b5") ? "#5" : "b13";
        case 9: return seventh ? "13" : "6";
        case 10: return "b7";
        default: return "7";
    }
}

// ---- Chord types --------------------------------------------------------------------------------
const std::vector<ChordTypePtr>& chordTypes()
{
    static const std::vector<ChordTypePtr> types = [] {
        std::vector<ChordTypePtr> v;
        for (auto& d : kChordDefs)
        {
            ChordType t;
            t.id = d.id;
            t.symbol = d.symbol;
            t.name = d.name;
            t.degrees = d.degrees;
            t.optional = d.optional;
            t.prior = d.prior;
            t.aliases = d.aliases;
            t.parseOnly = d.parseOnly;
            t.family = d.family;
            t.scales = d.scales;
            v.push_back (finish (std::move (t)));
        }
        return v;
    }();
    return types;
}

ChordTypePtr chordTypeById (const std::string& id)
{
    for (auto& t : chordTypes())
        if (t->id == id) return t;
    return nullptr;
}

const std::vector<ScaleType>& scaleTypes()
{
    static const std::vector<ScaleType> v = [] {
        std::vector<ScaleType> r;
        for (auto& d : kScaleDefs)
        {
            ScaleType s;
            s.id = d.id;
            s.name = d.name;
            s.degrees = d.degrees;
            s.prior = d.prior;
            for (auto& l : s.degrees) s.semis.push_back (degreeSemi (l));
            r.push_back (std::move (s));
        }
        return r;
    }();
    return v;
}

const ScaleType* scaleById (const std::string& id)
{
    for (auto& s : scaleTypes())
        if (s.id == id) return &s;
    return nullptr;
}

std::vector<int> scalePcs (int rootPc, const std::string& id)
{
    std::vector<int> out;
    if (auto* s = scaleById (id))
        for (int semi : s->semis) out.push_back (mod12 (rootPc + semi));
    return out;
}

const std::vector<Tuning>& tunings()
{
    static const std::vector<Tuning> v = [] {
        std::vector<Tuning> r;
        for (auto& d : kTuningDefs) r.push_back ({ d.id, d.name, d.group, d.strings });
        return r;
    }();
    return v;
}

namespace
{
const std::map<std::string, ChordTypePtr>& aliasMap()
{
    static const std::map<std::string, ChordTypePtr> m = [] {
        std::map<std::string, ChordTypePtr> r;
        for (auto& t : chordTypes())
            for (auto a : t->aliases)
            {
                if (a == "M") a = "maj";
                std::transform (a.begin(), a.end(), a.begin(), [] (unsigned char c) { return (char) std::tolower (c); });
                r.emplace (a, t); // first alias wins, like the web app
            }
        return r;
    }();
    return m;
}

int orderKey (const std::string& l)
{
    auto d = parseDegree (l);
    return d.num * 10 + d.acc;
}

ChordTypePtr exactDictionary (int mask)
{
    ChordTypePtr best;
    for (auto& t : chordTypes())
        if (! t->parseOnly && t->mask == mask && (! best || t->prior > best->prior)) best = t;
    return best;
}

struct Modifier
{
    enum Kind { Add, Alt, No } kind;
    std::string label;
};

bool isSeventhLike (const ChordType& t)
{
    for (auto& d : t.degrees)
        if (d == "7" || d == "b7" || d == "bb7" || d == "6") return true;
    return false;
}

std::string formatSymbol (const ChordType& base, std::vector<Modifier> mods)
{
    if (mods.empty()) return base.symbol;
    std::vector<Modifier> changes, omits;
    for (auto& m : mods) (m.kind == Modifier::No ? omits : changes).push_back (m);
    auto byOrder = [] (const Modifier& a, const Modifier& b) { return orderKey (a.label) < orderKey (b.label); };
    std::sort (changes.begin(), changes.end(), byOrder);
    std::sort (omits.begin(), omits.end(), byOrder);
    const bool seventh = isSeventhLike (base);
    std::vector<std::string> present = base.degrees;
    for (auto& c : changes) present.push_back (c.label);
    auto sameNum = [&] (const std::string& label) {
        const std::string natural = std::to_string (degreeNum (label));
        return label != natural && contains (present, natural);
    };
    std::vector<std::string> parts;
    for (auto& m : changes)
    {
        const bool plain = m.kind == Modifier::Alt || (seventh && degreeNum (m.label) >= 9 && ! sameNum (m.label));
        parts.push_back ((plain ? "" : "add") + prettyDegree (m.label));
    }
    for (auto& m : omits)
    {
        bool clash = false;
        for (auto& c : changes)
            if (degreeNum (c.label) == degreeNum (m.label)) clash = true;
        parts.push_back ("no" + (clash ? prettyDegree (m.label) : std::to_string (degreeNum (m.label))));
    }
    std::string joined;
    for (size_t i = 0; i < parts.size(); ++i) joined += (i ? ", " : "") + parts[i];
    if (! base.symbol.empty() && base.symbol.back() == ')') return base.symbol.substr (0, base.symbol.size() - 1) + ", " + joined + ")";
    return base.symbol + "(" + joined + ")";
}

std::string deriveFamily (const std::vector<std::string>& labels)
{
    auto has = [&] (const char* l) { return contains (labels, l); };
    if (has ("3"))
    {
        if (has ("b7")) return "dominant";
        if (has ("#5") && ! has ("5")) return "augmented";
        return "major";
    }
    if (has ("b3"))
    {
        if (has ("b5") && ! has ("5")) return has ("b7") ? "half-diminished" : "diminished";
        return "minor";
    }
    if (has ("4") || has ("2")) return "suspended";
    return "power";
}

std::vector<std::string> deriveScales (const std::vector<std::string>& labels)
{
    static const std::vector<std::string> preference { "ionian", "aeolian", "dorian", "mixolydian", "lydian", "phrygian", "majorPentatonic", "minorPentatonic", "blues",
                                                       "harmonicMinor", "melodicMinor", "lydianDominant", "phrygianDominant", "mixolydianB6", "locrian", "locrianNat2",
                                                       "altered", "dimHW", "dimWH", "wholeTone", "lydianAugmented" };
    auto rank = [&] (const std::string& id) {
        auto it = std::find (preference.begin(), preference.end(), id);
        return it == preference.end() ? 100 : (int) (it - preference.begin());
    };
    std::vector<std::string> out;
    for (auto& s : scaleTypes())
    {
        bool all = true;
        for (auto& l : labels)
            if (std::find (s.semis.begin(), s.semis.end(), degreeSemi (l)) == s.semis.end()) all = false;
        if (all) out.push_back (s.id);
    }
    std::stable_sort (out.begin(), out.end(), [&] (auto& a, auto& b) { return rank (a) < rank (b); });
    return out;
}

ChordTypePtr makeCustomType (const ChordTypePtr& base, const std::vector<Modifier>& mods)
{
    std::vector<std::string> omits, alts, adds;
    for (auto& m : mods) (m.kind == Modifier::No ? omits : m.kind == Modifier::Alt ? alts : adds).push_back (m.label);
    std::vector<std::string> labels;
    std::set<int> seen;
    auto push = [&] (const std::string& l) {
        if (seen.insert (degreeSemi (l)).second) labels.push_back (l);
    };
    for (auto& d : base->degrees)
        if (! contains (omits, d) && ! (! alts.empty() && d == "5")) push (d);
    for (auto& l : alts) push (l);
    for (auto& l : adds) push (l);
    std::sort (labels.begin(), labels.end(), [] (auto& a, auto& b) { return orderKey (a) < orderKey (b); });
    const int mask = maskOfLabels (labels);
    if (auto canonical = exactDictionary (mask)) return canonical;
    if (mods.empty()) return base;
    ChordType t;
    t.id = "custom:" + base->id;
    for (auto& m : mods) t.id += std::string (m.kind == Modifier::Add ? "+" : m.kind == Modifier::Alt ? "~" : "-") + m.label;
    t.symbol = formatSymbol (*base, mods);
    static const std::map<int, std::string> ordinals { { 1, "root" }, { 2, "2nd" }, { 3, "3rd" }, { 4, "4th" }, { 5, "5th" }, { 6, "6th" }, { 7, "7th" }, { 9, "9th" }, { 11, "11th" }, { 13, "13th" } };
    std::string addText;
    for (auto* list : { &alts, &adds })
        for (auto& l : *list) addText += (addText.empty() ? "" : ", ") + prettyDegree (l);
    t.name = base->name + (addText.empty() ? "" : " with " + addText);
    for (auto& o : omits) t.name += ", no " + (ordinals.count (degreeNum (o)) ? ordinals.at (degreeNum (o)) : o);
    t.degrees = labels;
    for (auto& o : base->optional)
        if (contains (labels, o)) t.optional.push_back (o);
    t.prior = 0.2;
    t.family = deriveFamily (labels);
    t.scales = deriveScales (labels);
    return finish (std::move (t));
}

double nameCost (const ChordType& base, int adds, int alts, int named, int silent, bool hasMods, bool namedMinorThird)
{
    double cost = adds * 1.0 + alts * 0.9 + named * 1.3 + silent * 0.15 + std::max (0, adds - 2) * 0.5 + 1.5 * (1 - base.prior);
    if (base.id == "5" && hasMods) cost += 1.1;
    if (namedMinorThird) cost += 0.6;
    return cost;
}
} // namespace

GenericName nameFromSemis (int mask, bool exact)
{
    const int m = mask | 1;
    if (auto t = exactDictionary (m)) return { t, {}, 1.5 * (1 - t->prior) };
    double bestCost = 1e9;
    ChordTypePtr bestBase;
    std::vector<Modifier> bestMods;
    std::vector<std::string> bestSilent;
    for (auto& base : chordTypes())
    {
        if (base->parseOnly) continue;
        std::vector<int> addSemis;
        for (int s = 1; s < 12; ++s)
            if ((m & (1 << s)) && ! (base->mask & (1 << s))) addSemis.push_back (s);
        std::vector<std::string> absent;
        for (auto& d : base->degrees)
            if (degreeSemi (d) != 0 && ! (m & (1 << degreeSemi (d)))) absent.push_back (d);
        std::vector<Modifier> mods;
        int alts = 0;
        if (contains (absent, "5"))
        {
            int alt = -1;
            if (std::find (addSemis.begin(), addSemis.end(), 6) != addSemis.end()) alt = 6;
            else if (std::find (addSemis.begin(), addSemis.end(), 8) != addSemis.end() && ! contains (base->degrees, "b13")) alt = 8;
            if (alt >= 0)
            {
                mods.push_back ({ Modifier::Alt, alt == 6 ? "b5" : "#5" });
                addSemis.erase (std::find (addSemis.begin(), addSemis.end(), alt));
                absent.erase (std::find (absent.begin(), absent.end(), "5"));
                alts = 1;
            }
        }
        std::vector<std::string> named, silent;
        for (auto& l : absent) (exact || ! contains (base->optional, l) ? named : silent).push_back (l);
        for (int s : addSemis) mods.push_back ({ Modifier::Add, labelInChord (s, base->degrees) });
        for (auto& l : named) mods.push_back ({ Modifier::No, l });
        const double cost = nameCost (*base, (int) addSemis.size(), alts, (int) named.size(), (int) silent.size(), ! mods.empty(), contains (named, "b3"));
        if (cost < bestCost - 1e-9)
        {
            bestCost = cost;
            bestBase = base;
            bestMods = mods;
            bestSilent = silent;
        }
    }
    return { makeCustomType (bestBase, bestMods), bestSilent, bestCost };
}

ChordTypePtr nameOverRoot (int rootPc, const std::vector<int>& pcs)
{
    int mask = 1; // the root is implied by the underlying chord
    for (int p : pcs) mask |= 1 << mod12 (p - rootPc);
    ChordTypePtr best;
    double bestScore = -1e18;
    for (auto& t : chordTypes())
    {
        if (t->parseOnly || (mask & t->requiredMask) != t->requiredMask || (mask & ~t->mask) != 0) continue;
        int omitted = 0;
        for (auto& d : t->degrees)
            if (! (mask & (1 << degreeSemi (d)))) omitted++;
        const double s = 100 * t->prior - 14 * omitted;
        if (s > bestScore)
        {
            bestScore = s;
            best = t;
        }
    }
    return best;
}

// ---- Chords -------------------------------------------------------------------------------------
namespace
{
Spelled chooseRootSpelling (int rootPc, const ChordType& t)
{
    const int p = mod12 (rootPc);
    const Spelled s = kSharpSpell[p], f = kFlatSpell[p];
    if (s.letter == f.letter) return s;
    const bool preferFlat = p == 1 || p == 3 || p == 8 || p == 10; // D♭ E♭ A♭ B♭ over C♯ D♯ G♯ A♯
    Spelled best = s;
    double bestCost = 1e18;
    for (const Spelled& c : { s, f })
    {
        double cost = 0;
        for (auto& d : t.degrees)
        {
            const int pc = mod12 (p + degreeSemi (d));
            const int a = std::abs (spellWithLetter (pc, c.letter + degreeStep (d)).value_or (defaultSpelling (pc)).acc);
            cost += a + (a > 1 ? 3 : 0);
        }
        const double tieBreak = (c.acc < 0) == preferFlat ? -0.1 : 0;
        if (cost + tieBreak < bestCost)
        {
            bestCost = cost + tieBreak;
            best = c;
        }
    }
    return best;
}
} // namespace

std::vector<int> Chord::pcs() const
{
    std::vector<int> out;
    if (! type) return out;
    for (auto& d : type->degrees) out.push_back (mod12 (root + degreeSemi (d)));
    if (bass >= 0 && std::find (out.begin(), out.end(), bass) == out.end()) out.push_back (bass);
    return out;
}

Spelled Chord::spelledRoot() const { return rootSpelling ? *rootSpelling : chooseRootSpelling (root, *type); }

std::vector<std::string> Chord::toneNames() const
{
    std::vector<std::string> out;
    const Spelled r = spelledRoot();
    for (auto& d : type->degrees)
    {
        const int pc = mod12 (root + degreeSemi (d));
        out.push_back (formatNote (spellWithLetter (pc, r.letter + degreeStep (d)).value_or (defaultSpelling (pc))));
    }
    return out;
}

std::string Chord::name() const
{
    if (! type) return "?";
    const Spelled r = spelledRoot();
    std::string s = formatNote (r) + type->symbol;
    if (bass >= 0 && bass != root)
    {
        std::optional<Spelled> b;
        for (auto& d : type->degrees)
            if (mod12 (root + degreeSemi (d)) == bass)
                if (auto sp = spellWithLetter (bass, r.letter + degreeStep (d)); sp && std::abs (sp->acc) < 2) b = sp;
        s += "/" + formatNote (b.value_or (defaultSpelling (bass, r.acc < 0 ? -1 : r.acc > 0 ? 1 : 0)));
    }
    return s;
}

// ---- Parsing ------------------------------------------------------------------------------------
std::string trim (const std::string& s)
{
    size_t a = 0, b = s.size();
    while (a < b && std::isspace ((unsigned char) s[a])) ++a;
    while (b > a && std::isspace ((unsigned char) s[b - 1])) --b;
    return s.substr (a, b - a);
}

std::string toAscii (const std::string& in)
{
    std::string s = in;
    replaceAll (s, "\xE2\x99\xAD", "b");
    replaceAll (s, "\xE2\x99\xAF", "#");
    replaceAll (s, "\xE2\x80\x93", "-");
    return s;
}

namespace
{
std::string normaliseQuality (const std::string& raw)
{
    std::string q = trim (raw);
    replaceAll (q, "\xE2\x99\xAF", "#");     // ♯
    replaceAll (q, "\xE2\x99\xAD", "b");     // ♭
    replaceAll (q, "\xE2\x88\x92", "-");     // −
    replaceAll (q, "\xE2\x80\x93", "-");     // –
    for (const char* tri : { "\xCE\x94", "\xE2\x96\xB3", "\xE2\x88\x86" }) // Δ △ ∆
    {
        size_t pos;
        while ((pos = q.find (tri)) != std::string::npos)
        {
            const size_t len = std::strlen (tri);
            const bool digit = pos + len < q.size() && std::isdigit ((unsigned char) q[pos + len]);
            q.replace (pos, len, digit ? "maj" : "maj7");
        }
    }
    replaceAll (q, "\xC3\xB8" "7", "m7b5"); // ø7
    replaceAll (q, "\xC3\xB8", "m7b5");     // ø
    replaceAll (q, "\xC2\xB0", "dim");      // °
    replaceAll (q, "\xC2\xBA", "dim");      // º
    q.erase (std::remove_if (q.begin(), q.end(), [] (unsigned char c) { return std::isspace (c) || c == '(' || c == ')'; }), q.end());
    for (const char* m : { "MAJ", "Maj", "MA", "Ma" }) replaceAll (q, m, "maj");
    q = std::regex_replace (q, std::regex ("^mM"), "mmaj");
    q = std::regex_replace (q, std::regex ("^M(?=[0-9]|$|#|b|add)"), "maj");
    std::transform (q.begin(), q.end(), q.begin(), [] (unsigned char c) { return (char) std::tolower (c); });
    q = std::regex_replace (q, std::regex ("^min(?!or)"), "m");
    q = std::regex_replace (q, std::regex ("^mi(?!n)"), "m");
    q = std::regex_replace (q, std::regex ("^minor"), "m");
    q = std::regex_replace (q, std::regex ("^major"), "maj");
    q = std::regex_replace (q, std::regex ("^-"), "m");
    q = std::regex_replace (q, std::regex ("(^|[0-9,])\\+(5|9|11|13)"), "$1#$2");
    q = std::regex_replace (q, std::regex ("([0-9,])-(5|9|11|13)"), "$1b$2");
    q = std::regex_replace (q, std::regex ("^\\+(?=[0-9]|$)"), "aug");
    q = std::regex_replace (q, std::regex ("^o7$"), "dim7");
    q = std::regex_replace (q, std::regex ("^o$"), "dim");
    q = std::regex_replace (q, std::regex ("maj7add9|maj7/9"), "maj9", std::regex_constants::format_first_only);
    q = std::regex_replace (q, std::regex ("^7/9$"), "9");
    return q;
}

const std::set<int> kAddable { 2, 3, 4, 5, 6, 7, 9, 11, 13 };
int slotOf (int num) { return ((num - 1) % 7) + 1; }

/** Apply "add#11", "no3", "b9", "13", "sus4" … tokens to a base chord; returns the mask or -1. */
int applyModifiers (const ChordType& base, const std::string& text, bool implicitBase)
{
    std::map<int, std::string> tones;
    for (auto& d : base.degrees) tones[degreeSemi (d)] = d;
    auto add = [&] (const std::string& label) { tones.emplace (degreeSemi (label), label); };
    auto removeWhere = [&] (const std::function<bool (const std::string&)>& pred) {
        for (auto it = tones.begin(); it != tones.end();)
            it = (it->first != 0 && pred (it->second)) ? tones.erase (it) : std::next (it);
    };
    std::vector<std::function<void()>> omissions, ops;
    std::smatch m;
    std::string s = text;
    int tokens = 0;
    static const std::regex reAdd ("^add(bb|b|#)?([0-9]{1,2})"), reNo ("^(?:no|omit)(bb|b|#)?([0-9]{1,2})"), reSus ("^sus(2|4)?"),
        reAlt ("^(bb|b|#)([0-9]{1,2})"), rePlain ("^([0-9]{1,2})");
    while (! s.empty())
    {
        if (s[0] == ',')
        {
            s.erase (0, 1);
            continue;
        }
        if (std::regex_search (s, m, reAdd))
        {
            const int num = std::stoi (m[2].str());
            if (! kAddable.count (num)) return -1;
            const std::string label = m[1].str() + m[2].str();
            ops.push_back ([&, label] { add (label); });
        }
        else if (std::regex_search (s, m, reNo))
        {
            const int num = std::stoi (m[2].str());
            if (num == 1 || ! kAddable.count (num)) return -1;
            const std::string exactLabel = m[1].matched ? m[1].str() + m[2].str() : "";
            omissions.push_back ([&, num, exactLabel] {
                removeWhere ([&] (const std::string& l) { return exactLabel.empty() ? slotOf (degreeNum (l)) == slotOf (num) : l == exactLabel; });
            });
        }
        else if (std::regex_search (s, m, reSus))
        {
            const bool two = m[1].matched && m[1].str() == "2";
            ops.push_back ([&, two] {
                removeWhere ([] (const std::string& l) { return degreeNum (l) == 3; });
                add (two ? "2" : "4");
            });
        }
        else if (std::regex_search (s, m, reAlt))
        {
            const int num = std::stoi (m[2].str());
            if (! kAddable.count (num)) return -1;
            const std::string label = m[1].str() + m[2].str();
            const std::string natural = std::to_string (num);
            ops.push_back ([&, label, natural] {
                removeWhere ([&] (const std::string& l) { return l == natural; });
                add (label);
            });
        }
        else if (! (implicitBase && tokens == 0) && std::regex_search (s, m, rePlain)
                 && std::set<int> { 2, 4, 6, 9, 11, 13 }.count (std::stoi (m[1].str())))
        {
            const std::string label = m[1].str();
            ops.push_back ([&, label] { add (label); });
        }
        else
            return -1;
        s.erase (0, (size_t) m.length (0));
        tokens++;
    }
    if (tokens == 0) return -1;
    for (auto& o : omissions) o();
    for (auto& o : ops) o();
    int mask = 1;
    for (auto& [semi, l] : tones) mask |= 1 << semi;
    return mask;
}

ChordTypePtr lookupQuality (const std::string& raw)
{
    const std::string q = normaliseQuality (raw);
    auto& am = aliasMap();
    if (auto it = am.find (q); it != am.end()) return it->second;
    if (q == "aug5") return am.at ("aug");
    if (q == "sus24") return am.at ("sus2");
    for (int len = (int) q.size() - 1; len >= 0; --len)
    {
        ChordTypePtr base;
        if (len == 0) base = chordTypeById ("maj");
        else if (auto it = am.find (q.substr (0, (size_t) len)); it != am.end()) base = it->second;
        if (! base || base->parseOnly) continue;
        const int mask = applyModifiers (*base, q.substr ((size_t) len), len == 0);
        if (mask >= 0) return nameFromSemis (mask, true).type;
    }
    return nullptr;
}
} // namespace

std::optional<Chord> parseChordSymbol (const std::string& input)
{
    const std::string s = trim (input);
    auto root = parseNoteName (s);
    if (! root) return std::nullopt;
    std::string rest = s.substr (root->length);
    std::optional<ParsedNote> bass;
    if (auto slash = rest.rfind ('/'); slash != std::string::npos)
    {
        auto b = parseNoteName (rest, slash + 1);
        if (b && slash + 1 + b->length == rest.size())
        {
            bass = b;
            rest = rest.substr (0, slash);
        }
    }
    auto type = lookupQuality (rest);
    if (! type) return std::nullopt;
    Chord c;
    c.root = pcOf (root->note);
    c.type = type;
    c.rootSpelling = root->note;
    if (bass && pcOf (bass->note) != c.root) c.bass = pcOf (bass->note);
    return c;
}

// ---- Identification -----------------------------------------------------------------------------
std::vector<ChordMatch> identifyChord (const std::vector<int>& midis)
{
    std::vector<ChordMatch> out;
    if (midis.empty()) return out;
    std::vector<int> pcs;
    for (int m : midis)
        if (std::find (pcs.begin(), pcs.end(), mod12 (m)) == pcs.end()) pcs.push_back (mod12 (m));
    if (pcs.size() < 2) return out;
    const int bassPc = mod12 (*std::min_element (midis.begin(), midis.end()));
    static const std::map<std::string, double> bassBonus { { "1", 40 }, { "3", 10 }, { "b3", 10 }, { "5", 6 }, { "b5", 3 }, { "#5", 3 }, { "b7", 4 }, { "7", 3 }, { "bb7", 3 }, { "6", 2 } };
    auto maskFrom = [] (const std::vector<int>& set, int root) {
        int m = 0;
        for (int p : set) m |= 1 << mod12 (p - root);
        return m;
    };
    auto omittedCount = [] (const ChordType& t, int mask) {
        int n = 0;
        for (auto& d : t.degrees)
            if (! (mask & (1 << degreeSemi (d)))) n++;
        return n;
    };
    auto bassLabelOf = [&] (const ChordType& t, int root) -> std::string {
        for (auto& d : t.degrees)
            if (mod12 (root + degreeSemi (d)) == bassPc) return d;
        return "";
    };
    for (int root : pcs)
    {
        const int mask = maskFrom (pcs, root);
        for (auto& t : chordTypes())
        {
            if (t->parseOnly || (mask & t->requiredMask) != t->requiredMask || (mask & ~t->mask) != 0) continue;
            const auto bl = bassLabelOf (*t, root);
            Chord c { root, t, bassPc == root ? -1 : bassPc, std::nullopt };
            const double bonus = bassBonus.count (bl) ? bassBonus.at (bl) : 0;
            // A root-less two-note "chord" is only a guess.
            out.push_back ({ c, c.name(), 100 * t->prior - 14 * omittedCount (*t, mask) + bonus - (pcs.size() == 2 ? 20 : 0) });
        }
    }
    std::vector<int> upper;
    for (int p : pcs)
        if (p != bassPc) upper.push_back (p);
    if (upper.size() >= 3)
        for (int root : upper)
        {
            const int mask = maskFrom (upper, root);
            for (auto& t : chordTypes())
            {
                if (t->parseOnly || (mask & t->requiredMask) != t->requiredMask || (mask & ~t->mask) != 0) continue;
                if (t->mask & (1 << mod12 (bassPc - root))) continue;
                Chord c { root, t, bassPc, std::nullopt };
                out.push_back ({ c, c.name(), 100 * t->prior - 14 * omittedCount (*t, mask) - 25 });
            }
        }
    // Generic names for anything the dictionary cannot describe well (as in the web app: when there
    // is no dictionary match at all, or no dictionary chord has the bass note as its root).
    bool rootPosition = false;
    for (auto& m : out)
        if (m.chord.bass < 0) rootPosition = true;
    for (int root : pcs)
    {
        if (! out.empty() && (rootPosition || root != bassPc)) continue;
        const auto g = nameFromSemis (maskFrom (pcs, root), false);
        const auto bl = bassLabelOf (*g.type, root);
        Chord c { root, g.type, bassPc == root ? -1 : bassPc, std::nullopt };
        out.push_back ({ c, c.name(), 70 - 12 * g.cost + (bassBonus.count (bl) ? bassBonus.at (bl) : 0) });
    }
    std::stable_sort (out.begin(), out.end(), [] (auto& a, auto& b) { return a.score > b.score; });
    std::vector<ChordMatch> unique;
    for (auto& m : out)
        if (std::none_of (unique.begin(), unique.end(), [&] (auto& u) { return u.name == m.name; })) unique.push_back (m);
    return unique;
}

std::optional<Chord> chordFromPcs (const std::vector<int>& pcsIn, int preferredRoot)
{
    std::vector<int> pcs;
    for (int p : pcsIn)
        if (std::find (pcs.begin(), pcs.end(), mod12 (p)) == pcs.end()) pcs.push_back (mod12 (p));
    if (pcs.empty()) return std::nullopt;
    if (pcs.size() == 1) return std::nullopt;
    // Stack the notes upwards from the preferred root (if it is one of them) and identify.
    std::vector<int> order = pcs;
    if (auto it = std::find (order.begin(), order.end(), mod12 (preferredRoot)); it != order.end()) std::rotate (order.begin(), it, it + 1);
    std::vector<int> midis;
    for (int pc : order)
    {
        int m = midis.empty() ? 48 + pc : midis.back() + 1;
        while (mod12 (m) != pc) m++;
        midis.push_back (m);
    }
    auto matches = identifyChord (midis);
    if (matches.size() > 30) matches.resize (30); // the web app looks at the 30 best readings
    if (matches.empty()) return std::nullopt;
    for (auto& m : matches)
        if (m.chord.root == order[0])
        {
            Chord c = m.chord;
            c.bass = -1;
            return c;
        }
    Chord c = matches[0].chord;
    c.bass = -1;
    return c;
}

namespace
{
/** Note tokens of "E G B D" / "Bb-D-F-A" / "E, G♯, B" — empty if any token is not a note name. */
std::vector<std::string> noteTokens (const std::string& textIn)
{
    std::string text = textIn;
    replaceAll (text, "\xE2\x80\x93", "-"); // en dash
    std::vector<std::string> out;
    std::string tok;
    auto flush = [&] () -> bool {
        if (tok.empty()) return true;
        auto n = parseNoteName (tok);
        if (! n || n->length != tok.size() || tok.find ('x') != std::string::npos) return false;
        out.push_back (tok);
        tok.clear();
        return true;
    };
    for (size_t i = 0; i <= text.size(); ++i)
    {
        const char c = i < text.size() ? text[i] : ' ';
        if (std::isspace ((unsigned char) c) || c == ',' || c == '-')
        {
            if (! flush()) return {};
        }
        else
            tok += c;
    }
    return out;
}
} // namespace

std::vector<int> parseNotesList (const std::string& text)
{
    std::vector<int> out;
    for (auto& t : noteTokens (text)) out.push_back (pcOf (parseNoteName (t)->note));
    return out;
}

std::string notesText (const std::vector<int>& pcs, const Chord* ctx)
{
    std::string s;
    for (size_t i = 0; i < pcs.size(); ++i)
    {
        std::string name = pcName (pcs[i]);
        if (ctx && ctx->type)
        {
            const auto names = ctx->toneNames();
            const auto cp = ctx->pcs();
            for (size_t k = 0; k < cp.size() && k < names.size(); ++k)
                if (cp[k] == mod12 (pcs[i])) name = names[k];
        }
        s += (i ? " " : "") + name;
    }
    return s;
}

ArpInput parseArpInput (const std::string& text)
{
    ArpInput r;
    const std::string t = trim (text);
    if (t.empty())
    {
        r.error = "Type a chord symbol (e.g. Bbmaj7, F#m7b5) or notes (e.g. E G B D).";
        return r;
    }
    const auto tokens = noteTokens (t);
    if (tokens.size() >= 2)
    {
        std::vector<int> notes;
        for (auto& tok : tokens) notes.push_back (pcOf (parseNoteName (tok)->note));
        auto c = chordFromPcs (notes, notes[0]);
        if (! c)
        {
            r.error = "Type at least two different notes.";
            return r;
        }
        if (c->root == notes[0]) c->rootSpelling = parseNoteName (tokens[0])->note;
        r.ok = true;
        r.chord = *c;
        for (size_t i = 0; i < tokens.size(); ++i) r.recognisedFrom += (i ? " " : "") + tokens[i];
        return r;
    }
    if (auto c = parseChordSymbol (t))
    {
        r.ok = true;
        r.chord = *c;
        return r;
    }
    r.error = "Couldn't read \"" + t + "\". Type a chord symbol (Bbmaj7, F#m7b5, C(add#11)) or notes (E G B D).";
    return r;
}
} // namespace fl
