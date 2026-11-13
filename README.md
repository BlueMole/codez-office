# codez-office

Static viewer for an ntfy.sh bot-status feed. Open https://bluemole.github.io/codez-office/#<TOPIC>

## Message types (JSON posted to the topic)

- Status: `{"bot":"Name","status":"working|idle|waiting_user|error|done","step":"..."}`
- Roster / looks / teams / chat / routines / usage — see `app.js`.
- Usage: `{"type":"usage","total_used_pct":42,"resets_at":"<ISO>","bots":{"Name":12.5}}` (also accepts `bots:[{"bot":"Name","pct":12.5}]` or `shares:{"Name":12.5}`).

### Holding things back

The top-of-page **Holding things back** panel is Kevin's open-items list. Each row is a link
to that bot's chat (`grokbot://app/v1/agent?id=<id>`). Items sort oldest first and are grouped
by team. A team is marked **stale** if its last report is older than 12 hours. Empty state:
"Nothing waiting on you."

Persistent source: committed `holdups.json` in this repo (survives the ntfy feed's 12-hour
memory). The page fetches it with a cache-buster and merges live `kevin_items` from the feed
(plus `waiting_user` / `error` status steps and board items with status `waiting_kevin`),
deduped by bot + title.

```json
{
  "updated": "2026-11-13T15:00:00-08:00",
  "teams": {
    "Inoltro Stack": {
      "updated": "2026-11-13T15:00:00-08:00",
      "stale": false,
      "items": [
        {"bot":"OZZIE","bot_id":"<uuid>","title":"Approve the draft","since":"2026-11-12T10:00:00-08:00","blocks":"Launch email","url":"grokbot://app/v1/agent?id=<uuid>"}
      ]
    }
  }
}
```

To publish a team's list (writes that team's section, then commits and pushes):

```bash
python3 publish_holdups.py "Inoltro Stack" items.json
python3 publish_holdups.py "Whodis App Team" '[{"bot":"OZZIE","title":"Approve the draft","since":"2026-11-12T15:00:00-08:00","blocks":"Launch email"}]'
```

`--no-commit` writes the file only; `--no-push` commits locally and skips the push.
Bot ids and chat URLs are filled from agent profiles (`AGENTS_DIR`, default
`/home/box/agent-data/agents`) by exact name. This script does not post to the ntfy feed.

Live feed posts still work as a supplement:

```json
{"kevin_items":{"bot":"Name","items":[{"title":"Approve the draft email","since":"2026-11-04T21:00:00Z"}]}}
```

Each post **replaces** that bot's list; `"items":[]` clears it.

### Team boards

```json
{"board":{"team":"Inoltro Stack","bot":"OZZIE","updated":"<ISO>","items":[
  {"title":"Ship v2","status":"working|waiting_kevin|blocked|next|done","owner":"OZZIE","since":"<ISO>","due":"<ISO, optional>"}]}}
```

Each post **replaces** that team's board (keyed by `team`). `open` is accepted and treated as `next`.
Each card shows three columns: **Working on** (`working` + `blocked`, blocked flagged and listed first),
**Owed to you** (`waiting_kevin`), **Up next** (`next`), plus `done` collapsed behind a count. Owner, age and due
are shown; overdue dues are highlighted. `waiting_kevin` items also appear in the Holding things back panel (deduped by bot + title), with the row linking to the posting `bot`'s chat. Columns stack on mobile.
