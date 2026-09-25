# Namernut

Never fall for a name that's already taken.
**[namernut.com](https://namernut.com)** is an AI business name generator
that instantly checks domain, Instagram & search availability.

Type a keyword, and Namernut pairs it against an English dictionary (plus
optional AI-suggested synonyms, AI-invented names, and alternate spellings)
to generate candidate names, checks each one's live availability as a domain
across selectable TLDs (.com, .io, .ai, .co, and more) and as an Instagram,
GitHub, and TikTok handle, filters out anything unpronounceable or
typo-prone, and — on request — runs an AI web-search-backed "brandability"
check that scores 0–100 how much real-world competition the name already
faces (an existing company, product, or well-known use), with a
plain-language summary of what it found.

## Features

- Dictionary-based name generation, augmented by AI synonyms, AI-invented
  names, and deterministic alternate spellings
- Live domain availability across multiple TLDs (RDAP/WHOIS)
- Live Instagram, GitHub, and TikTok handle availability
- Pronounceability, typo, and "niceness" filters
- AI brandability scoring (0–100) with a written summary per name
- Favorites and a running archive of every name found, ranked by score

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · Vitest

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in the API keys below
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `SERPER_API_KEY` | Yes (default provider) | Web search backing the brandability check ([serper.dev](https://serper.dev)) |
| `SERPENT_API_KEY` | Only if `SEARCH_PROVIDER=serpent` | Alternative search provider |
| `SEARCH_PROVIDER` | No | `serper` (default) or `serpent` |
| `KILOCODE_API_KEY` | Yes | LLM calls for AI synonyms/invented names/brandability summaries |
| `KILOCODE_MODEL` | No | Model id to use via Kilocode; falls back to the free auto-router model |
| `INSTAGRAM_SESSION_ID` | No | Enables live Instagram handle checks |

## Scripts

```bash
npm run dev      # start the dev server
npm run build    # production build
npm run lint      # eslint
npm test          # vitest
```

## Deployment

Deployed via Docker + Ansible + GitHub Actions to a self-hosted VPS behind
Cloudflare — see `ansible/` and `.github/workflows/ci-cd.yml`.

## License

[MIT](LICENSE)
