/**
 * POST /api/ai/run - the one door to the model.
 *
 * Every AI feature in the editor comes through here, and nothing gets past
 * without a grant the gallery signed. The order below is the whole security
 * model:
 *
 *   1. Verify the grant's signature and expiry (api/_lib/grant.js).
 *   2. Take the feature from the *grant*, never from the request body. A grant
 *      for patch review must not buy a creative director session.
 *   3. Only then call the model.
 *
 * The browser never sees OPENAI_API_KEY, and the editor cannot talk itself
 * into a tier it does not have: the tier in the payload was written by the
 * gallery, which read it from the database.
 */

import OpenAI from 'openai';
import { verifyGrant, grantsConfigured, claimGrantId } from '../_lib/grant.js';
import { applyCors } from '../_lib/cors.js';
import {
  featureConfig,
  buildUserMessage,
  answerBudget,
  BadInputError,
} from '../_lib/features.js';
import { validateGeneratedPatch } from '../_lib/nodeCatalog.js';

/**
 * Everything the artist has on their canvas travels in the request. A large
 * patch is normal; an unbounded one is someone else's problem being made ours.
 */
const MAX_INPUT_BYTES = 512 * 1024;

/**
 * How long the platform lets this function run, in seconds.
 *
 * It has to be the same number as `functions` → `maxDuration` in vercel.json;
 * tests/aiRequestTimeout.test.js reads both and fails if they drift. What
 * makes it worth knowing here is what happens when it is reached: the platform
 * kills the invocation and answers 504 itself, from outside this file — with
 * none of the CORS headers applyCors() put on the response. The browser is
 * then handed a reply it is not allowed to read, and reports the whole thing
 * as
 *
 *   No 'Access-Control-Allow-Origin' header is present on the requested resource
 *
 * which sends whoever debugs it into the CORS configuration, where nothing is
 * wrong. That is exactly what a review of a real, loaded patch looked like:
 * the default graph answers in a few seconds, and a patch with a canvas full
 * of nodes did not fit in the 60 seconds this function used to be given.
 */
export const FUNCTION_BUDGET_SECONDS = 300;

/**
 * The latest any call may still be running, whatever it is.
 *
 * Inside the platform's limit by enough to still write an answer. An honest
 * 504 that says the call ran long — with the CORS headers on it, so the editor
 * can read it and tell the artist — beats one from the platform that the
 * browser turns into a CORS error.
 *
 * This is the ceiling, not the setting: each call gets a deadline of its own,
 * sized from what it was allowed to write (see deadlineFor). Only the largest
 * refactor of the largest patch ever comes near this one.
 */
export const MODEL_DEADLINE_MS = (FUNCTION_BUDGET_SECONDS - 15) * 1000;

/**
 * The model most features run on.
 *
 * This used to be gpt-5.6-luna, the cost-efficient tier, on the argument that
 * reading a graph and reporting on it is not work that needs a large model.
 * The argument was half right. Luna is fine at *describing* a patch; what
 * these features are actually asked for is judgement — is this wiring what the
 * artist meant, will this parameter render black, is this chain worth
 * collapsing — and there the cheap tier was not earning its saving. A finding
 * that is wrong costs an artist more than the model cost saved, because they
 * act on it.
 *
 * So the default is now terra, and the exception goes the other way: a feature
 * that needs speed more than judgement names luna for itself, which today is
 * `ai.canvas_assist` alone (see features.js). Making the careful choice the
 * default also means a feature added later inherits it rather than inheriting
 * the cheap one by silence.
 *
 * On price: terra is $2.00 per million input tokens against gpt-5.5's $5.00,
 * and most of every request here is the node catalogue, which is identical
 * across calls and served from the prefix cache. The bill this moves is small
 * and it is the right place to spend it.
 *
 * Two things any replacement has to be able to do: Structured Outputs, which is
 * how every answer here is data rather than prose, and the Responses API. It
 * does not have to be a reasoning model — see reasoningEnabled().
 */
