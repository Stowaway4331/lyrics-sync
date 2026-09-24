# Phase 1 — Backend core

FR-3, FR-4, FR-5, FR-24. **Exit:** a recorded clip returns the right song, offset and LRC for 5 test songs.

- [x] 1.1 ACRCloud client: signed identify request and sync offset
- [x] 1.2 LRCLIB client, duration matching and KV cache (`lyrics:`, `acr:`, `miss:`, `translation:` keys)
- [ ] 1.3 `UserSession` Durable Object: history, chat memory, prefs, jobs, rate limits, WebSocket
- [ ] 1.4 API router: `/recognize`, `/lyrics/:id`, `/history`, `/prefs`, `/jobs/:id`, `/ws` (plus the chat, translate and recover handlers used by later phases)
- [ ] 1.5 Recognise 5 real test songs end to end (needs ACRCloud keys)
