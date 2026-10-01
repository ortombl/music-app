#include "PluginEditor.h"

#include <cmath>

using theme::u8;

namespace
{
juce::String percent (double fit) { return juce::String (juce::roundToInt (fit * 100)) + "%"; }

juce::String framesText (const fl::FretWindow& w) { return "frets " + juce::String (w.start) + juce::String::fromUTF8 ("\xE2\x80\x93") + juce::String (w.end); }

juce::String notesOf (const fl::Arpeggio& a)
{
    juce::StringArray s;
    for (auto& n : a.notes) s.add (u8 (n.name));
    return s.joinIntoString (" ");
}

void styleCombo (juce::ComboBox& c, const juce::String& tip)
{
    c.setTooltip (tip);
    c.setJustificationType (juce::Justification::centredLeft);
}

void fillChoices (juce::ComboBox& box, juce::RangedAudioParameter* p)
{
    if (auto* choice = dynamic_cast<juce::AudioParameterChoice*> (p))
        for (int i = 0; i < choice->choices.size(); ++i) box.addItem (choice->choices[i], i + 1);
}

const int kLengths[] = { 1, 2, 3, 4, 6, 8, 12, 16 };
} // namespace

ArpEditor::ArpEditor (ArpProcessor& p) : AudioProcessorEditor (&p), proc (p)
{
    setLookAndFeel (&lnf);

    // ---- Header ----
    title.setText ("Fretboard Lab Arp", juce::dontSendNotification);
    title.setFont (juce::FontOptions (19.0f, juce::Font::bold));
    title.setColour (juce::Label::textColourId, theme::text);
    addAndMakeVisible (title);

    const auto& tunings = fl::tunings();
    juce::String group;
    for (int i = 0; i < (int) tunings.size(); ++i)
    {
        if (u8 (tunings[(size_t) i].group) != group)
        {
            group = u8 (tunings[(size_t) i].group);
            tuningBox.addSectionHeading (group);
        }
        tuningBox.addItem (u8 (tunings[(size_t) i].name) + "  (" + u8 (fl::tuningText (tunings[(size_t) i].strings)) + ")", i + 1);
    }
    styleCombo (tuningBox, "Tuning - every chord, arpeggio and position is worked out for it");
    tuningBox.onChange = [this] {
        const int id = tuningBox.getSelectedId();
        if (id < 1 || id > (int) fl::tunings().size()) return;
        const auto& t = fl::tunings()[(size_t) id - 1];
        if (t.strings == doc.tuning && t.id == doc.tuningId) return;
        fl::Song s = doc;
        s.tuning = t.strings;
        s.tuningId = t.id;
        commit (s, selected, "Tuning: " + u8 (t.name) + " (" + u8 (fl::tuningText (t.strings)) + ").");
    };
    addAndMakeVisible (tuningBox);

    fretsBox.addItem ("22 frets", 22);
    fretsBox.addItem ("24 frets", 24);
    styleCombo (fretsBox, "Number of frets");
    fretsBox.onChange = [this] {
        if (fretsBox.getSelectedId() == doc.numFrets || fretsBox.getSelectedId() == 0) return;
        fl::Song s = doc;
        s.numFrets = fretsBox.getSelectedId();
        commit (s, selected);
    };
    addAndMakeVisible (fretsBox);

    labelsBox.addItem ("Note names", 1);
    labelsBox.addItem ("Intervals", 2);
    labelsBox.addItem ("Fret numbers", 3);
    labelsBox.setSelectedId (1, juce::dontSendNotification);
    styleCombo (labelsBox, "What the arpeggio notes on the fretboard show");
    labelsBox.onChange = [this] { fretboard.setLabels ((FretboardView::Labels) (labelsBox.getSelectedId() - 1)); };
    addAndMakeVisible (labelsBox);

    clickBox.addItem ("Click: edit arpeggio", 1);
    clickBox.addItem ("Click: just play", 2);
    clickBox.setSelectedId (1, juce::dontSendNotification);
    styleCombo (clickBox, "Edit: clicking a note adds it to (or removes it from) the selected chord's arpeggio and plays it.\nJust play: the fretboard is an instrument; nothing changes.");
    addAndMakeVisible (clickBox);

    importBtn.setTooltip ("Load a progression + arpeggios saved by the web app or by this plugin (.txt). You can also drop a .txt file on the window.");
    exportBtn.setTooltip ("Save the progression with every chord's arpeggio, position and length (.txt - the web app's format)");
    copyBtn.setTooltip ("Copy the export text to the clipboard");
    pasteBtn.setTooltip ("Import text from the clipboard (e.g. copied in the web app)");
    importBtn.onClick = [this] { doImport(); };
    exportBtn.onClick = [this] { doExport(); };
    copyBtn.onClick = [this] {
        juce::SystemClipboard::copyTextToClipboard (u8 (proc.exportText()));
        showStatus ("Copied the progression + arpeggios to the clipboard.");
    };
    pasteBtn.onClick = [this] { importFromText (juce::SystemClipboard::getTextFromClipboard(), "the clipboard"); };
    for (auto* b : { &importBtn, &exportBtn, &copyBtn, &pasteBtn }) addAndMakeVisible (b);

    status.setColour (juce::Label::textColourId, theme::muted);
    status.setFont (juce::FontOptions (13.0f));
    addAndMakeVisible (status);

    fretboard.onClick = [this] (int s, int f, int m, const juce::MouseEvent& e) { fretClick (s, f, m, e); };
    fretboard.onRightClick = [this] (int s, int f, int m) { fretRightClick (s, f, m); };
    addAndMakeVisible (fretboard);

    // ---- Progression ----
    progressionLbl.setText ("Progression", juce::dontSendNotification);
    progressionLbl.setColour (juce::Label::textColourId, theme::muted);
    addAndMakeVisible (progressionLbl);
    progressionEd.setTextToShowWhenEmpty ("Am7 | D7 | Gmaj7 Cmaj7 | Eb(add#11,no3) ...", theme::muted);
    progressionEd.setTooltip ("Type chords separated by spaces or |, then press Enter (\"%\" repeats the previous chord)");
    progressionEd.onReturnKey = [this] { setProgressionFromText(); };
    addAndMakeVisible (progressionEd);
    setBtn.setTooltip ("Use the typed progression (each chord keeps the arpeggio/position/length of its place)");
    setBtn.onClick = [this] { setProgressionFromText(); };
    addBtn.setTooltip ("Add a chord after the selected one");
    addBtn.onClick = [this] { addChord(); };
    removeBtn.setTooltip ("Remove the selected chord");
    removeBtn.onClick = [this] { removeChord(); };
    leftBtn.setTooltip ("Move the selected chord left");
    rightBtn.setTooltip ("Move the selected chord right");
    leftBtn.onClick = [this] { moveChord (-1); };
    rightBtn.onClick = [this] { moveChord (1); };
    for (auto* b : { &setBtn, &addBtn, &removeBtn, &leftBtn, &rightBtn }) addAndMakeVisible (b);
    followToggle.setToggleState (true, juce::dontSendNotification);
    followToggle.setTooltip ("While playing, select (and show on the fretboard) the chord that is being played");
    addAndMakeVisible (followToggle);
    strip.onSelect = [this] (int i) { select (i); };
    stripView.setViewedComponent (&strip, false);
    stripView.setScrollBarsShown (false, true);
    stripView.setScrollBarThickness (8);
    addAndMakeVisible (stripView);

    // ---- Selected chord ----
    for (auto [l, t] : { std::pair { &chordLbl, "Chord" }, { &arpLbl, "Arpeggio" }, { &ownLbl, "Your own" }, { &posLbl, "Position" }, { &lenLbl, "Length" } })
    {
        l->setText (t, juce::dontSendNotification);
        l->setColour (juce::Label::textColourId, theme::muted);
        addAndMakeVisible (*l);
    }
    chordEd.setTooltip ("The chord symbol - e.g. Am7, C#m7b5, Bbmaj7/D, G7(#9), Eb(add#11,no3) - or its notes (E G B D). Enter to apply.");
    chordEd.onReturnKey = [this] { applyChordText(); };
    chordEd.onFocusLost = [this] { applyChordText(); };
    addAndMakeVisible (chordEd);
    styleCombo (arpBox, "The arpeggio played over this chord: its own, a suggestion (best fit first) or your own");
    arpBox.onChange = [this] { onArpChoice(); };
    addAndMakeVisible (arpBox);
    ownArpEd.setTextToShowWhenEmpty ("Type an arpeggio: Bbmaj7, F#m7b5, E(add#11,no3) or notes E G B D", theme::muted);
    ownArpEd.setTooltip ("Your own arpeggio for this chord - a chord symbol or a list of notes. It is recognised and rated like the suggestions. Enter to use it.");
    ownArpEd.onReturnKey = [this] { applyArpText(); };
    ownArpEd.onTextChange = [this] { previewArpText(); };
    addAndMakeVisible (ownArpEd);
    useBtn.onClick = [this] { applyArpText(); };
    useBtn.setTooltip ("Use the typed arpeggio for this chord");
    ownBtn.onClick = [this] {
        fl::Song s = doc;
        if (selected < (int) s.slots.size()) s.slots[(size_t) selected].arp.clear();
        commit (s, selected, "Back to the chord's own arpeggio.");
    };
    ownBtn.setTooltip ("Play the chord's own arpeggio again");
    addAndMakeVisible (useBtn);
    addAndMakeVisible (ownBtn);
    pickLbl.setText ("Quick pick", juce::dontSendNotification);
    pickLbl.setColour (juce::Label::textColourId, theme::muted);
    addAndMakeVisible (pickLbl);
    for (size_t k = 0; k < picks.size(); ++k)
    {
        picks[k].setClickingTogglesState (false);
        picks[k].onClick = [this, k] {
            const auto* r = current();
            if (r == nullptr || ! r->chordOk) return;
            fl::Song s = doc;
            s.slots.resize (s.chords.size());
            if (k == 0) s.slots[(size_t) selected].arp.clear();
            else if (k - 1 < r->subs.size()) s.slots[(size_t) selected].arp = fl::toAscii (r->subs[k - 1].name);
            commit (s, selected);
            if (const auto* r2 = current()) showStatus ("Chord " + juce::String (selected + 1) + " plays " + u8 (r2->arp.name) + (k == 0 ? juce::String (" (its own arpeggio).") : " (fit " + percent (r2->arp.fit) + ")."));
        };
        addAndMakeVisible (picks[k]);
    }
    styleCombo (posBox, "Where on the neck this chord's arpeggio is played");
    posBox.onChange = [this] { onPositionChoice(); };
    addAndMakeVisible (posBox);
    for (int b : kLengths) lenBox.addItem (u8 (fl::beatsText (b)), b);
    styleCombo (lenBox, "How long the chord lasts (in 4/4)");
    lenBox.onChange = [this] { onLengthChoice(); };
    addAndMakeVisible (lenBox);
    info.setMultiLine (true, true);
    info.setReadOnly (true);
    info.setCaretVisible (false);
    info.setScrollbarsShown (true);
    info.setColour (juce::TextEditor::backgroundColourId, theme::panel);
    info.setColour (juce::TextEditor::outlineColourId, theme::border);
    info.setFont (juce::FontOptions (13.5f));
    addAndMakeVisible (info);

    // ---- Playback ----
    auto& apvts = proc.params;
    auto addLabelled = [this] (juce::Component& c, const juce::String& text) {
        auto l = std::make_unique<juce::Label> ("", text);
        l->setColour (juce::Label::textColourId, theme::muted);
        l->setFont (juce::FontOptions (12.0f));
        addAndMakeVisible (*l);
        addAndMakeVisible (c);
        labelled.push_back ({ std::move (l), &c });
    };
    struct ComboSpec
    {
        juce::ComboBox* box;
        const char* id;
        const char* label;
        const char* tip;
    };
    for (auto& spec : { ComboSpec { &modeBox, ids::mode, "Mode", "Progression: plays the chords in order, in sync with the host (or press Play).\nKeys pick chord: MIDI keys from 'First chord key' up choose chord 1, 2, 3...\nKeys play notes: hold any notes - they are arpeggiated as a guitar part in the selected chord's position." },
                        ComboSpec { &rateBox, ids::rate, "Rate", "Note value of the arpeggio steps" },
                        ComboSpec { &patternBox, ids::pattern, "Pattern", "Voice-led: each chord starts on the note nearest to the last one (like the web app); Up / Down / Up & down from the root; Random" },
                        ComboSpec { &backingBox, ids::backing, "Backing", "Strum the chord (and a bass note) under the arpeggio - sent on MIDI channel 2" } })
    {
        fillChoices (*spec.box, apvts.getParameter (spec.id));
        styleCombo (*spec.box, spec.tip);
        comboAttachments.push_back (std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment> (apvts, spec.id, *spec.box));
        addLabelled (*spec.box, spec.label);
    }
    styleCombo (allPosBox, "The position used by every chord set to 'Same as all'");
    allPosBox.onChange = [this] { onGlobalPosition(); };
    addLabelled (allPosBox, "Position for all chords");

    struct SliderSpec
    {
        juce::Slider* s;
        const char* id;
        const char* label;
        const char* tip;
    };
    for (auto& spec : { SliderSpec { &gateSl, ids::gate, "Gate", "Note length as a fraction of a step (above 1 = let ring)" },
                        SliderSpec { &velSl, ids::velocity, "Velocity", "MIDI velocity of the arpeggio notes (accents are added on the beat)" },
                        SliderSpec { &tempoSl, ids::tempo, "Tempo", "Tempo of the plugin's own clock (the host's tempo is used while it plays)" },
                        SliderSpec { &keySl, ids::keyBase, "First chord key", "In 'Keys pick chord' mode this key plays chord 1, the next key chord 2..." },
                        SliderSpec { &levelSl, ids::level, "Level", "Volume of the internal guitar" },
                        SliderSpec { &toneSl, ids::tone, "Tone", "Brightness of the internal guitar" },
                        SliderSpec { &backingSl, ids::backingLevel, "Backing level", "Volume of the strummed backing (internal guitar)" } })
    {
        spec.s->setSliderStyle (juce::Slider::LinearHorizontal);
        spec.s->setTextBoxStyle (juce::Slider::TextBoxRight, false, 62, 20);
        spec.s->setTooltip (spec.tip);
        sliderAttachments.push_back (std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment> (apvts, spec.id, *spec.s));
        addLabelled (*spec.s, spec.label);
    }
    soundToggle.setTooltip ("Play the built-in plucked-string sound. Turn it off to only send MIDI (arpeggio on channel 1, backing on channel 2) to another instrument.");
    soundAttachment = std::make_unique<juce::AudioProcessorValueTreeState::ButtonAttachment> (apvts, ids::sound, soundToggle);
    addAndMakeVisible (soundToggle);
    playBtn.setTooltip ("Play / stop the progression with the plugin's own clock (it also follows the host's transport)");
    playBtn.setColour (juce::TextButton::buttonColourId, theme::accent);
    playBtn.onClick = [this] { proc.setRunning (! proc.isRunning()); };
    addAndMakeVisible (playBtn);
    modeHint.setColour (juce::Label::textColourId, theme::muted);
    modeHint.setFont (juce::FontOptions (12.5f));
    addAndMakeVisible (modeHint);

    setResizable (true, true);
    setResizeLimits (1040, 660, 2000, 1300);
    setSize (1260, 700);
    refreshFromProcessor();
    showStatus ("Click the fretboard to add or remove notes of the selected chord's arpeggio; right-click for its position. Import/Export use the web app's .txt format.");
    startTimerHz (30);
}

