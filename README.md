# market-log

Daily snapshots of the [Velque](https://usevelque.xyz) test market, taken straight from Solana.

Once a day a GitHub Action reads every market from chain and appends one line per market to `data/YYYY-MM-DD.jsonl`. The newest snapshot is also written to [LATEST.md](LATEST.md) as a table.

## What a line holds

| Field | Meaning |
| --- | --- |
| `t` | Time of the snapshot, UTC |
| `nasdaq` | `open` or `closed` by the exchange calendar |
| `session` | `day` or `dark` as the program sees it, from the age of the reference price |
| `reference`, `referenceAgeSec` | The oracle reference price and how long ago it was posted |
| `lastPrice` | Price of the last trade or clearing |
| `window`, `windowOrders` | Current auction window and the orders waiting in it |
| `bestBid`, `bestAsk`, `dayOrders` | Top of the day book and its size |
| `storedAuctions` | Every cleared window still on chain: id, time, price, volume, whether it was an opening cross, and the result of replaying it |

`nasdaq` and `session` are recorded separately on purpose. They should agree within a few minutes of each bell. A longer disagreement means the oracle stopped posting, and the log records it.

## Replay

Each run recomputes every stored auction from its orders with the clearing rule in [velque-sdk](https://github.com/usevelque/velque-sdk) and writes `match` or `MISMATCH`. A mismatch fails the workflow run, so this repository shows a failed run if the program and the published rule ever disagree.

## Run it yourself

```bash
npm install
node snapshot.mjs
```

It needs no keys. Set `VELQUE_RPC` to use your own endpoint, since public devnet endpoints rate-limit.

## Related

- [auction-replay](https://github.com/usevelque/auction-replay): replay a single market or window by hand
- [velque-program](https://github.com/usevelque/velque-program): the on-chain program

## License

MIT
