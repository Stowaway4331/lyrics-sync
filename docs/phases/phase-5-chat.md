# Phase 5 — Chat

FR-18 to FR-23, FR-25. **Exit:** title search, lyric search and trivia work end to end; baseline lyric-search hit rate recorded here.

- [x] 5.1 Verify routing, LRCLIB verification and streaming locally
- [x] 5.2 Chat screen: streamed replies, song cards, current-song context, persisted history
- [ ] 5.3 Evaluation set of 20 lyric snippets; record the baseline hit rate

## Results

- 2026-09-24, `wrangler dev`: "what song goes hello from the other side, i must have called a thousand times" was routed as `lyrics` with candidate "Hello" by Adele, verified on LRCLIB, and labelled `match` (snippet found in the real lyrics). The reply streamed as SSE tokens.
- First attempt returned no candidates: Llama 3.3 omitted optional fields in JSON mode. Fixed by making every field required in the routing schema.
