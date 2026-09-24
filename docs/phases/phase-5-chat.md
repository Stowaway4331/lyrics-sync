# Phase 5 — Chat

FR-18 to FR-23, FR-25. **Exit:** title search, lyric search and trivia work end to end; baseline lyric-search hit rate recorded here.

- [x] 5.1 Verify routing, LRCLIB verification and streaming locally
- [x] 5.2 Chat screen: streamed replies, song cards, current-song context, persisted history
- [x] 5.3 Evaluation set of 20 lyric snippets; record the baseline hit rate
- [x] 5.4 Only accept LRCLIB results whose title matches the candidate when verifying

## Results

- 2026-09-24, `wrangler dev`: "what song goes hello from the other side, i must have called a thousand times" was routed as `lyrics` with candidate "Hello" by Adele, verified on LRCLIB, and labelled `match` (snippet found in the real lyrics). The reply streamed as SSE tokens.
- First attempt returned no candidates: Llama 3.3 omitted optional fields in JSON mode. Fixed by making every field required in the routing schema.
- 2026-09-24, item 5.3 baseline (`node worker/eval/run.mjs` against `wrangler dev`, 20 cases in `worker/eval/lyric-search.json`): **top-1 18/20 (90%)**, top-3 18/20, expected song labelled "match" 16/20.
    - Case 8 is a deliberate control (mixed-up lyrics), so its miss is expected.
    - Real miss: "Something Just Like This". Llama 3.3 suggested "Into the Storm" by Blind Guardian (confirmed in the routing log); verification correctly labelled it "possible" because the snippet is not in its lyrics. This is a model-knowledge miss.
    - "Tiny Dancer" (misheard "hold me closer tony danza") and "Gangnam Style" were found but labelled "possible", as expected for misheard or romanised snippets.
- 2026-09-24, item 5.4: verification now rejects LRCLIB results whose title doesn't match the suggested song (guards against fuzzy search results). Re-run: top-1 18/20, unchanged; case 8 (the control) returned no card this run, where the baseline showed "Dancing In The Dark" (possible).
