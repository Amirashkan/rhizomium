/**
 * ModalManager.js - Unified in-app modal/dialog system
 * Replaces browser-native alert(), confirm(), and prompt() with custom UI
 */

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
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: auto;
      }

      .modal-overlay.visible {
        opacity: 1;
      }

      .modal-dialog {
        background: rgba(28, 28, 30, 0.98);
        backdrop-filter: blur(20px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        width: 90%;
        max-width: 480px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
        transform: scale(0.9) translateY(-20px);
        opacity: 0;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .modal-overlay.visible .modal-dialog {
        transform: scale(1) translateY(0);
        opacity: 1;
      }

      .modal-header {
        padding: 20px 24px 16px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }

      .modal-title {
        margin: 0;
        color: #ffffff;
        font-size: 18px;
        font-weight: 600;
      }

      .modal-body {
        padding: 20px 24px;
        color: rgba(255, 255, 255, 0.9);
        font-size: 14px;
        line-height: 1.6;
      }

      .modal-input {
        width: 100%;
        margin-top: 12px;
        padding: 10px 12px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        color: #fff;
        font-size: 14px;
        font-family: inherit;
        box-sizing: border-box;
      }

      .modal-input:focus {
        outline: none;
        border-color: #007AFF;
        background: rgba(255, 255, 255, 0.08);
      }

      .modal-footer {
        padding: 16px 24px 20px;
        display: flex;
        gap: 12px;
        justify-content: flex-end;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
      }

      .modal-button {
        padding: 10px 20px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        background: rgba(58, 58, 62, 0.6);
        color: #ffffff;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
        min-width: 80px;
      }

      .modal-button:hover {
        background: rgba(74, 74, 78, 0.8);
        border-color: rgba(255, 255, 255, 0.3);
        transform: translateY(-1px);
      }

      .modal-button:active {
        transform: translateY(0);
      }

      .modal-button.primary {
        background: #007AFF;
        border-color: #007AFF;
      }

      .modal-button.primary:hover {
        background: #0056CC;
        border-color: #0056CC;
      }

      .modal-button.danger {
        background: #FF453A;
        border-color: #FF453A;
      }

      .modal-button.danger:hover {
        background: #CC231A;
        border-color: #CC231A;
      }

      /* Toast notification styles */
      .toast-container {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 20000;
        pointer-events: none;
      }

      .toast {
        background: rgba(28, 28, 30, 0.98);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 16px 20px;
        margin-bottom: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        color: #fff;
        font-size: 14px;
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
        border-left: 3px solid #34C759;
      }

      .toast.error {
        border-left: 3px solid #FF453A;
      }

      .toast.info {
        border-left: 3px solid #007AFF;
      }

      .toast.warning {
        border-left: 3px solid #FF9F0A;
      }

      .toast-title {
        font-weight: 600;
        margin-bottom: 4px;
      }

      .toast-message {
        font-size: 13px;
        opacity: 0.9;
      }

      /* Progress bar modal styles */
      .progress-modal {
        background: rgba(28, 28, 30, 0.98);
        backdrop-filter: blur(20px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 24px;
        min-width: 400px;
        max-width: 500px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
      }

      .progress-title {
        color: #ffffff;
        font-size: 18px;
        font-weight: 600;
        margin: 0 0 8px 0;
      }

      .progress-message {
        color: rgba(255, 255, 255, 0.8);
        font-size: 14px;
        margin: 0 0 20px 0;
      }

      .progress-bar-container {
        width: 100%;
        height: 8px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 12px;
      }

      .progress-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, #007AFF, #0056CC);
        border-radius: 4px;
        transition: width 0.3s ease;
        width: 0%;
      }

      .progress-bar-fill.indeterminate {
        background: linear-gradient(90deg, #007AFF, #0056CC, #007AFF);
        background-size: 200% 100%;
        animation: progress-shimmer 1.5s ease-in-out infinite;
        width: 100%;
      }

      @keyframes progress-shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      .progress-percentage {
        color: rgba(255, 255, 255, 0.6);
        font-size: 12px;
        text-align: right;
        margin-top: 4px;
      }

      .progress-details {
        color: rgba(255, 255, 255, 0.5);
        font-size: 12px;
        margin-top: 8px;
        font-family: monospace;
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

      // Focus input after a brief delay
      setTimeout(() => input.focus(), 100);
    }

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

    // Click outside to close (only for non-critical modals)
    if (!config.requireAction) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          this.closeModal(overlay);
        }
      });
    }

    // ESC to close
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        this.closeModal(overlay);
        document.removeEventListener('keydown', escHandler);
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

    // Trigger animation immediately
    requestAnimationFrame(() => {
      modal.classList.add('visible');
    });
  }

  closeModal(modal) {
    if (!modal) return;

    modal.classList.remove('visible');

    setTimeout(() => {
      if (modal.parentElement) {
        modal.parentElement.removeChild(modal);
      }

      // Clean up escape handler
      if (modal._escHandler) {
        document.removeEventListener('keydown', modal._escHandler);
      }

      // Call onClose callback
      if (modal._onClose) {
        modal._onClose();
      }

      // Remove from modals array
      const index = this.modals.indexOf(modal);
      if (index > -1) {
        this.modals.splice(index, 1);
      }
    }, 300);
  }

  /**
   * Show a progress bar modal
   * Returns an object with methods to update progress
   */
  showProgress(title = 'Processing...', initialMessage = '') {
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

    progressContainer.appendChild(progressFill);
    modal.appendChild(titleEl);
    modal.appendChild(messageEl);
    modal.appendChild(progressContainer);
    modal.appendChild(percentageEl);
    modal.appendChild(detailsEl);
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
