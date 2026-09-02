/**
 * AIPanel.js - the AI features, drawn from the live entitlements catalogue.
 *
 * This is a dock, not a dialog: it holds the right edge of the window and the
 * canvases end where it starts (src/ui/dockLayout.js). That is not decoration.
 * Every one of these features reads or rewrites the canvas, and a modal that
 * covered the canvas meant the artist could not see the thing being discussed
 * — could not follow a "Show nodes", could not watch a refactor land, could not
 * keep an eye on what was about to be replaced.
 *
 * The panel shows every editor-surface feature, including the ones this
 * visitor cannot use. Hiding a locked feature means an artist never finds out
 * the paid tier exists; showing it with the tier it needs is the whole upsell.
 *
 * Four things this panel is careful about:
 *
 *   - It draws from `catalog`, not from a hardcoded list, so a feature the
 *     gallery adds appears here without a release.
 *   - It asks for a grant when the artist clicks, never on open. A grant costs
 *     quota and expires in five minutes.
 *   - It tells a tier problem (402) from a spent allowance (429) apart, and
 *     from a signed-out visitor who should sign in rather than pay.
 *   - It says what an action costs and what it spent — allowance left, what the
 *     call will carry, tokens and seconds it took — because these are metered
 *     calls against someone's money and a spinner that says nothing else is a
 *     bill with no itemisation.
 */

import { modalManager } from './ModalManager.js';
import { iconMarkup, createIcon } from './iconSprite.js';
import { openExternal } from '../utils/openExternal.js';
import { isTauri } from '../utils/isTauri.js';
import { DESKTOP_ORIGIN_HINT, signInToGallery } from './accountSession.js';
import { entitlements } from '../ai/entitlements.js';
import { isAIDebugMode, setAIDebugMode } from '../ai/debugMode.js';
import { runFeature, AIRequestError, GrantError } from '../ai/aiClient.js';
import {
  buildPatchContext,
  measurePatchContext,
  refactorFit,
  EmptyPatchError,
  PatchTooLargeError,
  MAX_NODES,
} from '../ai/patchContext.js';
import { insertGeneratedNode, replaceGraphWithPatch, selectNodes } from '../ai/applyResult.js';
import { planArc, applyArc, revertArc } from '../ai/applyArc.js';
import { buildTimelineContext } from '../ai/timelineContext.js';
import { FEATURES, TIER_LABELS } from '../ai/tiers.js';
import { setRightDockWidth, notifyCanvasResize } from './dockLayout.js';

/** Features that need something typed before they can run. */
const PROMPTED = {
  'ai.patch_generator': {
    // Two things in one line: what to type, and that asking for 3D or for
    // something that listens to the music is a thing this can answer. The
    // backend knows about the field visualiser, the audio envelopes and live
    // parameter expressions (api/_lib/features.js); an artist reading a
    // placeholder about drifting plasma would not think to ask.
    placeholder: 'A torus in 3D, turning slowly, its surface breathing with the bass',
    inputKey: 'prompt',
    action: 'Generate patch',
  },
  'ai.node_generator': {
    placeholder: 'A node that mixes two colours by a curve, not linearly',
    inputKey: 'description',
    action: 'Generate node',
  },
  'ai.creative_director': {
    placeholder: 'What is this piece for? Where should it go?',
    inputKey: 'brief',
    action: 'Ask for direction',
  },
};

/**
 * Features whose result is something to read rather than something applied.
 *
 * Only these are worth remembering. Running one twice on an unchanged canvas
 * produces the same answer for a second charge, so the second run is waste.
 * The generative features are the opposite: they change the canvas, and asking
 * again is how an artist asks for a different idea, so they always run.
 */
const ANSWER_ONLY_FEATURES = new Set([
  'ai.patch_review',
  'ai.canvas_assist',
  'ai.creative_director',
]);

/** Dock geometry. The maximum is also clamped to half the window at runtime. */
const MIN_DOCK_WIDTH = 300;
const MAX_DOCK_WIDTH = 620;
const DEFAULT_DOCK_WIDTH = 400;

const STORAGE_KEY = 'glsl-node-editor.ai-panel.prefs';

/** How many runs the session log keeps before the oldest falls off. */
const MAX_LOGGED_RUNS = 12;

/**
 * What makes two runs the same run: the feature, and everything sent with it.
 *
 * Any edit to the graph moves the patch and so moves this, which is what makes
 * it safe to answer from memory — a stale answer is one the artist could not
 * have changed the inputs to.
 */
function answerFingerprint(feature, payload) {
  if (!ANSWER_ONLY_FEATURES.has(feature)) return null;
  return `${feature}:${JSON.stringify(payload)}`;
}

/** Preferences worth surviving a reload: the dock's size and its two switches. */
function loadPrefs() {
  const prefs = { width: DEFAULT_DOCK_WIDTH, scope: 'patch', reuseAnswers: true };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (Number.isFinite(stored.width)) prefs.width = stored.width;
    if (stored.scope === 'selection' || stored.scope === 'patch') prefs.scope = stored.scope;
    if (typeof stored.reuseAnswers === 'boolean') prefs.reuseAnswers = stored.reuseAnswers;
  } catch {
    // A corrupt or unavailable store is not worth a broken panel.
  }
  return prefs;
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private-mode storage refusals are not the artist's problem.
  }
}

export class AIPanel {
  constructor() {
    this.dock = null;
    this.isOpen = false;
    this.busyFeature = null;
    this.unsubscribe = null;
    /** The last answer-only result, and whether a repeat has been offered. */
    this.lastAnswer = null;

    this.prefs = loadPrefs();
    /** True while the edge is being dragged; see onWindowResize. */
    this.dragging = false;

    /** Typed prompts, kept across re-renders so a redraw never eats a draft. */
    this.drafts = {};
    /** Which feature's textarea had focus, so a redraw can give it back. */
    this.focusedFeature = null;

    /** This session's runs, newest first. Read by the log and the footer. */
    this.runs = [];
    this.session = {
      runs: 0,
      failures: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalMs: 0,
    };

    /**
     * The last payload measurement, and the graph shape it was taken on.
     *
     * Measuring means exporting the project, which collects texture data and
     * is far too heavy to run on a timer while someone is building. So it is
     * taken on request, and again for free after every run (the patch was
     * built anyway) — and marked stale as soon as the graph's shape moves.
     */
    this.measurement = null;
  }

  // --- Opening, closing, and holding the edge of the window -----------------

  async show() {
    if (this.isOpen) return;

    this.createDock();
    this.isOpen = true;
    this.applyWidth(this.prefs.width);

    // Redraw whenever entitlements change — a sign-in elsewhere in the app,
    // or a grant that just moved the counters.
    this.unsubscribe = entitlements.onChange(() => this.renderBody());

    this.onWindowResize = () => {
      // Not while the artist is dragging the edge. Every step of a drag tells
      // the canvases to re-measure, which comes back here as a resize — and
      // re-applying the *stored* width mid-drag snaps the dock back under the
      // cursor on every frame, so the edge cannot be moved at all.
      if (this.dragging) return;
      // Otherwise: the window shrinking can make the stored width more than
      // half of it, so re-clamp from the width the artist chose. Growing the
      // window back restores it, which is why this reads prefs rather than the
      // width currently applied.
      this.applyWidth(this.prefs.width, { persist: false, silent: true });
    };
    window.addEventListener('resize', this.onWindowResize);

    this.renderBody();

    // Cached for the session; this resolves immediately after the first load.
    await entitlements.load();
    this.renderBody();
  }

