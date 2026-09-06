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

import { nodeCatalogText, isDefaultParamValue } from './nodeCatalog.js';
import { ARC_LIMITS, EASES } from './directorArc.js';
import { patchFacts } from './patchFacts.js';

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
          /**
           * The artist's own label. Optional, and the only property here that
           * is: a generated patch may leave nodes unnamed, but a refactor that
           * cannot return a name is a refactor that deletes every name in the
           * patch — including the ones this prompt asks it to improve.
           */
          name: {
            type: 'string',
            description: 'The node\'s label on the canvas. Keep the artist\'s name unless you are improving it.',
          },
          /**
           * Positions overlapped constantly until these said how big a node
           * actually is: a card is 180 wide, and one showing its preview band
           * stands around 250 tall, so the ~220/~140 these used to ask for was
           * a patch whose nodes sat on each other. spaceOutPatch() in
           * patchLayout.js catches what still comes back stacked; saying the
           * real numbers here is what stops it having to.
           */
          x: {
            type: 'number',
            description:
              'Canvas position, laid out left to right along the signal. A node is 180 wide: leave at least 270 between one column and the next.',
          },
          y: {
            type: 'number',
            description:
              'Canvas position. A node stands up to 250 tall: leave at least 290 between nodes in the same column, and never give two nodes the same position.',
          },
          /**
           * Optional, and meaningful only on the handful of nodes the registry
           * marks `dynamic-in(min-max)` — Mix, Switch, Expr, CustomGLSL,
           * ProjectionMap. Without it a five-input Mix was not something either
           * generative feature could return: the node came back at the pin
           * count its definition declares and the wires past that were dropped
           * on the way to the canvas.
           */
          inputCount: {
            type: 'integer',
            description:
              'How many input pins this node has. Only for nodes marked dynamic-in in the registry; leave it out for every other node.',
          },
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

A node's line is: kind [category] "its name on the canvas" in(pins) out(pins) params: name:type=default[min..max]{what it is for}. A parameter set outside its [min..max] is a control the artist finds pinned at one end.

Use only node kinds listed above, spelled exactly as they appear. Never invent one. If the registry has no node for what is wanted, say so in your answer rather than inventing a kind.

${EDITOR_CAPABILITIES}

${PATCH_FORMAT_LEGEND}`;
}

/**
 * What this editor can do that reading the node registry alone does not show.
 *
 * The registry says which nodes exist and what pins they have. It does not say
 * that a parameter takes a live expression, that one node is the whole of the
 * 3D support, or that a fragment chain may feed a compute node — and a model
 * that does not know those things writes patches out of Math nodes and wonders
 * why the artist asked for something it could not build. Every claim here is
 * checkable in the editor: the expression grammar is UnifiedExpressionSystem.js,
 * the bridging is ComputeExecutor._renderFragmentInputs, the 3D is
 * src/scene/.
 *
 * It sits inside the cached prefix with the catalogue, so its cost is paid
 * once per cache window rather than once per call.
 */
const EDITOR_CAPABILITIES = `# What this editor can do beyond wiring nodes together

## Live parameters
Any numeric parameter — written above as :float, :int or :slider — takes a string beginning with "=" instead of a number, compiled into the shader and evaluated every frame:

  "rotateY": "=time*30"                a turntable
  "scale": "=8+audioEnvelopeBass*6"    the noise breathes with the kick
  "amount": "=0.5+sin(time*0.7)*0.5"   a slow sweep, no extra nodes

In scope: time (seconds), audioEnvelope, audioEnvelopeBass, audioEnvelopeMids, audioEnvelopeHighs, audioEnvelopeFull (each 0..1), aspect, PI, E, and node_<id> for another node's value.
Functions: sin cos tan asin acos atan atan2 sqrt abs pow exp log log2 floor ceil round min max sign clamp step smoothstep fract mod lerp length distance normalize dot, and "condition ? a : b".
This is how a static patch is made to move. Prefer an expression when one parameter needs the movement; wire a Time/Wave/Math chain instead when several nodes share the signal, or when the artist should be able to grab it on the canvas.
Only numeric parameters take one: select, bool, color and text parameters take literal values, and a file, font or button parameter is not yours to set at all.

