// The clickable guitar fretboard: every note is labelled, the arpeggio's notes are coloured by
// degree, the playing position is shaded and the note being played lights up.
#pragma once

#include "core/Fretboard.h"
#include "Theme.h"

#include <functional>

class FretboardView : public juce::Component, public juce::SettableTooltipClient
{
public:
    struct Marker
    {
        int pc = 0;
        std::string degree; // "1", "b3", "9" …
        std::string name;   // "E♭"
    };
    enum class Labels { Notes, Degrees, Frets };

    void setBoard (const std::vector<int>& tuning, int numFrets);
    void setMarkers (const std::vector<Marker>& markers, fl::OptWindow window, int rootPc);
    void setLabels (Labels l);
    /** The note being played (string -1 = none) and how bright its highlight is (0..1). */
    void setActive (int string, int fret, float glow);
    void setCaption (const juce::String& c);

    std::function<void (int string, int fret, int midi, const juce::MouseEvent&)> onClick;
    std::function<void (int string, int fret, int midi)> onRightClick;

    void paint (juce::Graphics&) override;
    void resized() override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseMove (const juce::MouseEvent&) override;
    void mouseExit (const juce::MouseEvent&) override;

private:
    struct Hit
    {
        int string = -1, fret = -1;
    };
    Hit locate (juce::Point<float> p) const;
    float fretX (int fret) const; // x of the fret wire after `fret` (0 = the nut)
    float noteX (int fret) const; // where a note on this fret is drawn
    float stringY (int string) const;

    std::vector<int> tuning { 40, 45, 50, 55, 59, 64 };
    int numFrets = 22;
    std::vector<Marker> markers;
    fl::OptWindow window;
    int rootPc = -1;
    Labels labels = Labels::Notes;
    int activeString = -1, activeFret = -1;
    float activeGlow = 0;
    Hit hover;
    juce::String caption;
    juce::Rectangle<float> board;
    float openWidth = 34, nutX = 0;
    std::vector<float> wires;
};
