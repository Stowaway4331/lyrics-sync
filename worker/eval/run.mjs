// Lyric-search baseline: sends each snippet to POST /chat on a running Worker
// and checks whether the expected song is among the verified song cards.
// Usage: npm run dev (in another terminal), then: node eval/run.mjs [baseUrl]
import { readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:8787';
const cases = JSON.parse(readFileSync(new URL('./lyric-search.json', import.meta.url), 'utf8'));
const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');

async function ask(message, i) {
  const res = await fetch(`${base}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': `eval-device-${String(i).padStart(4, '0')}` },
    body: JSON.stringify({ message: `What song goes: "${message}"` }),
  });
  const text = await res.text();
  const cards = [];
  for (const frame of text.split('\n\n')) {
    if (!frame.startsWith('data:')) continue;
    const event = JSON.parse(frame.slice(5));
    if (event.type === 'cards') cards.push(...event.cards);
  }
  return cards;
}

let top1 = 0;
let top3 = 0;
let labelledMatch = 0;
for (const [i, c] of cases.entries()) {
  const cards = await ask(c.snippet, i);
  const rank = cards.findIndex((k) => norm(k.title).includes(norm(c.title)) || norm(c.title).includes(norm(k.title)));
  if (rank === 0) top1++;
  if (rank >= 0 && rank < 3) top3++;
  if (rank >= 0 && cards[rank].label === 'match') labelledMatch++;
  const got = cards.map((k) => `${k.title} (${k.label ?? '-'})`).join('; ') || 'no cards';
  console.log(`${rank >= 0 ? 'HIT ' : 'MISS'} #${rank >= 0 ? rank + 1 : '-'}  ${c.title} — ${got}`);
}
const pct = (n) => `${n}/${cases.length} (${Math.round((n / cases.length) * 100)}%)`;
console.log(`\ntop-1: ${pct(top1)}  top-3: ${pct(top3)}  expected song labelled "match": ${pct(labelledMatch)}`);