## Sound
Two ways in, and they combine: the audioEnvelope* variables in any numeric parameter, and the AudioValue node, which carries ONE channel of the analysis into the graph as an ordinary signal. Its "channel" picks which: level, low, mid, high, kick/snare/hat with their Trig and Meter forms (kickTrig, kickMeter, …), centroid, density. One node per channel you need — two of them for a kick that both flashes and displaces.
The Audio node is the analysis's settings (the three drum thresholds, and the meter shaping) and has no outputs, so add one only if the patch is about tuning the detection; the defaults are usable without it.
Audio is silent until the artist enables an input, so keep a base value and add the audio on top ("=0.4+audioEnvelopeBass*0.6") rather than multiplying the picture by something that is zero until someone plays music.

## 3D
ComputeFieldMapper ("3D Field Visualizer") is the 3D of this editor. Wire any texture-producing chain into its Field Input and it renders real geometry in the floating 3D viewport, which opens with the node:
- mode=surface maps the field onto a plane, sphere, box or torus and displaces it along its normals by the field's brightness ("resolution" is the tessellation).
- mode=instances puts a cube, sphere or camera-facing quad in every cell of an instanceCount x instanceCount grid, driving each one's height, size, colour and culling from the field there.
It also outputs the rendered view as an ordinary colour texture, so wire its output into OutputFinal — directly or through more 2D nodes — and the 3D lands on the main canvas too. Its translate*/rotate* parameters move the object and take expressions, so "rotateY": "=time*20" turns it.
Nothing else here is 3D: the Blend SDF nodes combine distance fields inside a 2D render, and ComputeParticles' "depth" is parallax, not a camera.

## Compute and fragment nodes
Every kind beginning with "Compute" runs as a compute shader over a whole texture; every other node is evaluated per pixel in the fragment shader. They mix in both directions with no bridging node — a fragment chain feeding a compute input is rendered to a texture for it each frame, and a compute node's texture is sampled by the fragment nodes downstream — so pick whichever node does the job.
Compute is where simulation lives (ComputeFluidSim, ComputeReactionDiffusion, ComputeParticles, ComputeCellular, ComputeFeedbackField) and where whole-image effects belong (blur, glitch, kaleidoscope, edge detect, convolution), which need neighbouring pixels that a per-pixel expression cannot reach. Each one runs over every pixel every frame: two or three in a patch is a budget, eight is not.

## Nodes whose pin count is yours to choose
"dynamic-in(min-max)" on a node's line means its input pins can be added and removed — Mix, Switch, Expr, CustomGLSL, ProjectionMap. Set "inputCount" to the number of pins you want, then wire them, and wire nothing into a pin you did not ask for.

## Nodes that carry code
- Expr emits its "expr" parameter into the shader with its pins substituted in as a, b, c… in order: "expr": "a * sin(b * time)". This one is WGSL, not the grammar above — "mix(a, b, 0.5)" rather than "lerp", no "? :", and floats need a decimal point. time, uv, pi and the audioEnvelope* names are in scope.
- CustomGLSL runs the WGSL body in "code", reading pins as input0, input1, … and evaluating to "outputType". uv, time, pi, E and the audioEnvelope* names are in scope. Declare each pin's shape in "inputTypes" (e.g. ["vec2","f32"]) or the compiler guesses from the code and gets it wrong for a pin the body only multiplies.
Reach for either when no node does the maths that is wanted — never to reimplement one that exists.

## Text
Text draws a string as a texture. "{node_7}" inside it shows that node's live value, and a text field beginning with "=" is one expression: "BPM {node_7}" and "=time" both work.

## Time, and playing the piece
Three ways a patch moves, and they answer different questions.
- A live expression ("=time*30") moves forever, identically, from the moment the patch opens. It is how a patch breathes.
- The keyframe timeline is composed movement over a fixed length. A track is one node's one numeric parameter; a keyframe is a value at a time in seconds; between two of them the value interpolates as linear, ease-in, ease-out, ease-in-out or step. The playhead runs from 0 to the timeline's duration and loops over a loop region. While the timeline is enabled a track writes its parameter every frame, so a parameter under a track is no longer taking an expression and no longer the artist's to drag — put a track on a parameter because the piece needs that value at that minute, not to make something move in general.
- The VJ panel is where it is played: BPM with tap tempo, scenes that are whole patches and can be switched and crossfaded, a playlist. A piece whose loop lands on a bar line can be dropped into a set; one that loops at 37 seconds cannot.

