#include "ChordStrip.h"

void ChordStrip::setCards (const std::vector<Card>& c)
{
    cards = c;
    setSize (preferredWidth(), getHeight());
    repaint();
}

void ChordStrip::setSelected (int i)
{
    if (i == selected) return;
    selected = i;
    repaint();
}

void ChordStrip::setPlaying (int i)
{
    if (i == playing) return;
    playing = i;
    repaint();
}

int ChordStrip::preferredWidth() const { return (int) cards.size() * (cardWidth + gap) + gap; }

void ChordStrip::paint (juce::Graphics& g)
{
    g.fillAll (theme::panel);
    for (int i = 0; i < (int) cards.size(); ++i)
    {
        const auto& c = cards[(size_t) i];
        auto r = juce::Rectangle<float> ((float) (gap + i * (cardWidth + gap)), 4.0f, (float) cardWidth, (float) getHeight() - 8.0f);
        const bool sel = i == selected, play = i == playing;
        g.setColour (play ? theme::accent.withAlpha (0.32f) : sel ? theme::accentSoft : theme::panel2);
        g.fillRoundedRectangle (r, 7.0f);
        g.setColour (sel ? theme::accent : play ? theme::accent.withAlpha (0.7f) : theme::border);
        g.drawRoundedRectangle (r.reduced (0.5f), 7.0f, sel ? 2.0f : 1.0f);
        auto inner = r.reduced (8.0f, 5.0f);
        auto top = inner.removeFromTop (22.0f);
        g.setColour (theme::muted);
        g.setFont (juce::FontOptions (11.0f, juce::Font::bold));
        g.drawText (juce::String (i + 1), top.removeFromLeft (16.0f), juce::Justification::centredLeft);
        g.setColour (c.error ? theme::error : theme::text);
        g.setFont (juce::FontOptions (17.0f, juce::Font::bold));
        g.drawFittedText (c.chord, top.toNearestInt(), juce::Justification::centredLeft, 1, 0.7f);
        g.setColour (c.custom ? theme::warning : theme::accent.brighter (0.3f));
        g.setFont (juce::FontOptions (12.5f));
        g.drawFittedText (c.arp, inner.removeFromTop (17.0f).toNearestInt(), juce::Justification::centredLeft, 1, 0.75f);
        g.setColour (theme::muted);
        g.setFont (juce::FontOptions (11.0f));
        g.drawFittedText (c.detail, inner.removeFromTop (15.0f).toNearestInt(), juce::Justification::centredLeft, 1, 0.8f);
    }
    if (cards.empty())
    {
        g.setColour (theme::muted);
        g.drawText ("No chords yet - type a progression above.", getLocalBounds(), juce::Justification::centred);
    }
}

void ChordStrip::mouseDown (const juce::MouseEvent& e)
{
    const int i = (e.x - gap) / (cardWidth + gap);
    if (i >= 0 && i < (int) cards.size())
    {
        setSelected (i);
        if (onSelect) onSelect (i);
    }
}
