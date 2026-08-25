/**
 * features.js - what each AI feature asks the model for.
 *
 * One entry per metered feature key. Each carries the system prompt, the
 * response schema the answer must fit, and how much effort the call is worth.
 * Keeping them together means adding a feature is one object here plus one
 * button in the editor — and that the feature key from the signed grant is the
 * only thing that chooses a prompt.
 *
 * `format` is an OpenAI Structured Outputs response format: the model answers
 * as JSON in that shape rather than as prose to be parsed. Where `strict` is
 * true the platform guarantees the shape — every property required, every
 * object closed — so the answer either fits what the editor expects or the
 * call fails loudly. Prose is never parsed.
 */

import { nodeCatalogText } from './nodeCatalog.js';

/**
 * The patch shape the editor speaks, shared by generator and refactor.
 *
 * `params` is deliberately open: parameter names and value types come from the
 * node registry and differ per kind, which a closed schema cannot express.
 * Strict Structured Outputs forbids exactly that — an open `additionalProperties`
 * map — so the two features carrying this schema run with `strict: false`, and
 * validateGeneratedPatch() in nodeCatalog.js is what actually guarantees the
 * shape: it drops any parameter the node does not declare. Every other
 * feature's schema is closed and runs strict.
 */
const PATCH_SCHEMA = {
  type: 'object',
  description: 'A Rhizomium patch: nodes and the wires between them.',
  properties: {
    nodes: {
      type: 'array',
      description: 'Every node in the patch.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique within this patch.' },
          kind: { type: 'string', description: 'A node kind from the registry, exactly as spelled there.' },
          x: { type: 'number', description: 'Canvas position. Lay signal flow out left to right, ~220 apart.' },
          y: { type: 'number', description: 'Canvas position. Separate parallel branches by ~140.' },
          params: {
            type: 'object',
            description: 'Parameter values by name. Omit any you are leaving at its default.',
            additionalProperties: true,
          },
        },
        required: ['id', 'kind', 'x', 'y', 'params'],
        additionalProperties: false,
      },
    },
    connections: {
      type: 'array',
      description: 'Wires. Pins are zero-based indices into the node\'s pin lists.',
      items: {
        type: 'object',
        properties: {
          from: {
            type: 'object',
            properties: {
              nodeId: { type: 'string' },
              pin: { type: 'integer', description: 'Output pin index on the source node.' },
            },
            required: ['nodeId', 'pin'],
            additionalProperties: false,
          },
          to: {
            type: 'object',
            properties: {
              nodeId: { type: 'string' },
              pin: { type: 'integer', description: 'Input pin index on the destination node.' },
            },
            required: ['nodeId', 'pin'],
            additionalProperties: false,
          },
        },
        required: ['from', 'to'],
        additionalProperties: false,
      },
    },
  },
  required: ['nodes', 'connections'],
  additionalProperties: false,
};

/**
 * What every feature needs to know about the editor it is working in.
 *
 * Deterministic, and identical across requests, so it sits at the front of the
 * prompt where OpenAI's automatic prefix caching can find it. The node
 * catalogue is most of its bulk and never varies within a deploy.
 */
function sharedContext() {
  return `You are working inside Rhizomium, a node-based GLSL/WGSL shader editor for live visual art.

A patch is a directed graph. Nodes have zero-based input and output pins; a connection carries a value from one node's output pin to another node's input pin. A patch renders only if a node in the Output category is reached. Values are floats and vectors (f32, vec2, vec3, vec4); a node whose pins are typed "dynamic" takes the type of what feeds it.

Artists use this live — patches run every frame at 60fps. Node count and texture sampling cost real frame time.

${nodeCatalogText()}

Use only node kinds listed above, spelled exactly as they appear. Never invent one. If the registry has no node for what is wanted, say so in your answer rather than inventing a kind.`;
}