Only float, int and slider parameters can carry a track. A select, bool, colour or text parameter changes on the timeline the way it changes anywhere: not gradually.

## What needs the artist, not you
ProjectionMap warps the image onto surfaces whose corners are dragged by hand, and Texture2D/TextureCube need a file from the artist's disk. Use them only when asked for by name, and say in your notes what is left to set up.`;

/**
 * How a patch is written when it is shown to the model.
 *
 * This costs ~370 tokens, once, at the end of the cached prefix. It buys back
 * several thousand on every patch that follows: the same graph as indented JSON
 * runs five to nine times longer, and none of that length is information — it
 * is punctuation, repeated key names, and defaults the registry above already
 * stated. A sixty-node patch is 11,548 tokens as JSON and 1,299 in this format.
 *
 * Answers are unaffected: those come back through Structured Outputs, as JSON,
 * in the schema each feature declares.
 */
const PATCH_FORMAT_LEGEND = `Patches are given to you in a compact line format, not as JSON.

Nodes, one per line:
  <id> <kind> @<x>,<y> [name] [param=value ...]
The name, when present, is the artist's own label for that node, in quotes.
"in=<n>" is the pin count of a node that takes a variable number of inputs.

Then a blank line, then the wires, one per line:
  <fromId>:<outPin> -> <toId>:<inPin>

Reading the values:
- A parameter that is absent is at its registry default. Only parameters the
  artist changed are listed, so an absent one is a deliberate silence, not a
  gap in what you were given.
- Values are bare where they can be; anything else is JSON, so a quoted string
  follows JSON rules and \\n inside one is a line break.

After the wires you may be given a short block of facts worked out from them:
which nodes reach an Output node, which input pins have nothing wired in. Those
are computed, not observed, and they are exact. Use them. Tracing the graph
yourself to check them is the most expensive thing you can do with this budget,
and on a large patch it is also the least reliable.

Refer to nodes by these ids in your answer. Write your answer as JSON in the
schema you were given, never in this line format.`;

/**
 * What `effort`, `maxTokens` and `reasoningTokens` buy, and what they cost.
 *
 * All three are wall-clock settings as much as quality settings, and that is
 * worth stating once because a patch review used to run past the function's
 * time limit and come back to the browser as a phantom CORS error.
 *
 * The input is not what costs the time. The whole prompt for a review is about
 * 7,000 tokens — 5,800 of catalogue and instructions, cached, and a thousand
 * of patch — and prefill of that is a moment. Everything else is decode:
 *
 *   `effort` decides how many reasoning tokens the model spends before it
 *   answers. It is the one setting that changes how long a call takes rather
 *   than how long it is allowed to take, and it is the first thing to reach
 *   for. High effort on a task that is mostly reading a graph and reporting
 *   what is wrong with it was buying a good deal less than it cost.
 *
 *   `maxTokens` is the answer, and `reasoningTokens` the room to think before
 *   it. Their sum is `max_output_tokens`, which is a hard stop: a call that
 *   reaches it comes back `incomplete`, which is a wasted action. So they are
 *   sized from what a feature's answer actually needs, with margin — not
 *   generously, because the sum is also the worst case anyone can be made to
 *   wait for, and run.js derives the deadline from it.
 */

/**
 * The playable half of a director's answer.
 *
 * Strict Structured Outputs guarantees the shape and nothing about the
 * numbers: it has no way to cap an array's length or hold a time inside the
 * arc, so the limits are stated here as prose for the model and enforced in
 * shapeArc() for everyone else. Every property is required because strict mode
 * requires it — an arc with nothing in it is an empty `moves` list, not a
 * missing field.
 */
