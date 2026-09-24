// Item 4.3: translate songs on a deployed Worker, check line counts against the
// app's LRC parser, then confirm the repeat request is served from the KV cache.
// Usage: node worker/eval/translation-check.mts <baseUrl>
import { parseLrc } from '../../src/lib/lrc.ts';

const base = process.argv[2];
const headers = { 'Content-Type': 'application/json', 'X-Device-Id': 'eval-translation-0001' };
const songs = [
  { id: 36856755, name: 'Despacito (Spanish)' },
  { id: 7366003, name: 'Blueming (Korean)' },
  { id: 37123784, name: 'Alors On Danse (French)' },
];
const post = (lrclibId: number) =>
  fetch(`${base}/translate`, { method: 'POST', headers, body: JSON.stringify({ lrclibId, lang: 'English' }) }).then((r) => r.json());

for (const song of songs) {
  const { lyrics } = await fetch(`${base}/lyrics/${song.id}`, { headers }).then((r) => r.json());
  const expected = parseLrc(lyrics.synced).length;

  const t0 = Date.now();
  let res = await post(song.id);
  let lines: string[] | undefined = res.lines;
  while (!lines) {
    await new Promise((r) => setTimeout(r, 3000));
    const job = await fetch(`${base}/jobs/${res.jobId}`, { headers }).then((r) => r.json());
    if (job.status === 'failed') throw new Error(`${song.name}: ${job.error}`);
    if (job.status === 'complete') lines = job.result.lines;
  }
  const firstMs = Date.now() - t0;

  const t1 = Date.now();
  res = await post(song.id);
  const cachedMs = Date.now() - t1;

  const sample = parseLrc(lyrics.synced).findIndex((l) => l.text.trim());
  console.log(
    `${song.name}: ${lines.length}/${expected} lines ${lines.length === expected ? 'OK' : 'MISMATCH'}, ` +
      `first ${(firstMs / 1000).toFixed(1)} s, repeat ${res.status === 'complete' ? 'cached' : 'NOT cached'} in ${cachedMs} ms\n` +
      `    "${parseLrc(lyrics.synced)[sample].text}" -> "${lines[sample]}"`
  );
}
