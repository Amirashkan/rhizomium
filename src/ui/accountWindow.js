// src/ui/accountWindow.js
//
// The desktop sign-in window (editor/account.html).
//
// It runs the whole pairing itself: start one, show the code, send the artist
// to the gallery's /desktop page in their own browser, poll until the approval
// comes through, store the token. The editor that opened it does nothing but
// wait for it to close and then re-read the account (see signInInWindow in
// accountSession.js). That works because this page is served from the app's
// own origin, so the token it stores is the token the editor reads.
//
// '@tauri-apps/api' is reached through dynamic import() for the same reason as
// everywhere else in the Tauri integration (see openExternal.js).

import { APPROVAL_PATH, startPairing, waitForToken } from '../ai/desktopPairing.js';
import { setDesktopToken } from '../ai/desktopToken.js';
import { GALLERY_ORIGIN } from '../utils/galleryEndpoint.js';
import { openGalleryInBrowser } from '../utils/openExternal.js';

/** Long enough to read "Signed in", short enough not to be in the way. */
const CLOSE_AFTER_SUCCESS_MS = 1500;

const el = {
  code: document.getElementById('account-code'),
  copy: document.getElementById('account-copy'),
  open: document.getElementById('account-open'),
  url: document.getElementById('account-url'),
  status: document.getElementById('account-status'),
  retry: document.getElementById('account-retry'),
  cancel: document.getElementById('account-cancel'),
};

const approvalUrl = `${GALLERY_ORIGIN}${APPROVAL_PATH}`;
el.url.textContent = approvalUrl.replace(/^https:\/\//, '');

/** The code currently on screen, or null while there is none. */
let userCode = null;

function say(message, tone) {
  el.status.textContent = message;
  if (tone) el.status.dataset.tone = tone;
  else delete el.status.dataset.tone;
}

function showCode(code) {
  userCode = code;
  if (code) {
    el.code.textContent = code;
    delete el.code.dataset.empty;
  } else {
    el.code.textContent = '····-····';
    el.code.dataset.empty = '';
  }
  el.copy.disabled = !code;
  el.open.disabled = !code;
}

async function copyCode() {
  if (!userCode) return false;
  try {
    await navigator.clipboard.writeText(userCode);
    return true;
  } catch {
    // The code is user-select: all, so selecting it by hand still works.
    return false;
  }
}

async function closeWindow() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  } catch {
    window.close();
  }
}

/** One attempt: a fresh code, then wait for it to be approved. */
async function run() {
  showCode(null);
  el.retry.hidden = true;
  say('Starting sign-in…');

  const started = await startPairing();
  if (started.error) {
    say(started.error, 'bad');
    el.retry.hidden = false;
    return;
  }

  showCode(started.pairing.userCode);
  say('Waiting for you to approve the code on the gallery…');

  const token = await waitForToken(started.pairing.pairingId);
  if (!token) {
    showCode(null);
    say('That code expired before it was approved.', 'bad');
    el.retry.hidden = false;
    return;
  }

  setDesktopToken(token);
  el.open.disabled = true;
  el.copy.disabled = true;
  el.cancel.hidden = true;
  say('Signed in. You can go back to the editor.', 'ok');
  setTimeout(closeWindow, CLOSE_AFTER_SUCCESS_MS);
}

el.copy.addEventListener('click', async () => {
  const copied = await copyCode();
  el.copy.textContent = copied ? 'Copied' : 'Select it';
  setTimeout(() => {
    el.copy.textContent = 'Copy';
  }, 1500);
});

el.open.addEventListener('click', async () => {
  const copied = await copyCode();
  const opened = await openGalleryInBrowser(APPROVAL_PATH);
  if (!opened) {
    say(`Could not open your browser. Go to ${approvalUrl} and enter the code there.`, 'bad');
    return;
  }
  say(
    copied
      ? 'The code is on your clipboard. Paste it on the gallery page and approve it — this window will notice.'
      : 'Type the code on the gallery page and approve it — this window will notice.'
  );
});

el.retry.addEventListener('click', () => {
  run();
});

el.cancel.addEventListener('click', () => {
  closeWindow();
});

run();
