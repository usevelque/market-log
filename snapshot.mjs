// Take one snapshot of every Velque market straight from chain and append it
// to data/YYYY-MM-DD.jsonl. Runs hourly from GitHub Actions.
//
// Each line records what a trader would have seen at that moment: the session,
// the reference price and its age, the current auction window, the best bid
// and ask of the day book, and every cleared window still stored on chain
// together with the result of replaying it locally.
import { Connection, PublicKey } from '@solana/web3.js';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PROGRAM_ID, HEADER, ENTRY, bookPda, readMarket, readBook, readDay, session, nasdaqOpen, replay } from 'velque-sdk';

const cfg = JSON.parse(readFileSync(new URL('./markets.json', import.meta.url)));
const RPCS = (process.env.VELQUE_RPC || 'https://api.devnet.solana.com,https://solana-devnet.api.onfinality.io/public').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// public endpoints rate-limit: rotate and back off instead of failing the run
let turn = 0;
async function rpc(fn) {
  for (let i = 0; ; i++) {
    try {
      return await fn(new Connection(RPCS[turn % RPCS.length], 'confirmed'));
    } catch (e) {
      if (i >= 7) throw e;
      turn++;
      await sleep(1500 * (i + 1));
    }
  }
}

const now = Math.floor(Date.now() / 1000);
const stamp = new Date(now * 1000).toISOString();
const px = (v) => Number(v) / 1e6;
const rows = [];

for (const m of cfg.markets) {
  const market = new PublicKey(m.market);
  const unit = 10 ** m.baseDecimals;
  const mk = await rpc((c) => readMarket(c, market));
  const day = await rpc((c) => readDay(c, market));
  const window = await rpc((c) => readBook(c, bookPda(market, mk.auctionId)));
  const stored = await rpc((c) => c.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: HEADER + 64 * ENTRY }, { memcmp: { offset: 8, bytes: market.toBase58() } }],
  }));
  const cleared = [];
  for (const a of stored) {
    const b = await readBook({ getAccountInfo: async () => a.account }, a.pubkey);
    if (!b.cleared) continue;
    cleared.push({
      id: Number(b.auctionId), at: b.clearedAt, cross: b.clearedAt < b.windowEnd,
      price: b.volume > 0n ? px(b.clearPrice) : null, volume: Number(b.volume) / unit,
      orders: b.orders.length, replay: replay(b, mk).ok ? 'match' : 'MISMATCH',
    });
  }
  cleared.sort((x, y) => x.id - y.id);
  const live = window ? window.orders.filter((o) => o.status === 'live') : [];
  rows.push({
    t: stamp, token: m.token, symbol: m.symbol,
    nasdaq: nasdaqOpen(now) ? 'open' : 'closed', session: session(mk, now),
    reference: px(mk.reference), referenceAgeSec: mk.refAt ? now - mk.refAt : null,
    lastPrice: mk.lastPrice > 0n ? px(mk.lastPrice) : null,
    window: Number(mk.auctionId), windowOrders: live.length, windowsCleared: Number(mk.auctionsCleared),
    bestBid: day.bids[0] ? px(day.bids[0].price) : null, bestAsk: day.asks[0] ? px(day.asks[0].price) : null,
    dayOrders: day.bids.length + day.asks.length,
    storedAuctions: cleared,
  });
}

mkdirSync(new URL('./data/', import.meta.url), { recursive: true });
appendFileSync(new URL(`./data/${stamp.slice(0, 10)}.jsonl`, import.meta.url), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

// LATEST.md: the same snapshot as a table, for people
const cell = (v, d = 2) => (v === null || v === undefined ? 'n/a' : typeof v === 'number' ? v.toFixed(d) : v);
const mismatches = rows.flatMap((r) => r.storedAuctions).filter((a) => a.replay !== 'match').length;
const md = [
  '# Latest snapshot', '', `Taken ${stamp} from Solana devnet. Nasdaq is ${rows[0].nasdaq}.`, '',
  '| Token | Session | Reference | Ref age | Last price | Best bid | Best ask | Window | Orders waiting |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.token} | ${r.session} | ${cell(r.reference)} | ${r.referenceAgeSec === null ? 'n/a' : r.referenceAgeSec + 's'} | ${cell(r.lastPrice)} | ${cell(r.bestBid)} | ${cell(r.bestAsk)} | #${r.window} | ${r.session === 'day' ? r.dayOrders : r.windowOrders} |`),
  '', `Auctions stored on chain and replayed in this run: ${rows.reduce((n, r) => n + r.storedAuctions.length, 0)}, mismatches: ${mismatches}.`, '',
];
writeFileSync(new URL('./LATEST.md', import.meta.url), md.join('\n'));
console.log(md.join('\n'));
if (mismatches) process.exit(1);