const DEFAULT_MODEL = 'gpt-5.6-terra';

/**
 * `OPENAI_MODEL` exists so that moving to the next model is an environment
 * change rather than a deploy — and so a deployment on a different account can
 * name a model it actually has access to. It overrides every feature's own
 * choice, which is what makes it a usable escape hatch: one variable puts the
 * whole backend on one model. A model this account cannot reach comes back as
 * a 404 and is reported as a configuration problem, not as a failure the
 * artist did anything about.
 */
function modelName(config) {
  return process.env.OPENAI_MODEL || config?.model || DEFAULT_MODEL;
}

/**
 * Whether to send `reasoning` at all.
 *
 * A reasoning model wants it; a model without a reasoning mode rejects the
 * whole request for carrying it, which would turn naming a cheaper model into
 * a 400 on every call and read as a bug in the editor. `OPENAI_REASONING=off`
 * is how an operator says the model they named does not think out loud.
 *
 * Off is also the cheaper setting where it is available: reasoning tokens are
 * billed as output, and on a run of small patches they can outweigh the answer.
 */
function reasoningEnabled() {
  return String(process.env.OPENAI_REASONING || '').toLowerCase() !== 'off';
}

/**
 * Room to think, for a feature that has not said how much it needs.
 *
 * Reasoning tokens are spent out of `max_output_tokens`, unlike the answer
 * budgets in features.js, which describe the answer alone. Without headroom a
 * feature that thinks hard runs out of budget mid-sentence and comes back
 * `incomplete` — a spent call and nothing to show for it. Every feature names
 * its own `reasoningTokens`; this is only the floor under a new one that
 * forgets to.
 */
const DEFAULT_REASONING_TOKENS = 6000;

/**
 * How fast to assume the model writes, for turning a token budget into a
 * deadline.
 *
 * Deliberately pessimistic — roughly half of what these models decode at in
 * practice. A deadline that is too generous costs us nothing except a longer
 * wait in the rare case where a call has genuinely hung; one that is too tight
 * throws away calls that were about to answer, and bills the artist for them.
 * Every completed call logs its tokens and its seconds (see logCall), so this
 * can be calibrated from real numbers rather than adjusted by feel.
 */
const ASSUMED_TOKENS_PER_SECOND = 50;

/** Nothing is given less than this, however small its budget. */
const MIN_DEADLINE_MS = 30 * 1000;

/**
 * When to give up on a call whose budget is this many tokens.
 *
 * The point of deriving it rather than fixing it: a canvas-assist call that is
 * allowed 3,500 tokens has no business taking four minutes, and a refactor of
 * four hundred nodes cannot be held to seventy seconds. Each feature waits in
 * proportion to what it was allowed to write, and none of them waits longer
 * than the platform will (see MODEL_DEADLINE_MS).
 */
function deadlineFor(tokens) {
  const derived = (tokens / ASSUMED_TOKENS_PER_SECOND) * 1000;
  return Math.min(MODEL_DEADLINE_MS, Math.max(MIN_DEADLINE_MS, Math.round(derived)));
}

/**
 * The effort vocabulary in features.js, mapped to what the model accepts.
 *
 * `xhigh` still lands on `high`. The GPT-5.6 family takes `xhigh` and `max`,
 * so the ceiling this clamp was written for has moved — but `high` is the
 * deepest setting every model an operator might pin with `OPENAI_MODEL`
 * accepts, a rejected effort value fails the whole call, and reasoning tokens
 * are billed as output. Raise the `xhigh` row here if a deployment wants the
 * deeper setting and knows its model takes it.
 */
const EFFORT = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'high',
};

