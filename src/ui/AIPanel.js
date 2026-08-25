/**
 * AIPanel.js - the AI features, drawn from the live entitlements catalogue.
 *
 * The panel shows every editor-surface feature, including the ones this
 * visitor cannot use. Hiding a locked feature means an artist never finds out
 * the paid tier exists; showing it with the tier it needs is the whole upsell.
 *
 * Three things this panel is careful about:
 *
 *   - It draws from `catalog`, not from a hardcoded list, so a feature the
 *     gallery adds appears here without a release.
 *   - It asks for a grant when the artist clicks, never on open. A grant costs
 *     quota and expires in five minutes.
 *   - It tells a tier problem (402) from a spent allowance (429) apart, and
 *     from a signed-out visitor who should sign in rather than pay.
 */

import { modalManager } from './ModalManager.js';
import { iconMarkup } from './iconSprite.js';
import { openExternal } from '../utils/openExternal.js';
import { isTauri } from '../utils/isTauri.js';
import { DESKTOP_ORIGIN_HINT, signInToGallery } from './accountSession.js';
import { entitlements } from '../ai/entitlements.js';
import { runFeature, AIRequestError, GrantError } from '../ai/aiClient.js';
import { buildPatchContext, EmptyPatchError, PatchTooLargeError } from '../ai/patchContext.js';
import { insertGeneratedNode, replaceGraphWithPatch, selectNodes } from '../ai/applyResult.js';
import { FEATURES, TIER_LABELS } from '../ai/tiers.js';

