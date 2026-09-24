# Phase 7 — Device feedback (bugs and feature requests)

From testing the Android development build. **Exit:** every item below works on the Android build, and lint, typecheck and tests pass.

## Bugs

- [x] 7.1 Chat box placeholder text follows the theme (it stays black in dark mode)
- [x] 7.2 Chat box stays above the keyboard while typing (the keyboard currently covers it)
- [x] 7.8 No white flash when switching screens in dark mode
- [x] 7.3 Big listen button submits the clip early at any length instead of stopping; a separate Cancel button discards it (tap-to-stop is unreliable today)

## Features

- [ ] 7.4 Toggle in the player to show the lyrics without sync (plain view)
- [ ] 7.5 Tap a lyric line to jump the sync to it; fine-tune with + / −
- 7.6 ~~Translate with `@cf/meta/m2m100-1.2b`, supporting all 100 of its languages~~ — dropped 2026-09-25: translation stays on Llama 3.3
- [x] 7.7 Chat shows a small loader while a reply is still streaming

## Translation speed

- [x] 7.9 Translate faster: send the line batches to the model in parallel instead of one after another
- [x] 7.10 Language list sorted by global usage, from one constants file shared by the app and the Worker
- [x] 7.11 Remember each user's language choices and list those first, most relevant first
- [x] 7.12 Silently pre-translate each song into the user's top 3 languages
- [x] 7.13 "Wrong version" discards the pre-translations made for that lyrics version

## Notes

- **7.3:** ACRCloud accepts clips under 10 s, but matching gets less reliable below about 5 s. The clip's real length is still sent, so the sync offset stays correct.
- **7.5:** tapping a line sets the song position to that line's timestamp from that moment on. This also works for songs opened from history or chat, which have no audio sync yet.
- **7.8:** the native root view behind React defaults to white and was never set, so it shows through during screen transitions. Fix: set it to the theme background whenever the colour scheme changes.
- **7.12 cost:** a Llama translation of a typical song is about 260 neurons (~$0.003). Pre-translating 3 languages for a song nobody has translated yet is about 780 neurons, so the 10,000 free daily neurons cover roughly 12 new songs a day; after that it is about $0.009 per new song. Songs already translated for a language cost nothing. Pre-translation has its own per-device limit so it never uses up the limit for translations the user asks for.
- **7.12 English songs:** a target language matching the song's own language is skipped. The song language comes from ACRCloud when recognised; otherwise English is detected with a simple common-words check.

## Results

- 2026-09-25, item 7.8: root view background now follows the theme (`#0a0a0a` dark / `#ffffff` light) via `expo-system-ui`; this part works in the current build. The dark splash background and the `expo-system-ui` config plugin apply from the next EAS build. Needs a check on the phone.
- 2026-09-25, item 7.9: translation batches now run in parallel. Despacito (78 lines), fresh translations on production, measured by `worker/eval/translation-check.mts` (includes up to 3 s of polling delay): sequential 40-line batches 30.3 s (English, 4.3 baseline) → parallel 20-line 19.3 s (German) → parallel 10-line 14.0 s (Italian) and 10.8 s (Portuguese). Line counts matched every time. Kept 10-line batches.
- 2026-09-25, item 7.11: explicit picks (language picker, "translate to X" in chat) are counted per user in the `UserSession` Durable Object; relevance = picks ÷ (1 + weeks-since-last-use ÷ 2). `GET /prefs` returns `languages` in that order, and the picker lists them under "Your languages" above "All languages". Production check: Korean once then Spanish twice → `["Spanish","Korean"]`.
- 2026-09-25, item 7.12: recognising a song, opening one from history or chat, or recovery finding lyrics silently starts translations into the user's top 3 languages (their ranked picks, topped up from the global order), skipping the song's own language (ACRCloud's `language`, else an English word check). Pre-translations are tagged `prefetched` in KV until someone asks for one, and have their own limit (60 songs/hour/device). Production check: a new device opened "Alors On Danse" → jobs for English, Chinese (Simplified) and Hindi started; picking Hindi afterwards returned the finished lines immediately. Helpers moved to `worker/src/jobs.ts` and `worker/src/translations.ts`; 18/18 tests pass.
- 2026-09-25, item 7.1: `Input` and `Textarea` now pass `placeholderTextColor` from the theme (`#737373` light / `#a3a3a3` dark) instead of relying on the class-based placeholder colour, which stayed black in dark mode on Android. Needs a check on the phone.
- 2026-09-25, item 7.13: "Wrong version" (player button or chat) deletes that lyrics version's KV translations still tagged `prefetched` and terminates this user's pre-translation jobs for it that are still running; translations someone explicitly asked for are kept. Production check on "Alors On Danse": before, Chinese (Simplified) tagged `prefetched` plus English, German and Hindi requested explicitly; after the report, only English, German and Hindi remained. Limitation: finished Workflow runs keep their output (no delete API), so a later request for that exact rejected version and language can still be answered from it.
- 2026-09-25, item 7.2: chat uses `react-native-keyboard-controller`'s `KeyboardAvoidingView` (`behavior="padding"`, `automaticOffset`) on both platforms, per Expo's keyboard guide: with Android edge-to-edge the window no longer resizes for the keyboard, so React Native's own view left the input underneath. The tab bar hides while the keyboard is open. Native module: needs a new EAS build, then a check on the phone.
- 2026-09-25, item 7.7: a small spinner stays under the assistant's reply until the stream ends (with the status text, e.g. "Checking the lyrics database…", before the first token). JS only, works in the current build; needs a check on the phone.
- 2026-09-25, item 7.3: cause of the unreliable stop: recording waited on a fixed 10 s timer while "stop" called the recorder directly, so the timer later touched the recorder again. Now the wait ends on the timer *or* a stop signal, and the recorder is stopped exactly once. The big button (unchanged look) and the player's Resync button submit whatever was recorded; a separate Cancel (big screen) / × (player) discards it. The Worker accepts clips down to 0.5 s so the sync offset uses the real length; a 3 s clip on production returned a normal response. JS + Worker only; needs a check on the phone.
