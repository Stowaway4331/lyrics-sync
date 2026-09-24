# Phase 7 — Device feedback (bugs and feature requests)

From testing the Android development build. **Exit:** every item below works on the Android build, and lint, typecheck and tests pass.

## Bugs

- [ ] 7.1 Chat box placeholder text follows the theme (it stays black in dark mode)
- [ ] 7.2 Chat box stays above the keyboard while typing (the keyboard currently covers it)
- [ ] 7.3 Big listen button submits the clip early at any length instead of stopping; a separate Cancel button discards it (tap-to-stop is unreliable today)

## Features

- [ ] 7.4 Toggle in the player to show the lyrics without sync (plain view)
- [ ] 7.5 Tap a lyric line to jump the sync to it; fine-tune with + / −
- [ ] 7.6 Translate with `@cf/meta/m2m100-1.2b`, supporting all 100 of its languages from one constants file
- [ ] 7.7 Chat shows a small loader while a reply is still streaming

## Notes

- **7.3:** ACRCloud accepts clips under 10 s, but matching gets less reliable below about 5 s. The clip's real length is still sent, so the sync offset stays correct.
- **7.5:** tapping a line sets the song position to that line's timestamp from that moment on. This also works for songs opened from history or chat, which have no audio sync yet.
- **7.6:** m2m100 needs the source language as well as the target. Plan: take it from ACRCloud's `language` field when the song was recognised, otherwise detect it once per song with Llama 3.3 and cache it. m2m100 translates one text at a time, so lines are sent individually (or in small batches), and the line-count check stays in place. Translations cached under the old Llama keys are ignored.
