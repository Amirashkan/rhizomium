// src/ui/BackupDialog.js - Complete Backup Management System
export class BackupDialog {
  constructor(saveLoadManager) {
    this.saveLoadManager = saveLoadManager;
    this.dialog = null;
    this.isOpen = false;
  }

  show() {
    if (this.isOpen) return;

    this.createDialog();
    this.isOpen = true;
    this.refreshBackupList();
  }

  hide() {
    if (this.dialog) {
      document.body.removeChild(this.dialog);
      this.dialog = null;
    }
    this.isOpen = false;
  }

  createDialog() {
    // Remove existing dialog if any
    if (this.dialog) {
      this.hide();
    }

    // Create dialog overlay
    this.dialog = document.createElement("div");
    this.dialog.className = "backup-dialog-overlay";
    this.dialog.innerHTML = `
      <div class="backup-dialog">
        <div class="backup-header">
          <h3>Project Backups</h3>
          <button class="backup-close-btn" title="Close">×</button>
        </div>
        
        <div class="backup-actions">
          <button id="backup-create-btn" class="backup-btn backup-btn-primary">
            Create Backup
          </button>
          <button id="backup-clear-all-btn" class="backup-btn backup-btn-danger">
            Clear All
          </button>
          <button id="backup-export-all-btn" class="backup-btn">
            Export All
          </button>
        </div>
        
        <div class="backup-list-container">
          <div id="backup-list" class="backup-list">
            <div class="backup-loading">Loading backups...</div>
          </div>
        </div>
        
        <div class="backup-footer">
          <span class="backup-info">Backups are stored locally in your browser</span>
        </div>
      </div>
    `;

    // Add styles
    this.addStyles();

    // Add event listeners
    this.setupEventListeners();

    // Add to document
    document.body.appendChild(this.dialog);

    // Focus trap and ESC handler
    this.setupKeyboardHandlers();
  }

  addStyles() {
    if (document.getElementById("backup-dialog-styles")) return;

    const styles = document.createElement("style");
    styles.id = "backup-dialog-styles";
    styles.textContent = `
      .backup-dialog-overlay {
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
        z-index: 10000;
        animation: fadeIn 0.2s ease;
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .backup-dialog {
        background: rgba(28, 28, 30, 0.95);
        backdrop-filter: blur(20px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        width: 90%;
        max-width: 600px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
        animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }

      @keyframes slideIn {
        from {
          opacity: 0;
          transform: scale(0.9) translateY(-20px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }

      .backup-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px 24px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }

      .backup-header h3 {
        margin: 0;
        color: #ffffff;
        font-size: 18px;
        font-weight: 600;
      }

      .backup-close-btn {
        background: none;
        border: none;
        color: #888;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        transition: all 0.15s ease;
      }

      .backup-close-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #ffffff;
      }

      .backup-actions {
        display: flex;
        gap: 12px;
        padding: 20px 24px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }

      .backup-btn {
        padding: 8px 16px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        background: rgba(58, 58, 62, 0.6);
        color: #ffffff;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .backup-btn:hover {
        background: rgba(74, 74, 78, 0.8);
        border-color: rgba(255, 255, 255, 0.15);
      }

      .backup-btn-primary {
        background: #007AFF;
        border-color: #007AFF;
      }

      .backup-btn-primary:hover {
        background: #0056CC;
        border-color: #0056CC;
      }

      .backup-btn-danger {
        background: #FF453A;
        border-color: #FF453A;
      }

      .backup-btn-danger:hover {
        background: #CC231A;
        border-color: #CC231A;
      }

      .backup-list-container {
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .backup-list {
        flex: 1;
        overflow-y: auto;
        padding: 12px 24px;
        max-height: 400px;
      }

      .backup-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
        background: rgba(42, 42, 46, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 8px;
        margin-bottom: 12px;
        transition: all 0.15s ease;
      }

      .backup-item:hover {
        background: rgba(52, 52, 56, 0.8);
        border-color: rgba(255, 255, 255, 0.1);
      }

      .backup-item-info {
        flex: 1;
      }

      .backup-item-title {
        color: #ffffff;
        font-weight: 500;
        margin-bottom: 4px;
      }

      .backup-item-meta {
        color: #888;
        font-size: 12px;
        display: flex;
        gap: 16px;
      }

      .backup-item-actions {
        display: flex;
        gap: 8px;
      }

      .backup-item-btn {
        padding: 6px 12px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 4px;
        background: transparent;
        color: #ffffff;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .backup-item-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.2);
      }

      .backup-item-btn-primary {
        background: #007AFF;
        border-color: #007AFF;
      }

      .backup-item-btn-primary:hover {
        background: #0056CC;
        border-color: #0056CC;
      }

      .backup-loading, .backup-empty {
        text-align: center;
        color: #888;
        padding: 40px 20px;
        font-style: italic;
      }

      .backup-footer {
        padding: 16px 24px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        text-align: center;
      }

      .backup-info {
        color: #666;
        font-size: 12px;
      }

      /* Scrollbar styling */
      .backup-list::-webkit-scrollbar {
        width: 8px;
      }

      .backup-list::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 4px;
      }

      .backup-list::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 4px;
      }

      .backup-list::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.3);
      }
    `;

    document.head.appendChild(styles);
  }

