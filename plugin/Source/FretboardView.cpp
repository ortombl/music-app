#include "FretboardView.h"

#include <cmath>

void FretboardView::setBoard (const std::vector<int>& t, int frets)
{
    if (t == tuning && frets == numFrets) return;
    tuning = t;
    numFrets = frets;
    resized();
    repaint();
}

void FretboardView::setMarkers (const std::vector<Marker>& m, fl::OptWindow w, int root)
{
    markers = m;
    window = w;
    rootPc = root;
    repaint();
}

void FretboardView::setLabels (Labels l)
{
    labels = l;
    repaint();
}

void FretboardView::setActive (int string, int fret, float glow)
{
    if (string == activeString && fret == activeFret && std::abs (glow - activeGlow) < 0.01f) return;
    activeString = string;
    activeFret = fret;
    activeGlow = glow;
    repaint();
}

void FretboardView::setCaption (const juce::String& c)
{
    if (c == caption) return;
    caption = c;
    repaint();
}

void FretboardView::resized()
{
    auto r = getLocalBounds().toFloat().reduced (8.0f, 4.0f);
    r.removeFromTop (20.0f);    // caption
    r.removeFromBottom (18.0f); // fret numbers
    const float nameWidth = 30.0f;
    r.removeFromLeft (nameWidth);
    board = r;
    nutX = board.getX() + openWidth;
    // Frets get narrower up the neck (gently, so the high frets stay clickable).
    wires.assign ((size_t) numFrets + 1, 0.0f);
    double total = 0;
    std::vector<double> widths ((size_t) numFrets + 1, 0.0);
    for (int f = 1; f <= numFrets; ++f)
    {
        widths[(size_t) f] = std::pow (0.972, f);
        total += widths[(size_t) f];
    }
    const double usable = board.getRight() - nutX;
    double x = nutX;
    wires[0] = nutX;
    for (int f = 1; f <= numFrets; ++f)
    {
        x += widths[(size_t) f] / total * usable;
        wires[(size_t) f] = (float) x;
    }
}

float FretboardView::fretX (int fret) const { return wires.empty() ? 0.0f : wires[(size_t) juce::jlimit (0, numFrets, fret)]; }

float FretboardView::noteX (int fret) const
{
    if (fret <= 0) return board.getX() + openWidth * 0.45f;
    return (fretX (fret - 1) + fretX (fret)) * 0.5f;
}

float FretboardView::stringY (int string) const
{
    const int n = (int) tuning.size();
    if (n <= 1) return board.getCentreY();
    const float pad = board.getHeight() / (float) n * 0.5f;
    // Highest string at the top, as in tablature.
    return board.getY() + pad + (board.getHeight() - 2 * pad) * (float) (n - 1 - string) / (float) (n - 1);
}

FretboardView::Hit FretboardView::locate (juce::Point<float> p) const
{
    Hit h;
    if (tuning.empty() || p.x < board.getX() - 4 || p.x > board.getRight() + 4 || p.y < board.getY() - 6 || p.y > board.getBottom() + 6) return h;
    float best = 1e9f;
    for (int s = 0; s < (int) tuning.size(); ++s)
        if (std::abs (p.y - stringY (s)) < best)
        {
            best = std::abs (p.y - stringY (s));
            h.string = s;
        }
    if (p.x < nutX) h.fret = 0;
    else
        for (int f = 1; f <= numFrets; ++f)
            if (p.x <= fretX (f) || f == numFrets)
            {
                h.fret = f;
                break;
            }
    return h;
}

