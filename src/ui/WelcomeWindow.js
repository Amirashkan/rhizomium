// src/ui/WelcomeWindow.js
import { makeDraggable } from './utils/draggable.js';

export class WelcomeWindow {
  constructor(options = {}) {
    this.saveLoadManager = options.saveLoadManager || null;
    this.onNewProject = options.onNewProject || (() => {});
    this.onOpenProject = options.onOpenProject || (() => {});
    this.onOpenBackups = options.onOpenBackups || (() => {});
    this.onShowDocs = options.onShowDocs || null;
    this.onClose = options.onClose || (() => {});
    this.storageKey = options.storageKey || "rhizomium.welcome.dismissed";

    this.overlay = null;
    this.neverShowAgain = false;
    this.keyHandler = null;
    this.cleanupDraggable = null;
    this.state = {
      hasAutosave: false,
      autosaveAgeText: null,
      backups: [],
    };
  }

  shouldShow() {
    try {
      return localStorage.getItem(this.storageKey) !== "true";
    } catch (error) {

      return true;
    }
  }

  show({ force = false } = {}) {
    if (this.overlay) {
      return true;
    }

    if (!force && !this.shouldShow()) {
      return false;
    }

    // Render immediately with what we have; backups load async from
    // IndexedDB and the list is filled in when they arrive
    this.state = this.collectState();
    this.render();
    this.loadBackups();
    return true;
  }

  async loadBackups() {
    if (!this.saveLoadManager?.getBackups) {
      return;
    }
    try {
      const backups = await this.saveLoadManager.getBackups();
      if (!this.overlay || backups.length === 0) {
        return;
      }
      this.state.backups = backups.slice(0, 3);
      this.renderBackupList();
    } catch (error) {

    }
  }

  renderBackupList() {
    const tips = this.overlay?.querySelector(".welcome-tips");
    if (!tips || this.state.backups.length === 0) {
      return;
    }

    this.overlay.querySelector(".welcome-section")?.remove();

    const section = document.createElement("div");
    section.className = "welcome-section";
    section.innerHTML = `
      <div class="section-title">Recent Backups</div>
      <ul class="welcome-backup-list">
        ${this.state.backups
          .map(
            (backup) => `
          <li>
            <span class="backup-title">${backup.reason || "Backup"}</span>
            <span class="backup-age">${this.relativeBackupTime(
              backup.timestamp,
            )}</span>
            <button class="backup-restore-btn" data-backup="${
              backup.id
            }">Restore</button>
          </li>
        `,
          )
          .join("")}
      </ul>
    `;
    tips.parentNode.insertBefore(section, tips);