  setupEventListeners() {
    // Close button
    const closeBtn = this.dialog.querySelector(".backup-close-btn");
    closeBtn.addEventListener("click", () => this.hide());

    // Click outside to close
    this.dialog.addEventListener("click", (e) => {
      if (e.target === this.dialog) {
        this.hide();
      }
    });

    // Action buttons
    const createBtn = this.dialog.querySelector("#backup-create-btn");
    const clearAllBtn = this.dialog.querySelector("#backup-clear-all-btn");
    const exportAllBtn = this.dialog.querySelector("#backup-export-all-btn");

    createBtn.addEventListener("click", () => this.createBackup());
    clearAllBtn.addEventListener("click", () => this.clearAllBackups());
    exportAllBtn.addEventListener("click", () => this.exportAllBackups());
  }

  setupKeyboardHandlers() {
    const handler = (e) => {
      if (e.key === "Escape") {
        this.hide();
        document.removeEventListener("keydown", handler);
      }
    };
    document.addEventListener("keydown", handler);
  }

  refreshBackupList() {
    const listContainer = this.dialog.querySelector("#backup-list");
    const backups = this.saveLoadManager.getBackups();

    if (backups.length === 0) {
      listContainer.innerHTML =
        '<div class="backup-empty">No backups found</div>';
      return;
    }

    const html = backups
      .map(
        (backup) => `
      <div class="backup-item" data-backup-id="${backup.id}">
        <div class="backup-item-info">
          <div class="backup-item-title">
            Backup - ${backup.reason}
          </div>
          <div class="backup-item-meta">
            <span>${new Date(backup.timestamp).toLocaleString()}</span>
            <span>${backup.nodeCount} nodes, ${backup.connectionCount} connections</span>
            <span>${this.saveLoadManager.formatAge(Date.now() - backup.timestamp)} ago</span>
          </div>
        </div>
        <div class="backup-item-actions">
          <button class="backup-item-btn backup-item-btn-primary backup-restore-btn">
            Restore
          </button>
          <button class="backup-item-btn backup-export-btn">
            Export
          </button>
          <button class="backup-item-btn backup-delete-btn">
            Delete
          </button>
        </div>
      </div>
    `,
      )
      .join("");

    listContainer.innerHTML = html;

    // Add event listeners to backup item buttons
    listContainer
      .querySelectorAll(".backup-restore-btn")
      .forEach((btn, index) => {
        btn.addEventListener("click", () =>
          this.restoreBackup(backups[index].id),
        );
      });

    listContainer
      .querySelectorAll(".backup-export-btn")
      .forEach((btn, index) => {
        btn.addEventListener("click", () => this.exportBackup(backups[index]));
      });

    listContainer
      .querySelectorAll(".backup-delete-btn")
      .forEach((btn, index) => {
        btn.addEventListener("click", () =>
          this.deleteBackup(backups[index].id),
        );
      });
  }

  createBackup() {
    this.saveLoadManager.createBackup("manual");
    this.refreshBackupList();
    this.saveLoadManager.updateStatus("Backup created");
  }

  async restoreBackup(backupId) {
    if (!confirm("Restore this backup? Current work will be lost.")) return;

    try {
      await this.saveLoadManager.restoreBackup(backupId);
      this.hide();
    } catch (error) {
      alert(`Restore failed: ${error.message}`);
    }
  }

  exportBackup(backup) {
    const content = JSON.stringify(backup.data, null, 2);
    const filename = `backup-${backup.reason}-${new Date(backup.timestamp).toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    this.saveLoadManager.downloadFile(content, filename, "application/json");
  }

  deleteBackup(backupId) {
    if (!confirm("Delete this backup?")) return;

    const backups = this.saveLoadManager.getBackups();
    const filtered = backups.filter((b) => b.id !== backupId);

    localStorage.setItem(
      this.saveLoadManager.backupsKey,
      JSON.stringify(filtered),
    );
    this.refreshBackupList();
    this.saveLoadManager.updateStatus("Backup deleted");
  }

  clearAllBackups() {
    if (!confirm("Delete all backups? This cannot be undone.")) return;

    localStorage.removeItem(this.saveLoadManager.backupsKey);
    this.refreshBackupList();
    this.saveLoadManager.updateStatus("All backups cleared");
  }

  exportAllBackups() {
    const backups = this.saveLoadManager.getBackups();
    if (backups.length === 0) {
      alert("No backups to export");
      return;
    }

    const exportData = {
      exported: new Date().toISOString(),
      version: 2,
      backups: backups,
    };

    const content = JSON.stringify(exportData, null, 2);
    const filename = `rhizomium-backups-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    this.saveLoadManager.downloadFile(content, filename, "application/json");
  }
}
