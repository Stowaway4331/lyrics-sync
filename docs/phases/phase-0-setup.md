# Phase 0 — Checks and setup

**Exit:** a decision note is recorded; `wrangler dev` serves a hello route.

- [x] 0.1 Check current docs for every external API and record the decisions below
- [x] 0.2 Set up NativeWind, React Native Reusables and app dependencies
- [x] 0.3 Scaffold the Worker (`worker/`) with AI, KV, Durable Object and Workflow bindings

## Decision note (checked 2026-09-24)

| Topic | Finding | Decision |
| --- | --- | --- |
| Recording | Expo SDK 57 `expo-audio`: `useAudioRecorder`, `prepareToRecordAsync`, `record()`, `stop()`, `getStatus().durationMillis`, `uri`. Native records `.m4a` (AAC); web records WebM via MediaRecorder and needs HTTPS for the mic. | Mono AAC 96 kbps preset; clip length from `EXPO_PUBLIC_CLIP_MS` (10 s default, clamped 5–15 s). |
| Upload | `expo/fetch` accepts an `expo-file-system` `File` as the request body; on web the recording is a `blob:` URL. | App sends the raw clip as the request body; the Worker builds ACRCloud's multipart form. |
| Streaming | `expo/fetch` supports streaming response bodies on iOS, Android and web. | Chat replies stream as Server-Sent Events over `POST /chat`. |
| ACRCloud | `POST /v1/identify`, multipart, HMAC-SHA1 signature, sample < 5 MB, clips under 15 s preferred. Response has `db_end_time_offset_ms`, `sample_end_time_offset_ms`, `play_offset_ms`. No streaming input. | Offset = `db_end + (clip − sample_end)`, falling back to `play_offset_ms`. |
| Workers AI | `@cf/meta/llama-3.3-70b-instruct-fp8-fast`: JSON mode via `response_format: { type: 'json_schema' }`, streaming, tool calling, 24k context. | JSON mode for routing, recovery and translation; streamed text for chat replies. |
| LRCLIB | `/api/get` (exact, ±2 s), `/api/get/{id}`, `/api/search` (title/artist or `q`; does **not** search inside lyrics). Returns 503 "server is busy" under load. | One retry on 503; lyric search relies on the LLM proposing songs, verified against LRCLIB. |
| State | Plain Durable Object with SQLite and the WebSocket hibernation API covers everything; React Native has a built-in WebSocket. | Plain `UserSession` Durable Object instead of the Agents SDK (fewer unknowns in React Native). |
| UI | React Native Reusables (NativeWind v4 / Tailwind v3), `inlineRem: 16`, `PortalHost` in root layout. Tabs import from `expo-router/js-tabs`. | Minimal neutral theme; Vercel Web Interface Guidelines for hit targets, states and motion. |