let client = null;
function openai() {
  if (!client) client = new OpenAI();
  return client;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  // Before every other path out, so that an error the browser is entitled to
  // read does not come back as a CORS failure instead. The desktop app and a
  // local dev server both call this endpoint cross-origin; see _lib/cors.js.
  applyCors(req, res);

  // The preflight. It answers 204 either way — a browser whose origin was not
  // allowed sees the missing header and refuses to send the POST, which is the
  // outcome we want and the one it reports.
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Use POST.' });
  }

  if (!grantsConfigured()) {
    // The operator has not set TIER_GRANT_SECRET here. Say so plainly rather
    // than letting every call fail as an invalid grant, which would send
    // whoever debugs it looking in the wrong place.
    console.error('TIER_GRANT_SECRET is not set on the AI backend; refusing every request.');
    return res.status(503).json({
      error: 'AI features are not configured on this deployment.',
      code: 'not_configured',
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set on the AI backend; refusing every request.');
    return res.status(503).json({
      error: 'AI features are not configured on this deployment.',
      code: 'not_configured',
    });
  }

  const body = parseBody(req);
  if (!body) return res.status(400).json({ error: 'Expected a JSON body.' });

  // --- The gate ------------------------------------------------------------
  const grant = verifyGrant(body.grant, {
    onInvalid: (reason) => {
      // In normal operation this does not happen: the editor asks for a grant
      // immediately before calling here. Worth a line when it does.
      console.warn(`Rejected an AI request: grant ${reason}.`);
    },
  });

  if (!grant) {
    return res.status(401).json({
      error: 'Missing or invalid grant. Ask the gallery for permission first.',
      code: 'invalid_grant',
    });
  }

  // The grant says what was paid for. The body's `feature` is a claim, and is
  // only ever used to notice a mismatch — never to choose what runs.
  const feature = grant.feature;
  if (body.feature && body.feature !== feature) {
    console.warn(`Grant/body feature mismatch: grant=${feature} body=${body.feature}.`);
    return res.status(403).json({
      error: 'This grant is for a different feature.',
      code: 'feature_mismatch',
    });
  }

  const config = featureConfig(feature);
  if (!config) {
    // A valid grant for something this backend does not serve — render.server_side,
    // or a feature the gallery added before we did.
    return res.status(501).json({
      error: `${feature} is not available in this editor yet.`,
      code: 'not_implemented',
    });
  }

  if (config.singleUse && !claimGrantId(grant.jti)) {
    return res.status(409).json({
      error: 'That grant has already been used. Start the action again.',
      code: 'grant_replayed',
    });
  }

  // --- Only now is it worth spending a model call --------------------------
  const input = body.input || {};
  const inputBytes = Buffer.byteLength(JSON.stringify(input));
  if (inputBytes > MAX_INPUT_BYTES) {
    return res.status(413).json({
      error: `That patch is too large to send (${Math.round(inputBytes / 1024)}KB). Trim it and try again.`,
      code: 'input_too_large',
    });
  }

  let userMessage;
  try {
    userMessage = buildUserMessage(feature, input);
  } catch (error) {
    if (error instanceof BadInputError) {
      return res.status(400).json({ error: error.message, code: 'bad_input' });
    }
    throw error;
  }

  const started = Date.now();

  try {
    const result = await callModel(config, userMessage, input);
    const payload = shapeResult(feature, result);

    logCall(config, result, Date.now() - started);

    return res.status(200).json({
      feature,
      label: config.label,
      tier: grant.tier,
      ...payload,
    });
  } catch (error) {
    return handleModelError(error, res, config);
  }
}

/**
 * One line per completed call: what it cost, and how long it took.
 *
 * The budgets in features.js and ASSUMED_TOKENS_PER_SECOND above are estimates
 * of numbers nobody had measured — which is how a review came to be allowed
 * 32,000 output tokens and then ran past the function's time limit. This is
 * where the real ones come from. Read a few of these before changing either.
 */
function logCall(config, { usage, budget }, elapsedMs) {
  const reasoning = usage?.output_tokens_details?.reasoning_tokens;
  // Reasoning is counted inside output_tokens, so the answer is what is left.
  // Floored: a usage shape that disagrees should read as odd, not as negative.
  const answer = Math.max(0, (usage?.output_tokens ?? 0) - (reasoning ?? 0));
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0;

  console.log(
    `${config.label}: ${(elapsedMs / 1000).toFixed(1)}s, ` +
      `${reasoning ?? '?'} reasoning + ${answer} answer of ${budget} allowed, ` +
      `${usage?.input_tokens ?? '?'} in (${cached} cached).`
  );
}

/**
 * One model call, answered through a Structured Outputs schema so the result
 * is data rather than prose to be parsed.
 *
 * Streaming throughout: the generative features write whole patches, and a
 * non-streaming request with a large max_output_tokens is how you meet an HTTP
 * timeout instead of an answer. Nothing is streamed on to the browser — the
 * editor wants a whole patch or nothing — but the connection stays alive.
 *
 * The system prompt goes in `instructions`, where it is the stable prefix of
 * every request for a feature. OpenAI caches long prefixes automatically, so
 * the node catalogue that makes up most of its bulk is not paid for in full on
 * every call; there is nothing to mark, and nothing to keep in sync.
 */
async function callModel(config, userMessage, input) {
  const thinks = reasoningEnabled();
  const reasoningRoom = config.reasoningTokens ?? DEFAULT_REASONING_TOKENS;
  const outputBudget = answerBudget(config, input) + (thinks ? reasoningRoom : 0);

  // Our own deadline, always shorter than the platform's, so that a call that
  // runs long ends as an answer rather than as a killed invocation the browser
  // cannot read. Sized from the budget: this call cannot write more than
  // `outputBudget` tokens, so waiting longer than those tokens could take is
  // waiting for something that is not coming. See FUNCTION_BUDGET_SECONDS.
  const deadlineMs = deadlineFor(outputBudget);
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), deadlineMs);

  try {
    const answered = await streamAnswer(config, userMessage, {
      thinks,
      outputBudget,
      signal: controller.signal,
    });
    return { ...answered, budget: outputBudget };
  } catch (error) {
    if (controller.signal.aborted) {
      console.error(
        `${config.label}: no answer within ${Math.round(deadlineMs / 1000)}s ` +
          `(budget ${outputBudget} tokens) — gave up.`
      );
      const timeout = new Error('The AI did not finish in time.');
      timeout.code = 'timed_out';
      timeout.deadlineMs = deadlineMs;
      throw timeout;
    }
    throw error;
  } finally {
    // A timer still pending keeps the invocation alive after the answer is
    // written, and is billed for.
    clearTimeout(deadline);
  }
}

