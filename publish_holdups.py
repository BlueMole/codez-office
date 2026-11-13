#!/usr/bin/env python3
"""Update one team's section in holdups.json, then commit and push.

Usage:
  python3 publish_holdups.py "Inoltro Stack" items.json
  python3 publish_holdups.py "Whodis App Team" \\
    '[{"bot":"OZZIE","title":"Approve the draft","since":"2026-11-12T15:00:00-08:00","blocks":"Launch email"}]'

Items may be a JSON array or an object with an "items" key. Each item needs
bot and title; since (ISO) and blocks are optional. Bot ids and grokbot://
urls are filled from agent profiles by exact name.

Looks for profiles under AGENTS_DIR (default /home/box/agent-data/agents).
A name matches a profile's "name" field exactly, or uniquely matches the
part before " · " (so "Foreman" resolves "Foreman · Project Lead").

Does not post to the office ntfy feed. Pass --no-push to commit locally only.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
HOLDUPS = ROOT / "holdups.json"
AGENTS_DIR = Path(os.environ.get("AGENTS_DIR", "/home/box/agent-data/agents"))
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I
)
GROKBOT_RE = re.compile(r'^grokbot://[^\s"\'<>\\]+$', re.I)


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def load_profiles(agents_dir: Path) -> dict[str, str]:
    """Map exact profile name -> bot id (directory name)."""
    out: dict[str, str] = {}
    if not agents_dir.is_dir():
        return out
    for d in sorted(agents_dir.iterdir()):
        prof = d / "profile.json"
        if not d.is_dir() or not prof.is_file():
            continue
        try:
            data = json.loads(prof.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        name = data.get("name")
        if isinstance(name, str) and name.strip() and UUID_RE.match(d.name):
            out[name.strip()] = d.name
    return out


def resolve_bot(bot: str, profiles: dict[str, str]) -> tuple[str, str]:
    """Return (canonical_name, bot_id). Prefer exact profile name."""
    if bot in profiles:
        return bot, profiles[bot]
    # Unique prefix before " · "
    hits = [(n, i) for n, i in profiles.items() if n.split(" · ", 1)[0] == bot]
    if len(hits) == 1:
        return hits[0]
    if len(hits) > 1:
        names = ", ".join(n for n, _ in hits)
        raise SystemExit(f"Ambiguous bot name {bot!r}; matches: {names}")
    raise SystemExit(
        f"No agent profile named {bot!r}. Use the exact profile name."
    )


def parse_items(raw: str) -> list[dict[str, Any]]:
    path = Path(raw)
    if path.is_file():
        text = path.read_text()
    else:
        text = raw
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise SystemExit(f"Could not parse items as JSON: {e}") from e
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        data = data["items"]
    if not isinstance(data, list):
        raise SystemExit("Items must be a JSON array or an object with an 'items' key.")
    return data


def normalize_item(it: Any, profiles: dict[str, str]) -> dict[str, Any]:
    if not isinstance(it, dict):
        raise SystemExit(f"Each item must be an object, got {type(it).__name__}")
    bot = it.get("bot")
    title = it.get("title")
    if not isinstance(bot, str) or not bot.strip():
        raise SystemExit("Each item needs a non-empty 'bot' string.")
    if not isinstance(title, str) or not title.strip():
        raise SystemExit(f"Item for {bot!r} needs a non-empty 'title' string.")
    canonical, bot_id = resolve_bot(bot.strip(), profiles)
    since = it.get("since")
    if since is not None:
        if not isinstance(since, str) or not since.strip():
            raise SystemExit(f"Item {title!r}: 'since' must be an ISO timestamp string.")
        try:
            datetime.fromisoformat(since.strip().replace("Z", "+00:00"))
        except ValueError as e:
            raise SystemExit(f"Item {title!r}: invalid 'since' timestamp {since!r}") from e
        since = since.strip()
    blocks = it.get("blocks")
    if blocks is not None and not isinstance(blocks, str):
        raise SystemExit(f"Item {title!r}: 'blocks' must be a string.")
    url = it.get("url")
    if url is not None and not (isinstance(url, str) and GROKBOT_RE.match(url)):
        raise SystemExit(f"Item {title!r}: 'url' must be a grokbot:// link.")
    if not url:
        url = f"grokbot://app/v1/agent?id={bot_id}"
    out: dict[str, Any] = {
        "bot": canonical,
        "bot_id": bot_id,
        "title": title.strip(),
        "since": since,
        "blocks": (blocks.strip() if isinstance(blocks, str) and blocks.strip() else None),
        "url": url,
    }
    # Keep JSON tidy: drop null optional fields? Schema in the brief includes them.
    # Keep since/blocks even if null so the shape is stable? Brief shows them present.
    # I'll omit nulls for cleanliness except we could keep since as required-looking.
    # Brief example has since and blocks present. I'll omit keys that are None.
    return {k: v for k, v in out.items() if v is not None}


def load_holdups() -> dict[str, Any]:
    if HOLDUPS.is_file():
        try:
            data = json.loads(HOLDUPS.read_text())
        except json.JSONDecodeError as e:
            raise SystemExit(f"holdups.json is not valid JSON: {e}") from e
        if not isinstance(data, dict):
            raise SystemExit("holdups.json must be a JSON object.")
        if not isinstance(data.get("teams"), dict):
            data["teams"] = {}
        return data
    return {
        "updated": None,
        "teams": {
            "Inoltro Stack": {"updated": None, "stale": False, "items": []},
            "Whodis App Team": {"updated": None, "stale": False, "items": []},
        },
    }


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(ROOT), *args],
        check=check,
        text=True,
        capture_output=True,
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("team", help='Team name, e.g. "Inoltro Stack" or "Whodis App Team"')
    ap.add_argument("items", help="Path to a JSON file, or a JSON array string")
    ap.add_argument("--no-push", action="store_true", help="Commit locally but do not push")
    ap.add_argument("--no-commit", action="store_true", help="Write the file only, do not commit or push")
    args = ap.parse_args()

    team = args.team.strip()
    if not team:
        raise SystemExit("Team name is empty.")

    profiles = load_profiles(AGENTS_DIR)
    if not profiles:
        raise SystemExit(f"No agent profiles found in {AGENTS_DIR}")

    items = [normalize_item(it, profiles) for it in parse_items(args.items)]
    stamp = now_iso()
    data = load_holdups()
    teams: dict[str, Any] = data["teams"]
    teams[team] = {"updated": stamp, "stale": False, "items": items}
    data["updated"] = stamp
    HOLDUPS.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {len(items)} item(s) for {team} to {HOLDUPS.name}")

    if args.no_commit:
        return

    git("add", "--", "holdups.json")
    status = git("status", "--porcelain", "--", "holdups.json", check=True)
    if not status.stdout.strip():
        print("No change to commit.")
        return
    msg = f"Update {team} holdups"
    git("commit", "-m", msg)
    print(f"Committed: {msg}")
    if args.no_push:
        print("Skipped push (--no-push).")
        return
    git("push", "origin", "HEAD")
    print("Pushed to origin.")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        err = (e.stderr or e.stdout or str(e)).strip()
        print(err or f"git failed with exit {e.returncode}", file=sys.stderr)
        sys.exit(e.returncode)
