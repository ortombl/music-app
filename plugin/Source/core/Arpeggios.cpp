#include "Arpeggios.h"

#include <algorithm>
#include <cmath>
#include <map>
#include <set>

namespace fl
{
namespace
{
bool has (const std::vector<std::string>& v, const std::string& x) { return std::find (v.begin(), v.end(), x) != v.end(); }
bool hasPc (const std::vector<int>& v, int pc) { return std::find (v.begin(), v.end(), pc) != v.end(); }

std::string join (const std::vector<std::string>& parts, const std::string& sep)
{
    std::string s;
    for (size_t i = 0; i < parts.size(); ++i) s += (i ? sep : "") + parts[i];
    return s;
}

std::vector<std::string> pretty (const std::vector<std::string>& labels)
{
    std::vector<std::string> out;
    for (auto& l : labels) out.push_back (prettyDegree (l));
    return out;
}

int maskOf (const std::vector<int>& pcs)
{
    int m = 0;
    for (int p : pcs) m |= 1 << mod12 (p);
    return m;
}

std::vector<int> uniquePcs (const std::vector<int>& in)
{
    std::vector<int> out;
    for (int p : in)
        if (! hasPc (out, p)) out.push_back (p);
    return out;
}

Chord withoutBass (Chord c)
{
    c.bass = -1;
    return c;
}

/** Spell a note relative to the target chord using its degree label (the 9 of B is C♯). */
Spelled spellRel (const Chord& target, int pc, const std::string& label)
{
    return spellWithLetter (pc, target.spelledRoot().letter + degreeStep (label)).value_or (defaultSpelling (pc));
}

std::vector<std::pair<int, Spelled>> spelledTones (const Chord& c)
{
    std::vector<std::pair<int, Spelled>> out;
    const Spelled r = c.spelledRoot();
    for (auto& d : c.type->degrees)
    {
        const int pc = mod12 (c.root + degreeSemi (d));
        out.push_back ({ pc, spellWithLetter (pc, r.letter + degreeStep (d)).value_or (defaultSpelling (pc)) });
    }
    return out;
}

std::string soundName (const Chord& target, const std::vector<int>& pcs)
{
    std::vector<int> u = withoutBass (target).pcs();
    for (int p : pcs)
        if (! hasPc (u, p)) u.push_back (p);
    Chord c;
    c.root = target.root;
    c.rootSpelling = target.spelledRoot();
    if (auto t = nameOverRoot (target.root, u)) c.type = t;
    else
    {
        int mask = 0;
        for (int p : u) mask |= 1 << mod12 (p - target.root);
        c.type = nameFromSemis (mask, false).type;
    }
    return c.name();
}

struct Vocab
{
    const char* id;
    double prior;
};
const Vocab kVocab[] = {
    { "maj", 1 },     { "m", 1 },        { "m7", 1 },     { "maj7", 0.95 }, { "7", 0.9 },       { "m7b5", 0.8 },   { "dim7", 0.7 },
    { "9", 0.65 },    { "add9", 0.6 },   { "maj9", 0.6 }, { "m9", 0.6 },    { "sus4", 0.4 },    { "sus2", 0.4 },   { "6", 0.5 },
    { "7sus4", 0.4 }, { "madd9", 0.5 },  { "dim", 0.5 },  { "aug", 0.5 },   { "m6", 0.45 },     { "mmaj7", 0.45 }, { "6/9", 0.4 },
    { "maj7#5", 0.4 }, { "7#5", 0.35 }, { "7b9", 0.35 }, { "7b5", 0.3 },   { "7#9", 0.3 },
};

double vocabPriorOf (const std::string& id, double fallback)
{
    for (auto& v : kVocab)
        if (id == v.id) return v.prior;
    return fallback;
}

std::vector<std::string> avoidNotes (const ChordType& target, const std::vector<std::string>& tensions)
{
    auto hasDeg = [&] (const char* l) { return has (target.degrees, l); };
    const bool dominant = target.family == "dominant";
    std::vector<std::string> out;
    for (auto& t : tensions)
    {
        if ((t == "11" && hasDeg ("3")) || (t == "b9" && ! dominant) || (t == "b13" && hasDeg ("3") && ! dominant) || (t == "#9" && ! dominant)
            || (t == "b7" && hasDeg ("7")) || (t == "7" && hasDeg ("b7")) || (t == "3" && hasDeg ("b3")) || (t == "#5" && hasDeg ("5"))
            || (t == "b5" && hasDeg ("5")))
            out.push_back (t);
    }
    return out;
}

std::string relationText (int semi, const ChordType& target)
{
    static const std::map<int, std::string> ordinal { { 1, "root" }, { 2, "2nd" }, { 3, "3rd" }, { 4, "4th" }, { 5, "5th" }, { 6, "6th" }, { 7, "7th" }, { 9, "9th" }, { 11, "11th" }, { 13, "13th" } };
    const std::string lbl = labelInChord (semi, target.degrees);
    const int num = degreeNum (lbl);
    const std::string ord = ordinal.count (num) ? ordinal.at (num) : std::to_string (num) + "th";
    const std::string acc = lbl.rfind ("bb", 0) == 0 ? "\xE2\x99\xAD\xE2\x99\xAD" : lbl.rfind ("b", 0) == 0 ? "\xE2\x99\xAD" : lbl.rfind ("#", 0) == 0 ? "\xE2\x99\xAF" : "";
    return acc + ord;
}

struct ScaleCtx
{
    int rootPc;
    std::string scaleId;
};

std::vector<ScaleCtx> chordScales (const Chord& target)
{
    std::vector<ScaleCtx> out;
    const auto tones = withoutBass (target).pcs();
    for (auto& id : target.type->scales)
    {
        const auto s = scalePcs (target.root, id);
        if (s.empty()) continue;
        // Chord-scales must contain the whole chord (a slash bass may fall outside).
        if (! std::all_of (tones.begin(), tones.end(), [&] (int p) { return hasPc (s, p); })) continue;
        if (std::none_of (out.begin(), out.end(), [&] (auto& o) { return o.rootPc == target.root && o.scaleId == id; })) out.push_back ({ target.root, id });
    }
    return out;
}

std::vector<Spelled> spellScale (Spelled root, int rootPc, const ScaleType& s)
{
    std::vector<Spelled> out;
    for (auto& l : s.degrees)
    {
        const int pc = mod12 (rootPc + degreeSemi (l));
        auto n = spellWithLetter (pc, root.letter + degreeStep (l));
        // Avoid double sharps/flats in scales (E♭ blues uses A, not B♭♭).
        if (! n || std::abs (n->acc) > 1) out.push_back (defaultSpelling (pc, root.acc < 0 ? -1 : root.acc > 0 ? 1 : 0));
        else out.push_back (*n);
    }
    return out;
}

Spelled chooseScaleRoot (int rootPc, const ScaleType& s)
{
    const Spelled sharp = defaultSpelling (rootPc, 1), flat = defaultSpelling (rootPc, -1);
    if (sharp.letter == flat.letter) return sharp;
    Spelled best = sharp;
    double bestCost = 1e18;
    for (const Spelled& c : { sharp, flat })
    {
        double cost = c.acc > 0 ? 0.01 : 0; // tie → flats
        for (auto& n : spellScale (c, rootPc, s)) cost += std::abs (n.acc) + (std::abs (n.acc) > 1 ? 3 : 0);
        if (cost < bestCost)
        {
            bestCost = cost;
            best = c;
        }
    }
    return best;
}

/** How much each chord tone matters for outlining the chord (3rd and 7th most). */
std::map<int, double> outlineWeights (const ChordType& t)
{
    std::map<int, double> w;
    const bool hasThird = std::any_of (t.degrees.begin(), t.degrees.end(), [] (auto& d) { return degreeNum (d) == 3; });
    const bool hasSeventh = std::any_of (t.degrees.begin(), t.degrees.end(), [] (auto& d) { return degreeNum (d) == 7; });
    for (auto& d : t.degrees)
    {
        const int n = degreeNum (d);
        double weight;
        if (n == 1) weight = 0.15;
        else if (n == 3 || (! hasThird && (n == 2 || n == 4))) weight = 0.35;
        else if (n == 7 || (! hasSeventh && n == 6)) weight = 0.3;
        else if (n == 5) weight = d == "5" ? 0.1 : 0.25;
        else weight = 0.12;
        w[degreeSemi (d)] = weight;
    }
    return w;
}

double relationFamiliarity (int rel, const ChordType& target)
{
    if (rel == 3 || rel == 4) return 0.4; // built on the 3rd — the classic substitute
    if (rel == 7) return 0.35;            // on the 5th
    if (rel == 10 || rel == 11) return 0.3; // on the 7th
    if (rel == 9 && target.family != "minor") return 0.3;
    if (rel == 2) return 0.2;
    if (rel == 0) return 0;
    return 0.1;
}

struct RateEnv
{
    Chord target;
    std::vector<int> tPcs;
    std::vector<std::string> tDegs;
    std::map<int, double> weights;
    double totalWeight = 0;
    std::string targetName;
    std::vector<ScaleCtx> scales;
    std::vector<std::vector<int>> scaleSets;
};

RateEnv rateEnv (const Chord& target)
{
    RateEnv e;
    e.target = target;
    const Chord base = withoutBass (target);
    e.tPcs = base.pcs();
    e.tDegs = target.type->degrees;
    e.weights = outlineWeights (*target.type);
    for (auto& [semi, w] : e.weights) e.totalWeight += w;
    e.targetName = base.name();
    for (auto& sc : chordScales (base))
    {
        if (sc.scaleId == "majorPentatonic" || sc.scaleId == "minorPentatonic" || sc.scaleId == "blues") continue;
        if (e.scales.size() >= 3) break;
        e.scales.push_back (sc);
    }
    for (auto& sc : e.scales)
    {
        auto set = scalePcs (sc.rootPc, sc.scaleId);
        for (int p : e.tPcs)
            if (! hasPc (set, p)) set.push_back (p);
        e.scaleSets.push_back (set);
    }
    return e;
}

std::optional<Arpeggio> rateArpeggio (const RateEnv& env, const Chord& chord, double prior, bool strict)
{
    const Chord& target = env.target;
    const auto& tPcs = env.tPcs;
    const auto& tDegs = env.tDegs;
    const auto pcs = uniquePcs (chord.pcs());
    const int root = chord.root;
    int scaleIdx = -1;
    for (size_t i = 0; i < env.scaleSets.size() && scaleIdx < 0; ++i)
        if (std::all_of (pcs.begin(), pcs.end(), [&] (int p) { return hasPc (env.scaleSets[i], p); })) scaleIdx = (int) i;
    if (strict && scaleIdx < 0) return std::nullopt;
    const bool subset = std::all_of (pcs.begin(), pcs.end(), [&] (int p) { return hasPc (tPcs, p); });
    if (strict && root == target.root && subset) return std::nullopt;
    if (strict && root == target.root && chord.type->id == target.type->id) return std::nullopt;

    std::vector<std::string> labels, tensions;
    for (int pc : pcs) labels.push_back (labelInChord (pc - target.root, tDegs));
    for (size_t i = 0; i < pcs.size(); ++i)
        if (! hasPc (tPcs, pcs[i])) tensions.push_back (labels[i]);
    const auto avoid = avoidNotes (*target.type, tensions);
    std::vector<std::string> good;
    for (auto& t : tensions)
        if (! has (avoid, t)) good.push_back (t);
    const int ct = (int) std::count_if (pcs.begin(), pcs.end(), [&] (int p) { return hasPc (tPcs, p); });
    const bool upperStructure = ct == 0 && avoid.empty() && good.size() >= 3;
    if (strict && ct < 2 && ! upperStructure && ! (ct == 1 && tDegs.size() <= 3 && avoid.empty() && good.size() >= 2)) return std::nullopt;

    auto inAnyScale = [&] (int pc) { return std::any_of (env.scaleSets.begin(), env.scaleSets.end(), [&] (auto& s) { return hasPc (s, pc); }); };
    std::vector<int> outside;
    for (int pc : pcs)
        if (! hasPc (tPcs, pc) && ! inAnyScale (pc)) outside.push_back (pc);
    double qualitySum = 0;
    for (size_t i = 0; i < pcs.size(); ++i)
    {
        const int pc = pcs[i];
        if (hasPc (tPcs, pc)) qualitySum += 1;
        else if (has (avoid, labels[i])) qualitySum += 0.35;
        else if (! env.scaleSets.empty() && hasPc (env.scaleSets[0], pc)) qualitySum += 1;
        else qualitySum += inAnyScale (pc) ? 0.75 : 0.1;
    }
    const double consonance = qualitySum / (double) pcs.size();
    double outlined = 0;
    for (int pc : pcs)
        if (auto it = env.weights.find (mod12 (pc - target.root)); it != env.weights.end()) outlined += it->second;
    const double outline = env.totalWeight > 0 ? outlined / env.totalWeight : 0;
    int goodInside = 0;
    for (auto& g : good)
        if (std::none_of (outside.begin(), outside.end(), [&] (int pc) { return labelInChord (pc - target.root, tDegs) == g; })) goodInside++;
    const double colour = std::min (1.0, goodInside / 2.0);
    const int rel = mod12 (root - target.root);
    const double familiarity = std::min (1.0, 0.6 * prior + relationFamiliarity (rel, *target.type));
    double fit = 0.35 * consonance + 0.25 * outline + 0.15 * colour + 0.25 * familiarity;
    if (rel == 0) fit -= 0.05;
    if (pcs.size() >= 5) fit -= 0.03;

    const std::string name = chord.name();
    const auto spelled = spelledTones (chord);
    auto nameOf = [&] (int pc) {
        for (auto& [p, n] : spelled)
            if (p == pc) return formatNote (n);
        return formatNote (spellRel (target, pc, labelInChord (pc - target.root, tDegs)));
    };
    std::string sound = soundName (target, pcs);
    std::vector<std::string> parts;
    if (subset && ct == (int) tPcs.size()) parts.push_back ("Same notes as " + env.targetName + ".");
    else if (rel == 0) parts.push_back ("Extends " + env.targetName + " from its own root.");
    else parts.push_back ("Built on the " + relationText (rel, *target.type) + " of " + env.targetName + ".");
    const bool dimParent = (target.type->id == "dim7" || target.type->id == "dim") && chord.type->id == "7" && tensions.size() == 1 && ! hasPc (tPcs, root);
    const std::string soundSuffix = ! sound.empty() && sound != env.targetName ? " \xE2\x86\x92 " + sound + " sound" : "";
    if (dimParent)
    {
        parts.clear();
        parts.push_back (env.targetName + " works like a rootless " + name + "\xE2\x99\xAD" "9 (its notes are the 3rd, 5th, 7th and \xE2\x99\xAD" "9 of " + name
                         + "). Use the " + name + " arpeggio to hear that dominant function.");
        fit += 0.05;
        sound = name + "\xE2\x99\xAD" "9";
    }
    else if (upperStructure)
        parts.push_back ("Upper structure \xE2\x80\x94 only colour tones (" + join (pretty (labels), ", ") + ")" + soundSuffix
                         + ". Sounds modern and open; let the bass/chord supply the root.");
    else if (! good.empty())
        parts.push_back ("Adds " + join (pretty (good), " & ") + soundSuffix + ".");
    else if (! tensions.empty())
        parts.push_back ("Adds " + join (pretty (tensions), ", ") + " \xE2\x80\x94 notes that clash with " + env.targetName + ": a tense, \"outside\" sound.");
    else if (! (subset && ct == (int) tPcs.size()))
        parts.push_back ("Only chord tones (" + join (pretty (labels), "-") + ") \xE2\x80\x94 outlines the chord without stating the root.");
    fit = std::max (0.0, std::min (0.99, fit));

    std::vector<std::string> warnings;
    if (! avoid.empty())
        warnings.push_back ("Contains the " + join (pretty (avoid), ", ") + " \xE2\x80\x94 an \"avoid note\" over " + env.targetName + "; use it as a passing tone.");
    if (! outside.empty() && ! env.scales.empty())
    {
        std::vector<std::string> names;
        for (int pc : outside) names.push_back (nameOf (pc));
        warnings.push_back (join (names, ", ") + (outside.size() > 1 ? " are" : " is") + " outside the chord-scale (" + scaleLabel (env.scales[0].rootPc, env.scales[0].scaleId)
                            + ") \xE2\x80\x94 a deliberate \"outside\" sound.");
    }

    Arpeggio a;
    a.id = "sub-" + std::to_string (root) + "-" + chord.type->id + "-" + (chord.bass >= 0 ? std::to_string (chord.bass) : "");
    a.chord = chord;
    a.name = name;
    a.kind = Arpeggio::Kind::Substitute;
    for (size_t i = 0; i < pcs.size(); ++i) a.notes.push_back ({ pcs[i], labels[i], hasPc (tPcs, pcs[i]), nameOf (pcs[i]) });
    a.adds = good;
    a.sound = sound;
    a.description = join (parts, " ");
    if (scaleIdx >= 0) a.scaleLabel = scaleLabel (env.scales[(size_t) scaleIdx].rootPc, env.scales[(size_t) scaleIdx].scaleId);
    a.warning = join (warnings, " ");
    a.fit = fit;
    return a;
}
} // namespace

std::vector<int> Arpeggio::pcs() const
{
    std::vector<int> out;
    for (auto& n : notes) out.push_back (n.pc);
    return out;
}

std::string scaleLabel (int rootPc, const std::string& scaleId)
{
    const ScaleType* s = scaleById (scaleId);
    if (! s) return scaleId;
    return formatNote (chooseScaleRoot (rootPc, *s)) + " " + s->name;
}

std::vector<Arpeggio> exactArpeggios (const Chord& target)
{
    std::vector<Arpeggio> out;
    if (! target.type) return out;
    const std::string name = target.name();
    const auto pcs = target.pcs();
    std::vector<std::string> labels;
    for (int pc : pcs) labels.push_back (labelInChord (pc - target.root, target.type->degrees));
    Arpeggio own;
    own.id = "exact-" + std::to_string (target.root) + "-" + target.type->id + "-" + (target.bass >= 0 ? std::to_string (target.bass) : "");
    own.chord = target;
    own.name = name;
    own.kind = Arpeggio::Kind::Exact;
    for (size_t i = 0; i < pcs.size(); ++i) own.notes.push_back ({ pcs[i], labels[i], true, formatNote (spellRel (target, pcs[i], labels[i])) });
    own.sound = name;
    own.description = "The chord's own arpeggio: " + join (pretty (labels), " \xE2\x80\x93 ") + ".";
    own.fit = 1;
    out.push_back (own);

    const auto& degs = target.type->degrees;
    auto findOf = [&] (std::initializer_list<const char*> opts) -> std::string {
        for (auto& d : degs)
            for (auto* o : opts)
                if (d == o) return d;
        return "";
    };
    const std::string third = findOf ({ "3", "b3", "4", "2" }), fifth = findOf ({ "5", "b5", "#5" }), seventh = findOf ({ "7", "b7", "bb7", "6" });
    struct Core
    {
        std::vector<std::string> degs;
        std::string label;
    };
    std::vector<Core> cores;
    auto nonEmpty = [] (std::vector<std::string> v) {
        v.erase (std::remove (v.begin(), v.end(), std::string()), v.end());
        return v;
    };
    if (! seventh.empty() && degs.size() > 4) cores.push_back ({ nonEmpty ({ "1", third, fifth.empty() ? "5" : fifth, seventh }), "7th-chord core" });
    if (degs.size() > 3 && ! third.empty()) cores.push_back ({ { "1", third, fifth.empty() ? "5" : fifth }, "triad core" });
    for (auto& core : cores)
    {
        std::vector<int> corePcs;
        for (auto& l : core.degs) corePcs.push_back (mod12 (target.root + degreeSemi (l)));
        auto t = nameOverRoot (target.root, corePcs);
        if (! t || t->id == target.type->id) continue;
        bool exact = true;
        for (auto& d : t->degrees)
            if (! hasPc (corePcs, mod12 (target.root + degreeSemi (d)))) exact = false;
        if (! exact) continue;
        if (std::any_of (out.begin(), out.end(), [&] (auto& a) { return a.chord.type->id == t->id; })) continue;
        Chord c;
        c.root = target.root;
        c.type = t;
        c.rootSpelling = target.spelledRoot();
        Arpeggio a;
        a.id = "red-" + std::to_string (target.root) + "-" + t->id;
        a.chord = c;
        a.name = c.name();
        a.kind = Arpeggio::Kind::Reduction;
        for (int pc : c.pcs())
        {
            const auto label = labelInChord (pc - target.root, target.type->degrees);
            a.notes.push_back ({ pc, label, true, formatNote (spellRel (target, pc, label)) });
        }
        a.sound = name;
        a.description = "Simpler " + core.label + " of " + name + " (" + join (pretty (t->degrees), " \xE2\x80\x93 ") + "). Easier to finger; still outlines the harmony.";
        a.fit = 0.95;
        out.push_back (a);
    }
    return out;
}

std::vector<Arpeggio> suggestArpeggios (const Chord& target, int limit)
{
    std::vector<Arpeggio> result;
    if (! target.type) return result;
    const RateEnv env = rateEnv (target);
    std::vector<int> roots;
    for (auto& sc : env.scales)
        for (int p : scalePcs (sc.rootPc, sc.scaleId))
            if (! hasPc (roots, p)) roots.push_back (p);
    std::vector<Arpeggio> cands; // insertion-ordered map keyed by id (like the web app's Map)
    for (int root : roots)
        for (auto& v : kVocab)
        {
            auto type = chordTypeById (v.id);
            if (! type) continue;
            const int rel = mod12 (root - target.root);
            // Spell the root relative to the chord (D♯m7 over B), but never as B♯/E♯/C♭/F♭ or a double accidental.
            const Spelled rs = spellRel (target, root, labelInChord (rel, env.tDegs));
            const bool awkward = std::abs (rs.acc) > 1 || (rs.acc == 1 && (rs.letter == 2 || rs.letter == 6)) || (rs.acc == -1 && (rs.letter == 0 || rs.letter == 3));
            Chord c;
            c.root = root;
            c.type = type;
            if (! awkward) c.rootSpelling = rs;
            auto arp = rateArpeggio (env, c, v.prior, true);
            if (! arp) continue;
            auto it = std::find_if (cands.begin(), cands.end(), [&] (auto& a) { return a.id == arp->id; });
            if (it == cands.end()) cands.push_back (*arp);
            else if (it->fit < arp->fit) *it = *arp;
        }

    // Arpeggios with identical notes (Em7 = G6, the inversions of a dim7) are merged, keeping the
    // most common chord name; arpeggios with exactly the target chord's notes are dropped.
    const int targetMask = maskOf (env.tPcs);
    std::vector<std::pair<int, Arpeggio>> byNotes;
    for (auto& a : cands)
    {
        const int m = maskOf (a.pcs());
        if (m == targetMask) continue;
        auto it = std::find_if (byNotes.begin(), byNotes.end(), [&] (auto& p) { return p.first == m; });
        if (it == byNotes.end())
        {
            byNotes.push_back ({ m, a });
            continue;
        }
        const Arpeggio& prev = it->second;
        const double pa = vocabPriorOf (a.chord.type->id, 0), pp = vocabPriorOf (prev.chord.type->id, 0);
        Arpeggio better = pa > pp || (pa == pp && a.fit > prev.fit) ? a : prev;
        better.fit = std::max (a.fit, prev.fit);
        it->second = better;
    }
    for (auto& [m, a] : byNotes) result.push_back (a);
    std::stable_sort (result.begin(), result.end(), [] (auto& a, auto& b) { return a.fit > b.fit; });
    if ((int) result.size() > limit) result.resize ((size_t) limit);
    return result;
}

Arpeggio analyzeArpeggio (const Chord& target, const Chord& arp)
{
    const RateEnv env = rateEnv (target);
    const double prior = vocabPriorOf (arp.type->id, std::min (0.5, arp.type->prior));
    return *rateArpeggio (env, arp, prior, false);
}
} // namespace fl
