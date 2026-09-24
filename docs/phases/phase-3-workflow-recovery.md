# Phase 3 — Workflow and lookup recovery

FR-11 to FR-13. **Exit:** a remaster/live/featuring title that fails exact lookup is recovered and appears in the open player without user action.

- [x] 3.1 `LyricsPipeline` Workflow and LLM prompts (clean query → search → pick by duration; miss cache)
- [x] 3.2 WebSocket push to the app with polling fallback
- [x] 3.3 Verify recovery end to end locally

## Results

- 2026-09-24, `wrangler dev`: `POST /recover` for "Yesterday - Remastered 2009" / The Beatles / 125 s. The Workflow cleaned the title, found a synced LRCLIB version within the 2 s tolerance, and the result was pushed over the open WebSocket (`job.update`, status `complete`, `versionMismatch: false`).