  hide() {
    if (this.dock?.parentElement) document.body.removeChild(this.dock);
    this.dock = null;
    this.isOpen = false;
    this.unsubscribe?.();
    this.unsubscribe = null;

    if (this.onWindowResize) {
      window.removeEventListener('resize', this.onWindowResize);
      this.onWindowResize = null;
    }

    // Give the canvases the width back.
    setRightDockWidth(0);
  }

  toggle() {
    if (this.isOpen) {
      this.hide();
      return Promise.resolve();
    }
    return this.show();
  }

  /**
   * Set the dock's width, clamped, and hand the rest of the window to the
   * canvases.
   *
   * Never wider than half the window: past that the dock is the application
   * and the canvas is the panel.
   */
  applyWidth(width, { persist = true, silent = false } = {}) {
    const ceiling = Math.max(MIN_DOCK_WIDTH, Math.min(MAX_DOCK_WIDTH, window.innerWidth * 0.5));
    const next = Math.round(Math.min(Math.max(width, MIN_DOCK_WIDTH), ceiling));

    if (this.dock) this.dock.style.width = `${next}px`;
    setRightDockWidth(this.isOpen ? next : 0, { silent });

    if (persist && next !== this.prefs.width) {
      this.prefs.width = next;
      savePrefs(this.prefs);
    }
    return next;
  }

  createDock() {
    this.dock = document.createElement('aside');
    this.dock.className = 'ai-dock';
    this.dock.setAttribute('aria-label', 'AI assistant');
    this.dock.innerHTML = `
      <div class="ai-dock-resizer" role="separator" aria-orientation="vertical"
           aria-label="Resize the AI panel" tabindex="0" title="Drag to resize"></div>
      <div class="ai-dock-header">
        <h3>${iconMarkup('expression', { size: 15 })} AI</h3>
        <div class="ai-panel-tier" id="ai-panel-tier"></div>
        <button class="ai-dock-icon-button" id="ai-refresh" title="Re-read your plan and allowance">
          ${iconMarkup('refresh', { size: 13, label: 'Refresh' })}
        </button>
        <button class="ai-dock-icon-button" id="ai-close" title="Close the AI panel">
          ${iconMarkup('close', { size: 13, label: 'Close' })}
        </button>
      </div>
      <div class="ai-dock-body" id="ai-panel-body">
        <div class="ai-panel-loading">Checking what you can use…</div>
      </div>
      <div class="ai-dock-footer" id="ai-dock-footer"></div>`;

    this.dock.querySelector('#ai-close').addEventListener('click', () => this.hide());
    this.dock.querySelector('#ai-refresh').addEventListener('click', (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      entitlements
        .refresh()
        .catch((error) => console.warn('[AIPanel] Could not refresh entitlements:', error))
        .finally(() => {
          button.disabled = false;
          this.renderBody();
        });
    });

    this.wireResizer(this.dock.querySelector('.ai-dock-resizer'));

    document.body.appendChild(this.dock);
  }

