// The progression as a row of chord cards: chord, its arpeggio, length and position. Click a card
// to edit that chord; the card being played lights up.
#pragma once

#include "Theme.h"

#include <functional>

class ChordStrip : public juce::Component
{
public:
    struct Card
    {
        juce::String chord, arp, detail;
        bool error = false, custom = false;
    };

    void setCards (const std::vector<Card>& c);
    void setSelected (int i);
    void setPlaying (int i);
    int getSelected() const { return selected; }
    int preferredWidth() const;

    std::function<void (int)> onSelect;

    void paint (juce::Graphics&) override;
    void mouseDown (const juce::MouseEvent&) override;

    static constexpr int cardWidth = 138, gap = 6;

private:
    std::vector<Card> cards;
    int selected = 0, playing = -1;
};