ArpEditor::~ArpEditor()
{
    stopTimer();
    setLookAndFeel (nullptr);
}

void ArpEditor::paint (juce::Graphics& g) { g.fillAll (theme::bg); }

void ArpEditor::resized()
{
    auto area = getLocalBounds().reduced (10, 8);

    auto header = area.removeFromTop (30);
    title.setBounds (header.removeFromLeft (180));
    for (auto* btn : { &pasteBtn, &copyBtn })
    {
        btn->setBounds (header.removeFromRight (62));
        header.removeFromRight (6);
    }
    for (auto* btn : { &exportBtn, &importBtn })
    {
        btn->setBounds (header.removeFromRight (100));
        header.removeFromRight (6);
    }
    tuningBox.setBounds (header.removeFromLeft (std::min (330, header.getWidth() / 2)));
    header.removeFromLeft (6);
    fretsBox.setBounds (header.removeFromLeft (92));
    header.removeFromLeft (6);
    labelsBox.setBounds (header.removeFromLeft (116));
    header.removeFromLeft (6);
    clickBox.setBounds (header.removeFromLeft (std::min (170, header.getWidth())));

    status.setBounds (area.removeFromTop (22));
    const int boardHeight = juce::jlimit (190, 300, 56 + (int) doc.tuning.size() * 26);
    fretboard.setBounds (area.removeFromTop (boardHeight));
    area.removeFromTop (8);

    auto prog = area.removeFromTop (28);
    progressionLbl.setBounds (prog.removeFromLeft (84));
    followToggle.setBounds (prog.removeFromRight (130));
    for (auto* btn : { &rightBtn, &leftBtn })
    {
        btn->setBounds (prog.removeFromRight (30));
        prog.removeFromRight (4);
    }
    removeBtn.setBounds (prog.removeFromRight (74));
    prog.removeFromRight (4);
    addBtn.setBounds (prog.removeFromRight (74));
    prog.removeFromRight (4);
    setBtn.setBounds (prog.removeFromRight (50));
    prog.removeFromRight (6);
    progressionEd.setBounds (prog);
    area.removeFromTop (4);
    stripView.setBounds (area.removeFromTop (78));
    strip.setSize (std::max (strip.preferredWidth(), stripView.getWidth()), 70);
    area.removeFromTop (8);

    // Playback controls (bottom): two rows of labelled controls
    auto controls = area.removeFromBottom (100);
    area.removeFromBottom (8);
    auto rowA = controls.removeFromTop (46);
    controls.removeFromTop (6);
    auto rowB = controls;
    auto place = [this] (juce::Component* c, juce::Rectangle<int> cell) {
        for (auto& [label, comp] : labelled)
            if (comp == c)
            {
                label->setBounds (cell.removeFromTop (16));
                comp->setBounds (cell.withSizeKeepingCentre (cell.getWidth(), std::min (26, cell.getHeight())));
                return;
            }
        c->setBounds (cell.removeFromBottom (26));
    };
    {
        auto r = rowA;
        place (&modeBox, r.removeFromLeft (170));
        r.removeFromLeft (8);
        place (&rateBox, r.removeFromLeft (110));
        r.removeFromLeft (8);
        place (&patternBox, r.removeFromLeft (120));
        r.removeFromLeft (8);
        place (&backingBox, r.removeFromLeft (124));
        r.removeFromLeft (8);
        place (&allPosBox, r.removeFromLeft (170));
        r.removeFromLeft (12);
        playBtn.setBounds (r.removeFromLeft (84).removeFromBottom (28));
        r.removeFromLeft (10);
        soundToggle.setBounds (r.removeFromLeft (140).removeFromBottom (28));
        r.removeFromLeft (8);
        modeHint.setBounds (r.removeFromBottom (28));
    }
    {
        auto r = rowB;
        const int w = (r.getWidth() - 6 * 10) / 7;
        for (auto* s : { &gateSl, &velSl, &tempoSl, &keySl, &levelSl, &toneSl, &backingSl })
        {
            place (s, r.removeFromLeft (w));
            r.removeFromLeft (10);
        }
    }

    // Selected chord panel
    auto panel = area;
    auto left = panel.removeFromLeft (std::min (640, panel.getWidth() * 55 / 100));
    panel.removeFromLeft (10);
    info.setBounds (panel);
    auto row1 = left.removeFromTop (28);
    chordLbl.setBounds (row1.removeFromLeft (70));
    chordEd.setBounds (row1.removeFromLeft (150));
    row1.removeFromLeft (12);
    posLbl.setBounds (row1.removeFromLeft (62));
    posBox.setBounds (row1.removeFromLeft (std::max (120, row1.getWidth() - 180)));
    row1.removeFromLeft (10);
    lenLbl.setBounds (row1.removeFromLeft (52));
    lenBox.setBounds (row1);
    left.removeFromTop (8);
    auto row2 = left.removeFromTop (28);
    arpLbl.setBounds (row2.removeFromLeft (70));
    arpBox.setBounds (row2);
    left.removeFromTop (8);
    auto row3 = left.removeFromTop (28);
    ownLbl.setBounds (row3.removeFromLeft (70));
    ownBtn.setBounds (row3.removeFromRight (100));
    row3.removeFromRight (6);
    useBtn.setBounds (row3.removeFromRight (56));
    row3.removeFromRight (6);
    ownArpEd.setBounds (row3);
    left.removeFromTop (8);
    auto row4 = left.removeFromTop (28);
    pickLbl.setBounds (row4.removeFromLeft (70));
    const int pw = (row4.getWidth() - 4 * ((int) picks.size() - 1)) / (int) picks.size();
    for (auto& b : picks)
    {
        b.setBounds (row4.removeFromLeft (pw));
        row4.removeFromLeft (4);
    }
}

