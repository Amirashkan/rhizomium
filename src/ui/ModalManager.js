/**
 * ModalManager.js - Unified in-app modal/dialog system
 * Replaces browser-native alert(), confirm(), and prompt() with custom UI
 */

import { ACCENT, SEMANTIC, SURFACE, TEXT, FONT_MONO, FONT_UI, withAlpha } from '../core/theme.js';

export class ModalManager {
  constructor() {
    this.modals = [];
    this.zIndexBase = 10002; // Higher than FileManager (10001) to appear on top
    this.addStyles();
  }

  addStyles() {
    if (document.getElementById('modal-manager-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'modal-manager-styles';
    styles.textContent = `
      /* Shared dialog + toast chrome. Every confirm, prompt, progress bar and
         notification in the app is built from these classes, so this is the one
         place their surface is defined — see src/styles/tokens.css. */
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(8, 6, 5, 0.5);
        backdrop-filter: blur(3px);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: auto;
        font-family: ${FONT_UI};
      }

      .modal-overlay.visible {
        opacity: 1;
      }

      .modal-dialog {
        background: rgba(22, 18, 15, 0.96);
        backdrop-filter: blur(26px) saturate(150%);
        border: 1px solid ${SURFACE.lineStrong};
        border-radius: 18px;
        width: 90%;
        max-width: 480px;
        color: ${TEXT.primary};
        box-shadow: 0 40px 100px -24px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,244,230,0.07);
        transform: scale(0.94);
        opacity: 0;
        transition: all 0.22s cubic-bezier(0.2, 0.7, 0.3, 1);
      }

      .modal-overlay.visible .modal-dialog {
        transform: scale(1);
        opacity: 1;
      }

      .modal-header {
        padding: 20px 24px 14px;
        border-bottom: 1px solid ${SURFACE.line};
      }

      .modal-title {
        margin: 0;
        color: ${TEXT.primary};
        font-size: 17px;
        font-weight: 600;
      }

      .modal-body {
        padding: 18px 24px;
        color: ${TEXT.secondary};
        font-size: 13.5px;
        line-height: 1.6;
      }

      .modal-input {
        width: 100%;
        margin-top: 12px;
        padding: 9px 11px;
        background: ${SURFACE.well};
        border: 1px solid ${SURFACE.line};
        border-radius: 8px;
        color: ${TEXT.primary};
        font-size: 13px;
        font-family: ${FONT_MONO};
        box-sizing: border-box;
      }

      .modal-input:focus {
        outline: none;
        border-color: ${withAlpha(ACCENT.base, 0.3)};
        box-shadow: 0 0 0 3px ${withAlpha(ACCENT.base, 0.1)};
      }

      .modal-footer {
        padding: 14px 24px 20px;
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        border-top: 1px solid ${SURFACE.line};
      }

      .modal-button {
        padding: 9px 18px;
        border: 1px solid ${SURFACE.line};
        border-radius: 8px;
        background: ${SURFACE.fillSoft};
        color: ${TEXT.secondary};
        font-family: inherit;
        font-size: 12.5px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
        min-width: 80px;
      }

      .modal-button:hover {
        background: ${SURFACE.hover};
        color: #ffffff;
      }

      .modal-button:active {
        transform: translateY(1px);
      }

      /* One primary and, at most, one destructive action per dialog. */
      .modal-button.primary {
        background: ${ACCENT.base};
        border-color: ${ACCENT.base};
        color: ${ACCENT.ink};
        font-weight: 600;
      }

      .modal-button.primary:hover {
        background: ${ACCENT.hover};
        border-color: ${ACCENT.hover};
        color: ${ACCENT.ink};
      }

      .modal-button.danger {
        background: ${withAlpha(SEMANTIC.error, 0.14)};
        border-color: ${withAlpha(SEMANTIC.error, 0.4)};
        color: ${SEMANTIC.error};
      }

      .modal-button.danger:hover {
        background: ${withAlpha(SEMANTIC.error, 0.24)};
        border-color: ${SEMANTIC.error};
        color: ${SEMANTIC.error};
      }

      /* Toast notification styles */
      .toast-container {
        position: fixed;
        top: 52px;
        right: 20px;
        z-index: 20000;
        pointer-events: none;
        font-family: ${FONT_UI};
      }

      .toast {
        background: rgba(22, 18, 15, 0.96);
        backdrop-filter: blur(20px);
        border: 1px solid ${SURFACE.lineStrong};
        border-radius: 12px;
        padding: 13px 16px;
        margin-bottom: 10px;
        box-shadow: 0 20px 48px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,244,230,0.06);
        color: ${TEXT.primary};
        font-size: 13px;
        pointer-events: auto;
        transform: translateX(400px);
        opacity: 0;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        max-width: 400px;
      }

      .toast.visible {
        transform: translateX(0);
        opacity: 1;
      }

      .toast.success {
        border-left: 3px solid ${SEMANTIC.success};
      }

      .toast.error {
        border-left: 3px solid ${SEMANTIC.error};
      }

      .toast.info {
        border-left: 3px solid ${ACCENT.base};
      }

      .toast.warning {
        border-left: 3px solid ${SEMANTIC.warn};
      }

      .toast-title {
        font-weight: 600;
        margin-bottom: 3px;
      }

      .toast-message {
        font-size: 12.5px;
        color: ${TEXT.secondary};
      }

      /* Progress bar modal styles */
      .progress-modal {
        background: rgba(22, 18, 15, 0.96);
        backdrop-filter: blur(26px) saturate(150%);
        border: 1px solid ${SURFACE.lineStrong};
        border-radius: 18px;
        padding: 24px;
        min-width: 400px;
        max-width: 500px;
        color: ${TEXT.primary};
        font-family: ${FONT_UI};
        box-shadow: 0 40px 100px -24px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,244,230,0.07);
      }

      .progress-title {
        color: ${TEXT.primary};
        font-size: 17px;
        font-weight: 600;
        margin: 0 0 8px 0;
      }

      .progress-message {
        color: ${TEXT.secondary};
        font-size: 13.5px;
        margin: 0 0 20px 0;
      }

      .progress-bar-container {
        width: 100%;
        height: 8px;
        background: ${SURFACE.well};
        border: 1px solid ${SURFACE.line};
        border-radius: 999px;
        overflow: hidden;
        margin-bottom: 12px;
      }

      .progress-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, ${ACCENT.deep}, ${ACCENT.base});
        border-radius: 999px;
        transition: width 0.3s ease;
        width: 0%;
      }

      .progress-bar-fill.indeterminate {
        background: linear-gradient(90deg, ${ACCENT.deep}, ${ACCENT.base}, ${ACCENT.deep});
        background-size: 200% 100%;
        animation: progress-shimmer 1.5s ease-in-out infinite;
        width: 100%;
      }

      @keyframes progress-shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      .progress-percentage {
        color: ${TEXT.tertiary};
        font-family: ${FONT_MONO};
        font-size: 11px;
        text-align: right;
        margin-top: 4px;
      }

      .progress-details {
        color: ${TEXT.faint};
        font-size: 11px;
        margin-top: 8px;
        font-family: ${FONT_MONO};
      }

      /* Actions on a progress dialog: a way out of work that is already
         running, for the jobs long enough that an artist can change their
         mind halfway through. */
      .progress-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 16px;
      }

      .progress-actions:empty {
        display: none;
      }
    `;
    document.head.appendChild(styles);
  }

  /**
   * Show an alert dialog (replaces window.alert)
   */
  async alert(message, title = 'Alert') {
    return new Promise((resolve) => {
      const modal = this.createModal({
        title,
        body: message,
        buttons: [
          { label: 'OK', primary: true, onClick: () => resolve() }
        ]
      });
      this.showModal(modal, resolve);
    });
  }

  /**
   * Show a confirmation dialog (replaces window.confirm)
   */
  async confirm(message, title = 'Confirm', options = {}) {
    const {
      confirmLabel = 'OK',
      cancelLabel = 'Cancel',
      danger = false
    } = options;

    return new Promise((resolve) => {
      const modal = this.createModal({
        title,
        body: message,
        buttons: [
          { label: cancelLabel, onClick: () => resolve(false) },
          {
            label: confirmLabel,
            primary: !danger,
            danger: danger,
            onClick: () => resolve(true)
          }
        ]
      });
      this.showModal(modal, () => resolve(false));
    });
  }

  /**
   * Show a prompt dialog (replaces window.prompt)
   */
  async prompt(message, title = 'Input', defaultValue = '', options = {}) {
    const {
      placeholder = '',
      inputType = 'text',
      validator = null
    } = options;

    return new Promise((resolve) => {
      const modal = this.createModal({
        title,
        body: message,
        // A prompt usually gates a longer flow (Publish records the animation with
        // the answers), so cancelling it has to be deliberate - Cancel or Escape,
        // never a click that happened to land beside the dialog.
        requireAction: true,
        input: {
          type: inputType,
          value: defaultValue,
          placeholder
        },
        buttons: [
          { label: 'Cancel', onClick: () => resolve(null) },
          {
            label: 'OK',
            primary: true,
            onClick: (value) => {
              if (validator) {
                const error = validator(value);
                if (error) {
                  this.toast(error, 'error', 'Validation Error');
                  return false; // Don't close modal
                }
              }
              resolve(value);
            }
          }
        ]
      });
      this.showModal(modal, () => resolve(null));
    });
  }

  /**
   * Show a custom modal with arbitrary content
   */
  async custom(config) {
    return new Promise((resolve) => {
      const modal = this.createModal(config);
      this.showModal(modal, resolve);
    });
  }

  createModal(config) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog';

    // Header
    if (config.title) {
      const header = document.createElement('div');
      header.className = 'modal-header';
      const title = document.createElement('h3');
      title.className = 'modal-title';
      title.textContent = config.title;
      header.appendChild(title);
      dialog.appendChild(header);
    }

    // Body
    const body = document.createElement('div');
    body.className = 'modal-body';

    if (typeof config.body === 'string') {
      body.textContent = config.body;
    } else if (config.body instanceof HTMLElement) {
      body.appendChild(config.body);
    }

    // Input field (for prompts)
    let input = null;
    if (config.input) {
      input = document.createElement('input');
      input.className = 'modal-input';
      input.type = config.input.type || 'text';
      input.value = config.input.value || '';
      input.placeholder = config.input.placeholder || '';
      body.appendChild(input);
    }

    // showModal focuses this once the dialog is in the document. It used to happen
    // on a 100ms timer, which left a window where the keystrokes meant for the
    // field went to the editor behind the dialog instead.
    overlay._focusTarget = input;

    dialog.appendChild(body);

    // Footer with buttons
    if (config.buttons && config.buttons.length > 0) {
      const footer = document.createElement('div');
      footer.className = 'modal-footer';

      config.buttons.forEach((btnConfig) => {
        const button = document.createElement('button');
        button.className = 'modal-button';
        if (btnConfig.primary) button.classList.add('primary');
        if (btnConfig.danger) button.classList.add('danger');
        button.textContent = btnConfig.label;

        button.onclick = () => {
          const inputValue = input ? input.value : null;
          const shouldClose = btnConfig.onClick(inputValue);
          if (shouldClose !== false) {
            this.closeModal(overlay);
          }
        };

        footer.appendChild(button);
      });

      dialog.appendChild(footer);
    }

    overlay.appendChild(dialog);

    // Click outside to close (only for non-critical modals).
    //
    // Dismiss only when the press *and* the release both land on the backdrop. A
    // drag that starts inside the dialog - selecting the text in a prompt field is
    // the common one - ends with a click event whose target is the overlay, and
    // closing on that reads as the dialog vanishing on its own.
    if (!config.requireAction) {
      let pressedOnBackdrop = false;
      overlay.addEventListener('mousedown', (e) => {
        pressedOnBackdrop = e.target === overlay;
      });
      overlay.addEventListener('click', (e) => {
        const dismiss = pressedOnBackdrop && e.target === overlay;
        pressedOnBackdrop = false;
        if (dismiss) this.closeModal(overlay);
      });
    }

    // Escape closes, Enter confirms - but only for the modal currently on top, so
    // a dialog still fading out cannot act on a keystroke meant for its successor
    // (Publish asks for FPS, then duration, back to back).
    const handleKey = (e) => {
      if (this.topModal() !== overlay) return;

      if (e.key === 'Escape') {
        this.closeModal(overlay);
      } else if (e.key === 'Enter' && config.buttons) {
        // Enter key triggers primary button
        const primaryBtn = config.buttons.find(b => b.primary);
        if (primaryBtn) {
          const inputValue = input ? input.value : null;
          const shouldClose = primaryBtn.onClick(inputValue);
          if (shouldClose !== false) {
            this.closeModal(overlay);
          }
        }
        e.preventDefault();
      }
    };

    // Keys pressed inside the dialog belong to the dialog: stop them here so the
    // editor's global shortcuts never see them. Backspace is the one that bites -
    // it deletes the selected nodes and calls preventDefault(), so without this it
    // would eat a node instead of a digit of the value being typed.
    overlay.addEventListener('keydown', (e) => {
      handleKey(e);
      e.stopPropagation();
    });

    // Fallback for modals with nothing focused inside them (alerts, confirms):
    // their keystrokes never pass through the overlay at all.
    const escHandler = (e) => {
      if (e.target instanceof Node && overlay.contains(e.target)) return;
      handleKey(e);
    };
    document.addEventListener('keydown', escHandler);

    overlay._escHandler = escHandler;

    return overlay;
  }

  showModal(modal, onClose) {
    modal._onClose = onClose;
    this.modals.push(modal);

    // Set z-index before appending to ensure it's on top of FileManager and other modals
    const zIndex = this.zIndexBase + this.modals.length;
    modal.style.zIndex = zIndex;

    document.body.appendChild(modal);

    // Focus the field as soon as it is in the document, and select what is already
    // there: the artist can type "30" straight over the suggested "60" instead of
    // reaching for Backspace to clear it first.
    const focusTarget = modal._focusTarget;
    if (focusTarget) {
      focusTarget.focus();
      try {
        focusTarget.select();
      } catch {
        // Not every input type supports selection - focus is the part that matters.
      }
    }

    // Trigger animation immediately
    requestAnimationFrame(() => {
      modal.classList.add('visible');
    });
  }

  /** The modal that currently owns the keyboard - the most recently opened one. */
  topModal() {
    return this.modals[this.modals.length - 1] || null;
  }

  /**
   * Is a dialog on screen right now (including progress dialogs)?
   *
   * The editor's global shortcuts consult this before acting on a bare keypress:
   * with a prompt open, Backspace has to edit the text in its field rather than
   * delete the selected nodes behind it. Modals that are fading out are excluded -
   * their input is already gone, and the shortcuts should not stay deaf for the
   * length of the animation.
   */
  isModalOpen() {
    return document.querySelector('.modal-overlay:not([data-closing])') !== null;
  }

  closeModal(modal) {
    if (!modal || modal._closing) return;

    modal._closing = true;
    modal.dataset.closing = 'true';

    // Leave the stack and drop the key handler now rather than after the fade: the
    // next modal in a sequence opens immediately, and it has to be the one the
    // keyboard talks to.
    const index = this.modals.indexOf(modal);
    if (index > -1) {
      this.modals.splice(index, 1);
    }
    if (modal._escHandler) {
      document.removeEventListener('keydown', modal._escHandler);
    }

    modal.classList.remove('visible');

    setTimeout(() => {
      if (modal.parentElement) {
        modal.parentElement.removeChild(modal);
      }

      // Call onClose callback
      if (modal._onClose) {
        modal._onClose();
      }
    }, 300);
  }

  /**
   * Show a progress bar modal
   * Returns an object with methods to update progress
   *
   * `options.actions` adds buttons under the bar - `[{ label, onClick, variant,
   * closeOnClick }]`. A job the user can abandon halfway (a two-minute video
   * recording, say) needs somewhere to say so; without one the only exit from a
   * long export is reloading the page and losing the patch.
   */
  showProgress(title = 'Processing...', initialMessage = '', options = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.pointerEvents = 'auto';

    const modal = document.createElement('div');
    modal.className = 'progress-modal';

    const titleEl = document.createElement('div');
    titleEl.className = 'progress-title';
    titleEl.textContent = title;

    const messageEl = document.createElement('div');
    messageEl.className = 'progress-message';
    messageEl.textContent = initialMessage;

    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-bar-container';

    const progressFill = document.createElement('div');
    progressFill.className = 'progress-bar-fill indeterminate';

    const percentageEl = document.createElement('div');
    percentageEl.className = 'progress-percentage';
    percentageEl.textContent = '';

    const detailsEl = document.createElement('div');
    detailsEl.className = 'progress-details';
    detailsEl.textContent = '';

    const actionsEl = document.createElement('div');
    actionsEl.className = 'progress-actions';

    const actionButtons = new Map();
    (options.actions || []).forEach((action) => {
      if (!action?.label) return;
      const button = document.createElement('button');
      button.className = `modal-button${action.variant ? ` ${action.variant}` : ''}`;
      button.textContent = action.label;
      button.addEventListener('click', () => {
        // A long job's button is easy to double-press. Disabling on the first
        // click means "stop" cannot be asked for twice and land as two stops.
        if (action.once !== false) button.disabled = true;
        try {
          action.onClick?.();
        } catch (err) {
          console.warn('[ModalManager] progress action failed:', err);
        }
      });
      actionsEl.appendChild(button);
      actionButtons.set(action.id || action.label, button);
    });

    progressContainer.appendChild(progressFill);
    modal.appendChild(titleEl);
    modal.appendChild(messageEl);
    modal.appendChild(progressContainer);
    modal.appendChild(percentageEl);
    modal.appendChild(detailsEl);
    modal.appendChild(actionsEl);
    overlay.appendChild(modal);

    // Set z-index
    const zIndex = this.zIndexBase + this.modals.length + 1;
    overlay.style.zIndex = zIndex;

    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(() => {
      overlay.classList.add('visible');
    });

    // Return control object
    return {
      update: (progress, message, details) => {
        if (typeof progress === 'number') {
          const clamped = Math.max(0, Math.min(100, progress));
          progressFill.classList.remove('indeterminate');
          progressFill.style.width = `${clamped}%`;
          percentageEl.textContent = `${Math.round(clamped)}%`;
        } else {
          // Indeterminate mode
          progressFill.classList.add('indeterminate');
          percentageEl.textContent = '';
        }

        if (message !== undefined) {
          messageEl.textContent = message;
        }

        if (details !== undefined) {
          detailsEl.textContent = details;
        }
      },
      close: () => {
        // Marks it as no longer blocking for isModalOpen(), which the editor's
        // global shortcuts consult - they should come back as the dialog starts
        // fading, not 300ms later.
        overlay.dataset.closing = 'true';
        overlay.classList.remove('visible');
        setTimeout(() => {
          if (overlay.parentElement) {
            overlay.parentElement.removeChild(overlay);
          }
        }, 300);
      },
      setIndeterminate: (indeterminate) => {
        if (indeterminate) {
          progressFill.classList.add('indeterminate');
          percentageEl.textContent = '';
        } else {
          progressFill.classList.remove('indeterminate');
        }
      },
      /**
       * Retire an action once it can no longer do anything - the recording it
       * would have stopped has stopped on its own, and a live-looking button
       * that does nothing is worse than no button.
       */
      setActionEnabled: (id, enabled) => {
        const button = actionButtons.get(id);
        if (button) button.disabled = !enabled;
      },
      setActionLabel: (id, label) => {
        const button = actionButtons.get(id);
        if (button) button.textContent = label;
      }
    };
  }

  /**
   * Show a toast notification (non-blocking)
   */
  toast(message, type = 'info', title = null) {
    // Create container if it doesn't exist
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    if (title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'toast-title';
      titleEl.textContent = title;
      toast.appendChild(titleEl);
    }

    const messageEl = document.createElement('div');
    messageEl.className = 'toast-message';
    messageEl.textContent = message;
    toast.appendChild(messageEl);

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.add('visible');
    });

    // Auto-remove after delay
    const duration = type === 'error' ? 5000 : 3000;
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => {
        if (toast.parentElement) {
          toast.parentElement.removeChild(toast);
        }
      }, 300);
    }, duration);
  }
}

// Create singleton instance
export const modalManager = new ModalManager();
