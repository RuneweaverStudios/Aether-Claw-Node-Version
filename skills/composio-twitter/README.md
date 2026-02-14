# X Research (Composio) — Aether-Claw skill

X/Twitter research agent for **Aether-Claw**. Search, filter, monitor via [Composio](https://composio.dev); zero X API cost.

## Setup

1. **Bun** — [bun.sh](https://bun.sh) (required for CLI).
2. **Composio** — Create account at [composio.dev](https://composio.dev), connect Twitter, copy API key.
3. **Env** — Set `COMPOSIO_API_KEY` in your environment or in project root `.env`.
4. Optional: `COMPOSIO_CONNECTION_ID` for a specific connected account; `X_RESEARCH_DRAFTS` for `--save` directory (default `~/clawd/drafts`).

## Usage

From project root or from this directory:

```bash
cd skills/composio-twitter

# Search
bun run x-search.ts search "your query" --sort likes --limit 10

# Profile
bun run x-search.ts profile username

# Thread
bun run x-search.ts thread TWEET_ID

# Watchlist
bun run x-search.ts watchlist add username "note"
bun run x-search.ts watchlist check
```

When the Aether-Claw agent sees a request like "search X for …" or "what are people saying about …", it will use this skill (if bun and `COMPOSIO_API_KEY` are available).

## File structure

- `SKILL.md` — Agent instructions (Aether-Claw injects this when the skill applies).
- `x-search.ts` — CLI entry.
- `lib/api.ts` — Composio API wrapper.
- `lib/cache.ts` — 15-min file cache.
- `lib/format.ts` — Telegram/markdown formatters.
- `data/watchlist.json` — Watchlist (create from `data/watchlist.example.json`).

## Credits

Forked from [rohunvora/x-research-skill](https://github.com/rohunvora/x-research-skill). Composio adaptation: [@xBenJamminx](https://x.com/xBenJamminx).