// ---- State <-> UI ------------------------------------------------------------------------------
const fl::ResolvedSlot* ArpEditor::current() const
{
    const auto& res = proc.getResolved();
    return selected >= 0 && selected < (int) res.size() ? &res[(size_t) selected] : nullptr;
}

void ArpEditor::commit (const fl::Song& s, int sel, const juce::String& message)
{
    proc.selectedSlot = juce::jlimit (0, std::max (0, (int) s.chords.size() - 1), sel);
    proc.setSong (s);
    refreshFromProcessor();
    if (message.isNotEmpty()) showStatus (message);
}

void ArpEditor::select (int i)
{
    selected = juce::jlimit (0, std::max (0, (int) doc.chords.size() - 1), i);
    proc.selectedSlot = selected;
    strip.setSelected (selected);
    // keep the selected card visible
    const int x = ChordStrip::gap + selected * (ChordStrip::cardWidth + ChordStrip::gap);
    if (x < stripView.getViewPositionX() || x + ChordStrip::cardWidth > stripView.getViewPositionX() + stripView.getWidth())
        stripView.setViewPosition (std::max (0, x - 40), 0);
    refreshSlotPanel();
    refreshFretboard();
}

void ArpEditor::showStatus (const juce::String& text, bool good)
{
    status.setText (text, juce::dontSendNotification);
    status.setColour (juce::Label::textColourId, good ? theme::muted : theme::warning);
}

