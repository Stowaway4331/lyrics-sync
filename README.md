# Lyrics Sync

Stuck in a concert listening to songs you can't remember the name of? You really want to sing along to that song but can't remember its name or the lyrics. LyricSync solves that problem (I hope I'm not the only one).

LyricSync provides synced lyrics from whatever point in time the song is recognized by it. So if you're suddenly asked to sing along to a karaoke and you need auto-scrolled lyrics, LyricSync is your best friend. 

Listen to a song for a few seconds and get its lyrics scrolling in time with the music, from the exact point that was heard. Lyrics can be translated line by line, and a music chat finds songs by title or by remembered lyrics.

- **App:** Expo SDK 57 (iOS, Android, web), Expo Router, NativeWind + React Native Reusables.
- **Backend:** one Cloudflare Worker in [`worker/`](worker/) with Workers AI, Workflows, a Durable Object per user, and KV.
- **Services:** [ACRCloud](https://www.acrcloud.com/) identifies the clip; [LRCLIB](https://lrclib.net/) provides time-synced lyrics.

Note: The results from ACRCloud are not accurate and don't produce the best results for humming/noisy inputs. Gemini Song Search is a better (but expensive) alternative to ACRCloud. However, the current implementation works well for most studio/live recorded songs playing through speakers.

## Cloudflare Stack

The whole backend is a single Cloudflare Worker ([`worker/`](worker/)).

| Service | How the app uses it |
| --- | --- |
| **Workers** | The API (`worker/src/index.ts`). It signs and sends clips to ACRCloud, looks lyrics up on LRCLIB, streams chat replies, and starts background jobs. The quick path runs inside the request, so lyrics show up within a few seconds. |
| **Workers AI** (Llama 3.3 70B) | Three jobs (`worker/src/llm.ts`). Chat: working out whether a message is a song title, remembered lyrics or a music question, then answering it. Lookup recovery: cleaning up messy titles like "Song (2011 Remaster) - Live" so the lyrics can still be found. Translation: line by line, so every translated line keeps its original timing. |
| **Workflows** | `LyricsPipeline` (`worker/src/pipeline.ts`) runs the slow AI work in the background as retried steps. That's lyrics recovery and translation, including quietly pre-translating songs into each user's usual languages so a translation appears instantly when asked for. |
| **Durable Objects** (SQLite) | One `UserSession` per device (`worker/src/session.ts`). It holds that user's song history, language preferences, rate limits, background jobs and archived chats. It also keeps a WebSocket open to the app, so finished jobs are pushed to it straight away. Live chat threads stay on the device. |
| **KV** | A cache shared by all users: lyrics, translations, and which LRCLIB entry a recognised recording maps to. Each song only has to be looked up or translated once. |

## How syncing works

ACRCloud reports where in the original track the clip matched. The Worker returns the song position at the moment recording stopped:

```
offsetAtStop = db_end_time_offset_ms + (clipMs − sample_end_time_offset_ms)
```

The app records that moment with a monotonic clock and adds the time elapsed since, so upload and processing time don't affect accuracy. **Resync** records a new clip; **±0.5 s** nudges the timing by hand.

## Local setup

Requirements: Node 20+, a Cloudflare account (Workers AI runs remotely even in local dev), and an ACRCloud project (host, access key, access secret).

### 1. Worker

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars   # fill in ACR_ACCESS_KEY and ACR_ACCESS_SECRET
npx wrangler login
npm run dev                      # http://localhost:8787
```

`ACR_HOST` in `wrangler.jsonc` must match your ACRCloud project's region (shown as the project host in the ACRCloud console). This repo uses `identify-ap-southeast-1.acrcloud.com`; a key used on the wrong region fails with `3001 Missing/Invalid Access Key`.

### 2. App

```bash
npm install
echo "EXPO_PUBLIC_API_URL=http://localhost:8787" > .env.local
npx expo start
```

On a physical phone, use your computer's LAN IP in `EXPO_PUBLIC_API_URL` (for example `http://192.168.1.20:8787`) and start the Worker with `npm run dev -- --ip 0.0.0.0`. Optional: `EXPO_PUBLIC_CLIP_MS` sets the clip length (default 10000, allowed 5000–15000).

The app uses native modules (`expo-audio`, `expo-secure-store`), so use a development build (`npx expo run:ios` / `npx expo run:android`, or `eas build --profile development`) if Expo Go doesn't include them. On web, the mic only works over HTTPS or on `localhost`.

## Deploy the Worker

```bash
cd worker
npx wrangler kv namespace create CACHE      # paste the id into wrangler.jsonc
npx wrangler secret put ACR_ACCESS_KEY
npx wrangler secret put ACR_ACCESS_SECRET
npm run deploy
```

Then point `EXPO_PUBLIC_API_URL` at the deployed `*.workers.dev` URL.

## API

All requests except `GET /` need an `X-Device-Id` header (the WebSocket takes `?deviceId=`).

| Method + path | Purpose |
| --- | --- |
| `POST /recognize` | Raw audio body, `X-Clip-Ms` header → song, `offsetAtStopMs`, lyrics or a recovery `jobId` |
| `GET /lyrics/:lrclibId` | Lyrics by LRCLIB id (`?save=chat` adds it to history) |
| `POST /translate` | `{ lrclibId, lang }` → cached lines or a `jobId` |
| `POST /recover` | `{ song, excludeIds }` → look for another version of the lyrics |
| `POST /chat` | `{ message, currentSong? }` → Server-Sent Events: `status`, `action`, `cards`, `token`, `done` |
| `GET /jobs/:id` | Job status (polling fallback for the WebSocket) |
| `GET /history`, `DELETE /history` | Song history (delete also clears chat) |
| `GET /chat/history` | Chat memory |
| `GET /prefs`, `PUT /prefs` | `targetLanguage`, `calibrationMs` |
| `GET /ws` | WebSocket; pushes `job.update` events |

Per-device limits: 30 recognitions, 60 chat messages and 30 background jobs per hour.

## Checks

```bash
npx expo lint && npx tsc --noEmit        # app
cd worker && npm run typecheck && npm test
```

Lyrics are shown for personal use. A public release needs a licensed lyrics provider.

# TODO
- Fix web deployment
- Add button to clear current song
- Change archive chat storage from full chat to AI summary.
- Add song search by text feature
- Add agentic integration. Requests from chat like "show me lyrics for this song" should return results from LRCLIB and also quick action buttons to view synced lyrics should be available.
  
## Future scope
- Spotify / YTMusic / Apple Music integration. (Add to playlist, share link, etc)