# Phase 4 — Translation

FR-14 to FR-17. **Exit:** a Spanish, a Korean and a French song translate to English with matching line counts; the second request is served from cache.

- [x] 4.1 Verify the translation step locally (same line count, KV cache)
- [x] 4.2 Language picker, saved in prefs; translated lines shown under the originals
- [ ] 4.3 Verify Spanish, Korean and French songs and the cache hit on the deployed Worker

## Results

- 2026-09-24, `wrangler dev`: `POST /translate` for LRCLIB 197097 ("Hello", Adele) into Spanish. The Workflow returned 51 translated lines for 51 LRC lines; the result is cached in KV under `translation:197097:spanish`.