void ArpEditor::refreshFromProcessor()
{
    const int oldStrings = (int) doc.tuning.size();
    doc = proc.getSong();
    seenVersion = proc.getSongVersion();
    selected = juce::jlimit (0, std::max (0, (int) doc.chords.size() - 1), proc.selectedSlot.load());

    // Tuning
    int tid = 0;
    for (int i = 0; i < (int) fl::tunings().size(); ++i)
        if (fl::tunings()[(size_t) i].id == doc.tuningId && fl::tunings()[(size_t) i].strings == doc.tuning) tid = i + 1;
    tuningBox.setSelectedId (tid, juce::dontSendNotification);
    if (tid == 0) tuningBox.setText ("Custom (" + u8 (fl::tuningText (doc.tuning)) + ")", juce::dontSendNotification);
    fretsBox.setSelectedId (doc.numFrets, juce::dontSendNotification);
    if (fretsBox.getSelectedId() == 0) fretsBox.setText (juce::String (doc.numFrets) + " frets", juce::dontSendNotification);

    // Progression text + cards
    const auto& res = proc.getResolved();
    if (! progressionEd.hasKeyboardFocus (true))
    {
        juce::StringArray names;
        for (size_t i = 0; i < doc.chords.size(); ++i) names.add (i < res.size() && res[i].chordOk ? u8 (fl::toAscii (res[i].chordName)) : u8 (doc.chords[i]));
        progressionEd.setText (names.joinIntoString (" | "), false);
    }
    std::vector<ChordStrip::Card> cards;
    for (size_t i = 0; i < doc.chords.size() && i < res.size(); ++i)
    {
        const auto& r = res[i];
        ChordStrip::Card c;
        c.chord = u8 (r.chordName);
        c.error = ! r.chordOk;
        if (! r.chordOk) c.arp = "not recognised";
        else if (r.kind == fl::ResolvedSlot::Kind::Own) c.arp = "own: " + u8 (r.arp.name);
        else
        {
            c.arp = (r.kind == fl::ResolvedSlot::Kind::Custom ? "* " : juce::String::fromUTF8 ("\xE2\x86\x92 ")) + u8 (r.arp.name) + "  " + percent (r.arp.fit);
            c.custom = r.kind == fl::ResolvedSlot::Kind::Custom;
        }
        const auto slot = doc.slotAt (i);
        juce::String pos = slot.pos.kind == fl::SlotPosition::Global ? (doc.position ? "all: " + framesText (*doc.position) : juce::String ("all: neck"))
                           : slot.pos.kind == fl::SlotPosition::Neck ? juce::String ("whole neck")
                                                                     : framesText (slot.pos.window);
        c.detail = u8 (fl::beatsText (slot.beats)) + juce::String::fromUTF8 (" \xC2\xB7 ") + pos;
        cards.push_back (c);
    }
    strip.setCards (cards);
    strip.setSize (std::max (strip.preferredWidth(), stripView.getWidth()), 70);
    strip.setSelected (selected);

    // Global position
    allPosBox.clear (juce::dontSendNotification);
    allPosBox.addItem ("Whole neck", 1);
    for (int s = 0; s + 4 <= doc.numFrets; ++s) allPosBox.addItem ("Frets " + juce::String (s) + juce::String::fromUTF8 ("\xE2\x80\x93") + juce::String (s + 4), 100 + s);
    if (doc.position && doc.position->end - doc.position->start != 4)
        allPosBox.addItem (framesText (*doc.position), 1000);
    allPosBox.setSelectedId (! doc.position ? 1 : doc.position->end - doc.position->start == 4 ? 100 + doc.position->start : 1000, juce::dontSendNotification);

    if ((int) doc.tuning.size() != oldStrings) resized();
    refreshSlotPanel();
    refreshFretboard();
}