/** Severity vocabulary shared by review and canvas assist. */
const SEVERITY = {
  type: 'string',
  enum: ['error', 'warning', 'note'],
  description: 'error: the patch is broken. warning: it works but something is wrong. note: a suggestion.',
};

export const AI_FEATURES = {
  'ai.patch_review': {
    strict: true,
    label: 'Patch review',
    effort: 'high',
    maxTokens: 16000,
    /** Expensive enough to be worth replay protection? No — cheap and frequent. */
    singleUse: false,
    system: () => `${sharedContext()}

Your task is to review a patch an artist has already built and report what is wrong with it.

Read the graph as a whole before judging any node. Look for: nodes whose output reaches no Output node (dead branches), inputs left unconnected where the node needs one, wiring that is plainly not what the artist meant, parameter values that will render black or blow out, redundant chains, and costs that will not hold 60fps.

Be specific and short. Every finding names the nodes it is about and says what to do. Report only things you can point at in this patch — do not pad the list, and do not restate what the patch does. An empty findings list is a fine answer for a clean patch.`,
    format: {
      name: 'patch_review',
      description: 'A review of what is wrong with this patch.',
      schema: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'One or two sentences on the state of the patch overall.',
          },
          findings: {
            type: 'array',
            description: 'Problems found, most serious first. Empty when the patch is clean.',
            items: {
              type: 'object',
              properties: {
                severity: SEVERITY,
                title: { type: 'string', description: 'The problem in under ten words.' },
                detail: { type: 'string', description: 'What is wrong and why it matters.' },
                fix: { type: 'string', description: 'What to do about it, concretely.' },
                nodeIds: {
                  type: 'array',
                  description: 'Ids of the nodes this is about, so the editor can highlight them.',
                  items: { type: 'string' },
                },
              },
              required: ['severity', 'title', 'detail', 'fix', 'nodeIds'],
              additionalProperties: false,
            },
          },
        },
        required: ['summary', 'findings'],
        additionalProperties: false,
      },
    },
  },

  'ai.patch_refactor': {
    strict: false,
    label: 'Patch refactor',
    effort: 'high',
    maxTokens: 32000,
    singleUse: false,
    system: () => `${sharedContext()}

Your task is to tidy a patch without changing what it renders.

This is the whole constraint: the output must look the same. Remove dead branches that reach no Output node, collapse redundant chains, fold constants that never change, give nodes names that say what they do, and lay the graph out so signal flows left to right without crossing wires unnecessarily.

Do not change the render. If a change would alter a single pixel, do not make it — describe it in your summary as something the artist might want instead. When in doubt, leave it alone: an artist who asked for tidying and got a different image has lost work.

Return the complete patch, not a diff. Every node that should survive must appear in your answer, including the ones you did not touch.`,
    format: {
      name: 'refactor_proposal',
      description: 'The tidied patch, and what changed in it.',
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'What you changed, in a sentence or two.' },
          changes: {
            type: 'array',
            description: 'Each change, so the artist can see the work before accepting it.',
            items: {
              type: 'object',
              properties: {
                kind: {
                  type: 'string',
                  enum: ['removed', 'rewired', 'renamed', 'reordered', 'parameter', 'added'],
                },
                detail: { type: 'string', description: 'What changed and why it is safe.' },
                nodeIds: { type: 'array', items: { type: 'string' } },
              },
              required: ['kind', 'detail', 'nodeIds'],
              additionalProperties: false,
            },
          },
          patch: PATCH_SCHEMA,
        },
        required: ['summary', 'changes', 'patch'],
        additionalProperties: false,
      },
    },
  },

  'ai.canvas_assist': {
    strict: true,
    label: 'Canvas assist',
    // Fires while the artist works, so it is tuned for latency over depth.
    effort: 'low',
    maxTokens: 4000,
    singleUse: false,
    system: () => `${sharedContext()}

Your task is to suggest small improvements to what the artist is working on right now.

You are looking over their shoulder, not redesigning their work. Suggest node names that say what a node does, a wire that is obviously missing, a parameter that is at a value that cannot be intended. Prefer the suggestion the artist would accept in one click.

At most four suggestions, fewer when there is less to say, none when the patch is fine. Never suggest a rebuild, never suggest something you cannot point at a node for, and never explain what a node does — the artist knows.`,
    format: {
      name: 'canvas_suggestions',
      description: 'Small, immediately actionable suggestions.',
      schema: {
        type: 'object',
        properties: {
          suggestions: {
            type: 'array',
            description: 'At most four. Empty is a valid answer.',
            items: {
              type: 'object',
              properties: {
                severity: SEVERITY,
                title: { type: 'string', description: 'The suggestion in under ten words.' },
                detail: { type: 'string', description: 'One sentence on why.' },
                nodeIds: { type: 'array', items: { type: 'string' } },
              },
              required: ['severity', 'title', 'detail', 'nodeIds'],
              additionalProperties: false,
            },
          },
        },
        required: ['suggestions'],
        additionalProperties: false,
      },
    },
  },

  'ai.patch_generator': {
    strict: false,
    label: 'Patch generator',
    effort: 'high',
    maxTokens: 32000,
    singleUse: false,
    system: () => `${sharedContext()}

Your task is to build a complete patch from a description.

Build the smallest graph that actually produces what was asked for. Every node must earn its place, and every branch must reach the Output node — a node whose output goes nowhere is a bug, not a flourish.

Rules that make the difference between a patch that opens and one that wastes the artist's call:
- Exactly one OutputFinal node, and something must be wired into it.
- Lay the graph out left to right: sources at the left, output at the right, about 220 apart horizontally and 140 between parallel branches.
- Set parameters to values that render something visible on the first frame. A patch that opens black is a failure even if the graph is correct.
- Keep it live: this runs every frame, so prefer the cheaper node when two would look the same.

Say in your notes what the artist should reach for first to make it their own.`,
    format: {
      name: 'generated_patch',
      description: 'The finished patch.',
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'A short name for this patch.' },
          notes: {
            type: 'string',
            description: 'How it works and which parameters are worth turning first.',
          },
          patch: PATCH_SCHEMA,
        },
        required: ['title', 'notes', 'patch'],
        additionalProperties: false,
      },
    },
  },

  'ai.node_generator': {
    strict: true,
    label: 'Node generator',
    effort: 'high',
    maxTokens: 16000,
    singleUse: false,
    system: () => `${sharedContext()}

Your task is to write a custom node from a description.

The node is a CustomGLSL node: a body of shader code that reads its inputs and evaluates to one value. Write the body only — no function signature, no main(), no uniform declarations.

The rules of that body:
- Inputs are named input0, input1, input2, … in pin order. Use only as many as you declare.
- The body's final expression is the node's output, and its type must match the output type you declare.
- This is WGSL-flavoured: write 0.0 not 0 for floats, and vec3<f32>(...) style constructors.
- It runs per pixel per frame. No loops over large ranges, no unbounded work.

Name the inputs for what they carry, not input0. Keep the code short enough to read at a glance — an artist is going to open it.`,
    format: {
      name: 'custom_node',
      description: 'The custom node definition.',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'What this node is called on the canvas.' },
          description: { type: 'string', description: 'One sentence on what it does.' },
          outputType: {
            type: 'string',
            enum: ['f32', 'vec2', 'vec3', 'vec4'],
            description: 'The type the body evaluates to.',
          },
          inputs: {
            type: 'array',
            description: 'The input pins, in order. One to eight.',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'What this pin carries.' },
                type: { type: 'string', enum: ['f32', 'vec2', 'vec3', 'vec4'] },
              },
              required: ['label', 'type'],
              additionalProperties: false,
            },
          },
          code: { type: 'string', description: 'The shader body. No signature, no main().' },
          notes: { type: 'string', description: 'Anything the artist should know before wiring it up.' },
        },
        required: ['name', 'description', 'outputType', 'inputs', 'code', 'notes'],
        additionalProperties: false,
      },
    },
  },

  'ai.creative_director': {
    strict: true,
    label: 'AI creative director',
    effort: 'xhigh',
    maxTokens: 32000,
    // One call is minutes of model time. Worth remembering the grant id.
    singleUse: true,
    system: () => `${sharedContext()}

Your task is to direct a whole piece, not to fix a patch.

The artist has a work in progress and a brief. Think about the piece as something an audience sits with over time: where it starts, what changes, what it earns by the end. Then say what to do about it.

Give direction that is specific to this patch — which parameters carry the movement, where it repeats when it should develop, what the piece is currently promising and not paying off. Name the nodes. An artist should be able to act on each direction in the next session without asking you what you meant.

Be honest about what is not working. Encouragement that avoids the real problem wastes the sitting.`,
    format: {
      name: 'piece_direction',
      description: 'Direction on the piece as a whole.',
      schema: {
        type: 'object',
        properties: {
          reading: {
            type: 'string',
            description: 'What the piece currently is, as an audience would meet it.',
          },
          directions: {
            type: 'array',
            description: 'Concrete directions, most important first.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'The direction in under ten words.' },
                rationale: { type: 'string', description: 'What it does for the piece.' },
                steps: {
                  type: 'array',
                  description: 'What to actually do, in the editor.',
                  items: { type: 'string' },
                },
                nodeIds: { type: 'array', items: { type: 'string' } },
              },
              required: ['title', 'rationale', 'steps', 'nodeIds'],
              additionalProperties: false,
            },
          },
        },
        required: ['reading', 'directions'],
        additionalProperties: false,
      },
    },
  },
};

