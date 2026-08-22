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
 * The browser never sees ANTHROPIC_API_KEY, and the editor cannot talk itself
 * into a tier it does not have: the tier in the payload was written by the
 * gallery, which read it from the database.
 */

import Anthropic from '@anthropic-ai/sdk';
import { verifyGrant, grantsConfigured, claimGrantId } from '../_lib/grant.js';
import { featureConfig, buildUserMessage, BadInputError } from '../_lib/features.js';
import { validateGeneratedPatch } from '../_lib/nodeCatalog.js';

/**
 * Everything the artist has on their canvas travels in the request. A large
 * patch is normal; an unbounded one is someone else's problem being made ours.
 */
const MAX_INPUT_BYTES = 512 * 1024;

const MODEL = 'claude-opus-5';

let client = null;
function anthropic() {
  if (!client) client = new Anthropic();
  return client;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

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

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set on the AI backend; refusing every request.');
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

  try {
    const result = await callModel(config, userMessage);
    const payload = shapeResult(feature, result);

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
 * One model call, answered through a strict tool so the result is data rather
 * than prose to be parsed.
 *
 * Streaming throughout: the generative features write whole patches, and a
 * non-streaming request with a large max_tokens is how you meet an HTTP
 * timeout instead of an answer.
 */
async function callModel(config, userMessage) {
  const stream = anthropic().messages.stream({
    model: MODEL,
    max_tokens: config.maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: config.effort },
    system: [
      {
        type: 'text',
        text: config.system(),
        // The node registry makes up most of this and is identical on every
        // request, so it is billed once per window rather than once per call.
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [config.strict ? { ...config.tool, strict: true } : config.tool],
    tool_choice: { type: 'tool', name: config.tool.name },
    messages: [{ role: 'user', content: userMessage }],
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') {
    const error = new Error('The model declined this request.');
    error.refusal = message.stop_details?.explanation || null;
    error.code = 'refused';
    throw error;
  }

  const toolUse = message.content.find(
    (block) => block.type === 'tool_use' && block.name === config.tool.name
  );

  if (!toolUse) {
    const error = new Error('The model did not return a usable answer.');
    error.code = 'no_tool_use';
    throw error;
  }

  return { input: toolUse.input, usage: message.usage };
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
      cacheReadTokens: usage?.cache_read_input_tokens ?? null,
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

  if (error?.code === 'refused') {
    return res.status(422).json({
      error: 'The model declined this request. Try describing what you want differently.',
      code: 'refused',
      detail: error.refusal,
    });
  }

  if (error?.code === 'no_tool_use') {
    return res.status(502).json({ error: error.message, code: 'no_tool_use' });
  }

  const status = error?.status;
  if (status === 429) {
    res.setHeader('Retry-After', error?.headers?.['retry-after'] || '30');
    return res.status(503).json({
      error: 'The AI service is busy right now. Try again in a moment.',
      code: 'model_busy',
    });
  }
  if (status === 401 || status === 403) {
    console.error('Anthropic rejected our credentials:', error.message);
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