const ARC_SCHEMA = {
  type: 'object',
  description:
    'The piece as movement over time: keyframes the editor can play back. ' +
    'Empty `moves` is a valid answer and means this patch does not need an arc yet.',
  properties: {
    title: { type: 'string', description: 'What to call this arc. A few words.' },
    summary: {
      type: 'string',
      description: 'How the piece moves across its length, in two or three sentences.',
    },
    durationSeconds: {
      type: 'number',
      description:
        `How long the whole arc is, in seconds (${ARC_LIMITS.minDuration}-${ARC_LIMITS.maxDuration}). ` +
        'On a bar line if a tempo was given.',
    },
    sections: {
      type: 'array',
      description:
        `The shape, named, for the artist to read against the playhead. Up to ${ARC_LIMITS.maxSections}.`,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Under five words.' },
          startSeconds: { type: 'number', description: 'When it begins, in seconds from 0.' },
          intent: { type: 'string', description: 'What this stretch is doing for the piece.' },
        },
        required: ['name', 'startSeconds', 'intent'],
        additionalProperties: false,
      },
    },
    moves: {
      type: 'array',
      description:
        `One numeric parameter's journey through the piece, one entry each. Up to ${ARC_LIMITS.maxMoves}, ` +
        'and fewer is better: each one takes that control away from the artist while the timeline runs.',
      items: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'A node id from the patch you were given.' },
          param: {
            type: 'string',
            description:
              "The parameter's name on that node's kind, exactly as the registry spells it. " +
              'float, int or slider only.',
          },
          why: {
            type: 'string',
            description: 'Which direction above this move serves, in one line.',
          },
          keyframes: {
            type: 'array',
            description:
              `At least ${ARC_LIMITS.minKeyframesPerMove} — one keyframe is a value pinned, not a move — ` +
              `and up to ${ARC_LIMITS.maxKeyframesPerMove}. In time order.`,
            items: {
              type: 'object',
              properties: {
                atSeconds: {
                  type: 'number',
                  description: 'When, in seconds from the start of the arc.',
                },
                value: {
                  type: 'number',
                  description: "The value there, inside the parameter's stated range.",
                },
                ease: {
                  type: 'string',
                  enum: EASES,
                  description: 'How the value travels from here to the next keyframe.',
                },
              },
              required: ['atSeconds', 'value', 'ease'],
              additionalProperties: false,
            },
          },
        },
        required: ['nodeId', 'param', 'why', 'keyframes'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'summary', 'durationSeconds', 'sections', 'moves'],
  additionalProperties: false,
};

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
    /**
     * Medium, on the default model rather than the cheap one — capability
     * where the judgement is, effort where the time is.
     *
     * The graph arrives with its reachability and its empty pins already
     * worked out (see patchFacts.js), so what is left to reason about is a few
     * dozen lines of text. High effort on top of that was what took a loaded
     * patch past the function's time limit, and a review is the feature an
     * artist runs most often and waits on most impatiently.
     */
    effort: 'medium',
    // A summary and a handful of findings. Twelve findings at their most
    // verbose is under 2,000 tokens; the old 16,000 was room to ramble that
    // nothing was asking for.
    maxTokens: 3000,
    reasoningTokens: 6000,
    /** Expensive enough to be worth replay protection? No — cheap and frequent. */
    singleUse: false,
    system: () => `${sharedContext()}

Your task is to review a patch an artist has already built and report what is wrong with it.

Read the graph as a whole before judging any node. Look for: nodes whose output reaches no Output node (dead branches), inputs left unconnected where the node needs one, wiring that is plainly not what the artist meant, parameter values that will render black or blow out, redundant chains, and costs that will not hold 60fps.

Be specific and short. Every finding names the nodes it is about and says what to do. Report only things you can point at in this patch — do not pad the list, and do not restate what the patch does. At most eight findings: if there are more, the eight worth an artist's next half hour. An empty findings list is a fine answer for a clean patch.`,
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
    /**
     * Medium, despite the strictest correctness bar here — the output must
     * render identically — because this feature already writes the largest
     * answer of any of them. Its budget is where its time goes; adding high
     * effort on top of a four-hundred-node patch is how this becomes the one
     * feature nobody waits for. The prompt does the work instead: it is told,
     * plainly, to leave anything it is unsure of alone.
     */
    effort: 'medium',
    /**
     * The one feature whose answer is as large as its input: it returns the
     * whole patch, so a ten-node patch and a four-hundred-node one need budgets
     * an order of magnitude apart. This is the ceiling for the largest patch
     * the editor will send; answerBudget() sizes each call from what it was
     * actually given, which is what keeps a small refactor from being allowed
     * to take as long as the biggest possible one.
     */
    maxTokens: 32000,
    scaleWithPatch: true,
    reasoningTokens: 8000,
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
    /**
     * The one feature that runs on the cheap tier, and the only one where that
     * is the right trade. It interrupts nobody, it suggests things that are
     * accepted in one click, and a suggestion it misses costs an artist
     * nothing — where a slow one costs them the flow it was meant to support.
     * Everything else here is judgement an artist acts on, and runs on the
     * default model.
     */
    model: 'gpt-5.6-luna',
    // Four suggestions of a sentence each. It was budgeted for a small essay.
    maxTokens: 1500,
    reasoningTokens: 2000,
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
    /**
     * High, where review is medium, because of what a mistake costs. A review
     * that misses something is a shorter list; a generated patch with a wire
     * in the wrong place is a document the artist has to debug before they can
     * use it — and they asked for it and waited for it deliberately, which a
     * review fired mid-session was not.
     */
    effort: 'high',
    // A generated patch is meant to be the smallest graph that does the job —
    // forty nodes and their wires is around 5,000 tokens of JSON. This leaves
    // room for twice that and stops well short of the old ceiling, which was
    // sized for a patch nobody should be generating.
    maxTokens: 12000,
    // Room for high effort to actually think. Too little here and the call
    // comes back `incomplete`, which spends the artist's action on nothing.
    reasoningTokens: 12000,
    singleUse: false,
    system: () => `${sharedContext()}

Your task is to build a complete patch from a description.

Build the smallest graph that actually produces what was asked for. Every node must earn its place, and every branch must reach the Output node — a node whose output goes nowhere is a bug, not a flourish.

Decide first which of the editor's capabilities the description is asking for, and build with it: 3D means ComputeFieldMapper; reacting to sound means the audioEnvelope variables or an AudioValue node; movement means an expression on the parameter that should move; smoke, fluid, growth, swarms and feedback are what the Dynamics nodes do. A patch that imitates one of those out of Math nodes is worse than the one node that does it.

Rules that make the difference between a patch that opens and one that wastes the artist's call:
- Exactly one OutputFinal node, and something must be wired into it.
- Lay the graph out left to right: sources at the left, output at the right, about 220 apart horizontally and 140 between parallel branches.
- Set parameters to values that render something visible on the first frame. A patch that opens black is a failure even if the graph is correct.
- Keep every value inside the [min..max] the registry gives it.
- Name a node when its kind does not say what it is doing here.
- Keep it live: this runs every frame, so prefer the cheaper node when two would look the same, and keep the compute nodes to the two or three that earn their cost.

In your notes, name the node and the parameter to reach for first, and say what has to be set up outside the patch — an audio input for a patch that listens, the 3D viewport for one that opens it.`,
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
    // It writes shader code that has to compile. Same reasoning as the patch
    // generator above: an artist waiting on one artifact would rather wait.
    effort: 'high',
    // A shader body short enough for an artist to read at a glance, which the
    // prompt below asks for outright, plus its pins and a note.
    maxTokens: 3000,
    reasoningTokens: 8000,
    singleUse: false,
    system: () => `${sharedContext()}

Your task is to write a custom node from a description.

The node is a CustomGLSL node: a body of shader code that reads its inputs and evaluates to one value. Write the body only — no function signature, no main(), no uniform declarations.

The rules of that body:
- Inputs are named input0, input1, input2, … in pin order. Use only as many as you declare.
- The body's final expression is the node's output, and its type must match the output type you declare.
- This is WGSL-flavoured: write 0.0 not 0 for floats, and vec3<f32>(...) style constructors.
- It runs per pixel per frame. No loops over large ranges, no unbounded work.
- These names are already in scope and need no pin: uv (the vec2 pixel coordinate), time (seconds), pi, E, and audioEnvelope / audioEnvelopeBass / audioEnvelopeMids / audioEnvelopeHighs / audioEnvelopeFull. Declaring a local of the same name shadows the built-in, which is fine, but do not declare a pin for something this list already gives you.

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
    // The one feature where the thinking is the product, and the artist is
    // told to expect a wait. It keeps its effort; nothing else needed it.
    effort: 'xhigh',
    // Prose and an arc. Sixteen moves of twenty-four keyframes is ~3,500
    // tokens of JSON on its own, and the reading and directions were already
    // most of 6,000 — a ceiling reached is an `incomplete` answer, which is
    // this feature's whole daily allowance spent on nothing.
    maxTokens: 11000,
    reasoningTokens: 16000,
    // One call is minutes of model time. Worth remembering the grant id.
    singleUse: true,
    /**
     * No `model` line any more, and that is the point: this feature named terra
     * for itself back when the default was the cheap tier, on the argument that
     * an artist paying for direction on a piece should not get the
     * cost-efficient model. The rest of the editor has since been held to the
     * same standard, so the default is terra and this inherits it.
     *
     * `OPENAI_MODEL` overrides that, as it overrides everything.
     */
    system: () => `${sharedContext()}

