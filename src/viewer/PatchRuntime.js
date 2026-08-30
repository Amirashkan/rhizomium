/**
 * PatchRuntime.js — running a published patch, and nothing else.
 *
 * The editor's boot path wires up forty subsystems because it is an editor:
 * panels, undo, autosave, MIDI/OSC, node previews, the 3D viewport. A viewer
 * needs none of that. It needs the four things that turn a document into
 * pixels, in this order:
 *
 *   graph  →  buildWGSL()  →  gpuRenderer.setShaderSource()  →  render loop
 *
 * Everything here exists to serve that line. The codegen and the renderer were
 * already written to work without an editor present (they fall back from
 * `window.editor.graph` to `window.graph`), which is what makes a viewer this
 * small possible at all — so the globals below are set deliberately, as the
 * contract those modules read, not as leftovers of a copied boot sequence.
 *
 * ## What a viewer deliberately does not do
 *
 * - **No audio.** A patch carries its graph and its textures, not the track it
 *   was made to. Audio-reactive parameters read zero here, and a patch built
 *   around them will look static. That is a property of the published document,
 *   not of this runtime.
 * - **No MIDI or OSC.** Same reason: those are bindings to hardware in front of
 *   the artist, and the bindings are saved but the hardware is not here.
 * - **No 3D field visualisers.** ComputeFieldMapper nodes render through the
 *   editor's 3D scene, which is not loaded here; such a node's branch of the
 *   graph shows nothing.
 *
 * Each of those is a missing input rather than a missing feature, and the page
 * says so rather than showing a black canvas and letting the visitor guess.
 */

import { GPURenderer } from '../gpu/gpuRenderer.js';
import { requestDeviceWithTextureLimits } from '../gpu/deviceLimits.js';
import { ComputeExecutor } from '../gpu/ComputeExecutor.js';
import { RenderLoop } from '../core/RenderLoop.js';
import { buildWGSL } from '../codegen/glslBuilder.js';
import { Graph } from '../data/Graph.js';
import { hydrateNodes, hydrateConnections } from '../core/graphHydration.js';
import { restorePatchTextures } from '../core/patchTextures.js';
import { migrateProjectData } from '../core/projectMigrations.js';
import { applyProjectFormat, resolveResolution } from '../ui/OutputFormat.js';
import { expressionSystem } from '../utils/ParameterExpressionSystem.js';
import { TriggerNodeProcessor } from '../core/TriggerNodeProcessor.js';
import { WaveSyncProcessor } from '../core/WaveSyncProcessor.js';
import { HoldNodeProcessor } from '../core/HoldNodeProcessor.js';
import { CountNodeProcessor } from '../core/CountNodeProcessor.js';
import { FeedbackResetProcessor } from '../core/FeedbackResetProcessor.js';
import { VideoResetProcessor } from '../core/VideoResetProcessor.js';
import { TextNodeProcessor } from '../core/TextNodeProcessor.js';
import { applyControlValue, writeParameterUniform } from '../parameters/ExternalParameterControl.js';
import { coerceControlValue, resolveViewerControls } from './ViewerControls.js';

export class PatchRuntimeError extends Error {
  constructor(message, code = 'runtime_error') {
    super(message);
    this.name = 'PatchRuntimeError';
    this.code = code;
  }
}

/** Node kinds whose output the viewer cannot produce, and what to say about it. */
const UNSUPPORTED_KINDS = [
  {
    match: /^ComputeFieldMapper$/i,
    note: 'This patch drives a 3D field visualiser, which only renders in the editor.',
  },
];

/** Node kinds that need an input the viewer has no way to supply. */
const MISSING_INPUT_KINDS = [
  { match: /audio/i, note: 'This patch reacts to audio, which is not published with it.' },
  { match: /^(MIDI|OSC)/i, note: 'This patch is driven by a hardware controller.' },
];

export class PatchRuntime {
  /**
   * @param {HTMLCanvasElement} canvas the output surface
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.device = null;
    this.renderer = null;
    this.computeExecutor = null;
    this.textureManager = null;
    this.graph = new Graph();
    this.loop = null;
    this.notes = [];
    /** @type {Array<{control: object, node: object, def: object|null, value: *}>} */
    this.controls = [];
    this.size = { width: 0, height: 0 };
    this._recompileTimer = null;