void ArpEditor::refreshSlotPanel()
{
    const auto* r = current();
    const auto slot = doc.slotAt ((size_t) selected);
    if (! chordEd.hasKeyboardFocus (true)) chordEd.setText (selected < (int) doc.chords.size() ? u8 (doc.chords[(size_t) selected]) : juce::String(), false);
    chordEd.setColour (juce::TextEditor::textColourId, r != nullptr && ! r->chordOk ? theme::error : theme::text);

    arpBox.clear (juce::dontSendNotification);
    posBox.clear (juce::dontSendNotification);
    posWindows.clear();
    for (size_t k = 0; k < picks.size(); ++k)
    {
        const bool has = r != nullptr && r->chordOk && (k == 0 || k - 1 < r->subs.size());
        picks[k].setVisible (has);
        if (! has) continue;
        const auto& a = k == 0 ? r->exact.front() : r->subs[k - 1];
        picks[k].setButtonText (k == 0 ? "Own: " + u8 (a.name) : u8 (a.name) + " " + percent (a.fit));
        picks[k].setTooltip (u8 (a.name) + " (" + notesOf (a) + ")" + (k == 0 ? juce::String (" - the chord's own arpeggio") : " - " + u8 (a.description)));
        const bool on = k == 0 ? r->kind == fl::ResolvedSlot::Kind::Own : r->kind == fl::ResolvedSlot::Kind::Suggested && r->subIndex == (int) k - 1;
        picks[k].setToggleState (on, juce::dontSendNotification);
    }
    if (r == nullptr || ! r->chordOk)
    {
        info.setText (r != nullptr ? u8 (r->error) + "\nType a chord symbol such as Am7, C#m7b5, Bbmaj7/D, G7(#9), Eb(add#11,no3) - or its notes." : juce::String(), false);
        return;
    }
    const auto& own = r->exact.front();
    arpBox.addItem ("Own: " + u8 (own.name) + "  (" + notesOf (own) + ")", 1);
    arpBox.addSectionHeading ("Suggested - best fit first");
    for (size_t k = 0; k < r->subs.size(); ++k)
    {
        const auto& s = r->subs[k];
        juce::String t = percent (s.fit) + "  " + u8 (s.name);
        if (! s.sound.empty() && s.sound != r->chordName) t << juce::String::fromUTF8 ("  \xE2\x86\x92 ") << u8 (s.sound);
        t << "   (" << notesOf (s) << ")";
        arpBox.addItem (t, 100 + (int) k);
    }
    if (r->kind == fl::ResolvedSlot::Kind::Custom)
    {
        arpBox.addSectionHeading ("Your arpeggio");
        arpBox.addItem ("* " + u8 (r->arp.name) + "  " + percent (r->arp.fit) + "   (" + notesOf (r->arp) + ")", 2);
    }
    arpBox.addSeparator();
    arpBox.addItem ("Type your own arpeggio...", 3);
    arpBox.setSelectedId (r->kind == fl::ResolvedSlot::Kind::Own ? 1 : r->kind == fl::ResolvedSlot::Kind::Suggested ? 100 + r->subIndex : 2, juce::dontSendNotification);
    if (! ownArpEd.hasKeyboardFocus (true)) ownArpEd.setText (u8 (slot.arp), false);

    // Positions: the 5-fret windows around the roots of the arpeggio and of the chord
    posBox.addItem ("Same as all (" + (doc.position ? framesText (*doc.position) : juce::String ("whole neck")) + ")", 1);
    posBox.addItem ("Whole neck", 2);
    auto addWindows = [&] (int rootPc) {
        for (auto& w : fl::rootPositions (doc.tuning, doc.numFrets, rootPc))
            if (std::find (posWindows.begin(), posWindows.end(), w) == posWindows.end()) posWindows.push_back (w);
    };
    addWindows (r->arp.chord.root);
    addWindows (r->chord.root);
    if (slot.pos.kind == fl::SlotPosition::Window && std::find (posWindows.begin(), posWindows.end(), slot.pos.window) == posWindows.end()) posWindows.push_back (slot.pos.window);
    std::sort (posWindows.begin(), posWindows.end(), [] (auto& a, auto& b) { return a.start < b.start; });
    for (size_t k = 0; k < posWindows.size(); ++k) posBox.addItem ("Frets " + juce::String (posWindows[k].start) + juce::String::fromUTF8 ("\xE2\x80\x93") + juce::String (posWindows[k].end), 10 + (int) k);
    int posId = slot.pos.kind == fl::SlotPosition::Global ? 1 : slot.pos.kind == fl::SlotPosition::Neck ? 2 : 0;
    for (size_t k = 0; k < posWindows.size() && posId == 0; ++k)
        if (posWindows[k] == slot.pos.window) posId = 10 + (int) k;
    posBox.setSelectedId (posId, juce::dontSendNotification);

    if (lenBox.indexOfItemId (slot.beats) < 0) lenBox.addItem (u8 (fl::beatsText (slot.beats)), slot.beats);
    lenBox.setSelectedId (slot.beats, juce::dontSendNotification);

    // Description
    const auto& a = r->arp;
    juce::String t;
    t << u8 (a.name) << (r->kind == fl::ResolvedSlot::Kind::Own ? " - the chord's own arpeggio" : " over " + u8 (r->chordName));
    if (r->kind != fl::ResolvedSlot::Kind::Own) t << "  -  fit " << percent (a.fit);
    if (! a.sound.empty() && a.sound != r->chordName) t << juce::String::fromUTF8 ("  \xE2\x86\x92 ") << u8 (a.sound);
    t << "\nNotes: " << notesOf (a);
    if (! r->recognisedFrom.empty()) t << "   (recognised from " << u8 (r->recognisedFrom) << ")";
    t << "\n" << u8 (a.description);
    if (! a.scaleLabel.empty() && r->kind != fl::ResolvedSlot::Kind::Own) t << " (from " << u8 (a.scaleLabel) << ")";
    if (! a.warning.empty()) t << "\n! " << u8 (a.warning);
    if (! r->error.empty()) t << "\n! Saved arpeggio \"" << u8 (slot.arp) << "\" could not be read - using the chord's own arpeggio.";
    t << "\n\nChord tones: ";
    juce::StringArray tones;
    for (auto& n : r->chord.toneNames()) tones.add (u8 (n));
    t << tones.joinIntoString (" ") << "  (" << u8 (r->chord.type->name) << ")";
    info.setText (t, false);
}