Your task is to direct a whole piece, not to fix a patch.

The artist has a work in progress and a brief. Think about the piece as something an audience sits with over time: where it starts, what changes, what it earns by the end. Then say what to do about it.

Give direction that is specific to this patch — which parameters carry the movement, where it repeats when it should develop, what the piece is currently promising and not paying off. Name the nodes. An artist should be able to act on each direction in the next session without asking you what you meant.

Be honest about what is not working. Encouragement that avoids the real problem wastes the sitting.

Then write the arc: that direction as movement the editor can play. It is a length in seconds and a few moves, each one node's one numeric parameter keyframed along it, with sections naming the shape against the playhead.

- Few moves, chosen. Four parameters that carry the piece beat forty that automate it, and each move is a control the artist cannot touch while the timeline runs. Spend them on what the directions above actually turn on, and name that direction in "why".
- Start from where the patch already is: a first keyframe far from the parameter's current value is a jump cut at second zero. Stay inside its stated range.
- Time used, not filled. A held value is movement; a parameter ramping the whole length is a slider being dragged.
- A length the piece can loop on — on bar lines at the given tempo, if you were given one, so it can be dropped into a set.
- float, int and slider only, and never a parameter carrying an expression the piece needs, because a track overwrites it.

If this patch needs work before it needs an arc, return no moves and say so in the reading. An arc over a patch that is not ready is a way of not saying it.`,
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
          arc: ARC_SCHEMA,
        },
        required: ['reading', 'directions', 'arc'],
        additionalProperties: false,
      },
    },
  },
};

/**
 * Tokens for a feature's answer on this particular call.
 *
 * Static for every feature but the refactor, which hands back the whole patch
 * it was given: a ten-node patch needs a fraction of what four hundred nodes
 * need, and a budget sized for the largest possible patch is also permission
 * to spend the largest possible amount of time. Sizing it from the input keeps
 * a small refactor quick and still lets a big one finish.
 *
 * ~120 tokens a node covers the node's own JSON and the wires that reach it,
 * measured against the schema these features answer in; the floor is there so
 * that a two-node patch still has room for the summary and the change list.
 *
 * @param {Object} config - the feature, from AI_FEATURES.
 * @param {Object} input - the request payload, whose `patch` may be absent.
 * @returns {number} tokens for the answer alone, reasoning not included.
 */
export function answerBudget(config, input = {}) {
  if (!config?.scaleWithPatch) return config.maxTokens;

  const nodes = Array.isArray(input?.patch?.nodes) ? input.patch.nodes.length : 0;
  const needed = nodes * 120 + 2500;

  return Math.max(3000, Math.min(config.maxTokens, needed));
}

export function featureConfig(feature) {
  return Object.prototype.hasOwnProperty.call(AI_FEATURES, feature) ? AI_FEATURES[feature] : null;
}

/** The feature keys this backend actually implements. */
export const IMPLEMENTED_FEATURES = Object.keys(AI_FEATURES);

/**
 * What changes when the artist tidies a selection rather than a whole patch.
 *
 * The system prompt is written for a whole document — remove what reaches no
 * Output node, return every node that should survive — and both of those read
 * as instructions to delete most of a selection, because a selection usually
 * has no Output node in it and the branches it belongs to run off the edge.
 * This is appended after the patch so it is the last thing read, and it says
 * the two things that make the difference: the edge is fixed, and the answer
 * is the selection rather than the document.
 *
 * It lives here rather than in the feature's `system` because the system turn
 * is the cache prefix every call for this feature shares (see prompt_cache_key
 * in api/ai/run.js); varying it per call would cost the cache for the sake of
 * a paragraph the user turn can carry.
 */
const SELECTION_RULES = `

