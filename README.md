# Lyrics Sync

Listen to a song for a few seconds and get its lyrics scrolling in time with the music, from the exact point that was heard. Lyrics can be translated line by line, and a music chat finds songs by title or by remembered lyrics.

- **App:** Expo SDK 57 (iOS, Android, web), Expo Router, NativeWind + React Native Reusables.
- **Backend:** one Cloudflare Worker in [`worker/`](worker/) with Workers AI, Workflows, a Durable Object per user, and KV.
- **Services:** [ACRCloud](https://www.acrcloud.com/) identifies the clip; [LRCLIB](https://lrclib.net/) provides time-synced lyrics.

Progress and per-phase checklists: [`docs/phases/`](docs/phases/README.md).

## How the Cloudflare requirements are met

| Requirement | Where |
| --- | --- |
| LLM | Llama 3.3 70B on Workers AI (`worker/src/llm.ts`): chat routing and replies (song title, lyric search, trivia), lookup recovery, line-by-line translation |
| Workflow / coordination | `LyricsPipeline` Workflow (`worker/src/pipeline.ts`) runs recovery and translation as retried steps; the `UserSession` Durable Object pushes results to the app over a WebSocket |
| User input via chat or voice | Voice: the mic clip on the Listen tab. Chat: the Chat tab |
| Memory or state | `UserSession` Durable Object with SQLite (`worker/src/session.ts`): song history, chat memory, preferences, jobs. KV caches lyrics and translations for all users |

## How syncing works

ACRCloud reports where in the original track the clip matched. The Worker returns the song position at the moment recording stopped:

```
offsetAtStop = db_end_time_offset_ms + (clipMs − sample_end_time_offset_ms)
```

The app records that moment with a monotonic clock and adds the time elapsed since, so upload and processing time don't affect accuracy. **Resync** records a new clip; **±0.5 s** nudges the timing by hand.

## Run it locally

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