    // Per-frame CPU state the shader alone cannot carry: the Trigger node's
    // pulses, a Wave's sync origin, the Hold latch, the Count counter, feedback
    // and video resets, live Text. The editor runs these on an unthrottled
    // cadence for the same reason — a brief pulse missed for a frame is a cue
    // missed — and a published patch that uses them plays wrong without them.
    this.processors = {
      trigger: new TriggerNodeProcessor(),
      wave: new WaveSyncProcessor(),
      hold: new HoldNodeProcessor(),
      count: new CountNodeProcessor(),
      feedback: new FeedbackResetProcessor(),
      video: new VideoResetProcessor(),
      text: new TextNodeProcessor(),
    };
  }

  /** Acquire the GPU and build the render stack. */
  async init() {
    if (!navigator.gpu) {
      throw new PatchRuntimeError(
        'This browser has no WebGPU. Chrome, Edge or another Chromium browser (version 113 or newer) will run this patch.',
        'no_webgpu',
      );
    }

    let adapter;
    try {
      adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    } catch {
      adapter = null;
    }
    if (!adapter) {
      throw new PatchRuntimeError(
        'No GPU adapter was available for WebGPU on this machine.',
        'no_adapter',
      );
    }

    // Same texture-binding headroom the editor asks for, so a published patch
    // that compiles there compiles here.
    this.device = await requestDeviceWithTextureLimits(adapter);

    // Retain the adapter: if it is garbage-collected, Chromium drops the Dawn
    // instance behind it and later GPU calls fail out of nowhere.
    window.gpuAdapter = adapter;

    this.renderer = new GPURenderer(this.device, this.canvas);
    window.gpuRenderer = this.renderer;

    const { TextureManager } = await import('../core/TextureManager.js');
    this.textureManager = new TextureManager();
    await this.textureManager.initialize(this.device);
    window.textureManager = this.textureManager;

    this.computeExecutor = new ComputeExecutor(this.device);
    window.computeExecutor = this.computeExecutor;

    // The codegen resolves node references ("=node_4") through this.
    window.expressionSystem = expressionSystem;

    // What the compilers and the renderer read when there is no editor.
    window.graph = this.graph;

    this.device.lost?.then((info) => {
      // A lost device is not recoverable in place; the page decides what to say.
      this.stop();
      this.onDeviceLost?.(info);
    });
  }

  /**
   * Load a patch and compile it.
   *
   * @param {object} patchData project data as parsed from a `.rz` file
   */
  async load(patchData) {
    const projectData = migrateProjectData(patchData);

    const nodes = hydrateNodes(projectData.nodes || []);
    const connections = hydrateConnections(projectData.connections || [], nodes);
    if (nodes.length === 0) {
      throw new PatchRuntimeError('This patch has no nodes in it.', 'empty_patch');
    }

    this.graph.nodes = nodes;
    this.graph.connections = connections;
    this.graph.nodeMap = new Map(nodes.map((node) => [node.id, node]));
    this.graph.markExecutionOrderDirty?.();

    this.notes = describeUnsupported(nodes);

    // What this patch offers a visitor to move. Resolved against the graph that
    // was just hydrated, so a control naming a node the patch no longer has
    // simply is not there.
    this.controls = resolveViewerControls(projectData.viewerControls, nodes);

    // Textures are inlined in the patch, so this is a decode rather than a
    // fetch. One bad texture leaves its node blank and the patch still runs.
    await restorePatchTextures(this.textureManager, projectData.textures);

    // The authored composition size travels with the document: a
    // resolution-dependent simulation renders differently at another size, so
    // the viewer renders at the size the artist worked at and the page scales
    // that to the window.
    applyProjectFormat(projectData.outputFormat);
    await this.applyOutputSize();

    await this.compile();
  }

  /** Size the render surface to the patch's own composition format. */
  async applyOutputSize() {
    const { width, height } = resolveResolution('output');
    this.size = {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height)),
    };
    await this.renderer.resizeCanvasSync(this.size.width, this.size.height);
  }

  /** Compile the graph and hand the WGSL to the renderer. */
  async compile() {
    const outputNode = this.graph.nodes.find(
      (node) => node && /OutputFinal/i.test(node.kind || node.type || ''),
    );
    const wired =
      Array.isArray(outputNode?.inputs) &&
      outputNode.inputs[0] !== null &&
      outputNode.inputs[0] !== undefined;

    if (!outputNode || !wired) {
      throw new PatchRuntimeError(
        'This patch has nothing wired to its output, so there is nothing to show.',
        'no_output',
      );
    }

    const result = buildWGSL(this.graph);
    if (!result?.wgsl) {
      throw new PatchRuntimeError('This patch could not be compiled.', 'compile_failed');
    }

    // Compute textures have to exist before the render bind groups are built.
    if (window.computeNodeRegistry?.size > 0) {
      await this.computeExecutor.initialize();
    }

    this.renderer.setShaderSource(result.wgsl);
  }

  /**
   * Move one of the controls this patch offers.
   *
   * There are two ways a parameter reaches the GPU, and which one applies is
   * decided by the compiler, not here:
   *
   *   - **A uniform.** NodeCompiler registers every plain numeric parameter it
   *     reads as a uniform (see `getParam`), so the new value is a four-byte
   *     buffer write and the next frame already shows it. This is what makes a
   *     slider a slider rather than a series of stutters — it is the same path
   *     MIDI and OSC take in the editor.
   *   - **A rebuild.** A parameter the compiler baked into the WGSL — a mode a
   *     branch is chosen by, a boolean an `if` is written from — has no uniform
   *     to write. Those recompile, debounced, because a shader module compile
   *     is measured in milliseconds and a visitor flipping a switch can afford
   *     one; a visitor dragging a slider cannot afford sixty a second.
   *
   * The value is written onto `node.params` either way, so the two paths agree
   * and a later rebuild carries every control the visitor has moved.
   *
   * @param {object} control the control record being moved
   * @param {*} value whatever the input produced
   * @returns {*} the value actually stored, after clamping and coercion
   */
  setControlValue(control, value) {
    const entry = this.controls.find(
      (c) => c.control.nodeId === control?.nodeId && c.control.param === control?.param,
    );
    if (!entry) return undefined;

    const next = coerceControlValue(entry.control, value);
    const { node, control: spec } = entry;

    // Writes params and props, and leaves a parameter holding a formula alone —
    // though resolveViewerControls has already refused to offer one of those.
    applyControlValue(node, spec.param, next);
    entry.value = next;

    const uniformManager = window.nodeCompiler?.uniformManager;
    const hasUniform = !!uniformManager?.uniformValues?.has(`${node.id}.${spec.param}`);

    if (hasUniform && typeof next === 'number') {
      writeParameterUniform(node.id, spec.param, next);
      return next;
    }

    this._recompileSoon();
    return next;
  }

  /** Every control back to the value the patch was published with. */
  resetControls() {
    for (const entry of this.controls) {
      this.setControlValue(entry.control, entry.authored);
    }
  }

  /**
   * Rebuild the shader shortly, collapsing a burst of changes into one build.
   *
   * A failed rebuild is deliberately swallowed: the patch is already on screen
   * with the previous shader, and a visitor who moved a dropdown should get the
   * old render back rather than an error page over a piece that still works.
   */
  _recompileSoon() {
    if (this._recompileTimer) clearTimeout(this._recompileTimer);
    this._recompileTimer = setTimeout(() => {
      this._recompileTimer = null;
      this.compile().catch((error) => console.warn('[viewer] control rebuild failed', error));
    }, 120);
  }

  /** Start playing. */
  start() {
    if (this.loop) return;

    this.loop = new RenderLoop({
      mode: 'vsync',
      onFrame: (frame) => this.renderFrame(frame),
    });

    // resizeCanvasSync() stops window.renderLoop before it touches the canvas,
    // so the loop has to be reachable there for a later resize to be safe.
    window.renderLoop = this.loop;
    window.render = () => this.renderFrame({ simTime: this.loop?.getState?.().simTime || 0 });

    this.loop.start();
  }

  stop() {
    this.loop?.stop();
  }

  /** Stop and let go of the GPU. */
  dispose() {
    this.stop();
    if (this._recompileTimer) clearTimeout(this._recompileTimer);
    this._recompileTimer = null;
    if (window.renderLoop === this.loop) window.renderLoop = null;
    this.loop = null;
    try {
      this.device?.destroy?.();
    } catch {
      // A device that is already gone is the state we wanted anyway.
    }
  }

  renderFrame(frame) {
    const time = frame?.simTime ?? 0;
    const uniformManager = window.nodeCompiler?.uniformManager;

    if (uniformManager) {
      try {
        // Ordering matches the editor's loop: a Trigger's pulse and a Wave's
        // sync origin are read by Hold, Count and the feedback reset, so they
        // are advanced first and those consumers see this frame's values.
        this.processors.trigger.update(this.graph, { time, uniformManager });
        this.processors.wave.update(this.graph, { time, uniformManager });
        this.processors.hold.update(this.graph, { time, uniformManager });
        this.processors.count.update(this.graph, { time, uniformManager });
        this.processors.feedback.update(this.graph, {
          time,
          computeExecutor: this.computeExecutor,
        });
        this.processors.video.update(this.graph, { time, textureManager: this.textureManager });
        this.processors.text.update(this.graph);
      } catch {
        // A latch that throws must never take the render loop down with it.
      }
    }

    this.renderer.render({ timeSec: time }).catch(() => {
      // Render errors are logged inside the renderer; a rejected frame must
      // not stop the next one from being dispatched.
    });
  }
}

/**
 * What this patch uses that the viewer cannot give it.
 *
 * Returned as plain sentences for the page to show once, under the render: a
 * visitor looking at a still-looking patch deserves to know it is waiting for
 * audio rather than broken.
 */
export function describeUnsupported(nodes) {
  const notes = new Set();

  for (const node of nodes || []) {
    const kind = String(node?.kind || node?.type || '');
    for (const { match, note } of UNSUPPORTED_KINDS) {
      if (match.test(kind)) notes.add(note);
    }
    for (const { match, note } of MISSING_INPUT_KINDS) {
      if (match.test(kind)) notes.add(note);
    }
  }

  return [...notes];
}