These nodes are a selection out of a larger patch, and only they are yours to change:

- Return exactly this selection, tidied — not the rest of the patch, which you have not been shown. The nodes you return replace the selected ones; everything else on the canvas stays as it is.
- Keep the ids you were given. The editor reconnects the selection to the rest of the patch by id and pin number, so a node that comes back under a new id comes back unwired.
- Any node named in "Wires crossing the edge of the selection" is load-bearing: keep it, keep its id, and keep the pin numbers that wire crosses on. Moving a node's pins renumbers what feeds it.
- Do not delete a node because nothing in the selection reads it, and do not delete a branch because it reaches no Output node. Both are the normal shape of a selection: what reads it is outside.
- You may add nodes. A new node needs an id no node in the selection uses; the editor renames it if it clashes with something outside.
- The nodes with ids outside this selection are context, not content. Never put one in your answer.`;

/**
 * Build the user turn for a feature from the editor's payload.
 *
 * The graph travels as the line format described in PATCH_FORMAT_LEGEND, which
 * keeps what a model reasons about — ids, kinds, wires, the parameters an
 * artist moved — and drops what it cannot use. Node ids survive intact, so a
 * finding still names something the editor can highlight.
 */
export function buildUserMessage(feature, input = {}) {
  // The wires, then what they add up to. The second costs a few hundred
  // tokens and saves most of what a model would otherwise spend working the
  // same thing out — badly, on a large graph. See patchFacts.js.
  const patchText = () => `${describePatch(input.patch)}${patchFacts(input.patch)}`;

  switch (feature) {
    case 'ai.patch_review':
      return `Review this patch.\n\n${patchText()}`;

    case 'ai.patch_refactor':
      return input.patch?.scope === 'selection'
        ? `Tidy the selected part of this patch without changing what it renders.\n\n${patchText()}${SELECTION_RULES}`
        : `Tidy this patch without changing what it renders.\n\n${patchText()}`;

    case 'ai.canvas_assist': {
      const focus = Array.isArray(input.selectedNodeIds) && input.selectedNodeIds.length
        ? `\n\nThe artist currently has these nodes selected: ${input.selectedNodeIds.join(', ')}. Weight your suggestions towards them.`
        : '';
      return `Suggest small improvements to what I am working on.\n\n${patchText()}${focus}`;
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
      return `${briefText}Direct this piece.\n\n${patchText()}${describeTiming(input.timing)}`;
    }

    default:
      throw new BadInputError(`No message builder for ${feature}.`);
  }
}

/**
 * What the editor is already doing with time, for the one feature that writes
 * time back.
 *
 * Three facts, none of them in the graph: how long the timeline is set to run,
 * which parameters already have keyframes on them, and the tempo the artist
 * performs at. The first two are what stops an arc from being written over an
 * arrangement the artist made by hand; the third is what lets its length land
 * on a bar line instead of at 37 seconds.
 *
 * Absent when the editor sent none — an artist who has never opened the
 * timeline has nothing to say here, and a paragraph explaining that costs
 * tokens to tell a model nothing.
 */
function describeTiming(timing) {
  if (!timing || typeof timing !== 'object') return '';

  const lines = [];

  const duration = Number(timing.durationSeconds);
  if (Number.isFinite(duration) && duration > 0) {
    lines.push(`The timeline is ${round2(duration)}s long${timing.loop ? ', looping' : ''}.`);
  }

  const bpm = Number(timing.bpm);
  if (Number.isFinite(bpm) && bpm > 0) {
    const bar = (60 / bpm) * (Number(timing.beatsPerBar) > 0 ? Number(timing.beatsPerBar) : 4);
    lines.push(
      `The artist performs at ${round2(bpm)} BPM: one bar is ${round2(bar)}s, ` +
        `eight bars ${round2(bar * 8)}s, thirty-two bars ${round2(bar * 32)}s. ` +
        'Land the arc and its sections on bar lines.'
    );
  }

  const tracks = Array.isArray(timing.tracks) ? timing.tracks : [];
  if (tracks.length) {
    const listed = tracks
      .slice(0, 40)
      .map((track) => `${track?.nodeId}.${track?.param} (${track?.keyframes ?? 0})`)
      .join(', ');
    lines.push(
      `Already keyframed, with keyframe counts: ${listed}${tracks.length > 40 ? ', …' : ''}. ` +
        'This is the artist\'s own arrangement. A move on one of these replaces it, so touch one only ' +
        'when the direction says why, and say so in that move\'s "why".'
    );
  }

  return lines.length ? `\n\n# Time\n${lines.join('\n')}` : '';
}

