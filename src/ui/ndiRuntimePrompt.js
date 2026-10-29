// src/ui/ndiRuntimePrompt.js
//
// NDI is Vizrt's library, installed once per computer as the free NDI
// Runtime. When it is missing, say so and offer the download in one click;
// the app picks the runtime up as soon as it is installed, no restart.

import { modalManager } from './ModalManager.js';

/** Tell the artist NDI needs its runtime, and open the download if they want it. */
export async function offerNdiRuntime(reason) {
  const install = await modalManager.confirm(
    reason || 'NDI needs the free NDI Runtime, which is not installed on this computer.',
    'NDI Runtime Needed',
    { confirmLabel: 'Get NDI Runtime', cancelLabel: 'Not now' },
  );
  if (!install) return false;
  try {
    await window.__TAURI_INTERNALS__.invoke('open_ndi_runtime_download');
    return true;
  } catch (error) {
    console.warn('[ndi] could not open the NDI Runtime download:', error);
    return false;
  }
}