/** Features that need something typed before they can run. */
const PROMPTED = {
  'ai.patch_generator': {
    placeholder: 'A slow plasma in deep blues, drifting',
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

export class AIPanel {
  constructor() {
    this.dialog = null;
    this.isOpen = false;
    this.busyFeature = null;
    this.unsubscribe = null;
  }

  async show() {
    if (this.isOpen) return;

    this.createDialog();
    this.isOpen = true;

    // Redraw whenever entitlements change — a sign-in elsewhere in the app,
    // or a grant that just moved the counters.
    this.unsubscribe = entitlements.onChange(() => this.renderBody());

    // Cached for the session; this resolves immediately after the first load.
    await entitlements.load();
    this.renderBody();
  }

  hide() {
    if (this.dialog?.parentElement) document.body.removeChild(this.dialog);
    this.dialog = null;
    this.isOpen = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  createDialog() {
    this.dialog = document.createElement('div');
    this.dialog.className = 'ai-panel-overlay';
    this.dialog.innerHTML = `
      <div class="ai-panel-dialog">
        <div class="ai-panel-header">
          <h3>${iconMarkup('expression', { size: 16 })} AI</h3>
          <div class="ai-panel-tier" id="ai-panel-tier"></div>
          <button class="ai-panel-close" title="Close">${iconMarkup('close', { size: 14, label: 'Close' })}</button>
        </div>
        <div class="ai-panel-body" id="ai-panel-body">
          <div class="ai-panel-loading">Checking what you can use…</div>
        </div>
      </div>`;

    this.dialog.querySelector('.ai-panel-close').addEventListener('click', () => this.hide());
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.hide();
    });

    document.body.appendChild(this.dialog);
  }

  renderBody() {
    if (!this.dialog) return;

    const state = entitlements.current;
    this.renderTierBadge(state);

    const body = this.dialog.querySelector('#ai-panel-body');
    body.textContent = '';

    // Signed out is not an error, but it is the difference between a third of
    // the free allowance and all of it — and on the desktop it is the state the
    // app starts in every time, so the way out belongs here.
    if (state.degraded || !state.authenticated) {
      body.appendChild(signInPrompt(state));
    }

    const rows = entitlements.editorCatalog();
    if (!rows.length) {
      body.appendChild(note('No AI features are available right now.', 'warning'));
      return;
    }

    for (const row of rows) {
      body.appendChild(this.renderFeature(row));
    }
  }

  renderTierBadge(state) {
    const badge = this.dialog.querySelector('#ai-panel-tier');
    badge.textContent = state.tierLabel || TIER_LABELS[state.tier] || 'Free';
    badge.className = `ai-panel-tier tier-${state.tier}`;
    badge.title = state.authenticated
      ? `Signed in on the ${state.tierLabel} plan`
      : 'Signed out — the free allowance is smaller until you sign in';
  }

  renderFeature(row) {
    const card = document.createElement('div');
    card.className = `ai-feature${row.allowed ? '' : ' locked'}`;

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

  /** "12 of 100 left today" — most worth showing on free, where it is small. */
  renderAllowance(row) {
    const line = document.createElement('div');
    line.className = 'ai-feature-allowance';

    if (!row.quota) {
      line.textContent = 'Included';
      return line;
    }

    const limit = row.quota.limit;
    const used = typeof row.used === 'number' ? row.used : null;

    if (used === null) {
      line.textContent = `${limit} per day`;
    } else {
      const left = Math.max(0, limit - used);
      line.textContent = `${left} of ${limit} left today`;
      if (left === 0) line.classList.add('exhausted');
    }

    return line;
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
      wrap.appendChild(input);
    }

    const button = document.createElement('button');
    button.className = 'ai-feature-run';
    button.textContent = prompted?.action || 'Run';
    button.disabled = Boolean(this.busyFeature);
    if (this.busyFeature === row.feature) button.textContent = 'Working…';

    button.addEventListener('click', () => {
      const payload = {};
      if (prompted) {
        const text = input.value.trim();
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
    return wrap;
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
        payload.patch = buildPatchContext(window.saveLoadManager?.exportProject?.());
        const selected = window.graph?.selection;
        if (selected?.size) payload.selectedNodeIds = [...selected].map(String);
      } catch (error) {
        if (error instanceof EmptyPatchError || error instanceof PatchTooLargeError) {
          modalManager.toast(error.message, 'warning');
          return;
        }
        throw error;
      }
    }

    this.busyFeature = feature;
    this.renderBody();

    try {
      const { result, warnings, label } = await runFeature(feature, payload);
      await this.presentResult(feature, label, result, warnings);
    } catch (error) {
      this.presentError(error);
    } finally {
      this.busyFeature = null;
      this.renderBody();
    }
  }

  async presentResult(feature, label, result, warnings) {
    if (warnings?.length) {
      modalManager.toast(warnings.join(' '), 'warning', label);
    }

    switch (feature) {
      case 'ai.patch_review':
        return showFindings(label, result.summary, result.findings, 'findings');
      case 'ai.canvas_assist':
        return showFindings(label, '', result.suggestions, 'suggestions');
      case 'ai.creative_director':
        return showDirections(label, result);
      case 'ai.node_generator':
        return this.applyGeneratedNode(label, result);
      case 'ai.patch_generator':
        return this.applyGeneratedPatch(label, result, `Apply "${result.title}"?`);
      case 'ai.patch_refactor':
        return this.applyRefactor(label, result);
      default:
        return showFindings(label, JSON.stringify(result), [], 'findings');
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
      this.hide();
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
      await replaceGraphWithPatch(result.patch, { reason: 'ai-refactor' });
      modalManager.toast('Refactor applied.', 'success', label);
      this.hide();
    } catch (error) {
      modalManager.toast(`Could not apply the refactor: ${error.message}`, 'error', label);
    }
  }

  /**
   * The three answers that need different words.
   *
   * 402 is "here is what you would get". 429 is "come back at this time" — or,
   * for a signed-out visitor, "sign in, it is free and the allowance is
   * bigger". 503 is an operator problem and not the artist's fault.
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

/** Review findings and canvas-assist suggestions read the same way. */
function showFindings(title, summary, items, kind) {
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
    clean.textContent = kind === 'findings' ? 'Nothing to report — the patch looks clean.' : 'Nothing to suggest right now.';
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

    // A finding that names nodes can point at them.
    if (item.nodeIds?.length) {
      const show = document.createElement('button');
      show.className = 'ai-finding-show';
      show.textContent = `Show ${item.nodeIds.length === 1 ? 'node' : 'nodes'}`;
      show.addEventListener('click', () => {
        const found = selectNodes(item.nodeIds);
        if (!found) modalManager.toast('Those nodes are no longer on the canvas.', 'warning');
      });
      row.appendChild(show);
    }

    body.appendChild(row);
  }

  modalManager.showModal(
    modalManager.createModal({
      title,
      body,
      buttons: [{ label: 'Close', primary: true, onClick: () => true }],
    })
  );
}

function showDirections(title, result) {
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

  modalManager.showModal(
    modalManager.createModal({ title, body, buttons: [{ label: 'Close', primary: true, onClick: () => true }] })
  );
}

/** One panel for the session, like the other editor windows. */
let panel = null;
export function getAIPanel() {
  if (!panel) panel = new AIPanel();
  return panel;
}
