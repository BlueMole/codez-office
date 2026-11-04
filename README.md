# codez-office

Static viewer for an ntfy.sh bot-status feed. Open https://bluemole.github.io/codez-office/#<TOPIC>

## Message types (JSON posted to the topic)

- Status: `{"bot":"Name","status":"working|idle|waiting_user|error|done","step":"..."}`
- Roster / looks / teams / chat / routines / usage — see `app.js`.
- Usage: `{"type":"usage","total_used_pct":42,"resets_at":"<ISO>","bots":{"Name":12.5}}` (also accepts `bots:[{"bot":"Name","pct":12.5}]` or `shares:{"Name":12.5}`).

### Kevin open items

```json
{"kevin_items":{"bot":"Name","items":[{"title":"Approve the draft email","since":"2026-11-04T21:00:00Z"}]}}
```

Each post **replaces** that bot's list; `"items":[]` clears it. Bots whose latest status is
`waiting_user` or `error` also get an item from their `step` text (tagged *waiting* / *error*)
unless the same text is already in that bot's `kevin_items`. Items sort oldest first; the
**Open** button uses the bot's `grokbot://` link from the `chat` map.

### Team boards

```json
{"board":{"team":"Inoltro Stack","bot":"OZZIE","updated":"<ISO>","items":[
  {"title":"Ship v2","status":"working|waiting_kevin|blocked|next|done","owner":"OZZIE","since":"<ISO>","due":"<ISO, optional>"}]}}
```

Each post **replaces** that team's board (keyed by `team`). `open` is accepted and treated as `next`.
Each card shows three columns: **Working on** (`working` + `blocked`, blocked flagged and listed first),
**Owed to you** (`waiting_kevin`), **Up next** (`next`), plus `done` collapsed behind a count. Owner, age and due
are shown; overdue dues are highlighted. `waiting_kevin` items also appear in Kevin open items, tagged with
the team name, with Open linking to the posting `bot`'s chat link. Columns stack on mobile.