/** The call itself, run under callModel()'s deadline. */
async function streamAnswer(config, userMessage, { thinks, outputBudget, signal }) {
  const stream = openai().responses.stream(
    {
      model: modelName(config),
      instructions: config.system(),
      input: [{ role: 'user', content: userMessage }],
      ...(thinks ? { reasoning: { effort: EFFORT[config.effort] || 'medium' } } : {}),
      // Reasoning is spent out of this budget; without it the answer is the whole
      // of it, and the headroom would only be an invitation to ramble.
      max_output_tokens: outputBudget,
      // Every call for a feature shares one prefix — the whole node registry —
      // and prefix caching only pays when the request lands where that prefix is
      // already warm. Keying by feature is what makes that likely under load
      // rather than lucky. It steers routing; it is not part of the prompt.
      prompt_cache_key: config.format.name,
      text: {
        format: {
          type: 'json_schema',
          name: config.format.name,
          description: config.format.description,
          schema: config.format.schema,
          strict: Boolean(config.strict),
        },
      },
      // Artists' patches are their work. There is no reason for this deployment
      // to leave copies of them on someone else's server for 30 days.
      store: false,
    },
    { signal }
  );

  const response = await stream.finalResponse();

  const refusal = findRefusal(response);
  if (refusal !== null) {
    const error = new Error('The model declined this request.');
    error.refusal = refusal || null;
    error.code = 'refused';
    throw error;
  }

  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason;

    if (reason === 'content_filter') {
      const error = new Error('The model declined this request.');
      error.code = 'refused';
      error.refusal = null;
      throw error;
    }

    // Ran out of budget mid-answer. Half a patch is not a patch, so this is a
    // failed call rather than a partial result — and it is ours to fix, by
    // raising the feature's budget in features.js.
    console.error(
      `${config.label}: answer did not finish (${reason || 'unknown'}) within ` +
        `${outputBudget} output tokens.`
    );
    const error = new Error('The model ran out of room before finishing its answer.');
    error.code = 'answer_truncated';
    throw error;
  }

  const text = typeof response.output_text === 'string' ? response.output_text.trim() : '';
  if (!text) {
    const error = new Error('The model did not return a usable answer.');
    error.code = 'no_answer';
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Structured Outputs makes this close to impossible — but "close to" is
    // not "never", and a JSON.parse throwing inside the handler would read as
    // a server bug rather than as a bad answer.
    const error = new Error('The model did not return a usable answer.');
    error.code = 'no_answer';
    throw error;
  }

  return { input: parsed, usage: response.usage };
}

