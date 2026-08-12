// src/ui/WelcomeWindow.js
import { makeDraggable } from './utils/draggable.js';
import { ACCENT, SURFACE, TEXT, FONT_MONO, FONT_UI, withAlpha } from '../core/theme.js';

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
    } catch {

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
    } catch {

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
      } catch {

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
    } catch {

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
      /* The launch stage: a soft aurora over the app ground with the dot grid
         from the canvas, so opening the app already looks like the app. */
      .welcome-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background:
          radial-gradient(50% 60% at 22% 20%, rgba(167,139,250,0.24), transparent 55%),
          radial-gradient(50% 60% at 82% 78%, rgba(207,100,153,0.20), transparent 55%),
          radial-gradient(46% 56% at 60% 30%, rgba(198,242,78,0.08), transparent 55%),
          radial-gradient(rgba(255,240,220,0.05) 1px, transparent 1px) 0 0/22px 22px,
          rgba(10, 8, 7, 0.92);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.2s ease;
        font-family: ${FONT_UI};
      }

      .welcome-overlay.visible {
        opacity: 1;
      }

      .welcome-dialog {
        background: rgba(22, 18, 15, 0.92);
        backdrop-filter: blur(26px) saturate(150%);
        border-radius: 18px;
        border: 1px solid ${SURFACE.lineStrong};
        box-shadow: 0 40px 100px -24px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,244,230,0.07);
        color: ${TEXT.primary};
        max-width: 600px;
        width: 90%;
        max-height: 85vh;
        overflow-y: auto;
        animation: slideIn 0.3s ease;
        scrollbar-width: thin;
        scrollbar-color: rgba(198,242,78,0.32) transparent;
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
        border-bottom: 1px solid ${SURFACE.line};
      }

      .beta-tag {
        display: inline-block;
        background: ${withAlpha(ACCENT.base, 0.14)};
        border: 1px solid ${withAlpha(ACCENT.base, 0.3)};
        color: ${ACCENT.base};
        padding: 3px 10px;
        border-radius: 999px;
        font-family: ${FONT_MONO};
        font-size: 10px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 12px;
      }

      .welcome-header h1 {
        margin: 0 0 12px 0;
        font-size: 28px;
        font-weight: 700;
        letter-spacing: 0.2px;
        color: ${TEXT.primary};
      }

      .welcome-header p {
        margin: 0;
        color: ${TEXT.tertiary};
        font-size: 14px;
        line-height: 1.5;
      }

      .welcome-content {
        padding: 24px 32px;
      }

      .welcome-actions {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 24px;
      }

      .welcome-action {
        background: ${SURFACE.fillSoft};
        border: 1px solid ${SURFACE.line};
        border-radius: 11px;
        color: #ece5da;
        padding: 13px 15px;
        font-family: inherit;
        font-size: 13.5px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        text-align: left;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }

      .welcome-action:hover {
        background: ${SURFACE.hover};
        border-color: ${withAlpha(ACCENT.base, 0.4)};
      }

      .welcome-action:active {
        transform: translateY(1px);
      }

      .welcome-action:focus-visible,
      .welcome-close:focus-visible,
      .backup-restore-btn:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px ${withAlpha(ACCENT.base, 0.35)};
      }

      /* Exactly one primary action, and it is the only lime surface here. */
      .welcome-action.primary {
        background: radial-gradient(120% 120% at 0 0, ${ACCENT.base}, ${ACCENT.deep});
        border-color: transparent;
        color: ${ACCENT.ink};
        box-shadow: 0 0 24px ${withAlpha(ACCENT.base, 0.3)};
      }

      .welcome-action.primary:hover {
        background: radial-gradient(120% 120% at 0 0, ${ACCENT.hover}, ${ACCENT.base});
        border-color: transparent;
      }

      .action-sub {
        font-size: 10.5px;
        opacity: 0.7;
        font-weight: 400;
      }

      .welcome-section {
        background: ${SURFACE.well};
        border: 1px solid ${SURFACE.line};
        border-radius: 11px;
        padding: 16px;
        margin-bottom: 16px;
      }

      .welcome-section.subtle {
        background: transparent;
        border: 1px dashed ${SURFACE.lineStrong};
        color: ${TEXT.tertiary};
        font-size: 13px;
        text-align: center;
        padding: 20px;
      }

      .section-title {
        font-size: 10px;
        font-weight: 600;
        color: ${TEXT.faint};
        text-transform: uppercase;
        letter-spacing: 1.4px;
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
        padding: 9px 10px;
        background: ${SURFACE.fillSoft};
        border: 1px solid ${SURFACE.line};
        border-radius: 10px;
        margin-bottom: 8px;
      }

      .welcome-backup-list li:last-child {
        margin-bottom: 0;
      }

      .backup-title {
        flex: 1;
        font-size: 13px;
        color: ${TEXT.primary};
      }

      .backup-age {
        font-size: 10.5px;
        font-family: ${FONT_MONO};
        color: ${TEXT.tertiary};
      }

      .backup-restore-btn {
        background: ${SURFACE.fillSoft};
        border: 1px solid ${SURFACE.line};
        color: ${TEXT.secondary};
        padding: 5px 11px;
        border-radius: 7px;
        font-family: inherit;
        font-size: 11.5px;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .backup-restore-btn:hover {
        background: ${SURFACE.hover};
        color: #ffffff;
      }

      .welcome-footer {
        padding: 16px 32px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-top: 1px solid ${SURFACE.line};
      }

      .welcome-pref {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        color: ${TEXT.faint};
        cursor: pointer;
        user-select: none;
      }

      .welcome-pref input[type="checkbox"] {
        cursor: pointer;
        width: 15px;
        height: 15px;
        accent-color: ${ACCENT.base};
      }

      .welcome-close {
        background: ${SURFACE.fillSoft};
        border: 1px solid ${SURFACE.line};
        color: ${TEXT.secondary};
        padding: 9px 20px;
        border-radius: 8px;
        font-family: inherit;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .welcome-close:hover {
        background: ${SURFACE.hover};
        color: #ffffff;
      }

      .welcome-close:active {
        transform: translateY(1px);
      }

      /* Tips section */
      .welcome-tips {
        background: ${SURFACE.well};
        border: 1px solid ${SURFACE.line};
        border-radius: 11px;
        padding: 16px;
        margin-top: 16px;
      }

      .welcome-tips h3 {
        margin: 0 0 12px 0;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 1.4px;
        text-transform: uppercase;
        color: ${TEXT.faint};
      }

      .welcome-tips ul {
        margin: 0;
        padding-left: 18px;
        color: ${TEXT.secondary};
      }

      .welcome-tips li {
        font-size: 12.5px;
        line-height: 1.6;
        margin-bottom: 6px;
      }

      .welcome-tips li:last-child {
        margin-bottom: 0;
      }

      /* Scrollbar styling */
      .welcome-dialog::-webkit-scrollbar {
        width: 9px;
      }

      .welcome-dialog::-webkit-scrollbar-track {
        background: transparent;
        margin: 4px 0;
      }

      .welcome-dialog::-webkit-scrollbar-thumb {
        background: linear-gradient(rgba(198,242,78,0.30), rgba(198,242,78,0.18));
        border-radius: 999px;
        border: 2px solid transparent;
        background-clip: padding-box;
      }

      .welcome-dialog::-webkit-scrollbar-thumb:hover {
        background: linear-gradient(rgba(198,242,78,0.5), rgba(198,242,78,0.32));
        background-clip: padding-box;
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
            <button class="welcome-action${this.state.hasAutosave ? "" : " primary"}" data-action="new">
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
    } catch {

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
    } catch {

    }
  }

  maybeCreateStartupBackup() {
    if (this.state.hasAutosave && this.saveLoadManager?.createBackup) {
      try {
        this.saveLoadManager.createBackup("startup");
      } catch {

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
    } catch {

    }
  }
}
