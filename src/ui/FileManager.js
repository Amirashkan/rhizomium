// src/ui/FileManager.js - Cloud File Manager for TenderWorld
import { modalManager } from './ModalManager.js';
import { iconMarkup } from './iconSprite.js';

export class FileManager {
  constructor(saveLoadManager) {
    this.saveLoadManager = saveLoadManager;
    this.dialog = null;
    this.isOpen = false;
    this.currentPath = '/';
    this.files = [];
    this.loading = false;
    this.userInfo = null;
    this.tenderworldBaseUrl = 'https://art.tenderworld.org';
  }

  show() {
    if (this.isOpen) return;
    this.createDialog();
    this.isOpen = true;
    this.checkAuthAndLoadFiles();
  }

  hide() {
    if (this.dialog) {
      document.body.removeChild(this.dialog);
      this.dialog = null;
    }
    this.isOpen = false;
    this.files = [];
    this.currentPath = '/';
  }

  createDialog() {
    if (this.dialog) {
      this.hide();
    }

    this.dialog = document.createElement("div");
    this.dialog.className = "file-manager-overlay";
    this.dialog.innerHTML = `
      <div class="file-manager-dialog">
        <div class="file-manager-header">
          <div class="file-manager-header-content">
            <h3>${iconMarkup('folder', { size: 16 })} File Manager</h3>
            <div class="file-manager-user-info" id="file-manager-user-info">
              <span class="user-loading">Checking authentication...</span>
            </div>
          </div>
          <button class="file-manager-close-btn" title="Close">${iconMarkup('close', { size: 14, label: 'Close' })}</button>
        </div>
        
        <div class="file-manager-toolbar">
          <button id="file-manager-save-btn" class="file-manager-toolbar-btn file-manager-toolbar-btn-save" title="Save Current Project">
            ${iconMarkup('save-disk')} Save
          </button>
          <button id="file-manager-refresh-btn" class="file-manager-toolbar-btn" title="Refresh">
            ${iconMarkup('refresh')} Refresh
          </button>
          <button id="file-manager-upload-btn" class="file-manager-toolbar-btn file-manager-toolbar-btn-primary" title="Upload File">
            ${iconMarkup('upload')} Upload
          </button>
          <button id="file-manager-new-folder-btn" class="file-manager-toolbar-btn" title="New Folder">
            ${iconMarkup('folder-new')} New Folder
          </button>
          <div class="file-manager-path">
            <span class="path-label">Path:</span>
            <div class="path-breadcrumb" id="file-manager-breadcrumb">/</div>
          </div>
        </div>
        
        <div class="file-manager-content">
          <div id="file-manager-list" class="file-manager-list">
            <div class="file-manager-loading">Loading files...</div>
          </div>
        </div>
        
        <div class="file-manager-footer">
          <span class="file-manager-info" id="file-manager-info">
            Connect to TenderWorld to manage your cloud files
          </span>
          <button id="file-manager-login-btn" class="file-manager-login-btn" style="display: none;">
            Sign In to TenderWorld
          </button>
        </div>
      </div>
    `;

    this.addStyles();
    this.setupEventListeners();
    document.body.appendChild(this.dialog);
    this.setupKeyboardHandlers();
  }