/**
 * The model's refusal text, or null when it did not refuse.
 *
 * With Structured Outputs a refusal arrives as a content part in the output
 * message rather than as a status on the response, so it has to be looked for.
 * An empty string is a refusal with no explanation, which is why this returns
 * null rather than a falsy string for "did not refuse".
 */
function findRefusal(response) {
  for (const item of response.output || []) {
    if (item.type !== 'message') continue;
    for (const part of item.content || []) {
      if (part.type === 'refusal') return part.refusal ?? '';
    }
  }
  return null;
}

/**
 * Turn the model's answer into what the editor expects, and refuse anything
 * that would put a broken document on someone's canvas.
 */
function shapeResult(feature, { input, usage }) {
  const meta = {
    usage: {
      inputTokens: usage?.input_tokens ?? null,
      outputTokens: usage?.output_tokens ?? null,
      cacheReadTokens: usage?.input_tokens_details?.cached_tokens ?? null,
      reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? null,
    },
  };

  if (feature === 'ai.patch_generator' || feature === 'ai.patch_refactor') {
    // Throws when the patch is unusable — caught in handleModelError and
    // answered 502, because a patch that cannot open is a failed call, not a
    // result to hand over.
    const { patch, warnings } = validateGeneratedPatch(input.patch);
    return { ...meta, result: { ...input, patch }, warnings };
  }

  if (feature === 'ai.node_generator') {
    return { ...meta, result: shapeGeneratedNode(input) };
  }

  return { ...meta, result: input };
}

/**
 * Fit a generated node to what a CustomGLSL node can actually hold: between
 * one and eight inputs, and a declared output type.
 */
function shapeGeneratedNode(input) {
  const inputs = Array.isArray(input.inputs) ? input.inputs.slice(0, 8) : [];
  return {
    ...input,
    inputs: inputs.length ? inputs : [{ label: 'Input 0', type: 'f32' }],
    code: String(input.code || '').trim(),
  };
}

