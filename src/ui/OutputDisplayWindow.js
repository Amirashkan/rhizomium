// src/ui/OutputDisplayWindow.js
import { makeDraggable } from './utils/draggable.js';

export class OutputDisplayWindow {
  constructor(options = {}) {
    this.onClose = options.onClose || (() => {});
    this.onLaunchExternalViewer = options.onLaunchExternalViewer || (() => {});

    this.overlay = null;
    this.keyHandler = null;
    this.cleanupDraggable = null;
  }

  show() {
    if (this.overlay) {
      return true;
    }

    this.render();
    return true;
  }

  hide() {
    if (!this.overlay) {
      return;
    }

    if (this.cleanupDraggable) {
      this.cleanupDraggable();
      this.cleanupDraggable = null;
    }

    this.overlay.classList.remove("visible");
    if (this.keyHandler) {
      document.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }

    setTimeout(() => {
      this.overlay?.remove();
      this.overlay = null;
      this.onClose();
    }, 180);
  }

  render() {
    this.addStyles();

    this.overlay = document.createElement("div");
    this.overlay.className = "output-display-overlay";
    this.overlay.innerHTML = this.getTemplate();
    document.body.appendChild(this.overlay);

    // Make dialog draggable by its header
    const dialog = this.overlay.querySelector('.output-display-dialog');
    const header = this.overlay.querySelector('.output-display-header');
    if (dialog && header) {
      this.cleanupDraggable = makeDraggable(dialog, header);
    }

    requestAnimationFrame(() => {
      this.overlay?.classList.add("visible");
    });

    this.attachEventHandlers();
  }

  addStyles() {
    if (document.getElementById("output-display-window-styles")) return;

    const styles = document.createElement("style");
    styles.id = "output-display-window-styles";
    styles.textContent = `
      .output-display-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(8px);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      .output-display-overlay.visible {
        opacity: 1;
      }

      .output-display-dialog {
        background: linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%);
        border-radius: 12px;
        border: 1px solid #444;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        max-width: 700px;
        width: 90%;
        max-height: 85vh;
        overflow-y: auto;
        animation: slideIn 0.3s ease;
      }

      @keyframes slideIn {
        from {
          transform: translateY(-20px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }

      .output-display-header {
        padding: 24px 32px 20px;
        text-align: center;
        border-bottom: 1px solid #333;
        cursor: move;
      }

      .output-display-header h1 {
        margin: 0 0 8px 0;
        font-size: 28px;
        font-weight: 700;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .output-display-header p {
        margin: 0;
        color: #aaa;
        font-size: 14px;
        line-height: 1.5;
      }

      .output-display-content {
        padding: 24px 32px 32px;
      }

      .output-display-placeholder {
        background: #222;
        border: 1px solid #333;
        border-radius: 8px;
        padding: 24px;
        margin-bottom: 20px;
        min-height: 200px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #666;
        font-size: 14px;
        text-align: center;
      }

      .output-display-actions {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .output-display-button {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border: 1px solid #667eea;
        border-radius: 8px;
        color: white;
        padding: 14px 24px;
        font-size: 15px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        text-align: center;
      }

      .output-display-button:hover {
        background: linear-gradient(135deg, #7a8ef0 0%, #8a5bb2 100%);
        box-shadow: 0 4px 16px rgba(102, 126, 234, 0.4);
        transform: translateY(-1px);
      }

      .output-display-button:active {
        transform: translateY(0);
      }

      .output-display-close {
        position: absolute;
        top: 16px;
        right: 16px;
        width: 32px;
        height: 32px;
        border: none;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 6px;
        color: #aaa;
        font-size: 20px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
      }

      .output-display-close:hover {
        background: rgba(255, 255, 255, 0.2);
        color: white;
      }

      .output-display-dialog {
        position: relative;
      }
    `;
    document.head.appendChild(styles);
  }

  getTemplate() {
    return `
      <div class="output-display-dialog">
        <button class="output-display-close" aria-label="Close">×</button>
        <div class="output-display-header">
          <h1>Output Display</h1>
          <p>Configure and manage output display settings</p>
        </div>
        <div class="output-display-content">
          <div class="output-display-placeholder">
            <div>
              <p style="margin: 0 0 8px 0; font-size: 16px; color: #888;">Output Display</p>
              <p style="margin: 0; font-size: 13px; color: #555;">Placeholder content will be added here</p>
            </div>
          </div>
          <div class="output-display-actions">
            <button class="output-display-button" id="btn-launch-external-viewer">
              Open External Viewer
            </button>
          </div>
        </div>
      </div>
    `;
  }

  attachEventHandlers() {
    // Close button
    const closeBtn = this.overlay.querySelector('.output-display-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.hide();
      });
    }

    // Launch external viewer button
    const launchBtn = this.overlay.querySelector('#btn-launch-external-viewer');
    if (launchBtn) {
      launchBtn.addEventListener('click', async () => {
        if (this.onLaunchExternalViewer) {
          await this.onLaunchExternalViewer();
        }
      });
    }

    // Close on Escape key
    this.keyHandler = (e) => {
      if (e.key === 'Escape') {
        this.hide();
      }
    };
    document.addEventListener('keydown', this.keyHandler);

    // Close on overlay click (outside dialog)
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.hide();
      }
    });
  }
}