void FretboardView::paint (juce::Graphics& g)
{
    g.fillAll (theme::panel);
    if (tuning.empty() || wires.empty()) return;

    // Caption (what is shown)
    g.setColour (theme::text);
    g.setFont (juce::FontOptions (14.0f, juce::Font::bold));
    g.drawText (caption, getLocalBounds().reduced (10, 4).removeFromTop (18), juce::Justification::centredLeft);

    // Neck
    const auto neck = juce::Rectangle<float> (nutX, board.getY(), board.getRight() - nutX, board.getHeight());
    g.setGradientFill (juce::ColourGradient (juce::Colour (0xff231d16), neck.getX(), neck.getY(), juce::Colour (0xff17130f), neck.getX(), neck.getBottom(), false));
    g.fillRoundedRectangle (neck, 3.0f);

    // Inlays
    g.setColour (juce::Colour (0xff3a3128));
    for (int f : { 3, 5, 7, 9, 15, 17, 19, 21 })
        if (f <= numFrets) g.fillEllipse (juce::Rectangle<float> (9, 9).withCentre ({ noteX (f), neck.getCentreY() }));
    for (int f : { 12, 24 })
        if (f <= numFrets)
            for (float dy : { -0.25f, 0.25f })
                g.fillEllipse (juce::Rectangle<float> (9, 9).withCentre ({ noteX (f), neck.getCentreY() + dy * neck.getHeight() }));

    // Playing position
    if (window)
    {
        const float x0 = window->start <= 0 ? board.getX() : fretX (window->start - 1);
        const float x1 = fretX (std::min (window->end, numFrets));
        auto w = juce::Rectangle<float> (x0, board.getY() - 3, x1 - x0, board.getHeight() + 6);
        g.setColour (theme::accent.withAlpha (0.13f));
        g.fillRoundedRectangle (w, 5.0f);
        g.setColour (theme::accent.withAlpha (0.55f));
        g.drawRoundedRectangle (w, 5.0f, 1.2f);
    }

    // Frets and nut
    for (int f = 1; f <= numFrets; ++f)
    {
        g.setColour (juce::Colour (0xff8d8a86).withAlpha (0.8f));
        g.drawLine (fretX (f), neck.getY(), fretX (f), neck.getBottom(), 1.6f);
    }
    g.setColour (juce::Colour (0xffd9d2c3));
    g.fillRect (juce::Rectangle<float> (nutX - 3, neck.getY(), 4, neck.getHeight()));

    // Fret numbers
    g.setFont (juce::FontOptions (11.0f));
    for (int f = 0; f <= numFrets; ++f)
    {
        const bool marked = f == 0 || f == 3 || f == 5 || f == 7 || f == 9 || f == 12 || f == 15 || f == 17 || f == 19 || f == 21 || f == 24;
        g.setColour (marked ? theme::muted : theme::muted.withAlpha (0.45f));
        g.drawText (juce::String (f), juce::Rectangle<float> (noteX (f) - 12, board.getBottom() + 3, 24, 14), juce::Justification::centred);
    }

    // Strings and their names
    const int n = (int) tuning.size();
    for (int s = 0; s < n; ++s)
    {
        const float y = stringY (s);
        const float thick = 0.9f + 1.6f * (float) (n - 1 - s) / (float) std::max (1, n - 1); // low strings are thicker
        g.setColour (juce::Colour (0xffc9c4ba).withAlpha (0.85f));
        g.drawLine (board.getX(), y, board.getRight(), y, thick);
        g.setColour (theme::muted);
        g.setFont (juce::FontOptions (12.0f, juce::Font::bold));
        g.drawText (theme::u8 (fl::pcName (tuning[(size_t) s])), juce::Rectangle<float> (board.getX() - 30, y - 8, 24, 16), juce::Justification::centredRight);
    }

    // Notes
    const float rowGap = n > 1 ? std::abs (stringY (0) - stringY (1)) : 30.0f;
    for (int s = 0; s < n; ++s)
        for (int f = 0; f <= numFrets; ++f)
        {
            const int midi = tuning[(size_t) s] + f;
            const int pc = fl::mod12 (midi);
            const Marker* m = nullptr;
            for (auto& mk : markers)
                if (mk.pc == pc) m = &mk;
            const float x = noteX (f), y = stringY (s);
            const float cellW = f == 0 ? openWidth : fretX (f) - fretX (f - 1);
            const float d = std::min ({ rowGap * 0.86f, cellW * 0.86f, 24.0f });
            const bool inWindow = ! window || (f >= window->start && f <= window->end);
            const bool isHover = hover.string == s && hover.fret == f;
            if (m != nullptr)
            {
                auto c = theme::degreeColour (m->degree);
                const auto circle = juce::Rectangle<float> (d, d).withCentre ({ x, y });
                g.setColour (inWindow ? c : c.withAlpha (0.28f));
                g.fillEllipse (circle);
                if (pc == rootPc)
                {
                    g.setColour (inWindow ? juce::Colours::white.withAlpha (0.9f) : juce::Colours::white.withAlpha (0.3f));
                    g.drawEllipse (circle.reduced (0.5f), 1.6f);
                }
                juce::String label = labels == Labels::Notes ? theme::u8 (m->name) : labels == Labels::Degrees ? theme::u8 (fl::prettyDegree (m->degree)) : juce::String (f);
                g.setColour (inWindow ? theme::textOn (c) : theme::text.withAlpha (0.45f));
                g.setFont (juce::FontOptions (label.length() > 2 ? d * 0.42f : d * 0.5f, juce::Font::bold));
                g.drawText (label, circle.expanded (4, 0), juce::Justification::centred);
            }
            else
            {
                // Every other note is labelled faintly, so the whole neck can be read.
                g.setColour (theme::muted.withAlpha (isHover ? 0.95f : 0.32f));
                g.setFont (juce::FontOptions (std::min (11.0f, d * 0.5f)));
                const juce::String label = labels == Labels::Frets ? juce::String (f) : theme::u8 (fl::pcName (pc));
                g.drawText (label, juce::Rectangle<float> (d + 6, d).withCentre ({ x, y }), juce::Justification::centred);
            }
            if (isHover)
            {
                g.setColour (theme::text.withAlpha (0.6f));
                g.drawEllipse (juce::Rectangle<float> (d + 4, d + 4).withCentre ({ x, y }), 1.2f);
            }
            if (s == activeString && f == activeFret && activeGlow > 0.01f)
            {
                g.setColour (juce::Colours::white.withAlpha (0.25f * activeGlow));
                g.fillEllipse (juce::Rectangle<float> (d + 12, d + 12).withCentre ({ x, y }));
                g.setColour (juce::Colours::white.withAlpha (0.95f * activeGlow));
                g.drawEllipse (juce::Rectangle<float> (d + 5, d + 5).withCentre ({ x, y }), 2.4f);
            }
        }
}

void FretboardView::mouseDown (const juce::MouseEvent& e)
{
    const auto h = locate (e.position);
    if (h.string < 0 || h.fret < 0) return;
    const int midi = tuning[(size_t) h.string] + h.fret;
    if (e.mods.isPopupMenu())
    {
        if (onRightClick) onRightClick (h.string, h.fret, midi);
    }
    else if (onClick)
        onClick (h.string, h.fret, midi, e);
}

void FretboardView::mouseMove (const juce::MouseEvent& e)
{
    const auto h = locate (e.position);
    if (h.string != hover.string || h.fret != hover.fret)
    {
        hover = h;
        if (h.string >= 0)
        {
            const int midi = tuning[(size_t) h.string] + h.fret;
            setTooltip (theme::u8 (fl::midiName (midi)) + " - string " + juce::String ((int) tuning.size() - h.string) + ", fret " + juce::String (h.fret)
                        + "\nClick: add/remove the note in the arpeggio (or just play it) - right-click: position");
        }
        else
            setTooltip ({});
        repaint();
    }
}

void FretboardView::mouseExit (const juce::MouseEvent&)
{
    hover = {};
    repaint();
}