export function featureConfig(feature) {
  return Object.prototype.hasOwnProperty.call(AI_FEATURES, feature) ? AI_FEATURES[feature] : null;
}

/** The feature keys this backend actually implements. */
export const IMPLEMENTED_FEATURES = Object.keys(AI_FEATURES);

/**
 * Build the user turn for a feature from the editor's payload.
 *
 * Patches go over as JSON because that is what the editor speaks and what the
 * answer has to be expressed in; prose descriptions of a graph lose the ids
 * that make a finding actionable.
 */
export function buildUserMessage(feature, input = {}) {
  const patchJson = () => JSON.stringify(input.patch ?? {}, null, 1);

  switch (feature) {
    case 'ai.patch_review':
      return `Review this patch.\n\n\`\`\`json\n${patchJson()}\n\`\`\``;

    case 'ai.patch_refactor':
      return `Tidy this patch without changing what it renders.\n\n\`\`\`json\n${patchJson()}\n\`\`\``;

    case 'ai.canvas_assist': {
      const focus = Array.isArray(input.selectedNodeIds) && input.selectedNodeIds.length
        ? `\n\nThe artist currently has these nodes selected: ${input.selectedNodeIds.join(', ')}. Weight your suggestions towards them.`
        : '';
      return `Suggest small improvements to what I am working on.\n\n\`\`\`json\n${patchJson()}\n\`\`\`${focus}`;
    }

    case 'ai.patch_generator': {
      const prompt = String(input.prompt || '').trim();
      if (!prompt) throw new BadInputError('Describe the patch you want before generating one.');
      return `Build a patch: ${prompt}`;
    }

    case 'ai.node_generator': {
      const description = String(input.description || '').trim();
      if (!description) throw new BadInputError('Describe the node you want before generating one.');
      return `Write a custom node: ${description}`;
    }

    case 'ai.creative_director': {
      const brief = String(input.brief || '').trim();
      const briefText = brief ? `The artist's brief: ${brief}\n\n` : '';
      return `${briefText}Direct this piece.\n\n\`\`\`json\n${patchJson()}\n\`\`\``;
    }

    default:
      throw new BadInputError(`No message builder for ${feature}.`);
  }
}

/** Input the caller got wrong — answered 400, not 500. */
export class BadInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BadInputError';
  }
}