void ArpEditor::refreshFretboard()
{
    fretboard.setBoard (doc.tuning, doc.numFrets);
    std::vector<FretboardView::Marker> markers;
    const auto win = doc.windowFor ((size_t) selected);

    if (proc.getMode() == PlayMode::KeysPlayNotes && (lastHeldLow | lastHeldHigh) != 0)
    {
        std::vector<int> midis;
        for (int n = 0; n < 128; ++n)
            if ((n < 64 ? (lastHeldLow >> n) : (lastHeldHigh >> (n - 64))) & 1) midis.push_back (n);
        std::vector<int> pcs;
        for (int m : midis)
            if (std::find (pcs.begin(), pcs.end(), fl::mod12 (m)) == pcs.end()) pcs.push_back (fl::mod12 (m));
        const auto matches = fl::identifyChord (midis);
        juce::String name = matches.empty() ? u8 (fl::pcName (pcs.front())) : u8 (matches.front().name);
        const fl::Chord* c = matches.empty() ? nullptr : &matches.front().chord;
        for (int pc : pcs)
        {
            FretboardView::Marker m;
            m.pc = pc;
            m.degree = c ? fl::labelInChord (pc - c->root, c->type->degrees) : "1";
            m.name = fl::pcName (pc);
            markers.push_back (m);
        }
        fretboard.setMarkers (markers, win, c ? c->root : pcs.front());
        fretboard.setCaption ("Keys: " + name + "  (" + u8 (fl::notesText (pcs, c)) + ")");
        return;
    }

    const auto* r = current();
    if (r == nullptr || ! r->chordOk)
    {
        fretboard.setMarkers ({}, win, -1);
        fretboard.setCaption (r != nullptr ? "Chord \"" + u8 (doc.chords[(size_t) selected]) + "\" not recognised" : juce::String());
        return;
    }
    for (auto& n : r->arp.notes) markers.push_back ({ n.pc, n.label, n.name });
    fretboard.setMarkers (markers, win, r->arp.chord.root);
    juce::String cap;
    cap << "Chord " << (selected + 1) << " of " << (int) doc.chords.size() << ":  " << u8 (r->chordName) << "   -   arpeggio " << u8 (r->arp.name) << "  (" << notesOf (r->arp) << ")"
        << "   -   " << (win ? framesText (*win) : juce::String ("whole neck"));
    fretboard.setCaption (cap);
}

void ArpEditor::timerCallback()
{
    if (proc.getSongVersion() != seenVersion) refreshFromProcessor();

    const bool running = proc.play.running.load();
    const int playing = running ? proc.play.slot.load() : -1;
    strip.setPlaying (proc.getMode() == PlayMode::KeysPlayNotes ? -1 : playing);
    const bool editing = chordEd.hasKeyboardFocus (true) || ownArpEd.hasKeyboardFocus (true) || progressionEd.hasKeyboardFocus (true);
    if (followToggle.getToggleState() && playing >= 0 && playing != selected && ! editing && playing < (int) doc.chords.size()) select (playing);
    if (proc.getMode() == PlayMode::KeysPickChord && proc.selectedSlot.load() != selected && ! editing) select (proc.selectedSlot.load());

    const uint64_t lo = proc.play.heldLow.load(), hi = proc.play.heldHigh.load();
    if (lo != lastHeldLow || hi != lastHeldHigh)
    {
        lastHeldLow = lo;
        lastHeldHigh = hi;
        if (proc.getMode() == PlayMode::KeysPlayNotes) refreshFretboard();
    }

    const auto serial = proc.play.noteSerial.load();
    const double now = juce::Time::getMillisecondCounterHiRes();
    if (serial != lastSerial)
    {
        lastSerial = serial;
        glowStart = now;
    }
    const float glow = (float) juce::jlimit (0.0, 1.0, 1.0 - (now - glowStart) / 450.0);
    fretboard.setActive (proc.play.noteString.load(), proc.play.noteFret.load(), glow);

    // Transport button and hint
    const auto mode = proc.getMode();
    const bool host = proc.play.hostPlaying.load();
    playBtn.setEnabled (mode == PlayMode::Progression);
    playBtn.setButtonText (proc.isRunning() ? "Stop" : "Play");
    playBtn.setColour (juce::TextButton::buttonColourId, proc.isRunning() ? theme::accent.darker (0.3f) : theme::accent);
    juce::String hint;
    if (mode == PlayMode::Progression) hint = host ? "Following the host's transport" : proc.isRunning() ? "Playing with the plugin's clock" : "Start the host or press Play";
    else if (mode == PlayMode::KeysPickChord)
        hint = "Keys " + juce::MidiMessage::getMidiNoteName ((int) keySl.getValue(), true, true, 4) + " and up pick chords 1-" + juce::String ((int) doc.chords.size());
    else
        hint = "Hold notes on your MIDI keyboard - they are played as a guitar arpeggio";
    modeHint.setText (hint, juce::dontSendNotification);
    if (running != wasRunning)
    {
        wasRunning = running;
        if (! running) refreshFretboard();
    }
}

// ---- Actions -----------------------------------------------------------------------------------
void ArpEditor::setProgressionFromText()
{
    const auto tokens = fl::tokenizeProgression (progressionEd.getText().toStdString());
    fl::Song s = doc;
    std::vector<std::string> chords, bad;
    for (auto& t : tokens)
    {
        if (t == "%" || t == "-" || t == "/")
        {
            if (! chords.empty()) chords.push_back (chords.back());
            continue;
        }
        if (fl::parseChordSymbol (t) || fl::parseArpInput (t).ok) chords.push_back (t);
        else bad.push_back (t);
    }
    if (chords.empty())
    {
        showStatus (bad.empty() ? "Type some chords first, e.g. Am7 | D7 | Gmaj7" : "Not recognised: " + u8 (bad.front()), false);
        return;
    }
    s.chords = chords;
    s.slots.resize (chords.size());
    juce::String msg = juce::String ((int) chords.size()) + " chords.";
    if (! bad.empty())
    {
        juce::StringArray b;
        for (auto& x : bad) b.add (u8 (x));
        msg << " Not recognised (skipped): " << b.joinIntoString (", ");
    }
    progressionEd.giveAwayKeyboardFocus();
    commit (s, std::min (selected, (int) chords.size() - 1), msg);
}

