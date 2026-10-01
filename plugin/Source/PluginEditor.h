// The plugin window: a clickable fretboard, the progression as chord cards, an editor for the
// selected chord's arpeggio (own / ranked suggestions / typed or clicked), playback controls and
// Import / Export of the same .txt format as the Fretboard Lab web app.
#pragma once

#include "ChordStrip.h"
#include "FretboardView.h"
#include "PluginProcessor.h"

class ArpEditor : public juce::AudioProcessorEditor, public juce::FileDragAndDropTarget, private juce::Timer
{
public:
    explicit ArpEditor (ArpProcessor&);
    ~ArpEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;
    bool isInterestedInFileDrag (const juce::StringArray& files) override;
    void filesDropped (const juce::StringArray& files, int, int) override;

private:
    void timerCallback() override;
    void refreshFromProcessor();
    void refreshSlotPanel();
    void refreshFretboard();
    void commit (const fl::Song& s, int select, const juce::String& message = {});
    void select (int i);
    void showStatus (const juce::String& text, bool good = true);
    const fl::ResolvedSlot* current() const;

    void setProgressionFromText();
    void addChord();
    void removeChord();
    void moveChord (int dir);
    void applyChordText();
    void applyArpText();
    void previewArpText();
    void onArpChoice();
    void onPositionChoice();
    void onLengthChoice();
    void onGlobalPosition();
    void fretClick (int string, int fret, int midi, const juce::MouseEvent& e);
    void fretRightClick (int string, int fret, int midi);
    void doImport();
    void doExport();
    void importFromText (const juce::String& text, const juce::String& source);

    ArpProcessor& proc;
    theme::LookAndFeel lnf;
    juce::TooltipWindow tooltips { this, 700 };
    fl::Song doc;
    int seenVersion = -1, selected = 0;
    uint32_t lastSerial = 0;
    double glowStart = 0;
    uint64_t lastHeldLow = 0, lastHeldHigh = 0;
    bool wasRunning = false;

    // Header
    juce::Label title, status;
    juce::ComboBox tuningBox, fretsBox, labelsBox, clickBox;
    juce::TextButton importBtn { "Import .txt" }, exportBtn { "Export .txt" }, copyBtn { "Copy" }, pasteBtn { "Paste" };
    FretboardView fretboard;

    // Progression
    juce::Label progressionLbl;
    juce::TextEditor progressionEd;
    juce::TextButton setBtn { "Set" }, addBtn { "+ Chord" }, removeBtn { "Remove" }, leftBtn { "<" }, rightBtn { ">" };
    juce::ToggleButton followToggle { "Follow playback" };
    juce::Viewport stripView;
    ChordStrip strip;

    // Selected chord
    juce::Label chordLbl, arpLbl, ownLbl, posLbl, lenLbl;
    juce::TextEditor chordEd, ownArpEd, info;
    juce::ComboBox arpBox, posBox, lenBox;
    juce::TextButton useBtn { "Use" }, ownBtn { "Chord's own" };
    juce::Label pickLbl;
    std::array<juce::TextButton, 7> picks; // one-click choice: the chord's own + the best suggestions
    std::vector<fl::FretWindow> posWindows;

    // Playback
    juce::ComboBox modeBox, rateBox, patternBox, backingBox, allPosBox;
    juce::Slider gateSl, velSl, levelSl, toneSl, backingSl, tempoSl, keySl;
    juce::ToggleButton soundToggle { "Internal guitar" };
    juce::TextButton playBtn { "Play" };
    juce::Label modeHint;
    std::vector<std::pair<std::unique_ptr<juce::Label>, juce::Component*>> labelled;
    std::vector<std::unique_ptr<juce::AudioProcessorValueTreeState::ComboBoxAttachment>> comboAttachments;
    std::vector<std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment>> sliderAttachments;
    std::unique_ptr<juce::AudioProcessorValueTreeState::ButtonAttachment> soundAttachment;
    std::unique_ptr<juce::FileChooser> chooser;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (ArpEditor)
};