    section.querySelectorAll(".backup-restore-btn").forEach((button) =>
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const backupId = event.currentTarget.dataset.backup;
        if (backupId) {
          this.restoreBackup(backupId);
        }
      }),
    );
  }

  hide(commitPreference = true) {
    if (!this.overlay) {
      return;
    }

    if (commitPreference) {
      this.persistPreference();
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

  collectState() {
    const autosaveEntry = this.readAutosaveEntry();
    const hasAutosave = !!(
      autosaveEntry &&
      autosaveEntry.data &&
      Array.isArray(autosaveEntry.data.nodes) &&
      autosaveEntry.data.nodes.length > 0
    );

    let autosaveAgeText = null;
    if (hasAutosave && typeof autosaveEntry.timestamp === "number") {
      try {
        const age = Date.now() - autosaveEntry.timestamp;
        autosaveAgeText = this.formatAge(age);
      } catch (error) {

      }
    }

    return {
      hasAutosave,
      autosaveAgeText,
      backups: [],
    };
  }

  readAutosaveEntry() {
    const key =
      this.saveLoadManager?.autosaveKey || "rhizomium.autosave.v2";
    try {
      const stored = localStorage.getItem(key);
      if (!stored) {
        return null;
      }
      return JSON.parse(stored);
    } catch (error) {

      return null;
    }
  }

  formatAge(ms) {
    if (this.saveLoadManager?.formatAge) {
      return this.saveLoadManager.formatAge(ms);
    }

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d`;
    }
    if (hours > 0) {
      return `${hours}h`;
    }
    if (minutes > 0) {
      return `${minutes}m`;
    }
    return `${seconds}s`;
  }

  render() {
    this.addStyles();

    this.overlay = document.createElement("div");
    this.overlay.className = "welcome-overlay";
    this.overlay.innerHTML = this.getTemplate();
    document.body.appendChild(this.overlay);

    // Make dialog draggable by its header
    const dialog = this.overlay.querySelector('.welcome-dialog');
    const header = this.overlay.querySelector('.welcome-header');
    if (dialog && header) {
      this.cleanupDraggable = makeDraggable(dialog, header);
    }

    requestAnimationFrame(() => {
      this.overlay?.classList.add("visible");
    });

    this.attachEventHandlers();
  }

  addStyles() {
    if (document.getElementById("welcome-window-styles")) return;

    const styles = document.createElement("style");
    styles.id = "welcome-window-styles";
    styles.textContent = `
      .welcome-overlay {
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

      .welcome-overlay.visible {
        opacity: 1;
      }

      .welcome-dialog {
        background: linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%);
        border-radius: 12px;
        border: 1px solid #444;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        max-width: 600px;
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

      .welcome-header {
        padding: 32px 32px 24px;
        text-align: center;
        border-bottom: 1px solid #333;
      }

      .beta-tag {
        display: inline-block;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 4px 12px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 12px;
      }

      .welcome-header h1 {
        margin: 0 0 12px 0;
        font-size: 32px;
        font-weight: 700;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .welcome-header p {
        margin: 0;
        color: #aaa;
        font-size: 15px;
        line-height: 1.5;
      }

      .welcome-content {
        padding: 24px 32px;
      }

      .welcome-actions {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 24px;
      }

      .welcome-action {
        background: #2a2a2a;
        border: 1px solid #444;
        border-radius: 8px;
        color: white;
        padding: 16px 20px;
        font-size: 15px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        text-align: left;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .welcome-action:hover {
        background: #333;
        border-color: #667eea;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
      }

      .welcome-action:active {
        transform: translateY(0);
      }

      .welcome-action.primary {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-color: #667eea;
      }

      .welcome-action.primary:hover {
        background: linear-gradient(135deg, #7a8ef0 0%, #8a5bb2 100%);
        box-shadow: 0 4px 16px rgba(102, 126, 234, 0.4);
      }

      .action-sub {
        font-size: 13px;
        opacity: 0.8;
        font-weight: 400;
      }

      .welcome-section {
        background: #222;
        border: 1px solid #333;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 16px;
      }

      .welcome-section.subtle {
        background: transparent;
        border: 1px dashed #333;
        color: #888;
        font-size: 13px;
        text-align: center;
        padding: 20px;
      }

      .section-title {
        font-size: 13px;
        font-weight: 600;
        color: #aaa;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 12px;
      }

      .welcome-backup-list {
        list-style: none;
        padding: 0;
        margin: 0;
      }

      .welcome-backup-list li {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px;
        background: #1a1a1a;
        border: 1px solid #333;
        border-radius: 6px;
        margin-bottom: 8px;
      }

      .welcome-backup-list li:last-child {
        margin-bottom: 0;
      }

      .backup-title {
        flex: 1;
        font-size: 14px;
        color: white;
      }

      .backup-age {
        font-size: 12px;
        color: #888;
      }

      .backup-restore-btn {
        background: #667eea;
        border: none;
        color: white;
        padding: 6px 12px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .backup-restore-btn:hover {
        background: #7a8ef0;
      }

      .welcome-footer {
        padding: 16px 32px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-top: 1px solid #333;
      }

      .welcome-pref {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: #aaa;
        cursor: pointer;
        user-select: none;
      }

      .welcome-pref input[type="checkbox"] {
        cursor: pointer;
        width: 16px;
        height: 16px;
      }

      .welcome-close {
        background: #667eea;
        border: none;
        color: white;
        padding: 10px 24px;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .welcome-close:hover {
        background: #7a8ef0;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
      }

      .welcome-close:active {
        transform: translateY(0);
      }

      /* Tips section */
      .welcome-tips {
        background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
        border: 1px solid rgba(102, 126, 234, 0.3);
        border-radius: 8px;
        padding: 16px;
        margin-top: 16px;
      }

      .welcome-tips h3 {
        margin: 0 0 12px 0;
        font-size: 14px;
        font-weight: 600;
        color: #667eea;
      }

      .welcome-tips ul {
        margin: 0;
        padding-left: 20px;
        color: #aaa;
      }

      .welcome-tips li {
        font-size: 13px;
        line-height: 1.6;
        margin-bottom: 6px;
      }

      .welcome-tips li:last-child {
        margin-bottom: 0;
      }

      /* Scrollbar styling */
      .welcome-dialog::-webkit-scrollbar {
        width: 8px;
      }

      .welcome-dialog::-webkit-scrollbar-track {
        background: #1a1a1a;
      }

      .welcome-dialog::-webkit-scrollbar-thumb {
        background: #444;
        border-radius: 4px;
      }

      .welcome-dialog::-webkit-scrollbar-thumb:hover {
        background: #555;
      }
    `;
    document.head.appendChild(styles);
  }

  getTemplate() {
    const autosaveButton = this.state.hasAutosave
      ? `
        <button class="welcome-action primary" data-action="continue">
          Continue Last Session
          ${
            this.state.autosaveAgeText
              ? `<span class="action-sub">${this.state.autosaveAgeText} ago</span>`
              : ""
          }
        </button>
      `
      : "";

    const backupList =
      this.state.backups.length > 0
        ? `
        <div class="welcome-section">
          <div class="section-title">Recent Backups</div>
          <ul class="welcome-backup-list">
            ${this.state.backups
              .map(
                (backup) => `
              <li>
                <span class="backup-title">${backup.reason || "Backup"}</span>
                <span class="backup-age">${this.relativeBackupTime(
                  backup.timestamp,
                )}</span>
                <button class="backup-restore-btn" data-backup="${
                  backup.id
                }">Restore</button>
              </li>
            `,
              )
              .join("")}
          </ul>
        </div>
      `
        : `
        <div class="welcome-section subtle">
          Backups are created automatically while you work. You can manage them from the menu later.
        </div>
      `;

    const docsButton = this.onShowDocs
      ? `<button class="welcome-action" data-action="docs">Open Documentation</button>`
      : "";

    return `
      <div class="welcome-dialog" role="dialog" aria-modal="true">
        <div class="welcome-header">
          <div class="beta-tag">Beta</div>
          <h1>Welcome to Rhizomium</h1>
          <p>Build procedural textures with a fast, WebGPU-powered node editor.</p>
        </div>
        <div class="welcome-content">
          <div class="welcome-actions">
            ${autosaveButton}
            <button class="welcome-action" data-action="new">
              Start New Graph
            </button>
            <button class="welcome-action" data-action="open">
              Open Project File
            </button>
            <button class="welcome-action" data-action="backups">
              Manage Backups
            </button>
            ${docsButton}
          </div>
          ${backupList}
          <div class="welcome-tips">
            <h3>Quick Tips</h3>
            <ul>
              <li><strong>Create Nodes:</strong> Right-click on canvas or press Cmd+Space to open the node menu</li>
              <li><strong>Connect Nodes:</strong> Drag from output pins to input pins. Drag works both ways!</li>
              <li><strong>Move Around:</strong> Pan with middle mouse button or Space+Drag</li>
              <li><strong>Undo/Redo:</strong> Use Cmd+Z / Cmd+Y or the History buttons</li>
              <li><strong>Auto-Save:</strong> Your work is automatically saved in the browser</li>
              <li><strong>Backups:</strong> Automatic backups are created as you work</li>
            </ul>
          </div>
        </div>
        <div class="welcome-footer">
          <label class="welcome-pref">
            <input type="checkbox" id="welcome-hide-checkbox" />
            Don't show this again
          </label>
          <button class="welcome-close" data-action="close">Get Started</button>
        </div>
      </div>
    `;
  }

  attachEventHandlers() {
    if (!this.overlay) {
      return;
    }

    this.overlay
      .querySelectorAll("[data-action]")
      .forEach((button) =>
        button.addEventListener("click", (event) => {
          const { action } = event.currentTarget.dataset;
          this.handleAction(action, event);
        }),
      );

    this.overlay
      .querySelectorAll(".backup-restore-btn")
      .forEach((button) =>
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          const backupId = event.currentTarget.dataset.backup;
          if (backupId) {
            this.restoreBackup(backupId);
          }
        }),
      );

    const checkbox = this.overlay.querySelector("#welcome-hide-checkbox");
    if (checkbox) {
      checkbox.addEventListener("change", (event) => {
        this.neverShowAgain = event.target.checked;
      });
    }

    this.keyHandler = (event) => {
      if (event.key === "Escape") {
        this.hide();
      }
    };
    document.addEventListener("keydown", this.keyHandler);

    const focusTarget =
      this.overlay.querySelector(".welcome-action") ||
      this.overlay.querySelector(".welcome-close");
    focusTarget?.focus?.();
  }

  async handleAction(action, event) {
    switch (action) {
      case "continue":
        await this.restoreAutosave();
        this.hide();
        break;
      case "new":
        this.onNewProject();
        this.maybeCreateStartupBackup();
        this.hide();
        break;
      case "open":
        this.onOpenProject();
        this.maybeCreateStartupBackup();
        this.hide();
        break;
      case "backups":
        this.onOpenBackups();
        this.hide();
        break;
      case "docs":
        if (this.onShowDocs) {
          this.onShowDocs();
        }
        this.hide(false);
        break;
      case "close":
        this.hide();
        break;
      default:
        break;
    }

    event.preventDefault();
  }

  async restoreAutosave() {
    if (!this.saveLoadManager?.loadFromLocal) {
      return false;
    }
    try {
      return await this.saveLoadManager.loadFromLocal();
    } catch (error) {

      return false;
    }
  }

  async restoreBackup(backupId) {
    if (!this.saveLoadManager?.restoreBackup) {
      return;
    }
    try {
      await this.saveLoadManager.restoreBackup(backupId);
      this.hide();
    } catch (error) {

    }
  }

  maybeCreateStartupBackup() {
    if (this.state.hasAutosave && this.saveLoadManager?.createBackup) {
      try {
        this.saveLoadManager.createBackup("startup");
      } catch (error) {

      }
    }
  }

  relativeBackupTime(timestamp) {
    if (!timestamp) {
      return "";
    }

    const age = Date.now() - timestamp;
    const formatted = this.formatAge(age);
    const locale = new Date(timestamp).toLocaleString();
    return `${formatted} ago · ${locale}`;
  }

  persistPreference() {
    try {
      if (this.neverShowAgain) {
        localStorage.setItem(this.storageKey, "true");
      } else {
        localStorage.removeItem(this.storageKey);
      }
    } catch (error) {

    }
  }
}
