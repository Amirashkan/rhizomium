/**
 * viewerMain.js — the web patch viewer page.
 *
 * A published patch, running live, in a browser, with no editor around it. The
 * page has exactly one job and four states:
 *
 *   checking  — asking the gallery what this visitor is entitled to
 *   locked    — the visitor is on the free tier (or signed out); an upsell
 *   loading   — fetching and compiling the patch
 *   playing   — the canvas, and nothing else
 *
 * The order matters: the entitlement check happens *before* the patch is
 * fetched. Downloading someone's work and then refusing to show it would spend
 * the visitor's bandwidth to tell them no.
 */

import { resolveWebViewerAccess, refusalMessage, VIEWER_FEATURE } from './viewerGate.js';
import { describePatchSource, fetchPatch, parsePatchText, PatchSourceError } from './patchSource.js';
import { takeHandoff } from './patchHandoff.js';
import { PatchRuntime, PatchRuntimeError } from './PatchRuntime.js';
import { ViewerControlsUi } from './viewerControlsUi.js';
import { FEATURES } from '../ai/tiers.js';
import { GALLERY_ORIGIN } from '../ai/entitlements.js';

const dom = {};
let runtime = null;
let controlsUi = null;

function el(id) {
  return document.getElementById(id);
}

function show(state) {
  document.body.dataset.state = state;
}

/** Put a message on the overlay. `actions` are [{label, href|onClick}]. */
function overlay({ title, message, detail = '', actions = [], state = 'message' }) {
  dom.overlayTitle.textContent = title;
  dom.overlayMessage.textContent = message;
  dom.overlayDetail.textContent = detail;
  dom.overlayDetail.hidden = !detail;

  dom.overlayActions.replaceChildren();
  for (const action of actions) {
    const node = action.href ? document.createElement('a') : document.createElement('button');
    node.className = action.primary ? 'viewer-action viewer-action-primary' : 'viewer-action';
    node.textContent = action.label;
    if (action.href) {
      node.href = action.href;
      node.rel = 'noopener';
      if (action.newTab) node.target = '_blank';
    } else {
      node.type = 'button';
      node.addEventListener('click', action.onClick);
    }
    dom.overlayActions.append(node);
  }

  show(state);
}

/** The upsell. Says what the feature is, what it costs and what to do next. */
function showLocked(check) {
  const feature = FEATURES[VIEWER_FEATURE];
  const actions = [];

  if (check.remedy === 'sign_in') {
    actions.push({
      label: 'Sign in to the gallery',
      href: `${GALLERY_ORIGIN}/login`,
      newTab: true,
      primary: true,
    });
  }
  if (check.remedy === 'upgrade' || check.remedy === 'sign_in') {
    actions.push({
      label: `See ${check.requiredTierLabel}`,
      href: check.upgradeUrl,
      newTab: true,
      primary: check.remedy === 'upgrade',
    });
  }
  if (check.remedy === 'retry') {
    actions.push({ label: 'Try again', onClick: () => start({ force: true }), primary: true });
  }

  overlay({
    state: 'locked',
    title: check.remedy === 'retry' ? 'Could not check your plan' : 'Part of a paid plan',
    message: refusalMessage(check),
    detail:
      check.remedy === 'retry'
        ? 'The gallery did not answer, so the viewer could not confirm your plan. Signing in there and reloading usually fixes it.'
        : feature?.description || '',
    actions,
  });
}

function showError(error) {
  const isSource = error instanceof PatchSourceError;
  const isRuntime = error instanceof PatchRuntimeError;

  overlay({
    state: 'error',
    title: isSource ? 'This patch could not be opened' : 'This patch could not be played',
    message: error?.message || String(error),
    detail:
      !isSource && !isRuntime
        ? 'Something went wrong that the viewer did not expect. The browser console has the details.'
        : '',
    actions: [{ label: 'Open a patch file…', onClick: () => dom.filePicker.click() }],
  });

  if (!isSource && !isRuntime) console.error('[viewer]', error);
}

/** No patch in the URL: offer the file picker rather than an empty page. */
function showEmpty() {
  overlay({
    state: 'empty',
    title: 'Rhizomium viewer',
    message: 'Open a Rhizomium patch (.rz) to run it here.',
    detail: 'Drop a file anywhere on this page, or pick one.',
    actions: [{ label: 'Open a patch file…', onClick: () => dom.filePicker.click(), primary: true }],
  });
}