void ArpEditor::addChord()
{
    fl::Song s = doc;
    const size_t at = std::min (s.chords.size(), (size_t) selected + 1);
    s.chords.insert (s.chords.begin() + (long) at, s.chords.empty() ? std::string ("C") : s.chords[(size_t) selected]);
    s.slots.insert (s.slots.begin() + (long) std::min (at, s.slots.size()), s.chords.size() > 1 ? doc.slotAt ((size_t) selected) : fl::Slot {});
    commit (s, (int) at, "Added a chord - type its name in the Chord field.");
    chordEd.grabKeyboardFocus();
    chordEd.selectAll();
}

void ArpEditor::removeChord()
{
    if (doc.chords.size() <= 1)
    {
        showStatus ("The progression needs at least one chord.", false);
        return;
    }
    fl::Song s = doc;
    s.chords.erase (s.chords.begin() + selected);
    if (selected < (int) s.slots.size()) s.slots.erase (s.slots.begin() + selected);
    commit (s, std::max (0, selected - 1));
}

void ArpEditor::moveChord (int dir)
{
    const int j = selected + dir;
    if (j < 0 || j >= (int) doc.chords.size()) return;
    fl::Song s = doc;
    s.slots.resize (s.chords.size());
    std::swap (s.chords[(size_t) selected], s.chords[(size_t) j]);
    std::swap (s.slots[(size_t) selected], s.slots[(size_t) j]);
    commit (s, j);
}

void ArpEditor::applyChordText()
{
    const auto text = chordEd.getText().trim().toStdString();
    if (selected >= (int) doc.chords.size() || text.empty() || text == doc.chords[(size_t) selected]) return;
    if (! fl::parseChordSymbol (text) && ! fl::parseArpInput (text).ok)
    {
        showStatus ("Chord \"" + u8 (text) + "\" not recognised - try e.g. Am7, C#m7b5, G7(#9), Eb(add#11,no3) or notes like E G B D.", false);
        return;
    }
    fl::Song s = doc;
    s.chords[(size_t) selected] = text;
    commit (s, selected);
    if (const auto* r = current()) showStatus ("Chord " + juce::String (selected + 1) + ": " + u8 (r->chordName) + " (" + u8 (r->chord.type->name) + ").");
}

void ArpEditor::previewArpText()
{
    const auto* r = current();
    const auto text = ownArpEd.getText().trim().toStdString();
    if (r == nullptr || ! r->chordOk || text.empty()) return;
    const auto in = fl::parseArpInput (text);
    if (! in.ok)
    {
        showStatus (u8 (in.error), false);
        return;
    }
    const auto a = fl::analyzeArpeggio (r->chord, in.chord);
    juce::String t;
    if (! in.recognisedFrom.empty()) t << "Recognised " << u8 (in.recognisedFrom) << " as " << u8 (in.chord.name()) << ".  ";
    t << u8 (a.name) << " over " << u8 (r->chordName) << ": fit " << percent (a.fit);
    if (! a.sound.empty() && a.sound != r->chordName) t << juce::String::fromUTF8 (" \xE2\x86\x92 ") << u8 (a.sound);
    t << "  (Enter to use it)";
    showStatus (t);
}

void ArpEditor::applyArpText()
{
    const auto text = ownArpEd.getText().trim().toStdString();
    if (text.empty() || selected >= (int) doc.chords.size()) return;
    const auto in = fl::parseArpInput (text);
    if (! in.ok)
    {
        showStatus (u8 (in.error), false);
        return;
    }
    fl::Song s = doc;
    s.slots.resize (s.chords.size());
    s.slots[(size_t) selected].arp = text;
    ownArpEd.giveAwayKeyboardFocus();
    commit (s, selected);
    if (const auto* r = current()) showStatus ("Chord " + juce::String (selected + 1) + " plays " + u8 (r->arp.name) + " (fit " + percent (r->arp.fit) + ").");
}

void ArpEditor::onArpChoice()
{
    const auto* r = current();
    const int id = arpBox.getSelectedId();
    if (r == nullptr || ! r->chordOk || id == 0) return;
    fl::Song s = doc;
    s.slots.resize (s.chords.size());
    auto& slot = s.slots[(size_t) selected];
    if (id == 1) slot.arp.clear();
    else if (id >= 100 && id - 100 < (int) r->subs.size()) slot.arp = fl::toAscii (r->subs[(size_t) id - 100].name);
    else if (id == 3)
    {
        ownArpEd.setText (u8 (slot.arp), false);
        ownArpEd.grabKeyboardFocus();
        ownArpEd.selectAll();
        showStatus ("Type a chord symbol or notes for this chord's arpeggio, then press Enter - or click notes on the fretboard.");
        refreshSlotPanel();
        return;
    }
    else
        return;
    commit (s, selected);
}

void ArpEditor::onPositionChoice()
{
    const int id = posBox.getSelectedId();
    if (id == 0 || selected >= (int) doc.chords.size()) return;
    fl::Song s = doc;
    s.slots.resize (s.chords.size());
    auto& slot = s.slots[(size_t) selected];
    if (id == 1) slot.pos = fl::SlotPosition::global();
    else if (id == 2) slot.pos = fl::SlotPosition::neck();
    else if (id - 10 < (int) posWindows.size()) slot.pos = fl::SlotPosition::frets (posWindows[(size_t) id - 10].start, posWindows[(size_t) id - 10].end);
    commit (s, selected);
}

void ArpEditor::onLengthChoice()
{
    const int beats = lenBox.getSelectedId();
    if (beats <= 0 || selected >= (int) doc.chords.size()) return;
    fl::Song s = doc;
    s.slots.resize (s.chords.size());
    s.slots[(size_t) selected].beats = beats;
    commit (s, selected);
}

void ArpEditor::onGlobalPosition()
{
    const int id = allPosBox.getSelectedId();
    if (id == 0 || id == 1000) return;
    fl::Song s = doc;
    if (id == 1) s.position = std::nullopt;
    else s.position = fl::FretWindow { id - 100, id - 96 };
    commit (s, selected);
}

