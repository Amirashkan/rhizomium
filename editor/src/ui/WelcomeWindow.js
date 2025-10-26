// src/ui/WelcomeWindow.js
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
      console.warn("WelcomeWindow: unable to read preference", error);
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

    this.state = this.collectState();
    this.render();
    return true;
  }

  hide(commitPreference = true) {
    if (!this.overlay) {
      return;
    }

    if (commitPreference) {
      this.persistPreference();
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
        console.warn("WelcomeWindow: unable to read autosave age", error);
      }
    }

    let backups = [];
    if (this.saveLoadManager?.getBackups) {
      try {
        backups = this.saveLoadManager.getBackups().slice(0, 3);
      } catch (error) {
        console.warn("WelcomeWindow: unable to read backups", error);
      }
    }

    return {
      hasAutosave,
      autosaveAgeText,
      backups,
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
      console.warn("WelcomeWindow: unable to read autosave entry", error);
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
    this.overlay = document.createElement("div");
    this.overlay.className = "welcome-overlay";
    this.overlay.innerHTML = this.getTemplate();
    document.body.appendChild(this.overlay);

    requestAnimationFrame(() => {
      this.overlay?.classList.add("visible");
    });

    this.attachEventHandlers();
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
      console.error("WelcomeWindow: failed to restore autosave", error);
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
      console.error("WelcomeWindow: failed to restore backup", error);
    }
  }

  maybeCreateStartupBackup() {
    if (this.state.hasAutosave && this.saveLoadManager?.createBackup) {
      try {
        this.saveLoadManager.createBackup("startup");
      } catch (error) {
        console.warn("WelcomeWindow: unable to create startup backup", error);
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
      console.warn("WelcomeWindow: unable to persist preference", error);
    }
  }
}
