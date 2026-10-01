#include "Fretboard.h"

#include "Theory.h"

#include <algorithm>
#include <climits>
#include <cstdlib>

namespace fl
{
std::vector<FretNote> notesOnBoard (const std::vector<int>& tuning, int numFrets, const std::vector<int>& pcs, OptWindow window)
{
    std::vector<FretNote> out;
    bool want[12] = {};
    for (int p : pcs) want[mod12 (p)] = true;
    const int lo = window ? window->start : 0;
    const int hi = window ? std::min (window->end, numFrets) : numFrets;
    for (int s = 0; s < (int) tuning.size(); ++s)
        for (int f = lo; f <= hi; ++f)
            if (want[mod12 (tuning[(size_t) s] + f)]) out.push_back ({ s, f, tuning[(size_t) s] + f });
    return out;
}

std::vector<FretWindow> rootPositions (const std::vector<int>& tuning, int numFrets, int rootPc, int span)
{
    std::vector<FretWindow> out;
    const int n = (int) tuning.size();
    for (int s = 0; s < std::min (3, n); ++s)
        for (int f = 0; f <= numFrets; ++f)
        {
            if (mod12 (tuning[(size_t) s] + f) != mod12 (rootPc)) continue;
            int start = std::max (0, f - 1);
            int end = start + span;
            if (end > numFrets)
            {
                end = numFrets;
                start = std::max (0, end - span);
            }
            out.push_back ({ start, end });
        }
    std::stable_sort (out.begin(), out.end(), [] (auto& a, auto& b) { return a.start < b.start; });
    std::vector<FretWindow> merged;
    for (auto& p : out)
    {
        if (! merged.empty() && std::abs (merged.back().start - p.start) <= 1) continue;
        merged.push_back (p);
    }
    return merged;
}

std::vector<int> pitchPool (const std::vector<int>& tuning, int numFrets, const std::vector<int>& pcs, OptWindow window)
{
    std::vector<int> all;
    for (auto& n : notesOnBoard (tuning, numFrets, pcs, window))
        if (std::find (all.begin(), all.end(), n.midi) == all.end()) all.push_back (n.midi);
    std::sort (all.begin(), all.end());
    if (window || tuning.empty()) return all;
    const int low = tuning[(size_t) std::min (1, (int) tuning.size() - 1)];
    std::vector<int> out;
    for (int m : all)
        if (m >= low && m <= low + 24) out.push_back (m);
    return out;
}

std::optional<FretNote> positionForMidi (const std::vector<int>& tuning, int numFrets, int midi, OptWindow window)
{
    const int lo = window ? window->start : 0;
    const int hi = window ? std::min (window->end, numFrets) : numFrets;
    std::optional<FretNote> best;
    for (int s = 0; s < (int) tuning.size(); ++s)
    {
        const int f = midi - tuning[(size_t) s];
        if (f < lo || f > hi) continue;
        if (! best || f < best->fret) best = FretNote { s, f, midi };
    }
    return best;
}

namespace
{
struct Walk
{
    std::vector<int> notes;
    int end = 0;
    int dir = 1;
};

Walk walk (const std::vector<int>& pool, int start, int dir, int count)
{
    Walk w;
    w.dir = dir;
    if (pool.empty()) return w;
    int idx = std::max (0, std::min ((int) pool.size() - 1, start));
    for (int k = 0; k < count; ++k)
    {
        w.notes.push_back (pool[(size_t) idx]);
        if (pool.size() == 1) continue;
        if (idx + w.dir < 0 || idx + w.dir >= (int) pool.size()) w.dir = -w.dir;
        idx += w.dir;
    }
    w.end = idx;
    return w;
}

int nearestIndex (const std::vector<int>& pool, int target, int dir)
{
    int best = 0, bestKey = INT_MAX;
    for (int i = 0; i < (int) pool.size(); ++i)
    {
        const int m = pool[(size_t) i];
        const int key = std::abs (m - target) * 2 + ((m - target) * dir >= 0 ? 0 : 1); // tie → direction of travel
        if (key < bestKey)
        {
            bestKey = key;
            best = i;
        }
    }
    return best;
}
} // namespace

std::vector<std::vector<int>> voiceLedLines (const std::vector<std::vector<int>>& pools, const std::vector<int>& rootPcs, const std::vector<int>& counts)
{
    std::vector<std::vector<int>> out;
    bool havePrev = false;
    int prev = 0, dir = 1;
    for (size_t i = 0; i < pools.size(); ++i)
    {
        const auto& pool = pools[i];
        if (pool.empty())
        {
            out.emplace_back();
            continue;
        }
        int start;
        if (! havePrev)
        {
            start = 0;
            for (int k = 0; k < (int) pool.size(); ++k)
                if (mod12 (pool[(size_t) k]) == mod12 (rootPcs[i]))
                {
                    start = k;
                    break;
                }
        }
        else
            start = nearestIndex (pool, prev + dir, dir);
        auto w = walk (pool, start, dir, counts[i]);
        dir = w.dir;
        if (! w.notes.empty())
        {
            prev = w.notes.back();
            havePrev = true;
        }
        out.push_back (w.notes);
    }
    return out;
}

std::string tuningText (const std::vector<int>& tuning)
{
    std::string s;
    for (size_t i = 0; i < tuning.size(); ++i) s += (i ? " " : "") + midiName (tuning[i]);
    return s;
}
} // namespace fl