void ArpEditor::fretClick (int string, int fret, int midi, const juce::MouseEvent& e)
{
    proc.audition (midi, string, fret);
    if (clickBox.getSelectedId() != 1 || e.mods.isShiftDown() || proc.getMode() == PlayMode::KeysPlayNotes) return;
    const auto* r = current();
    if (r == nullptr || ! r->chordOk) return;
    const int pc = fl::mod12 (midi);
    std::vector<int> pcs;
    std::vector<std::string> names;
    for (auto& n : r->arp.notes)
    {
        pcs.push_back (n.pc);
        names.push_back (n.name);
    }
    auto it = std::find (pcs.begin(), pcs.end(), pc);
    juce::String what;
    if (it != pcs.end())
    {
        if (pcs.size() <= 2)
        {
            showStatus ("An arpeggio needs at least two different notes.", false);
            return;
        }
        what = "Removed " + u8 (names[(size_t) (it - pcs.begin())]);
        names.erase (names.begin() + (it - pcs.begin()));
        pcs.erase (it);
    }
    else
    {
        // Spell the new note relative to the chord (the 9 of B is C♯).
        const auto label = fl::labelInChord (pc - r->chord.root, r->chord.type->degrees);
        auto sp = fl::spellWithLetter (pc, r->chord.spelledRoot().letter + fl::degreeStep (label));
        const auto name = sp && std::abs (sp->acc) < 2 ? fl::formatNote (*sp) : fl::pcName (pc);
        pcs.push_back (pc);
        names.push_back (name);
        what = "Added " + u8 (name);
    }
    std::string text;
    for (size_t i = 0; i < names.size(); ++i) text += (i ? " " : "") + fl::toAscii (names[i]);
    fl::Song s = doc;
    s.slots.resize (s.chords.size());
    // Exactly the chord's own notes again → back to "own".
    int maskNew = 0, maskOwn = 0;
    for (int p : pcs) maskNew |= 1 << p;
    for (int p : r->exact.front().pcs()) maskOwn |= 1 << p;
    s.slots[(size_t) selected].arp = maskNew == maskOwn && pcs.front() == r->chord.root ? std::string() : text;
    commit (s, selected);
    if (const auto* r2 = current())
        showStatus (what + juce::String::fromUTF8 (" \xE2\x86\x92 ") + u8 (fl::toAscii (text)) + " = " + u8 (r2->arp.name)
                    + (r2->kind == fl::ResolvedSlot::Kind::Own ? juce::String (" (the chord's own)") : "  (fit " + percent (r2->arp.fit) + ")"));
}

void ArpEditor::fretRightClick (int string, int fret, int midi)
{
    int start = std::max (0, fret - 1), end = start + 4;
    if (end > doc.numFrets)
    {
        end = doc.numFrets;
        start = std::max (0, end - 4);
    }
    const auto w = fl::FretWindow { start, end };
    juce::PopupMenu m;
    m.addSectionHeader ("Chord " + juce::String (selected + 1) + " (" + (selected < (int) doc.chords.size() ? u8 (doc.chords[(size_t) selected]) : juce::String()) + ")");
    m.addItem (1, "Play its arpeggio in " + framesText (w));
    m.addItem (2, "Play it on the whole neck");
    m.addItem (3, "Use the position of all chords");
    m.addSectionHeader ("All chords");
    m.addItem (4, "Position for all chords: " + framesText (w));
    m.addItem (5, "Position for all chords: whole neck");
    m.addSeparator();
    m.addItem (6, "Play " + u8 (fl::midiName (midi)));
    m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (&fretboard).withMousePosition(), [this, w, midi, string, fret] (int choice) {
        if (choice == 0) return;
        if (choice == 6)
        {
            proc.audition (midi, string, fret);
            return;
        }
        fl::Song s = doc;
        s.slots.resize (s.chords.size());
        if (choice == 1) s.slots[(size_t) selected].pos = fl::SlotPosition::frets (w.start, w.end);
        else if (choice == 2) s.slots[(size_t) selected].pos = fl::SlotPosition::neck();
        else if (choice == 3) s.slots[(size_t) selected].pos = fl::SlotPosition::global();
        else if (choice == 4) s.position = w;
        else if (choice == 5) s.position = std::nullopt;
        commit (s, selected);
    });
}

void ArpEditor::doExport()
{
    juce::String name = "fretboard-lab";
    for (auto& c : doc.chords) name << " " << u8 (fl::toAscii (c));
    juce::String safe;
    for (auto ch : name)
        safe << (juce::CharacterFunctions::isLetterOrDigit (ch) || juce::String ("#()+,-").containsChar (ch) ? juce::String::charToString (ch) : juce::String ("_"));
    safe = safe.substring (0, 80);
    chooser = std::make_unique<juce::FileChooser> ("Export progression + arpeggios",
                                                   juce::File::getSpecialLocation (juce::File::userDocumentsDirectory).getChildFile (safe + ".txt"), "*.txt");
    chooser->launchAsync (juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles | juce::FileBrowserComponent::warnAboutOverwriting,
                          [this] (const juce::FileChooser& fc) {
                              auto f = fc.getResult();
                              if (f == juce::File()) return;
                              if (! f.hasFileExtension ("txt")) f = f.withFileExtension ("txt");
                              if (f.replaceWithText (u8 (proc.exportText()), false, false, "\n"))
                                  showStatus ("Exported " + juce::String ((int) doc.chords.size()) + " chords with their arpeggios to " + f.getFileName() + ".");
                              else
                                  showStatus ("Could not write " + f.getFullPathName(), false);
                          });
}

void ArpEditor::doImport()
{
    chooser = std::make_unique<juce::FileChooser> ("Import progression + arpeggios", juce::File::getSpecialLocation (juce::File::userDocumentsDirectory), "*.txt");
    chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles, [this] (const juce::FileChooser& fc) {
        const auto f = fc.getResult();
        if (f == juce::File()) return;
        importFromText (f.loadFileAsString(), f.getFileName());
    });
}

void ArpEditor::importFromText (const juce::String& text, const juce::String& source)
{
    if (text.trim().isEmpty())
    {
        showStatus ("Nothing to import from " + source + ".", false);
        return;
    }
    bool ok = false;
    const auto msg = proc.importText (text.toStdString(), ok);
    refreshFromProcessor();
    showStatus ((ok ? "" : "Could not import from " + source + ": ") + msg, ok);
}

bool ArpEditor::isInterestedInFileDrag (const juce::StringArray& files)
{
    for (auto& f : files)
        if (f.endsWithIgnoreCase (".txt")) return true;
    return false;
}

void ArpEditor::filesDropped (const juce::StringArray& files, int, int)
{
    for (auto& f : files)
        if (f.endsWithIgnoreCase (".txt"))
        {
            const juce::File file (f);
            importFromText (file.loadFileAsString(), file.getFileName());
            return;
        }
}
