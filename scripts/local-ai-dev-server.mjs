// Minimal local stand-in for the Vercel function runtime, so /api/ai/run can
// be exercised from `npm run dev` without `vercel dev` (which does not get
// along with this project's fixed Vite port on Windows — see the AI Performer
// build session). Not part of the deploy; only imported when you run this
// script directly.
//
// Usage:
//   node --env-file=.env.local scripts/local-ai-dev-server.mjs
//   API_PROXY=http://localhost:8788 npm run dev

import { createServer } from 'node:http';

// api/ai/run.js pulls in src/ai/patchContext.js, which transitively reaches
// browser-only modules (ParameterExpressionSystem's deferred worker-support
// setTimeout touches `window`). This server never runs that worker path; the
// stub just keeps the import from crashing under plain Node.
globalThis.window ??= globalThis;

const { default: handler } = await import('../api/ai/run.js');

const PORT = process.env.LOCAL_AI_PORT || 8788;

function decorate(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
    return res;
  };
  return res;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  decorate(res);

  if (!req.url.startsWith('/api/ai/run')) {
    return res.status(404).json({ error: 'Only /api/ai/run is served here.' });
  }

  const raw = await readBody(req);
  if (raw) {
    try {
      req.body = JSON.parse(raw);
    } catch {
      req.body = raw;
    }
  }

  try {
    await handler(req, res);
  } catch (error) {
    console.error('Unhandled error in api/ai/run.js:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Local dev server crashed handling this.' });
  }
});

server.listen(PORT, () => {
  console.log(`Local AI backend on http://localhost:${PORT} (proxy /api there with API_PROXY)`);
  console.log(`AI_DEBUG_MODE=${process.env.AI_DEBUG_MODE || '(unset)'}  OPENAI_API_KEY=${process.env.OPENAI_API_KEY ? 'set' : '(unset)'}`);
});