  addStyles() {
    if (document.getElementById("file-manager-styles")) return;

    const styles = document.createElement("style");
    styles.id = "file-manager-styles";
    styles.textContent = `
      .file-manager-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10001;
        animation: fadeIn 0.2s ease;
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .file-manager-dialog {
        background: linear-gradient(135deg, rgba(28, 28, 30, 0.98) 0%, rgba(20, 20, 22, 0.98) 100%);
        backdrop-filter: blur(20px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 16px;
        width: 90%;
        max-width: 900px;
        height: 85vh;
        max-height: 700px;
        display: flex;
        flex-direction: column;
        box-shadow: 0 24px 48px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
        animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }

      @keyframes slideIn {
        from {
          opacity: 0;
          transform: scale(0.95) translateY(-30px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }

      .file-manager-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 24px 28px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.2);
        border-radius: 16px 16px 0 0;
      }

      .file-manager-header-content {
        flex: 1;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .file-manager-header h3 {
        margin: 0;
        color: #f3ede4;
        font-size: 20px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .file-manager-user-info {
        color: #8f867a;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .file-manager-user-info.authenticated {
        color: #c6f24e;
      }

      .file-manager-user-info.authenticated::before {
        content: "✓";
        color: #c6f24e;
        font-weight: bold;
      }

      .file-manager-close-btn {
        background: none;
        border: none;
        color: #6f6559;
        font-size: 28px;
        cursor: pointer;
        padding: 0;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        transition: all 0.15s ease;
        margin-left: 16px;
      }

      .file-manager-close-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #f3ede4;
      }

      .file-manager-toolbar {
        display: flex;
        gap: 12px;
        padding: 16px 28px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        align-items: center;
        flex-wrap: wrap;
      }

      .file-manager-toolbar-btn {
        padding: 8px 16px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        background: rgba(58, 58, 62, 0.6);
        color: #f3ede4;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .file-manager-toolbar-btn:hover {
        background: rgba(74, 74, 78, 0.8);
        border-color: rgba(255, 255, 255, 0.2);
        transform: translateY(-1px);
      }

      .file-manager-toolbar-btn-primary {
        background: linear-gradient(135deg, #c6f24e 0%, #a9d63c 100%);
        border-color: #c6f24e;
        color: #14110a;
        font-weight: 600;
      }

      .file-manager-toolbar-btn-primary:hover {
        background: linear-gradient(135deg, #d7f877 0%, #a9d63c 100%);
        box-shadow: 0 0 24px rgba(198, 242, 78, 0.32);
      }

      .file-manager-toolbar-btn-save {
        background: linear-gradient(135deg, #c6f24e 0%, #a9d63c 100%);
        border-color: #c6f24e;
        color: #14110a;
        font-weight: 600;
      }

      .file-manager-toolbar-btn-save:hover {
        background: linear-gradient(135deg, #d7f877 0%, #a9d63c 100%);
        box-shadow: 0 0 24px rgba(198, 242, 78, 0.32);
      }

      .file-manager-path {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 200px;
      }

      .path-label {
        color: #6f6559;
        font-size: 12px;
        font-weight: 500;
      }

      .path-breadcrumb {
        flex: 1;
        color: #f3ede4;
        font-size: 13px;
        font-family: 'SF Mono', Monaco, monospace;
        padding: 6px 12px;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.05);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .file-manager-content {
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        padding: 20px 28px;
      }

      .file-manager-list {
        flex: 1;
        overflow-y: auto;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 12px;
        padding: 8px;
      }

      .file-manager-item {
        background: rgba(42, 42, 46, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 16px;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        position: relative;
        overflow: hidden;
      }

      .file-manager-item::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: linear-gradient(90deg, transparent, #c6f24e, transparent);
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      .file-manager-item:hover {
        background: rgba(52, 52, 56, 0.9);
        border-color: rgba(198, 242, 78, 0.4);
        transform: translateY(-2px);
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);
      }

      .file-manager-item:hover::before {
        opacity: 1;
      }

      .file-manager-item-icon {
        font-size: 48px;
        margin-bottom: 12px;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
      }

      .file-manager-item-name {
        color: #f3ede4;
        font-size: 13px;
        font-weight: 500;
        margin-bottom: 4px;
        word-break: break-word;
        width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }

      .file-manager-item-meta {
        color: #6f6559;
        font-size: 11px;
        margin-top: 4px;
      }

      .file-manager-item-actions {
        position: absolute;
        top: 8px;
        right: 8px;
        display: none;
        gap: 4px;
      }

      .file-manager-item:hover .file-manager-item-actions {
        display: flex;
      }

      .file-manager-item-action-btn {
        width: 24px;
        height: 24px;
        border: none;
        border-radius: 4px;
        background: rgba(0, 0, 0, 0.6);
        color: #f3ede4;
        cursor: pointer;
        font-size: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
      }

      .file-manager-item-action-btn:hover {
        background: rgba(198, 242, 78, 0.8);
        transform: scale(1.1);
      }

      .file-manager-loading,
      .file-manager-empty,
      .file-manager-error {
        grid-column: 1 / -1;
        text-align: center;
        color: #6f6559;
        padding: 60px 20px;
        font-size: 14px;
      }

      .file-manager-error {
        color: #f8615a;
      }

      .file-manager-footer {
        padding: 20px 28px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: rgba(0, 0, 0, 0.2);
      }

      .file-manager-info {
        color: rgba(255,244,230,0.13);
        font-size: 12px;
      }

      .file-manager-login-btn {
        padding: 10px 20px;
        border: 1px solid #c6f24e;
        border-radius: 8px;
        background: linear-gradient(135deg, #c6f24e 0%, #a9d63c 100%);
        color: #14110a;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .file-manager-login-btn:hover {
        background: linear-gradient(135deg, #d7f877 0%, #a9d63c 100%);
        box-shadow: 0 0 24px rgba(198, 242, 78, 0.32);
        transform: translateY(-1px);
      }

      /* Scrollbar styling */
      .file-manager-list::-webkit-scrollbar {
        width: 10px;
      }

      .file-manager-list::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 5px;
      }

      .file-manager-list::-webkit-scrollbar-thumb {
        background: rgba(198, 242, 78, 0.5);
        border-radius: 5px;
      }

      .file-manager-list::-webkit-scrollbar-thumb:hover {
        background: rgba(198, 242, 78, 0.7);
      }

      /* Loading spinner */
      .file-manager-loading::before {
        content: '';
        display: inline-block;
        width: 20px;
        height: 20px;
        border: 2px solid rgba(198, 242, 78, 0.3);
        border-top-color: #c6f24e;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin-right: 10px;
        vertical-align: middle;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;

    document.head.appendChild(styles);
  }

  setupEventListeners() {
    const closeBtn = this.dialog.querySelector(".file-manager-close-btn");
    closeBtn.addEventListener("click", () => this.hide());

    this.dialog.addEventListener("click", (e) => {
      if (e.target === this.dialog) {
        this.hide();
      }
    });

    const saveBtn = this.dialog.querySelector("#file-manager-save-btn");
    saveBtn.addEventListener("click", () => this.handleSave());

    const refreshBtn = this.dialog.querySelector("#file-manager-refresh-btn");
    refreshBtn.addEventListener("click", () => this.refreshFiles());

    const uploadBtn = this.dialog.querySelector("#file-manager-upload-btn");
    uploadBtn.addEventListener("click", () => this.handleUpload());

    const newFolderBtn = this.dialog.querySelector("#file-manager-new-folder-btn");
    newFolderBtn.addEventListener("click", () => this.handleNewFolder());

    const loginBtn = this.dialog.querySelector("#file-manager-login-btn");
    loginBtn.addEventListener("click", () => this.handleLogin());
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

  async checkAuthAndLoadFiles() {
    if (!this.dialog) return;
    const userInfoEl = this.dialog.querySelector("#file-manager-user-info");
    const loginBtn = this.dialog.querySelector("#file-manager-login-btn");
    const infoEl = this.dialog.querySelector("#file-manager-info");

    try {
      // Check if we're on a domain that can access TenderWorld API
      const currentOrigin = window.location.origin;
      const isTenderWorldDomain = currentOrigin.includes('tenderworld.org') || 
                                   currentOrigin.includes('localhost') ||
                                   currentOrigin.includes('127.0.0.1');
      
      if (!isTenderWorldDomain) {
        // CORS will block this request, show helpful message
        userInfoEl.textContent = 'Cloud file manager unavailable';
        userInfoEl.classList.remove('authenticated');
        loginBtn.style.display = 'none';
        infoEl.textContent = 'File Manager is only available when running on TenderWorld domains. Use local save/load instead.';
        this.showEmptyState('File Manager requires TenderWorld domain access');
        return;
      }

      // Check authentication
      const authResponse = await fetch(`${this.tenderworldBaseUrl}/api/auth/check`, {
        method: 'GET',
        credentials: 'include'
      }).catch(err => {
        // Handle network/CORS errors gracefully
        if (err.name === 'TypeError' && err.message.includes('fetch')) {
          throw new Error('Network error: Unable to connect to TenderWorld API. This may be a CORS issue.');
        }
        throw err;
      });

      if (authResponse.ok) {
        const authData = await authResponse.json();
        if (authData.authenticated && authData.user) {
          this.userInfo = authData.user;
          userInfoEl.textContent = `Logged in as ${authData.user.email || authData.user.username || 'User'}`;
          userInfoEl.classList.add('authenticated');
          loginBtn.style.display = 'none';
          infoEl.textContent = `Managing files for ${authData.user.email || authData.user.username || 'your account'}`;
          await this.loadFiles();
        } else {
          throw new Error('Not authenticated');
        }
      } else {
        throw new Error('Auth check failed');
      }
    } catch (error) {
      console.error('Authentication check failed:', error);
      const errorMessage = error.message || 'Unknown error';
      const isCorsError = errorMessage.includes('CORS') || errorMessage.includes('fetch') || 
                         errorMessage.includes('blocked');
      
      userInfoEl.textContent = 'Not signed in';
      userInfoEl.classList.remove('authenticated');
      loginBtn.style.display = isCorsError ? 'none' : 'block';
      
      if (isCorsError) {
        infoEl.textContent = 'File Manager unavailable: CORS restrictions prevent access to TenderWorld API from this domain.';
        this.showEmptyState('File Manager requires TenderWorld domain access');
      } else {
        infoEl.textContent = 'Please sign in to TenderWorld to access your cloud files';
        this.showEmptyState('Please sign in to access your files');
      }
    }
  }

  async loadFiles() {
    if (this.loading) return;
    if (!this.dialog) return;
    this.loading = true;

    const listContainer = this.dialog.querySelector("#file-manager-list");
    listContainer.innerHTML = '<div class="file-manager-loading">Loading files...</div>';

    try {
      // Fetch files from TenderWorld API
      // Note: This endpoint needs to be created in tenderworld project
      const response = await fetch(
        `${this.tenderworldBaseUrl}/api/files/list?path=${encodeURIComponent(this.currentPath)}`,
        {
          method: 'GET',
          credentials: 'include'
        }
      );

      if (!response.ok) {
        if (response.status === 401) {
          this.showEmptyState('Please sign in to access your files');
          const loginBtn = this.dialog.querySelector("#file-manager-login-btn");
          loginBtn.style.display = 'block';
          return;
        }
        throw new Error(`Failed to load files: ${response.status}`);
      }

      const data = await response.json();
      this.files = data.files || [];
      this.renderFiles();
    } catch (error) {
      console.error('Failed to load files:', error);
      // error.message can carry server-controlled text.
      const errorEl = document.createElement('div');
      errorEl.className = 'file-manager-error';
      errorEl.textContent = `Error loading files: ${error.message}`;
      listContainer.replaceChildren(errorEl);
    } finally {
      this.loading = false;
    }
  }

  renderFiles() {
    const listContainer = this.dialog.querySelector("#file-manager-list");
    const breadcrumb = this.dialog.querySelector("#file-manager-breadcrumb");

    // Update breadcrumb
    breadcrumb.textContent = this.currentPath || '/';

    if (this.files.length === 0) {
      listContainer.innerHTML = '<div class="file-manager-empty">No files found in this folder</div>';
      return;
    }

    const html = this.files.map(file => {
      const icon = iconMarkup(
        file.type === 'folder' ? 'folder' : this.getFileIcon(file.name),
        { size: 28 },
      );
      const size = file.size ? this.formatFileSize(file.size) : '';
      const date = file.modified ? new Date(file.modified).toLocaleDateString() : '';

      return `
        <div class="file-manager-item" data-file-path="${file.path}" data-file-type="${file.type}">
          <div class="file-manager-item-actions">
            <button class="file-manager-item-action-btn" data-action="delete" title="Delete">${iconMarkup('trash', { size: 14, label: 'Delete' })}</button>
          </div>
          <div class="file-manager-item-icon">${icon}</div>
          <div class="file-manager-item-name" title="${file.name}">${file.name}</div>
          <div class="file-manager-item-meta">${size} ${date ? '• ' + date : ''}</div>
        </div>
      `;
    }).join('');

    listContainer.innerHTML = html;

    // Add click handlers
    listContainer.querySelectorAll('.file-manager-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.file-manager-item-action-btn')) {
          const action = e.target.closest('.file-manager-item-action-btn').dataset.action;
          const filePath = item.dataset.filePath;
          const fileType = item.dataset.fileType;
          if (action === 'delete') {
            this.handleDelete(filePath, fileType);
          }
        } else {
          const filePath = item.dataset.filePath;
          const fileType = item.dataset.fileType;
          if (fileType === 'folder') {
            this.navigateToFolder(filePath);
          } else {
            this.handleFileOpen(filePath);
          }
        }
      });
    });
  }

  getFileIcon(filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    // Values are sprite ids (src/ui/iconSprite.js), resolved by the caller.
    const iconMap = {
      'json': 'file',
      'rz': 'file-shader',
      'glsl': 'file-shader',
      'wgsl': 'file-shader',
      'png': 'file-image',
      'jpg': 'file-image',
      'jpeg': 'file-image',
      'webp': 'file-image',
      'gif': 'file-image',
    };
    return iconMap[ext] || 'file';
  }

  formatFileSize(bytes) {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  navigateToFolder(path) {
    this.currentPath = path;
    this.loadFiles();
  }

  async handleFileOpen(filePath) {
    try {
      const response = await fetch(
        `${this.tenderworldBaseUrl}/api/files/download?path=${encodeURIComponent(filePath)}`,
        {
          method: 'GET',
          credentials: 'include'
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';
      let projectData;

      // Handle JSON response (when API returns JSON with content field)
      if (contentType.includes('application/json')) {
        const fileData = await response.json();
        projectData = fileData.content || fileData;
      } else {
        // Handle binary/text file (create a File-like object)
        const blob = await response.blob();
        const fileName = filePath.split('/').pop() || 'file.rz';
        const file = new File([blob], fileName, { type: blob.type });
        
        // Use loadFromFile which handles different file types
        if (this.saveLoadManager && this.saveLoadManager.loadFromFile) {
          await this.saveLoadManager.loadFromFile(file);
          this.hide();
          if (typeof window.updateStatus === 'function') {
            window.updateStatus(`Loaded ${filePath}`);
          }
          return;
        } else {
          // Fallback: try to read as text and parse JSON
          const text = await blob.text();
          projectData = JSON.parse(text);
        }
      }
      
      // Load the file into the editor
      if (this.saveLoadManager && projectData) {
        await this.saveLoadManager.importProject(projectData);
        this.hide();
        if (typeof window.updateStatus === 'function') {
          window.updateStatus(`Loaded ${filePath}`);
        }
      }
    } catch (error) {
      console.error('Failed to open file:', error);
      await modalManager.alert(`Failed to open file: ${error.message}`, 'Error');
    }
  }

  async handleDelete(filePath, fileType) {
    const confirmed = await modalManager.confirm(
      `Delete this ${fileType}? This action cannot be undone.`,
      'Confirm Delete',
      { danger: true, confirmLabel: 'Delete', cancelLabel: 'Cancel' }
    );
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(
        `${this.tenderworldBaseUrl}/api/files/delete?path=${encodeURIComponent(filePath)}`,
        {
          method: 'DELETE',
          credentials: 'include'
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to delete: ${response.status}`);
      }

      await this.loadFiles();
      if (typeof window.updateStatus === 'function') {
        window.updateStatus('File deleted');
      }
    } catch (error) {
      console.error('Failed to delete file:', error);
      await modalManager.alert(`Failed to delete file: ${error.message}`, 'Error');
    }
  }

  async handleSave() {
    if (!this.saveLoadManager) {
      await modalManager.alert('SaveLoadManager not available', 'Error');
      return;
    }

    // Get filename from user
    const defaultName = `project-${new Date().toISOString().slice(0, 10)}.json`;
    const fileName = await modalManager.prompt(
      'Enter filename:',
      'Save Project',
      defaultName,
      { placeholder: 'Enter filename...' }
    );
    
    if (!fileName) {
      return; // User cancelled
    }

    // Ensure .json extension
    const finalFileName = fileName.endsWith('.json') ? fileName : `${fileName}.json`;

    try {
      // Export current project data
      const projectData = this.saveLoadManager.exportProject({
        includeMetadata: true,
        includePreviews: false,
        includeViewport: true
      });

      // Convert to JSON string
      const jsonContent = JSON.stringify(projectData, null, 2);

      // Create a Blob and File object
      const blob = new Blob([jsonContent], { type: 'application/json' });
      const file = new File([blob], finalFileName, { type: 'application/json' });

      // Upload using FormData (same as handleUpload)
      const formData = new FormData();
      formData.append('file', file);
      formData.append('path', this.currentPath);

      const response = await fetch(
        `${this.tenderworldBaseUrl}/api/files/upload`,
        {
          method: 'POST',
          body: formData,
          credentials: 'include'
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Upload failed: ${response.status}`);
      }

      // Refresh file list and show success
      await this.loadFiles();
      
      if (typeof window.updateStatus === 'function') {
        window.updateStatus(`Project saved: ${finalFileName}`);
      }

      // Show success message in the dialog
      const infoEl = this.dialog.querySelector("#file-manager-info");
      const originalText = infoEl.textContent;
      infoEl.textContent = `Saved ${finalFileName} successfully`;
      infoEl.style.color = '#c6f24e';
      
      setTimeout(() => {
        infoEl.textContent = originalText;
        infoEl.style.color = '';
      }, 3000);

    } catch (error) {
      console.error('Failed to save project:', error);
      await modalManager.alert(`Failed to save project: ${error.message}`, 'Error');
    }
  }

  async handleUpload() {
    // Create file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.rz,.glsl,.wgsl';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('path', this.currentPath);

        const response = await fetch(
          `${this.tenderworldBaseUrl}/api/files/upload`,
          {
            method: 'POST',
            body: formData,
            credentials: 'include'
          }
        );

        if (!response.ok) {
          throw new Error(`Upload failed: ${response.status}`);
        }

        await this.loadFiles();
        if (typeof window.updateStatus === 'function') {
          window.updateStatus(`File uploaded: ${file.name}`);
        }
      } catch (error) {
        console.error('Upload failed:', error);
        await modalManager.alert(`Upload failed: ${error.message}`, 'Error');
      }
    };
    input.click();
  }

  async handleNewFolder() {
    const folderName = await modalManager.prompt(
      'Enter folder name:',
      'New Folder',
      '',
      { placeholder: 'Folder name...' }
    );
    if (!folderName) return;

    try {
      const response = await fetch(
        `${this.tenderworldBaseUrl}/api/files/create-folder`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({
            path: this.currentPath,
            name: folderName
          })
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to create folder: ${response.status}`);
      }

      await this.loadFiles();
      if (typeof window.updateStatus === 'function') {
        window.updateStatus(`Folder created: ${folderName}`);
      }
    } catch (error) {
      console.error('Failed to create folder:', error);
      await modalManager.alert(`Failed to create folder: ${error.message}`, 'Error');
    }
  }

  handleLogin() {
    window.open(`${this.tenderworldBaseUrl}/login?redirect=${encodeURIComponent(window.location.href)}`, '_blank');
  }

  refreshFiles() {
    this.loadFiles();
  }

  showEmptyState(message) {
    // Dialog may have been closed while an async auth/file request was pending
    if (!this.dialog) return;
    const listContainer = this.dialog.querySelector("#file-manager-list");
    if (!listContainer) return;
    const empty = document.createElement("div");
    empty.className = "file-manager-empty";
    empty.textContent = message;
    listContainer.replaceChildren(empty);
  }
}

