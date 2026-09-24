# Phase 4 — Translation

FR-14 to FR-17. **Exit:** a Spanish, a Korean and a French song translate to English with matching line counts; the second request is served from cache.

- [x] 4.1 Verify the translation step locally (same line count, KV cache)
- [x] 4.2 Language picker, saved in prefs; translated lines shown under the originals
- [x] 4.3 Verify Spanish, Korean and French songs and the cache hit on the deployed Worker
- [ ] 4.4 Share one translation job per song and language (KV caches misses for ~60 s)

## Results

- 2026-09-24, `wrangler dev`: `POST /translate` for LRCLIB 197097 ("Hello", Adele) into Spanish. The Workflow returned 51 translated lines for 51 LRC lines; the result is cached in KV under `translation:197097:spanish`.
- 2026-09-24, item 4.3 (`node worker/eval/translation-check.mts <url>` against production), into English:

    | Song | Lines (translated / player) | First run |
    | --- | --- | --- |
    | Despacito — Luis Fonsi (Spanish) | 78 / 78 | 30.3 s |
    | Blueming — IU (Korean) | 46 / 46 | 26.4 s |
    | Alors On Danse — Stromae (French) | 68 / 68 | 20.2 s |

    Cache: a repeat request right after completion was **not** served from cache and started a duplicate job; 80 s later all three came from cache. Cause: KV is eventually consistent and caches "not found" lookups for 60+ seconds ([Cloudflare docs](https://developers.cloudflare.com/kv/concepts/how-kv-works/)). Fixed in 4.4. First runs are above the 15 s target in the requirements for Spanish and Korean.