  wireResizer(handle) {
    let frameQueued = false;
    // The canvases follow the drag, but at most once a frame: the graph redraws
    // on every resize notification and a mousemove stream is faster than that.
    const scheduleNotify = () => {
      if (frameQueued) return;
      frameQueued = true;
      requestAnimationFrame(() => {
        frameQueued = false;
        notifyCanvasResize();
      });
    };

    const onMove = (event) => {
      this.applyWidth(window.innerWidth - event.clientX, { persist: false, silent: true });
      scheduleNotify();
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      this.dragging = false;
      // Where it was let go is the width to remember.
      if (this.dock) this.applyWidth(this.dock.offsetWidth, { silent: true });
      notifyCanvasResize();
    };

    handle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this.dragging = true;
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Keyboard: the drag handle is a control, and a control that only answers
    // to a mouse is one some people cannot use at all.
    handle.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 48 : 16;
      if (event.key === 'ArrowLeft') {
        this.applyWidth(this.dock.offsetWidth + step);
      } else if (event.key === 'ArrowRight') {
        this.applyWidth(this.dock.offsetWidth - step);
      } else {
        return;
      }
      event.preventDefault();
    });
  }

  // --- Drawing --------------------------------------------------------------

  renderBody() {
    if (!this.dock) return;

    const state = entitlements.current;
    this.renderTierBadge(state);

    const body = this.dock.querySelector('#ai-panel-body');
    const scrollTop = body.scrollTop;
    body.textContent = '';

    // Debug mode makes every number on this panel fictional, so it says so
    // before any of them are drawn — and instead of the sign-in prompt, which
    // is about an account debug mode is not consulting.
    if (state.debug) {
      body.appendChild(debugModePrompt());
    } else if (state.degraded || !state.authenticated) {
      // Signed out is not an error, but it is the difference between a third of
      // the free allowance and all of it — and on the desktop it is the state the
      // app starts in every time, so the way out belongs here.
      body.appendChild(signInPrompt(state));
    }

    const rows = entitlements.editorCatalog?.() || [];

    body.appendChild(this.renderAllowanceSummary(rows));
    body.appendChild(this.renderContextSection());

    if (!rows.length) {
      body.appendChild(note('No AI features are available right now.', 'warning'));
    } else {
      const features = section('Features');
      for (const row of rows) features.appendChild(this.renderFeature(row));
      body.appendChild(features);
    }

    body.appendChild(this.renderResults());

    this.renderFooter();

    body.scrollTop = scrollTop;
    this.restoreFocus();
  }

  renderTierBadge(state) {
    const badge = this.dock.querySelector('#ai-panel-tier');

    // The badge is the one thing on this panel that is always visible, which
    // makes it the right place to say that none of the rest is an account.
    if (state.debug) {
      badge.textContent = 'Debug';
      badge.className = 'ai-panel-tier tier-debug';
      badge.title = 'AI debug mode: features unlocked locally and nothing spends your allowance';
      return;
    }

    badge.textContent = state.tierLabel || TIER_LABELS[state.tier] || 'Free';
    badge.className = `ai-panel-tier tier-${state.tier}`;
    badge.title = state.authenticated
      ? `Signed in on the ${state.tierLabel} plan`
      : 'Signed out — the free allowance is smaller until you sign in';
  }

  /**
   * The allowance across every metered feature, totalled.
   *
   * Per-feature numbers are on the cards below; this is the question an artist
   * actually asks before starting something — how much have I got left today,
   * and when does it come back.
   */
  renderAllowanceSummary(rows) {
    const wrap = section('Allowance');

    const metered = rows.filter((row) => row.allowed && row.quota);
    if (!metered.length) {
      wrap.appendChild(
        quietLine(
          isAIDebugMode()
            ? 'Nothing is metered while debug mode is on — runs are unlimited from here.'
            : 'Nothing here is metered on your plan.'
        )
      );
      return wrap;
    }

    let left = 0;
    let total = 0;
    let soonestReset = null;

    for (const row of metered) {
      const limit = row.quota.limit ?? 0;
      total += limit;
      left += typeof row.used === 'number' ? Math.max(0, limit - row.used) : limit;
      if (row.resetsAt) {
        const at = new Date(row.resetsAt).getTime();
        if (!Number.isNaN(at) && (soonestReset === null || at < soonestReset)) soonestReset = at;
      }
    }

    const stats = document.createElement('div');
    stats.className = 'ai-stat-grid';
    stats.appendChild(stat('Actions left today', String(left), left === 0 ? 'bad' : null));
    stats.appendChild(stat('Daily allowance', String(total)));
    stats.appendChild(
      stat('Metered features', String(metered.length), null, 'Features that spend an action when you run them')
    );
    stats.appendChild(
      stat('Allowance resets', soonestReset ? formatReset(new Date(soonestReset).toISOString()) : '—')
    );
    wrap.appendChild(stats);

    wrap.appendChild(meter(total ? left / total : 0, left === 0 ? 'bad' : left / (total || 1) < 0.2 ? 'warn' : null));

    return wrap;
  }

  /**
   * What a call would carry, before one is paid for.
   *
   * The counts are read straight off the graph and cost nothing. The payload
   * size is not: it means exporting the project, textures included, so it is
   * taken on request and goes stale visibly rather than silently.
   */
  renderContextSection() {
    const wrap = section('What gets sent');
    const graph = window.graph;
    const nodeCount = graph?.nodes?.length ?? 0;
    const connectionCount = graph?.connections?.length ?? 0;
    const selectedCount = graph?.selection?.size ?? 0;

    // Scope: the whole patch, or only what is selected. Selection is how a
    // large patch gets a specific answer — and how it stays under the cap.
    const scope = document.createElement('div');
    scope.className = 'ai-scope';

    const scopeLabel = document.createElement('span');
    scopeLabel.className = 'ai-control-label';
    scopeLabel.textContent = 'Scope';
    scope.appendChild(scopeLabel);

    const group = document.createElement('div');
    group.className = 'ai-segmented';
    for (const [value, text, title] of [
      ['patch', 'Whole patch', 'Send every node on the canvas'],
      ['selection', 'Selection', 'Send only the selected nodes and the wires between them'],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.title = title;
      button.className = this.prefs.scope === value ? 'active' : '';
      button.addEventListener('click', () => {
        this.prefs.scope = value;
        savePrefs(this.prefs);
        // A different scope is a different payload, so a remembered answer for
        // the old one must not be handed back for the new one.
        this.lastAnswer = null;
        this.measurement = null;
        this.renderBody();
      });
      group.appendChild(button);
    }
    scope.appendChild(group);
    wrap.appendChild(scope);

    const sending = this.prefs.scope === 'selection' ? selectedCount : nodeCount;

    const stats = document.createElement('div');
    stats.className = 'ai-stat-grid';
    stats.appendChild(
      stat('Nodes sent', `${sending}`, sending === 0 || sending > MAX_NODES ? 'bad' : null,
        `Of ${nodeCount} on the canvas. ${MAX_NODES} is the most one call can read.`)
    );
    stats.appendChild(stat('Wires', String(connectionCount)));
    stats.appendChild(stat('Selected', String(selectedCount)));
    stats.appendChild(
      stat(
        'Payload',
        this.measurement ? formatBytes(this.measurement.bytes) : '—',
        this.measurementIsStale(nodeCount, connectionCount, selectedCount) ? 'stale' : null,
        'The trimmed graph that leaves your machine: no textures, no bindings, no viewport.'
      )
    );
    stats.appendChild(
      stat(
        'Est. tokens',
        this.measurement ? `~${formatCount(this.measurement.approxTokens)}` : '—',
        this.measurementIsStale(nodeCount, connectionCount, selectedCount) ? 'stale' : null,
        'A rough four-characters-to-a-token estimate. The exact count comes back with the answer.'
      )
    );
    stats.appendChild(
      stat('Node kinds', this.measurement ? String(this.measurement.kindCount) : '—')
    );
    wrap.appendChild(stats);

    wrap.appendChild(
      meter(sending / MAX_NODES, sending > MAX_NODES ? 'bad' : sending / MAX_NODES > 0.75 ? 'warn' : null,
        `${sending} of the ${MAX_NODES}-node limit for one call`)
    );

    const reason = this.contextProblem(nodeCount, selectedCount);
    if (reason) wrap.appendChild(note(reason, 'warning'));

    const controls = document.createElement('div');
    controls.className = 'ai-control-row';

    const measure = document.createElement('button');
    measure.className = 'ai-secondary-button';
    measure.textContent = this.measurement ? 'Re-measure payload' : 'Measure payload';
    measure.title = 'Builds the payload without sending it. Costs nothing.';
    measure.disabled = Boolean(reason);
    measure.addEventListener('click', () => this.measure());
    controls.appendChild(measure);

    controls.appendChild(
      checkbox(
        'Reuse the last answer when nothing has changed',
        this.prefs.reuseAnswers,
        (checked) => {
          this.prefs.reuseAnswers = checked;
          savePrefs(this.prefs);
        },
        'Reading features cost an action even when the canvas has not moved, so a ' +
          'repeat is offered from memory first. Turn this off to always run for real.'
      )
    );

    wrap.appendChild(controls);
    return wrap;
  }

  /** Why the patch-reading features cannot run right now, or null. */
  contextProblem(nodeCount, selectedCount) {
    if (!nodeCount) return 'There is nothing on the canvas yet, so the reading features have nothing to read.';
    if (this.prefs.scope === 'selection' && !selectedCount) {
      return 'The scope is set to the selection, but nothing is selected.';
    }
    const sending = this.prefs.scope === 'selection' ? selectedCount : nodeCount;
    if (sending > MAX_NODES) {
      return `${sending} nodes is more than the ${MAX_NODES} one call can read. Select part of the patch instead.`;
    }
    return null;
  }

  measurementIsStale(nodeCount, connectionCount, selectedCount) {
    if (!this.measurement) return false;
    return this.measurement.signature !== graphSignature(nodeCount, connectionCount, selectedCount, this.prefs.scope);
  }

  /** Build the payload without sending it, so its size can be shown. */
  measure() {
    try {
      const patch = this.buildPatch();
      this.measurement = {
        ...measurePatchContext(patch),
        signature: graphSignature(
          window.graph?.nodes?.length ?? 0,
          window.graph?.connections?.length ?? 0,
          window.graph?.selection?.size ?? 0,
          this.prefs.scope
        ),
      };
    } catch (error) {
      this.measurement = null;
      modalManager.toast(error.message, 'warning');
    }
    this.renderBody();
  }

  renderFeature(row) {
    const card = document.createElement('div');
    card.className = `ai-feature${row.allowed ? '' : ' locked'}`;
    card.dataset.feature = row.feature;

    const definition = FEATURES[row.feature];

    const title = document.createElement('div');
    title.className = 'ai-feature-title';
    title.textContent = row.label || definition?.label || row.feature;
    card.appendChild(title);

    const description = document.createElement('div');
    description.className = 'ai-feature-description';
    description.textContent = definition?.description || '';
    card.appendChild(description);

    if (row.allowed) {
      card.appendChild(this.renderAllowance(row));
      card.appendChild(this.renderAction(row));
    } else {
      card.appendChild(this.renderLocked(row));
    }

    return card;
  }

  /** "12 of 100 left today", with the bar that makes a small number obvious. */
  renderAllowance(row) {
    const wrap = document.createElement('div');
    wrap.className = 'ai-feature-allowance-block';

    const line = document.createElement('div');
    line.className = 'ai-feature-allowance';

    if (!row.quota) {
      line.textContent = 'Included — this one does not spend an action.';
      wrap.appendChild(line);
      return wrap;
    }

    const limit = row.quota.limit;
    const used = typeof row.used === 'number' ? row.used : null;

    if (used === null) {
      line.textContent = `${limit} per day`;
      wrap.appendChild(line);
      return wrap;
    }

    const left = Math.max(0, limit - used);
    line.textContent = `${left} of ${limit} left today`;
    if (left === 0) line.classList.add('exhausted');
    if (row.resetsAt) {
      const reset = document.createElement('span');
      reset.className = 'ai-feature-reset';
      reset.textContent = `resets ${formatReset(row.resetsAt)}`;
      line.appendChild(reset);
    }

    wrap.appendChild(line);
    wrap.appendChild(meter(limit ? left / limit : 0, left === 0 ? 'bad' : left / limit < 0.2 ? 'warn' : null));
    return wrap;
  }

  renderLocked(row) {
    const wrap = document.createElement('div');
    wrap.className = 'ai-feature-locked';

    const needed = row.requiredTier || FEATURES[row.feature]?.tier || 'cloude';
    const label = TIER_LABELS[needed] || needed;

    const text = document.createElement('span');
    text.textContent = `Needs ${label}`;
    wrap.appendChild(text);

    wrap.appendChild(upgradeLink(entitlements.upgradeUrl, `Upgrade to ${label}`));

    return wrap;
  }

  renderAction(row) {
    const wrap = document.createElement('div');
    wrap.className = 'ai-feature-action';

    const prompted = PROMPTED[row.feature];
    let input = null;

    if (prompted) {
      input = document.createElement('textarea');
      input.className = 'ai-feature-input';
      input.rows = 2;
      input.placeholder = prompted.placeholder;
      // Drafts survive the redraws that a running feature and every entitlement
      // change cause. Losing a typed brief to a background refresh is the kind
      // of small betrayal that stops people typing long ones.
      input.value = this.drafts[row.feature] || '';
      input.addEventListener('input', () => {
        this.drafts[row.feature] = input.value;
      });
      input.addEventListener('focus', () => {
        this.focusedFeature = row.feature;
      });
      input.addEventListener('blur', () => {
        if (this.focusedFeature === row.feature) this.focusedFeature = null;
      });
      wrap.appendChild(input);
    }

    // A reading feature with nothing valid to read cannot run, and saying why
    // here beats spending the click to find out.
    const blocked = needsPatch(row.feature)
      ? this.contextProblem(window.graph?.nodes?.length ?? 0, window.graph?.selection?.size ?? 0)
      : null;
    const exhausted = row.quota && typeof row.used === 'number' && row.used >= row.quota.limit;

    const button = document.createElement('button');
    button.className = 'ai-feature-run';
    button.textContent = prompted?.action || 'Run';
    button.disabled = Boolean(this.busyFeature) || Boolean(blocked) || Boolean(exhausted);
    if (blocked) button.title = blocked;
    if (exhausted) button.title = 'Your allowance for this feature is spent for now.';
    if (this.busyFeature === row.feature) {
      button.textContent = 'Working…';
      button.classList.add('working');
    }

    button.addEventListener('click', () => {
      const payload = {};
      if (prompted) {
        const text = (this.drafts[row.feature] || '').trim();
        if (!text) {
          modalManager.toast('Describe what you want first.', 'warning');
          input.focus();
          return;
        }
        payload[prompted.inputKey] = text;
      }
      this.run(row.feature, payload);
    });

    wrap.appendChild(button);

    if (needsPatch(row.feature)) {
      const scopeNote = document.createElement('span');
      scopeNote.className = 'ai-feature-scope';
      scopeNote.textContent =
        this.prefs.scope === 'selection' ? 'Reads the selection' : 'Reads the whole patch';
      wrap.appendChild(scopeNote);
    }

    return wrap;
  }

  /**
   * Everything this session has asked for, newest first.
   *
   * Answers land here rather than in a modal because the canvas is the point:
   * a finding that names three nodes is worth nothing if reading it means
   * covering them up.
   */
  renderResults() {
    const wrap = section('Results');

    if (this.runs.length) {
      const clear = document.createElement('button');
      clear.className = 'ai-section-action';
      clear.textContent = 'Clear';
      clear.addEventListener('click', () => {
        this.runs = [];
        this.renderBody();
      });
      wrap.querySelector('.ai-section-header').appendChild(clear);
    }

    if (!this.runs.length) {
      wrap.appendChild(quietLine('Nothing run yet this session.'));
      return wrap;
    }

    for (const entry of this.runs) wrap.appendChild(this.renderRun(entry));
    return wrap;
  }

  renderRun(entry) {
    const card = document.createElement('details');
    card.className = `ai-run status-${entry.status}`;
    card.open = entry.open !== false;
    card.addEventListener('toggle', () => {
      entry.open = card.open;
    });

    const summary = document.createElement('summary');

    const label = document.createElement('span');
    label.className = 'ai-run-label';
    label.textContent = entry.label;
    summary.appendChild(label);

    const when = document.createElement('span');
    when.className = 'ai-run-when';
    when.textContent = entry.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    summary.appendChild(when);

    card.appendChild(summary);

    // What the call actually cost. Null tokens mean the backend did not report
    // usage for this one — shown as a dash rather than a confident zero.
    const cost = document.createElement('div');
    cost.className = 'ai-run-cost';
    cost.appendChild(
      entry.repeat
        ? pill('reused answer', 'Shown from memory — nothing was sent and no action was spent')
        : pill(formatDuration(entry.durationMs), 'How long the call took')
    );
    if (entry.usage) {
      cost.appendChild(pill(`${formatTokenCount(entry.usage.inputTokens)} in`, 'Input tokens'));
      cost.appendChild(pill(`${formatTokenCount(entry.usage.outputTokens)} out`, 'Output tokens'));
      if (entry.usage.cacheReadTokens) {
        cost.appendChild(
          pill(`${formatTokenCount(entry.usage.cacheReadTokens)} cached`, 'Input tokens served from cache')
        );
      }
      if (entry.usage.reasoningTokens) {
        cost.appendChild(
          pill(`${formatTokenCount(entry.usage.reasoningTokens)} thinking`, 'Output tokens spent on reasoning')
        );
      }
    }
    if (entry.scope) cost.appendChild(pill(entry.scope === 'selection' ? 'selection' : 'whole patch'));
    card.appendChild(cost);

    card.appendChild(entry.body);
    return card;
  }

  renderFooter() {
    const footer = this.dock?.querySelector('#ai-dock-footer');
    if (!footer) return;
    footer.textContent = '';

    const { runs, failures, inputTokens, outputTokens, totalMs } = this.session;
    if (!runs) {
      footer.appendChild(quietLine('This session: nothing run yet.'));
      return;
    }

    const stats = document.createElement('div');
    stats.className = 'ai-stat-grid compact';
    stats.appendChild(stat('Runs', String(runs), null, 'Calls made this session — each spent an action'));
    stats.appendChild(stat('Failed', String(failures), failures ? 'bad' : null,
      'Failed calls still spend an action: the grant is issued before the model runs.'));
    stats.appendChild(stat('Tokens', `${formatCount(inputTokens)}/${formatCount(outputTokens)}`, null, 'Input / output tokens across this session'));
    stats.appendChild(stat('Average', formatDuration(totalMs / runs), null, 'Mean time per call this session'));
    footer.appendChild(stats);
  }

  /**
   * Give the caret back after a redraw.
   *
   * The panel redraws itself on every entitlement change and on both edges of
   * a run, and a redraw that drops focus mid-sentence is worse than one that
   * drops the text — the artist keeps typing into nothing.
   */
  restoreFocus() {
    if (!this.focusedFeature || !this.dock) return;
    // Matched by walking rather than by selector: a feature key comes from the
    // gallery's catalogue, and interpolating one into a selector is how a
    // remote string ends up parsed as CSS.
    const card = [...this.dock.querySelectorAll('.ai-feature')].find(
      (element) => element.dataset.feature === this.focusedFeature
    );
    const input = card?.querySelector('.ai-feature-input');
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  // --- Running --------------------------------------------------------------

  /** The payload the current scope says to send. Throws like buildPatchContext. */
  buildPatch() {
    const project = window.saveLoadManager?.exportProject?.();
    if (this.prefs.scope === 'selection') {
      const selected = window.graph?.selection;
      return buildPatchContext(project, { nodeIds: selected ? [...selected] : [] });
    }
    return buildPatchContext(project);
  }

  /**
   * Run a feature: gather the patch, ask for a grant, call the backend, and
   * show whatever comes back.
   */
  async run(feature, payload) {
    if (this.busyFeature) return;

    // Features that read the canvas need the canvas. Gather before spending a
    // grant, so an empty canvas costs nothing.
    if (needsPatch(feature)) {
      try {
        payload.patch = this.buildPatch();
        const selected = window.graph?.selection;
        if (selected?.size) payload.selectedNodeIds = [...selected].map(String);
      } catch (error) {
        if (error instanceof EmptyPatchError || error instanceof PatchTooLargeError) {
          modalManager.toast(error.message, 'warning');
          return;
        }
        throw error;
      }

      // The refactor has a second limit besides MAX_NODES: it writes the whole
      // patch back, and past a certain size that cannot be written inside the
      // deadline. Checked here, in front of the grant, because the gallery
      // meters the grant when it issues it — a call let through to fail on the
      // backend costs the artist an action and a five-minute wait for a 504.
      if (feature === 'ai.patch_refactor') {
        const fit = refactorFit(payload.patch);
        if (fit.verdict === 'too_large') {
          modalManager.toast(fit.message, 'warning', 'Too large to refactor in one call');
          return;
        }
        if (fit.verdict === 'tight') {
          modalManager.toast(fit.message, 'info', 'Large refactor');
        }
      }

      // The director is the one feature that writes time back into the patch,
      // and a graph says nothing about time. What the editor is already doing
      // with it travels separately — and only for this feature, because
      // nothing else can act on it. See timelineContext.js.
      if (feature === 'ai.creative_director') {
        const timing = buildTimelineContext();
        if (timing) payload.timing = timing;
      }

      // The payload is in hand, so its size is free to record.
      this.measurement = {
        ...measurePatchContext(payload.patch),
        signature: graphSignature(
          window.graph?.nodes?.length ?? 0,
          window.graph?.connections?.length ?? 0,
          window.graph?.selection?.size ?? 0,
          this.prefs.scope
        ),
      };
    }

    // A second click with nothing changed buys the same answer twice. The
    // gallery spends the artist's quota when the grant is issued, before the
    // model is called at all, so this has to be caught here — in front of
    // runFeature() — or the action is already gone.
    //
    // It defers rather than refuses: the repeat is offered once, and clicking
    // through it runs for real. An artist who wants a second opinion gets one;
    // an artist who clicked twice wondering whether it worked does not pay for
    // wondering.
    const fingerprint = this.prefs.reuseAnswers ? answerFingerprint(feature, payload) : null;
    if (fingerprint && this.lastAnswer?.fingerprint === fingerprint && !this.lastAnswer.offered) {
      this.lastAnswer.offered = true;
      modalManager.toast(
        'Nothing has changed since this ran, so here is the same answer again. Click once more for a fresh one.',
        'info',
        this.lastAnswer.label
      );
      await this.presentResult(feature, this.lastAnswer.label, this.lastAnswer.result, this.lastAnswer.warnings, {
        durationMs: 0,
        usage: null,
        repeat: true,
      });
      return;
    }

    this.busyFeature = feature;
    this.renderBody();

    const startedAt = performance.now();
    try {
      const { result, warnings, label, usage } = await runFeature(feature, payload);
      const durationMs = performance.now() - startedAt;

      this.session.runs += 1;
      this.session.totalMs += durationMs;
      this.session.inputTokens += usage?.inputTokens || 0;
      this.session.outputTokens += usage?.outputTokens || 0;

      if (fingerprint) this.lastAnswer = { fingerprint, label, result, warnings, offered: false };
      await this.presentResult(feature, label, result, warnings, { durationMs, usage });
    } catch (error) {
      this.session.runs += 1;
      this.session.failures += 1;
      this.session.totalMs += performance.now() - startedAt;
      this.logFailure(feature, error, performance.now() - startedAt);
      this.presentError(error);
    } finally {
      this.busyFeature = null;
      this.renderBody();
    }
  }

  /** Put an entry at the top of the session log. */
  log(entry) {
    const run = {
      at: new Date(),
      status: 'ok',
      durationMs: 0,
      usage: null,
      repeat: false,
      ...entry,
    };
    // Only a feature that read the canvas has a scope worth naming: a generator
    // was given a sentence, not a patch.
    if (run.scope === undefined) run.scope = needsPatch(run.feature) ? this.prefs.scope : null;

    this.runs.unshift(run);
    if (this.runs.length > MAX_LOGGED_RUNS) this.runs.length = MAX_LOGGED_RUNS;
    this.renderBody();

    // The log sits under the feature cards, so a fresh answer can land below
    // the fold — which reads as nothing having happened at all. Bring it up.
    const newest = this.dock?.querySelector('.ai-run');
    if (newest?.scrollIntoView) newest.scrollIntoView({ block: 'nearest' });
  }

  logFailure(feature, error, durationMs) {
    const body = document.createElement('div');
    body.className = 'ai-findings';
    const text = document.createElement('p');
    text.className = 'ai-findings-summary';
    text.textContent = error?.message || 'Something went wrong running that.';
    body.appendChild(text);

    this.log({
      feature,
      label: FEATURES[feature]?.label || feature,
      status: 'error',
      durationMs,
      body,
    });
  }

  async presentResult(feature, label, result, warnings, meta = {}) {
    if (warnings?.length) {
      modalManager.toast(warnings.join(' '), 'warning', label);
    }

    const entry = {
      feature,
      label: meta.repeat ? `${label} (repeat)` : label,
      durationMs: meta.durationMs ?? 0,
      usage: meta.usage ?? null,
      repeat: Boolean(meta.repeat),
    };

    switch (feature) {
      case 'ai.patch_review':
        return this.log({ ...entry, body: findingsElement(result.summary, result.findings, 'findings') });
      case 'ai.canvas_assist':
        return this.log({ ...entry, body: findingsElement('', result.suggestions, 'suggestions') });
      case 'ai.creative_director':
        return this.log({
          ...entry,
          body: directionsElement(result, (arc) => this.applyDirectorArc(label, arc)),
        });
      case 'ai.node_generator':
        this.log({
          ...entry,
          body: generatedNodeElement(result, () => this.applyGeneratedNode(label, result)),
        });
        return this.applyGeneratedNode(label, result);
      case 'ai.patch_generator':
        this.log({
          ...entry,
          body: generatedPatchElement(result, () =>
            this.applyGeneratedPatch(label, result, `Apply "${result.title}"?`)
          ),
        });
        return this.applyGeneratedPatch(label, result, `Apply "${result.title}"?`);
      case 'ai.patch_refactor':
        this.log({ ...entry, body: refactorElement(result, () => this.applyRefactor(label, result)) });
        return this.applyRefactor(label, result);
      default:
        return this.log({ ...entry, body: findingsElement(JSON.stringify(result), [], 'findings') });
    }
  }

  /**
   * Put a director's arc on the timeline.
   *
   * Planned at click time rather than when the answer arrived: a director call
   * is minutes long, and the canvas it was written against may have moved
   * since. Planning here means the dialog describes what will actually land on
   * the timeline in front of the artist, including what will not and why.
   *
   * @returns {Object|null} the timeline as it was, for the undo button, or
   *   null when nothing was written.
   */
  async applyDirectorArc(label, arc) {
    const graph = window.graph || window.editor?.graph;
    const timelineManager = window.timelineManager;
    if (!graph || !timelineManager) {
      modalManager.toast('The timeline is not ready yet.', 'error', label);
      return null;
    }

    const plan = planArc(arc, { graph, timelineManager });

    if (!plan.moves.length) {
      modalManager.toast(
        plan.skipped.length
          ? `Nothing in this arc can go on the timeline: ${describeSkipped(plan.skipped)}`
          : 'This arc has no moves to write.',
        'warning',
        label
      );
      return null;
    }

    const notes = [
      `${plan.moves.length} ${plan.moves.length === 1 ? 'parameter' : 'parameters'} keyframed over ` +
        `${formatSeconds(plan.durationSeconds)}, ${plan.keyframeCount} keyframes in all.`,
      plan.replacedCount
        ? `${plan.replacedCount} of them replace keyframes already on the timeline.`
        : '',
      plan.clampedCount
        ? `${plan.clampedCount} ${plan.clampedCount === 1 ? 'keyframe was' : 'keyframes were'} ` +
          'outside the range their control allows and have been brought inside it.'
        : '',
      plan.skipped.length ? `Not written: ${describeSkipped(plan.skipped)}` : '',
      'The timeline\'s length and loop become the arc\'s, and it starts running — so these ' +
        'parameters are played rather than dragged until you switch it off.',
    ].filter(Boolean);

    const accepted = await modalManager.confirm(
      `${notes.join('\n\n')}\n\nPut this on the timeline?`,
      label,
      { confirmLabel: 'Put it on the timeline', cancelLabel: 'Not now' }
    );
    if (!accepted) return null;

    try {
      const written = applyArc(plan, { timelineManager });
      modalManager.toast(
        `${written.keyframes} keyframes across ${written.moves} ` +
          `${written.moves === 1 ? 'parameter' : 'parameters'}. The timeline is running.`,
        'success',
        label
      );
      return written.backup;
    } catch (error) {
      modalManager.toast(`Could not write the arc: ${error.message}`, 'error', label);
      return null;
    }
  }

  async applyGeneratedNode(label, result) {
    const summary = `${result.description || ''}\n\nInputs: ${
      result.inputs?.map((pin) => `${pin.label} (${pin.type})`).join(', ') || 'none'
    }\nOutput: ${result.outputType}\n\n${result.notes || ''}`.trim();

    const accepted = await modalManager.confirm(
      `${summary}\n\nAdd "${result.name}" to the canvas?`,
      label,
      { confirmLabel: 'Add node', cancelLabel: 'Discard' }
    );
    if (!accepted) return;

    try {
      insertGeneratedNode(result);
      modalManager.toast(`Added "${result.name}".`, 'success', label);
    } catch (error) {
      modalManager.toast(`Could not add the node: ${error.message}`, 'error', label);
    }
  }

  async applyGeneratedPatch(label, result, question) {
    const accepted = await modalManager.confirm(
      `${result.notes || ''}\n\n${question}\n\nThis replaces what is on the canvas now. A backup is saved first.`.trim(),
      label,
      { confirmLabel: 'Replace canvas', cancelLabel: 'Keep mine' }
    );
    if (!accepted) return;

    try {
      await replaceGraphWithPatch(result.patch, { title: result.title, reason: 'ai-generated' });
      modalManager.toast(`Applied "${result.title}".`, 'success', label);
      // The canvas is a different canvas now: the measurement and any
      // remembered answer describe a patch that no longer exists.
      this.measurement = null;
      this.lastAnswer = null;
      this.renderBody();
    } catch (error) {
      modalManager.toast(`Could not apply the patch: ${error.message}`, 'error', label);
    }
  }

  async applyRefactor(label, result) {
    const changes = (result.changes || [])
      .map((change) => `• ${change.kind}: ${change.detail}`)
      .join('\n');

    const accepted = await modalManager.confirm(
      `${result.summary}\n\n${changes}\n\nApply this? It replaces what is on the canvas now, and a backup is saved first.`,
      label,
      { confirmLabel: 'Apply refactor', cancelLabel: 'Keep mine' }
    );
    if (!accepted) return;

    try {
      await replaceGraphWithPatch(result.patch, {
        reason: 'ai-refactor',
        // The artist had this patch before the refactor did. Any node whose
        // code was too long to send in full keeps the code it already had.
        preserveLongParams: true,
      });
      modalManager.toast('Refactor applied.', 'success', label);
      this.measurement = null;
      this.lastAnswer = null;
      this.renderBody();
    } catch (error) {
      modalManager.toast(`Could not apply the refactor: ${error.message}`, 'error', label);
    }
  }

  /**
   * The four answers that need different words.
   *
   * 402 is "here is what you would get". 429 is "come back at this time" — or,
   * for a signed-out visitor, "sign in, it is free and the allowance is
   * bigger". 503 is an operator problem and not the artist's fault, and so is
   * a 5xx crash — with the difference that nobody meant that one to happen, so
   * it points at the console rather than reading as a settled state.
   */
  presentError(error) {
    if (error instanceof GrantError) {
      if (error.code === 'tier_required') {
        return showUpsell(error);
      }
      if (error.code === 'quota_exceeded') {
        return showQuotaExhausted(error);
      }
      if (error.code === 'not_configured') {
        return modalManager.toast(
          'AI features are not switched on for the gallery yet. Nothing you did — it needs an operator.',
          'error',
          'Not configured'
        );
      }
      if (error.code === 'server_error') {
        return modalManager.toast(
          `${error.message} The console line names the credential the request went out with.`,
          'error',
          'Not your fault'
        );
      }
      return modalManager.toast(error.message, 'error');
    }

    if (error instanceof AIRequestError) {
      // Failures that are the deployment's fault, not the artist's. They still
      // cost an action — the gallery meters the grant before the model runs —
      // so say that, but do not word it as though they spent it on something.
      if (OPERATOR_FAULT_CODES.has(error.code)) {
        return modalManager.toast(
          `${error.message} An action was still deducted from your allowance for this, which is not your fault — sorry.`,
          'error',
          'Not your fault'
        );
      }

      // Ran past the backend's deadline, or past the editor's. The advice in
      // the message is the artist's to act on, so this is not an operator
      // fault — but the call was made and metered, which they should hear.
      if (error.code === 'timed_out') {
        return modalManager.toast(
          `${error.message} It still counted against your allowance, because the call was made.`,
          'error',
          'Took too long'
        );
      }

      const suffix = error.quotaSpent ? ' This one still counted against your allowance.' : '';
      return modalManager.toast(`${error.message}${suffix}`, 'error');
    }

    console.error('AI request failed:', error);
    modalManager.toast('Something went wrong running that. Try again.', 'error');
  }
}

/**
 * Backend failures the artist could not have caused and cannot fix by trying
 * again: an unconfigured deployment, an unpaid model bill, a request this
 * editor built wrongly, the model service being down, an answer that came back
 * unusable, or one that ran past a budget this editor sets.
 */
const OPERATOR_FAULT_CODES = new Set([
  'not_configured',
  'bad_model_request',
  'model_unavailable',
  'no_answer',
  'answer_truncated',
]);

function needsPatch(feature) {
  return feature !== 'ai.patch_generator' && feature !== 'ai.node_generator';
}

/** What has to move before a payload measurement stops describing the canvas. */
function graphSignature(nodeCount, connectionCount, selectedCount, scope) {
  return `${scope}:${nodeCount}:${connectionCount}:${scope === 'selection' ? selectedCount : 0}`;
}

// --- Small DOM pieces -------------------------------------------------------

function section(title) {
  const wrap = document.createElement('section');
  wrap.className = 'ai-section';

  const header = document.createElement('div');
  header.className = 'ai-section-header';

  const heading = document.createElement('h4');
  heading.textContent = title;
  header.appendChild(heading);

  wrap.appendChild(header);
  return wrap;
}

/** A labelled number. `tone` is 'bad', 'warn' or 'stale'. */
function stat(label, value, tone = null, title = '') {
  const cell = document.createElement('div');
  cell.className = `ai-stat${tone ? ` ${tone}` : ''}`;
  if (title) cell.title = title;

  const name = document.createElement('span');
  name.className = 'ai-stat-label';
  name.textContent = label;
  cell.appendChild(name);

  const number = document.createElement('span');
  number.className = 'ai-stat-value';
  number.textContent = value;
  cell.appendChild(number);

  return cell;
}

/** A 0..1 bar. Values over 1 fill it and read as over-budget. */
function meter(fraction, tone = null, title = '') {
  const track = document.createElement('div');
  track.className = `ai-meter${tone ? ` ${tone}` : ''}`;
  if (title) track.title = title;

  const fill = document.createElement('div');
  fill.className = 'ai-meter-fill';
  fill.style.width = `${Math.max(0, Math.min(1, fraction || 0)) * 100}%`;
  track.appendChild(fill);

  return track;
}

function pill(text, title = '') {
  const el = document.createElement('span');
  el.className = 'ai-pill';
  el.textContent = text;
  if (title) el.title = title;
  return el;
}

function quietLine(text) {
  const el = document.createElement('div');
  el.className = 'ai-quiet';
  el.textContent = text;
  return el;
}

function checkbox(labelText, checked, onChange, title = '') {
  const label = document.createElement('label');
  label.className = 'ai-checkbox';
  if (title) label.title = title;

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  label.appendChild(input);

  const text = document.createElement('span');
  text.textContent = labelText;
  label.appendChild(text);

  return label;
}

function note(text, type = 'info') {
  const el = document.createElement('div');
  el.className = `ai-panel-note ${type}`;
  el.textContent = text;
  return el;
}

/**
 * A link out to the gallery.
 *
 * Kept as an <a> for its styling and for the address it shows on hover, but the
 * navigation is ours: in the desktop app the webview refuses a target="_blank"
 * outright, so the upsell link was a dead control there — the one control an
 * artist who wants to pay would click.
 */
function upgradeLink(url, text) {
  const link = document.createElement('a');
  link.className = 'ai-upgrade-link';
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = text;

  link.addEventListener('click', (event) => {
    event.preventDefault();
    openExternal(url, { label: 'gallery-upgrade', title: 'Rhizomium — Plans' })
      .catch((error) => console.warn('[AIPanel] Could not open', url, error));
    // The allowance and the tier both change on the gallery, so re-read when
    // the artist comes back rather than leaving a stale "Needs Cloude".
    setTimeout(() => entitlements.refresh(), 1000);
  });

  return link;
}

/**
 * The row the panel shows when the artist is not signed in, or when the gallery
 * did not answer at all.
 *
 * Both used to be one sentence telling the artist to "sign in on the gallery",
 * which on the desktop was advice with nowhere to follow it: there is no other
 * tab, and the editor had no route to a sign-in page. The button is that route.
 */
function signInPrompt(state) {
  const wrap = document.createElement('div');
  wrap.className = 'ai-panel-note warning signin';

  const text = document.createElement('span');
  if (state.degraded) {
    text.textContent = isTauri()
      ? `Could not reach the gallery, so this shows the free tier. ${DESKTOP_ORIGIN_HINT}`
      : 'Could not reach the gallery, so this shows the free tier. Sign in and reopen this panel if you have a plan.';
  } else {
    text.textContent =
      'You are signed out, so this is a third of the free allowance. Signing in is free and raises it.';
  }
  wrap.appendChild(text);

  const button = document.createElement('button');
  button.className = 'ai-upgrade-link';
  button.type = 'button';
  button.textContent = state.degraded ? 'Try signing in' : 'Sign in';
  button.addEventListener('click', () => {
    button.disabled = true;
    signInToGallery()
      .catch((error) => console.warn('[AIPanel] Sign-in failed:', error))
      .finally(() => {
        button.disabled = false;
      });
  });
  wrap.appendChild(button);

  return wrap;
}

/**
 * What debug mode says for itself, and the way back out of it.
 *
 * Worth the space: an artist who lands on a link carrying `?aidebug=1` would
 * otherwise see a Studio panel they have not paid for and a first run that
 * fails at the backend for no reason they can see.
 */
function debugModePrompt() {
  const wrap = document.createElement('div');
  wrap.className = 'ai-panel-note warning signin';

  const text = document.createElement('span');
  text.textContent =
    'AI debug mode is on: every feature is unlocked here and runs do not spend an allowance. ' +
    'The backend still refuses unless it was started with AI_DEBUG_MODE set.';
  wrap.appendChild(text);

  const button = document.createElement('button');
  button.className = 'ai-upgrade-link';
  button.type = 'button';
  button.textContent = 'Turn off';
  // Turning it off redraws this panel and sends the client after the real
  // entitlements on its own; see the subscription in entitlements.js.
  button.addEventListener('click', () => setAIDebugMode(false));
  wrap.appendChild(button);

  return wrap;
}

/** 402: the artist is who they say they are, the feature just costs more. */
function showUpsell(error) {
  const label = error.requiredTierLabel || TIER_LABELS[error.requiredTier] || 'Cloude';
  const body = document.createElement('div');

  const text = document.createElement('p');
  text.textContent = error.message;
  body.appendChild(text);

  body.appendChild(upgradeLink(error.upgradeUrl, `See what ${label} includes`));

  modalManager.showModal(
    modalManager.createModal({
      title: `${label} feature`,
      body,
      buttons: [{ label: 'Close', primary: true, onClick: () => true }],
    })
  );
}

/** 429: they have the feature, the window is spent. */
function showQuotaExhausted(error) {
  if (error.remedyIsSignIn) {
    return modalManager.toast(
      'That is the signed-out allowance. Sign in on the gallery — it is free, and the allowance is bigger.',
      'warning',
      'Sign in for more'
    );
  }

  const when = error.resetsAt ? formatReset(error.resetsAt) : 'later today';
  modalManager.toast(`${error.message} Your allowance resets ${when}.`, 'warning', 'Allowance spent');
}

function formatReset(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'later';

  const hours = (date.getTime() - Date.now()) / 36e5;
  if (hours < 1) return 'within the hour';
  if (hours < 24) return `at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  return `on ${date.toLocaleDateString()}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCount(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1000) return String(Math.round(value));
  return `${(value / 1000).toFixed(1)}k`;
}

/** Null means the backend reported no usage — a dash, never a confident zero. */
function formatTokenCount(value) {
  return typeof value === 'number' ? formatCount(value) : '—';
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

// --- Result bodies ----------------------------------------------------------

/** Review findings and canvas-assist suggestions read the same way. */
function findingsElement(summary, items, kind) {
  const body = document.createElement('div');
  body.className = 'ai-findings';

  if (summary) {
    const el = document.createElement('p');
    el.className = 'ai-findings-summary';
    el.textContent = summary;
    body.appendChild(el);
  }

  if (!items?.length) {
    const clean = document.createElement('p');
    clean.className = 'ai-findings-summary';
    clean.textContent =
      kind === 'findings' ? 'Nothing to report — the patch looks clean.' : 'Nothing to suggest right now.';
    body.appendChild(clean);
  }

  for (const item of items || []) {
    const row = document.createElement('div');
    row.className = `ai-finding severity-${item.severity || 'note'}`;

    const heading = document.createElement('div');
    heading.className = 'ai-finding-title';
    heading.textContent = item.title;
    row.appendChild(heading);

    const detail = document.createElement('div');
    detail.className = 'ai-finding-detail';
    detail.textContent = item.detail;
    row.appendChild(detail);

    if (item.fix) {
      const fix = document.createElement('div');
      fix.className = 'ai-finding-fix';
      fix.textContent = item.fix;
      row.appendChild(fix);
    }

    // A finding that names nodes can point at them — and now that the panel is
    // beside the canvas rather than over it, the artist can watch it happen.
    if (item.nodeIds?.length) {
      const show = document.createElement('button');
      show.className = 'ai-finding-show';
      show.appendChild(createIcon('search', { size: 12 }));
      show.appendChild(
        document.createTextNode(`Show ${item.nodeIds.length === 1 ? 'node' : 'nodes'}`)
      );
      show.addEventListener('click', () => {
        const found = selectNodes(item.nodeIds);
        if (!found) modalManager.toast('Those nodes are no longer on the canvas.', 'warning');
      });
      row.appendChild(show);
    }

    body.appendChild(row);
  }

  return body;
}

function directionsElement(result, onApplyArc) {
  const body = document.createElement('div');
  body.className = 'ai-findings';

  const reading = document.createElement('p');
  reading.className = 'ai-findings-summary';
  reading.textContent = result.reading || '';
  body.appendChild(reading);

  for (const direction of result.directions || []) {
    const row = document.createElement('div');
    row.className = 'ai-finding severity-note';

    const heading = document.createElement('div');
    heading.className = 'ai-finding-title';
    heading.textContent = direction.title;
    row.appendChild(heading);

    const rationale = document.createElement('div');
    rationale.className = 'ai-finding-detail';
    rationale.textContent = direction.rationale;
    row.appendChild(rationale);

    if (direction.steps?.length) {
      const steps = document.createElement('ul');
      steps.className = 'ai-finding-steps';
      for (const step of direction.steps) {
        const li = document.createElement('li');
        li.textContent = step;
        steps.appendChild(li);
      }
      row.appendChild(steps);
    }

    body.appendChild(row);
  }

  const arc = arcElement(result.arc, onApplyArc);
  if (arc) body.appendChild(arc);

  return body;
}

/**
 * The playable half of a direction: what the arc is, and the way onto the
 * timeline.
 *
 * It lists what the director asked for, not what will land — that is worked
 * out against the live graph when the button is pressed, and said in the
 * dialog. Listing a plan here would go stale the moment a node was deleted,
 * and this element outlives several edits: it sits in the session log.
 */
function arcElement(arc, onApply) {
  const moves = Array.isArray(arc?.moves) ? arc.moves : [];
  if (!arc || (!moves.length && !arc.summary)) return null;

  const wrap = document.createElement('div');
  wrap.className = 'ai-arc';

  const heading = document.createElement('div');
  heading.className = 'ai-arc-heading';
  heading.textContent = arc.title || 'The arc';
  wrap.appendChild(heading);

  const keyframes = moves.reduce((total, move) => total + (move.keyframes?.length || 0), 0);
  const meta = document.createElement('div');
  meta.className = 'ai-arc-meta';
  meta.textContent = moves.length
    ? `${formatSeconds(arc.durationSeconds)} · ${moves.length} ${moves.length === 1 ? 'move' : 'moves'} · ${keyframes} keyframes`
    : 'No moves — the director says the patch comes first.';
  wrap.appendChild(meta);

  if (arc.summary) {
    const summary = document.createElement('div');
    summary.className = 'ai-finding-detail';
    summary.textContent = arc.summary;
    wrap.appendChild(summary);
  }

  if (arc.sections?.length) {
    const list = document.createElement('ul');
    list.className = 'ai-finding-steps';
    for (const section of arc.sections) {
      const item = document.createElement('li');
      item.textContent = `${formatSeconds(section.startSeconds)} — ${section.name}${
        section.intent ? `: ${section.intent}` : ''
      }`;
      list.appendChild(item);
    }
    wrap.appendChild(list);
  }

  for (const move of moves) {
    const row = document.createElement('div');
    row.className = 'ai-arc-move';

    const name = document.createElement('span');
    name.className = 'ai-arc-move-param';
    name.textContent = `${move.nodeId}.${move.param}`;
    row.appendChild(name);

    const why = document.createElement('span');
    why.className = 'ai-arc-move-why';
    why.textContent = move.why || `${move.keyframes?.length || 0} keyframes`;
    row.appendChild(why);

    wrap.appendChild(row);
  }

  if (moves.length && onApply) {
    const actions = document.createElement('div');
    actions.className = 'ai-arc-actions';

    const apply = document.createElement('button');
    apply.className = 'ai-secondary-button';
    apply.textContent = 'Put this on the timeline';
    actions.appendChild(apply);

    // The timeline as it was before the most recent apply. Held here rather
    // than on the panel because the log keeps several answers, and each one's
    // undo has to put back what *that* arc replaced.
    let backup = null;
    let undo = null;

    apply.addEventListener('click', async () => {
      const replaced = await onApply(arc);
      if (!replaced) return;
      backup = replaced;

      // Made once, on the first apply that lands, and kept: an artist who
      // reverts and applies again wants the same door back, not a second one.
      if (!undo) {
        undo = document.createElement('button');
        undo.className = 'ai-secondary-button';
        undo.textContent = 'Put my timeline back';
        undo.addEventListener('click', () => {
          if (revertArc(backup)) {
            modalManager.toast('The timeline you had is back.', 'info', 'AI creative director');
          }
        });
        actions.appendChild(undo);
      }
    });

    wrap.appendChild(actions);
  }

  return wrap;
}

/** A time on the arc, as an artist reads it off the timeline: 0:00, 1:04. */
function formatSeconds(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The moves an arc could not write, as one sentence. */
function describeSkipped(skipped) {
  const listed = skipped
    .slice(0, 3)
    .map((entry) => `${entry.nodeId}.${entry.param} (${entry.reason})`)
    .join('; ');
  return skipped.length > 3 ? `${listed}; and ${skipped.length - 3} more` : listed;
}

/**
 * A generated thing in the log, with the way to apply it again.
 *
 * The confirm dialog opens on its own when the answer arrives; this is what is
 * left afterwards, so an artist who said "keep mine" can change their mind
 * without paying for a second generation.
 */
function applyableElement(summaryText, detailNodes, applyLabel, onApply) {
  const body = document.createElement('div');
  body.className = 'ai-findings';

  if (summaryText) {
    const summary = document.createElement('p');
    summary.className = 'ai-findings-summary';
    summary.textContent = summaryText;
    body.appendChild(summary);
  }

  for (const node of detailNodes) body.appendChild(node);

  const apply = document.createElement('button');
  apply.className = 'ai-secondary-button';
  apply.textContent = applyLabel;
  apply.addEventListener('click', () => onApply());
  body.appendChild(apply);

  return body;
}

function generatedNodeElement(result, onApply) {
  const detail = document.createElement('div');
  detail.className = 'ai-finding-detail';
  detail.textContent = `${result.name} — ${
    result.inputs?.map((pin) => `${pin.label} (${pin.type})`).join(', ') || 'no inputs'
  } → ${result.outputType}`;

  return applyableElement(result.description || '', [detail], 'Add to canvas…', onApply);
}

function generatedPatchElement(result, onApply) {
  const detail = document.createElement('div');
  detail.className = 'ai-finding-detail';
  detail.textContent = `${result.patch?.nodes?.length ?? 0} nodes, ${
    result.patch?.connections?.length ?? 0
  } wires`;

  return applyableElement(
    `${result.title || 'Generated patch'}${result.notes ? ` — ${result.notes}` : ''}`,
    [detail],
    'Replace canvas…',
    onApply
  );
}

function refactorElement(result, onApply) {
  const changes = document.createElement('ul');
  changes.className = 'ai-finding-steps';
  for (const change of result.changes || []) {
    const li = document.createElement('li');
    li.textContent = `${change.kind}: ${change.detail}`;
    changes.appendChild(li);
  }

  return applyableElement(result.summary || '', [changes], 'Apply refactor…', onApply);
}

/** One panel for the session, like the other editor windows. */
let panel = null;
export function getAIPanel() {
  if (!panel) panel = new AIPanel();
  return panel;
}