function handleModelError(error, res, config) {
  // A patch the model wrote that will not open. The call happened and the
  // quota is spent, so say what went wrong rather than pretending otherwise.
  if (error?.message && /patch|node kind|output node/i.test(error.message) && !error.status) {
    console.warn(`${config.label}: unusable answer — ${error.message}`);
    return res.status(502).json({ error: error.message, code: 'unusable_answer' });
  }

  // Stopped at our own deadline. Not the artist's doing, but not something an
  // operator can fix either — the honest advice is a smaller patch, and saying
  // so is the whole reason this branch exists rather than a platform 504 the
  // browser reports as a CORS failure.
  if (error?.code === 'timed_out') {
    const seconds = Math.round((error.deadlineMs ?? MODEL_DEADLINE_MS) / 1000);
    return res.status(504).json({
      error:
        `The AI was still working after ${seconds} seconds and was stopped. ` +
        'Large patches take the longest — try it on a smaller one, or on part of this one.',
      code: 'timed_out',
    });
  }

  if (error?.code === 'refused') {
    return res.status(422).json({
      error: 'The model declined this request. Try describing what you want differently.',
      code: 'refused',
      detail: error.refusal,
    });
  }

  if (error?.code === 'answer_truncated') {
    return res.status(502).json({
      error: 'The AI ran out of room before finishing. Try again, or with a smaller patch.',
      code: 'answer_truncated',
    });
  }

  if (error?.code === 'no_answer') {
    return res.status(502).json({ error: error.message, code: 'no_answer' });
  }

  const status = error?.status;

  // An unpaid bill arrives as a 429 with `insufficient_quota`, which is the
  // one 429 that retrying cannot fix. Checked before the rate-limit branch,
  // and separately, because "the service is busy, try again" is exactly the
  // wrong thing to tell an artist whose operator needs to top up an account.
  if (isBillingProblem(error)) {
    console.error(
      'OpenAI refused the call for quota reasons — the deployment needs credit:',
      modelErrorMessage(error)
    );
    return res.status(503).json({
      error: 'AI features are unavailable on this deployment right now. An operator needs to look at it.',
      code: 'not_configured',
    });
  }

  // A 400 is never the artist's doing and is not something retrying fixes: our
  // own request was malformed — a schema this backend built, not anything the
  // artist typed. Loud in the log, honest to the caller.
  if (status === 400 || status === 422) {
    console.error(`${config.label}: the model rejected our request:`, modelErrorMessage(error));
    return res.status(502).json({
      error: 'The AI service rejected this request. That is a problem with the editor, not with what you asked for.',
      code: 'bad_model_request',
    });
  }

  // The named model does not exist, or this account cannot reach it. Only ever
  // a misconfigured OPENAI_MODEL, so name the value in the log — that is the
  // one thing whoever reads it needs.
  if (status === 404) {
    console.error(
      `The AI backend is configured for a model it cannot use: ${modelName(config)} — ${modelErrorMessage(error)}`
    );
    return res.status(503).json({
      error: 'AI features are not configured correctly on this deployment.',
      code: 'not_configured',
    });
  }

  if (status === 429) {
    res.setHeader('Retry-After', error?.headers?.['retry-after'] || '30');
    return res.status(503).json({
      error: 'The AI service is busy right now. Try again in a moment.',
      code: 'model_busy',
    });
  }
  if (status === 401 || status === 403) {
    console.error('OpenAI rejected our credentials:', error.message);
    return res.status(503).json({
      error: 'AI features are not configured correctly on this deployment.',
      code: 'not_configured',
    });
  }
  if (status && status >= 500) {
    return res.status(503).json({
      error: 'The AI service is having trouble. Try again in a moment.',
      code: 'model_unavailable',
    });
  }

  console.error(`${config.label} failed:`, error);
  return res.status(500).json({
    error: 'The AI request failed. Try again.',
    code: 'request_failed',
  });
}

/**
 * The model API's own message, dug out of whichever shape the SDK used.
 *
 * `error.message` carries the whole JSON body as text, and the parsed body
 * hangs off `error.error`. Read both — which one is populated depends on the
 * SDK version, and neither is guaranteed.
 */
function modelErrorMessage(error) {
  return error?.error?.message || error?.error?.error?.message || error?.message || 'no message';
}

/**
 * Whether a failure is the account being out of credit rather than a bad
 * request.
 *
 * `insufficient_quota` is the field that says so; the message is checked too
 * because the code has moved between the top level and the error body across
 * SDK versions, and a billing failure misread as a rate limit sends the
 * operator looking at traffic instead of at their bill.
 */
function isBillingProblem(error) {
  const code = error?.code || error?.error?.code || error?.error?.type;
  if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') return true;
  return /insufficient_quota|exceeded your current quota|billing/i.test(modelErrorMessage(error));
}

/** Vercel parses JSON bodies, but be explicit — a string body is still valid JSON. */
function parseBody(req) {
  if (!req.body) return null;
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return null;
  }
}
