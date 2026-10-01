// Colours and look of the plugin — the dark theme of the Fretboard Lab web app.
#pragma once

#include "core/Theory.h"

#include <juce_gui_basics/juce_gui_basics.h>

namespace theme
{
const juce::Colour bg { 0xff0e1116 };
const juce::Colour panel { 0xff161a22 };
const juce::Colour panel2 { 0xff1d222c };
const juce::Colour border { 0xff2a303c };
const juce::Colour text { 0xffe8ebf2 };
const juce::Colour muted { 0xff98a1b3 };
const juce::Colour accent { 0xff8b7dff };
const juce::Colour accentSoft { 0xff2a2550 };
const juce::Colour warning { 0xfff5a524 };
const juce::Colour error { 0xffff6b6b };
const juce::Colour ok { 0xff35b36a };
const juce::Colour wood { 0xff1b1712 };
const juce::Colour neutral { 0xff7c8aa5 };

/** One colour per scale-degree family: root, 2/9, 3, 4/11, 5, 6/13, 7 (as in the web app). */
inline juce::Colour degreeColour (const std::string& label)
{
    if (label.empty()) return neutral;
    static const juce::uint32 colours[] = { 0xffe5484d, 0xff9e6bdb, 0xfff5a524, 0xffe0529c, 0xff3e7bfa, 0xff13a89e, 0xff35b36a };
    const int category = (fl::degreeNum (label) - 1) % 7;
    return juce::Colour (colours[juce::jlimit (0, 6, category)]);
}

inline juce::Colour textOn (juce::Colour c) { return c == juce::Colour (0xfff5a524) ? juce::Colour (0xff1b1300) : juce::Colours::white; }

inline juce::String u8 (const std::string& s) { return juce::String::fromUTF8 (s.c_str()); }

class LookAndFeel : public juce::LookAndFeel_V4
{
public:
    LookAndFeel()
        : juce::LookAndFeel_V4 (juce::LookAndFeel_V4::ColourScheme (bg, panel, panel2, border, text, accent, juce::Colours::white, panel2, text))
    {
        setColour (juce::ComboBox::backgroundColourId, panel2);
        setColour (juce::ComboBox::outlineColourId, border);
        setColour (juce::ComboBox::textColourId, text);
        setColour (juce::ComboBox::arrowColourId, muted);
        setColour (juce::PopupMenu::backgroundColourId, panel2);
        setColour (juce::PopupMenu::highlightedBackgroundColourId, accentSoft);
        setColour (juce::PopupMenu::headerTextColourId, muted);
        setColour (juce::TextEditor::backgroundColourId, panel2);
        setColour (juce::TextEditor::outlineColourId, border);
        setColour (juce::TextEditor::focusedOutlineColourId, accent);
        setColour (juce::TextEditor::textColourId, text);
        setColour (juce::TextButton::buttonColourId, panel2);
        setColour (juce::TextButton::buttonOnColourId, accent);
        setColour (juce::TextButton::textColourOffId, text);
        setColour (juce::Slider::rotarySliderFillColourId, accent);
        setColour (juce::Slider::rotarySliderOutlineColourId, border);
        setColour (juce::Slider::thumbColourId, text);
        setColour (juce::Slider::textBoxTextColourId, text);
        setColour (juce::Slider::textBoxOutlineColourId, juce::Colours::transparentBlack);
        setColour (juce::Label::textColourId, text);
        setColour (juce::ToggleButton::tickColourId, accent);
        setColour (juce::TooltipWindow::backgroundColourId, panel2);
        setColour (juce::TooltipWindow::textColourId, text);
        setColour (juce::TooltipWindow::outlineColourId, border);
        setColour (juce::ScrollBar::thumbColourId, border);
    }

    juce::Font getTextButtonFont (juce::TextButton&, int buttonHeight) override { return juce::Font (juce::FontOptions (juce::jmin (14.0f, (float) buttonHeight * 0.55f))); }
};
} // namespace theme
