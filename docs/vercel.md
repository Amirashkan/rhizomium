# Deploying to Vercel

The web build - landing page, editor, web patch viewer, docs site - and the AI
backend deploy to Vercel as one project. `vercel.json` in the repository root
holds the whole configuration; this page explains it.

---

## What gets deployed

| Path | What it is |
|---|---|
| `/` | Landing page (`index.html`) |
| `/studio` | The editor (`editor/index.html`). `/editor` redirects here. |
| `/viewer` | The [Web Patch Viewer](web-viewer.md) (`viewer/index.html`) |
| `/docs` | This documentation, copied from `docs/` (minus `docs/internal/` and `docs/profiling/`), plus generated `llms.txt`, `llms-full.txt`, `sitemap.xml` and `robots.txt` |
| `/api/ai/run` | The serverless function behind every AI feature (`api/ai/run.js`) |

Build settings, all from `vercel.json`:

- **Install:** `npm install`
- **Build:** `npm run build:web`
- **Output directory:** `dist`
- **Framework preset:** none
- **Functions:** `api/**/*.js`, with a 300-second max duration

`.vercelignore` keeps the Python bridges, `requirements.txt`, `src-tauri/` and
`tests/` out of the build context, so Vercel does not try to install Python
packages that need local GL or audio libraries.

---

## Deploy

1. Import the repository in the Vercel dashboard (or run `vercel` from the
   repository root with the Vercel CLI). Leave the build settings alone - they
   come from `vercel.json`.
2. Set the environment variables below.
3. Deploy. Pushes to the connected branch deploy automatically; other branches
   and pull requests get preview deployments.

Before deploying, `npm run build:web` locally must succeed - it is the same
command Vercel runs.

---

## Environment variables

Only the AI backend reads any. Without them the site works; AI features fail.

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | Yes, for AI | The model provider key. Never sent to the browser. |
| `TIER_GRANT_SECRET` | Yes, for AI | Shared with the gallery (art.tenderworld.org), which signs the per-user grants every AI request must carry. Requests without a valid grant are refused. |
| `AI_ALLOWED_ORIGINS` | No | Extra comma-separated origins allowed to call the API, e.g. a custom domain. |
| `OPENAI_MODEL` | No | Overrides the model for every feature. |
| `OPENAI_REASONING` | No | `off` disables reasoning parameters, for models that reject them. |
| `AI_DEBUG_MODE` | No | Accepts unsigned `debug:<feature>` tokens, for working on AI features. Ignored on production deployments... |
| `AI_DEBUG_ALLOW_PRODUCTION` | No | ...unless this is also set. Leave it unset. |

The security model is described at the top of `api/ai/run.js` and in
`api/_lib/grant.js`.

---

## Caching

`vercel.json` sets:

- `*.js` and `*.css`: `max-age=0, must-revalidate`, so a deploy is picked up
  on the next load.
- Images, `.wasm` and everything under `/assets/`: one year, immutable. Vite
  fingerprints these file names, so a changed file gets a new URL.

`cleanUrls` is on and `trailingSlash` is off.

---

## What does not work on Vercel

The Python bridges (OSC, NDI, the collab relay, `rhizo_server.py`) are local
processes and cannot run on a static host. Multi-screen output is a
desktop-app feature. See [Installation & Setup](setup.md#optional-local-bridges-python).

---

## Developing against a deployment

`npm run dev` forwards `/api` to `https://studio.tenderworld.org`. To work on
the backend, point it at a preview deployment or a `vercel dev` on another
port:

```bash
API_PROXY=https://your-preview.vercel.app npm run dev
```
