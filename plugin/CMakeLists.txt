# Fretboard Lab Arp — a VST3 / AU / standalone guitar-arpeggio instrument built on the music-theory
# engine of the Fretboard Lab web app (ported to C++ in Source/core).
#
#   cmake -B build -DCMAKE_BUILD_TYPE=Release
#   cmake --build build --config Release
#
# JUCE is downloaded automatically (or point FETCHCONTENT_SOURCE_DIR_JUCE at a local copy).
cmake_minimum_required(VERSION 3.22)
# Must be set before project(); ignored on other platforms.
set(CMAKE_OSX_DEPLOYMENT_TARGET "10.13" CACHE STRING "Minimum macOS version")
project(FretboardLabArp VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

option(FL_BUILD_PLUGIN "Build the JUCE plugin (needs JUCE)" ON)
option(FL_BUILD_TESTS "Build the music-theory core tests" ON)

# ---- Music-theory core (plain C++17, no JUCE) -----------------------------------------------
add_library(fl_core STATIC
  Source/core/Theory.cpp
  Source/core/Arpeggios.cpp
  Source/core/Fretboard.cpp
  Source/core/Arrangement.cpp
  Source/core/Song.cpp)
target_include_directories(fl_core PUBLIC Source)
if(MSVC)
  target_compile_options(fl_core PRIVATE /utf-8 /W4)
else()
  target_compile_options(fl_core PRIVATE -Wall -Wextra)
endif()

if(FL_BUILD_TESTS)
  enable_testing()
  add_executable(fl_core_tests tests/CoreTests.cpp)
  target_link_libraries(fl_core_tests PRIVATE fl_core)
  target_compile_definitions(fl_core_tests PRIVATE FL_VECTORS_PATH="${CMAKE_CURRENT_SOURCE_DIR}/tests/vectors.txt")
  if(MSVC)
    target_compile_options(fl_core_tests PRIVATE /utf-8)
  endif()
  add_test(NAME fl_core_tests COMMAND fl_core_tests)
endif()

# ---- Plugin ---------------------------------------------------------------------------------
if(FL_BUILD_PLUGIN)
  include(FetchContent)
  FetchContent_Declare(JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG 8.0.15
    GIT_SHALLOW TRUE)
  FetchContent_MakeAvailable(JUCE)

  set(FL_FORMATS VST3 Standalone)
  if(APPLE)
    list(APPEND FL_FORMATS AU)
  endif()

  juce_add_plugin(FretboardLabArp
    PRODUCT_NAME "Fretboard Lab Arp"
    COMPANY_NAME "Fretboard Lab"
    BUNDLE_ID com.fretboardlab.arp
    PLUGIN_MANUFACTURER_CODE Frlb
    PLUGIN_CODE FlAr
    FORMATS ${FL_FORMATS}
    IS_SYNTH TRUE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT TRUE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    COPY_PLUGIN_AFTER_BUILD FALSE
    VST3_CATEGORIES Instrument Synth
    AU_MAIN_TYPE kAudioUnitType_MusicDevice
    DESCRIPTION "Guitar arpeggios for chord progressions, on a clickable fretboard")

  target_sources(FretboardLabArp PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp
    Source/FretboardView.cpp
    Source/ChordStrip.cpp
    Source/GuitarSynth.cpp)

  target_compile_definitions(FretboardLabArp PUBLIC
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_APPLICATION_NAME_STRING="$<TARGET_PROPERTY:FretboardLabArp,JUCE_PRODUCT_NAME>"
    JUCE_APPLICATION_VERSION_STRING="$<TARGET_PROPERTY:FretboardLabArp,JUCE_VERSION>")
  if(MSVC)
    target_compile_options(FretboardLabArp PRIVATE /utf-8)
  endif()

  target_link_libraries(FretboardLabArp
    PRIVATE
      fl_core
      juce::juce_audio_utils
    PUBLIC
      juce::juce_recommended_config_flags
      juce::juce_recommended_lto_flags
      juce::juce_recommended_warning_flags)
endif()

# ---- End-to-end tests of the processor + editor snapshots (console app) ----------------------
if(FL_BUILD_PLUGIN AND FL_BUILD_TESTS)
  juce_add_console_app(fl_engine_tests PRODUCT_NAME "fl_engine_tests")
  target_sources(fl_engine_tests PRIVATE
    tests/EngineTests.cpp
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp
    Source/FretboardView.cpp
    Source/ChordStrip.cpp
    Source/GuitarSynth.cpp)
  target_compile_definitions(fl_engine_tests PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_MODAL_LOOPS_PERMITTED=1)
  if(MSVC)
    target_compile_options(fl_engine_tests PRIVATE /utf-8)
  endif()
  target_link_libraries(fl_engine_tests PRIVATE fl_core juce::juce_audio_utils juce::juce_recommended_config_flags)
endif()