/** Read the patch the URL points at. */
async function resolvePatch(source) {
  if (source.kind === 'url') return fetchPatch(source.url);

  const record = await takeHandoff(source.id);
  if (!record) {
    throw new PatchSourceError(
      'That patch is no longer waiting in this browser. Send it over from the editor again.',
      'handoff_missing',
    );
  }
  return record.patch;
}

/** Compile and play. */
async function play(patchData, title) {
  overlay({ state: 'loading', title: 'Loading…', message: title || 'Compiling the patch' });

  runtime?.dispose();
  runtime = new PatchRuntime(dom.canvas);
  runtime.onDeviceLost = () => {
    overlay({
      state: 'error',
      title: 'The GPU dropped this page',
      message: 'The browser released the GPU device this patch was running on.',
      actions: [{ label: 'Reload', onClick: () => window.location.reload(), primary: true }],
    });
  };

  await runtime.init();
  await runtime.load(patchData);

  // The canvas renders at the patch's authored size and is scaled to the
  // window by CSS, so the framing is the artist's, whatever the display is.
  dom.canvas.style.setProperty('--viewer-ar-w', String(runtime.size.width));
  dom.canvas.style.setProperty('--viewer-ar-h', String(runtime.size.height));

  runtime.start();

  document.title = title ? `${title} — Rhizomium` : 'Rhizomium viewer';
  dom.notes.replaceChildren(
    ...runtime.notes.map((note) => {
      const li = document.createElement('li');
      li.textContent = note;
      return li;
    }),
  );
  dom.notes.hidden = runtime.notes.length === 0;

  // The knobs this patch's author offered, if any. Built after the first frame
  // is on its way, so a patch with controls still appears as fast as one
  // without.
  controlsUi = new ViewerControlsUi(dom.controls, runtime);
  controlsUi.mount();

  show('playing');
}

/** Open a `.rz` the visitor dropped or picked. Still gated. */
async function playLocalFile(file) {
  try {
    const check = await resolveWebViewerAccess();
    if (!check.allowed) {
      showLocked(check);
      return;
    }
    await play(parsePatchText(await file.text()), file.name.replace(/\.rz$/i, ''));
  } catch (error) {
    showError(error);
  }
}

async function start({ force = false } = {}) {
  overlay({ state: 'checking', title: 'One moment', message: 'Checking your plan…' });

  let source;
  try {
    source = describePatchSource(new URLSearchParams(window.location.search), window.location.origin);
  } catch (error) {
    showError(error);
    return;
  }

  // The gate first, then the download — see the note at the top of the file.
  const check = await resolveWebViewerAccess({ force });
  if (!check.allowed) {
    showLocked(check);
    return;
  }

  if (source.kind === 'none') {
    showEmpty();
    return;
  }

  try {
    overlay({ state: 'loading', title: 'Loading…', message: 'Fetching the patch' });
    const patchData = await resolvePatch(source);
    await play(patchData, source.title || patchData?.title || null);
  } catch (error) {
    showError(error);
  }
}

function bindFileDrop() {
  document.addEventListener('dragover', (event) => {
    event.preventDefault();
    document.body.classList.add('is-dropping');
  });
  document.addEventListener('dragleave', () => document.body.classList.remove('is-dropping'));
  document.addEventListener('drop', (event) => {
    event.preventDefault();
    document.body.classList.remove('is-dropping');
    const file = event.dataTransfer?.files?.[0];
    if (file) playLocalFile(file);
  });

  dom.filePicker.addEventListener('change', () => {
    const file = dom.filePicker.files?.[0];
    if (file) playLocalFile(file);
  });
}

function bindFullscreen() {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'f' && event.key !== 'F') return;
    // A patch with controls has real form fields on the page; a keystroke aimed
    // at one of those is not a request to go full-screen.
    if (event.target instanceof HTMLElement && event.target.closest('#viewer-controls')) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
  dom.canvas.addEventListener('dblclick', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
}

function boot() {
  dom.canvas = el('viewer-canvas');
  dom.overlayTitle = el('viewer-overlay-title');
  dom.overlayMessage = el('viewer-overlay-message');
  dom.overlayDetail = el('viewer-overlay-detail');
  dom.overlayActions = el('viewer-overlay-actions');
  dom.filePicker = el('viewer-file');
  dom.notes = el('viewer-notes');
  dom.controls = el('viewer-controls');

  bindFileDrop();
  bindFullscreen();
  start();
}

boot();