/** Seconds and tempi, at the precision anyone reads them: two decimals, no trailing zeros. */
function round2(value) {
  return Number(value.toFixed(2));
}

/**
 * The graph as the line format the legend describes.
 *
 * Exported so the tests can read what a patch actually costs, and so anything
 * else that needs to show a model a patch writes it the one way.
 */
export function describePatch(patch) {
  const nodes = Array.isArray(patch?.nodes) ? patch.nodes : [];
  const connections = Array.isArray(patch?.connections) ? patch.connections : [];
  const boundary = Array.isArray(patch?.boundary) ? patch.boundary : [];

  if (!nodes.length) return '(The canvas is empty.)';

  const lines = nodes.map(describePatchNode);

  if (connections.length) {
    lines.push('');
    for (const conn of connections) {
      const from = `${conn?.from?.nodeId ?? ''}:${conn?.from?.pin ?? 0}`;
      const to = `${conn?.to?.nodeId ?? ''}:${conn?.to?.pin ?? 0}`;
      lines.push(`${from} -> ${to}`);
    }
  } else if (!boundary.length) {
    lines.push('', '(No wires: nothing in this patch is connected to anything else.)');
  }

  // The edge of a selection. These name nodes that are deliberately not in the
  // list above — they belong to the rest of the patch — so they are drawn
  // apart from the wires, with the outside node's kind in brackets, and the
  // legend says they are not yours to return.
  if (boundary.length) {
    lines.push('', 'Wires crossing the edge of the selection:');
    for (const edge of boundary) {
      const inside = `${edge?.inside?.nodeId ?? ''}:${edge?.inside?.pin ?? 0}`;
      const outside = `${edge?.outside?.nodeId ?? ''}:${edge?.outside?.pin ?? 0} [${edge?.outside?.kind ?? 'unknown'}, outside]`;
      lines.push(edge?.direction === 'in' ? `${outside} -> ${inside}` : `${inside} -> ${outside}`);
    }
  }

  return lines.join('\n');
}

function describePatchNode(node) {
  const bits = [String(node?.id ?? ''), String(node?.kind ?? '')];

  bits.push(`@${Math.round(Number(node?.x) || 0)},${Math.round(Number(node?.y) || 0)}`);

  // The artist's own name for a node says more about intent than anything else
  // in the document, so it is one of the few things worth its length.
  if (node?.name) bits.push(JSON.stringify(String(node.name)));
  if (Number.isFinite(node?.inputCount)) bits.push(`in=${node.inputCount}`);

  for (const [name, value] of Object.entries(node?.params || {})) {
    if (value === null || value === undefined) continue;
    if (isDefaultParamValue(node.kind, name, value)) continue;
    bits.push(`${name}=${describeParamValue(value)}`);
  }

  return bits.join(' ');
}

/**
 * Bare where it can be, JSON where it has to be.
 *
 * A bareword needs no quotes to be read back unambiguously; anything with a
 * space, a quote, or a line break in it does, and JSON is the quoting the model
 * already knows. Numbers and booleans are never quoted.
 */
function describeParamValue(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string' && /^[\w./+-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

/** Input the caller got wrong — answered 400, not 500. */
export class BadInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BadInputError';
  }
}
