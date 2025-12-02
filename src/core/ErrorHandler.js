// src/core/ErrorHandler.js

/**
 * Global Error Handler for GLSL Node Editor
 * Provides centralized error handling with user-friendly UI feedback
 */
export class ErrorHandler {
  constructor() {
    this.errorContainer = null;
    this.isInitialized = false;
    this.errorCount = 0;
    
    this.init();
  }

  /**
   * Initialize error handler
   */
  init() {
    if (this.isInitialized) return;

    this.createErrorUI();
    this.setupGlobalErrorHandling();
    this.isInitialized = true;

  }

  /**
   * Create error display UI
   */
  createErrorUI() {
    // Create error container
    this.errorContainer = document.createElement('div');
    this.errorContainer.id = 'error-container';
    this.errorContainer.className = 'error-container';
    document.body.appendChild(this.errorContainer);

    // Add styles if not already present
    if (!document.getElementById('error-handler-styles')) {
      this.addErrorStyles();
    }
  }

  /**
   * Add error display styles
   */
  addErrorStyles() {
    const style = document.createElement('style');
    style.id = 'error-handler-styles';
    style.textContent = `
      .error-container {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        max-width: 400px;
        pointer-events: none;
      }

      .error-notification {
        background: #fee2e2;
        border: 1px solid #fecaca;
        border-left: 4px solid #ef4444;
        border-radius: 6px;
        padding: 16px;
        margin-bottom: 12px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        pointer-events: auto;
        animation: slideInRight 0.3s ease-out;
        position: relative;
        max-height: 200px;
        overflow: hidden;
      }

      .error-warning {
        background: #fef3c7;
        border-color: #fde68a;
        border-left-color: #f59e0b;
      }

      .error-info {
        background: #dbeafe;
        border-color: #bfdbfe;
        border-left-color: #3b82f6;
      }

      .error-success {
        background: #d1fae5;
        border-color: #a7f3d0;
        border-left-color: #10b981;
      }

      .error-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }

      .error-title {
        font-weight: 600;
        font-size: 14px;
        color: #1f2937;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .error-close {
        background: none;
        border: none;
        font-size: 18px;
        cursor: pointer;
        color: #6b7280;
        padding: 0;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 3px;
      }

      .error-close:hover {
        background: rgba(0, 0, 0, 0.1);
      }

      .error-message {
        color: #374151;
        font-size: 13px;
        line-height: 1.4;
        margin-bottom: 8px;
      }

      .error-details {
        font-size: 11px;
        color: #6b7280;
        background: rgba(0, 0, 0, 0.05);
        padding: 8px;
        border-radius: 4px;
        font-family: 'Courier New', monospace;
        white-space: pre-wrap;
        max-height: 80px;
        overflow-y: auto;
        cursor: pointer;
      }

      .error-details:hover {
        background: rgba(0, 0, 0, 0.08);
      }

      @keyframes slideInRight {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }

      @keyframes slideOutRight {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(100%);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Setup global error catching
   */
  setupGlobalErrorHandling() {
    // Catch unhandled errors
    window.addEventListener('error', (event) => {
      this.handleError(event.error, 'Unhandled Error', 'error');
    });

    // Catch unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.handleError(event.reason, 'Unhandled Promise', 'error');
      event.preventDefault(); // Prevent default browser handling
    });
  }

  /**
   * Main error handling method
   */
  handleError(error, context = '', type = 'error', duration = 5000) {

    const errorMessage = this.formatErrorMessage(error);
    const userMessage = this.getUserFriendlyMessage(error, context);

    this.showNotification({
      type: type,
      title: context || 'Error',
      message: userMessage,
      details: this.shouldShowDetails(error) ? errorMessage : null,
      duration: duration
    });

    // Also emit event for other systems to listen to
    this.emitErrorEvent(error, context, type);
  }

  /**
   * Show specific error types
   */
  handleShaderError(error, shaderCode = '', lineNumber = null) {
    const message = `Shader compilation failed${lineNumber ? ` at line ${lineNumber}` : ''}`;
    const details = this.parseShaderError(error, shaderCode);
    
    this.showNotification({
      type: 'error',
      title: 'Shader Error',
      message: message,
      details: details,
      duration: 0 // Don't auto-dismiss
    });
  }

  handleNodeError(nodeId, nodeName, error) {
    this.handleError(error, `Node Error: ${nodeName || nodeId}`, 'error');
  }

  handleConnectionError(error) {
    this.handleError(error, 'Connection Error', 'warning');
  }

  handleTextureError(error, textureName = '') {
    const context = textureName ? `Texture Error: ${textureName}` : 'Texture Error';
    this.handleError(error, context, 'error');
  }

  /**
   * Show different types of notifications
   */
  showWarning(message, context = 'Warning', duration = 4000) {
    this.showNotification({
      type: 'warning',
      title: context,
      message: message,
      duration: duration
    });
  }

  showInfo(message, context = 'Info', duration = 3000) {
    this.showNotification({
      type: 'info',
      title: context,
      message: message,
      duration: duration
    });
  }

  showSuccess(message, context = 'Success', duration = 2000) {
    this.showNotification({
      type: 'success',
      title: context,
      message: message,
      duration: duration
    });
  }

  /**
   * Show notification in UI
   */
 showNotification({ type, title, message, details, duration = 5000 }) {
  if (!this.errorContainer) {

    return;
  }

  // Check for duplicate errors (same message within last 2 seconds)
  const now = Date.now();
  const errorKey = `${type}-${title}-${message}`;
  
  if (this.recentErrors && this.recentErrors.has(errorKey)) {
    const lastTime = this.recentErrors.get(errorKey);
    if (now - lastTime < 2000) { // 2 second cooldown
      return; // Skip duplicate
    }
  }

  // Track this error
  if (!this.recentErrors) this.recentErrors = new Map();
  this.recentErrors.set(errorKey, now);

  // Clean up old entries
  for (const [key, time] of this.recentErrors.entries()) {
    if (now - time > 10000) { // Remove after 10 seconds
      this.recentErrors.delete(key);
    }
  }


    const notification = this.createNotificationElement({ type, title, message, details });
    this.errorContainer.appendChild(notification);

    // Auto-remove after duration (if duration > 0)
    if (duration > 0) {
      setTimeout(() => {
        this.removeNotification(notification);
      }, duration);
    }

    // Limit number of notifications
    this.limitNotifications();
  }

  /**
   * Create notification DOM element
   */
  createNotificationElement({ type, title, message, details }) {
    const notification = document.createElement('div');
    notification.className = `error-notification error-${type}`;

    const icon = this.getErrorIcon(type);
  const displayTitle = typeof title === 'string' ? title : 
                      (title?.message || title?.name || 'Error');
  const displayMessage = typeof message === 'string' ? message : 
                         (message?.message || String(message));

  notification.innerHTML = `
    <div class="error-header">
      <div class="error-title">
        <span>${icon}</span>
        <span>${displayTitle}</span>
      </div>
      <button class="error-close" title="Dismiss">×</button>
    </div>
    <div class="error-message">${displayMessage}</div>
    ${details ? `<div class="error-details" title="Click to select all">${details}</div>` : ''}
  `;

    // Add close functionality
    const closeBtn = notification.querySelector('.error-close');
    closeBtn.addEventListener('click', () => {
      this.removeNotification(notification);
    });

    // Add details selection functionality
    const detailsEl = notification.querySelector('.error-details');
    if (detailsEl) {
      detailsEl.addEventListener('click', () => {
        try {
          const selection = window.getSelection();
          const range = document.createRange();
          
          // Check if element is still in the DOM and has a parent
          if (!detailsEl.parentNode) {
            console.warn('Cannot select text: element has no parent');
            return;
          }
          
          range.selectNodeContents(detailsEl);
          selection.removeAllRanges();
          selection.addRange(range);
        } catch (error) {
          // Handle InvalidNodeTypeError and other DOM errors gracefully
          console.warn('Failed to select text:', error);
          // Fallback: try to copy text to clipboard
          try {
            const text = detailsEl.textContent || detailsEl.innerText;
            if (navigator.clipboard && text) {
              navigator.clipboard.writeText(text).catch(() => {
                // Clipboard API failed, ignore
              });
            }
          } catch (clipboardError) {
            // Ignore clipboard errors
          }
        }
      });
    }

    return notification;
  }

  /**
   * Remove notification with animation
   */
  removeNotification(notification) {
    if (!notification || !notification.parentNode) return;

    notification.style.animation = 'slideOutRight 0.3s ease-in';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }

  /**
   * Limit number of notifications
   */
  limitNotifications(maxCount = 5) {
    const notifications = this.errorContainer.querySelectorAll('.error-notification');
    if (notifications.length > maxCount) {
      // Remove oldest notifications
      for (let i = 0; i < notifications.length - maxCount; i++) {
        this.removeNotification(notifications[i]);
      }
    }
  }

  /**
   * Get icon for error type
   */
  getErrorIcon(type) {
    const icons = {
      error: '⚠️',
      warning: '⚡',
      info: 'ℹ️',
      success: '✅'
    };
    return icons[type] || '⚠️';
  }

  /**
   * Format error message for display
   */
  formatErrorMessage(error) {
    if (typeof error === 'string') return error;
    if (error instanceof Error) {
      return `${error.name}: ${error.message}${error.stack ? '\n\nStack trace:\n' + error.stack : ''}`;
    }
    return String(error);
  }

  /**
   * Get user-friendly error message
   */
  getUserFriendlyMessage(error, context) {
    const message = error?.message || String(error);

    // Map technical errors to user-friendly messages
    const patterns = {
      'WebGL context lost': 'Graphics context lost. Try refreshing the page.',
      'Shader compilation': 'There\'s an error in the shader. Check your node connections.',
      'Texture loading': 'Failed to load texture. Check the file format and size.',
      'Network': 'Network error occurred. Check your connection.',
      'Permission denied': 'Permission denied. Check file access rights.',
      'Out of memory': 'Not enough memory. Try simplifying your graph.',
      'Invalid connection': 'Invalid node connection. Check input/output types.',
      'Compilation failed': 'Code compilation failed. Check your node setup.',
    };

    for (const [pattern, friendlyMessage] of Object.entries(patterns)) {
      if (message.toLowerCase().includes(pattern.toLowerCase())) {
        return friendlyMessage;
      }
    }

    // Return original message if no pattern matches
    return message.length > 100 ? message.substring(0, 100) + '...' : message;
  }

  /**
   * Parse shader errors for better display
   */
  parseShaderError(error, shaderCode) {
    const message = error?.message || String(error);
    
    // Try to extract line numbers and specific errors
    const lineMatch = message.match(/line (\d+)/i);
    if (lineMatch && shaderCode) {
      const lineNum = parseInt(lineMatch[1]);
      const lines = shaderCode.split('\n');
      const errorLine = lines[lineNum - 1];
      
      return `${message}\n\nLine ${lineNum}: ${errorLine || 'Unknown line'}`;
    }

    return message;
  }

  /**
   * Determine if error details should be shown
   */
  shouldShowDetails(error) {
    // Show details for development or complex errors
    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const isComplexError = error instanceof Error && error.stack;
    
    return isDev || isComplexError;
  }

  /**
   * Emit error event for other systems
   */
  emitErrorEvent(error, context, type) {
    const event = new CustomEvent('app-error', {
      detail: { error, context, type }
    });
    document.dispatchEvent(event);
  }

  /**
   * Clear all notifications
   */
  clearAll() {
    if (this.errorContainer) {
      this.errorContainer.innerHTML = '';
    }
  }

  /**
   * Static methods for easy access
   */
  static instance = null;

  static getInstance() {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  static handleError(error, context, type) {
    ErrorHandler.getInstance().handleError(error, context, type);
  }

  static handleCriticalError(error) {
    ErrorHandler.getInstance().handleError(error, 'Critical Error', 'error', 0);
  }

  static showWarning(message, context) {
    ErrorHandler.getInstance().showWarning(message, context);
  }

  static showInfo(message, context) {
    ErrorHandler.getInstance().showInfo(message, context);
  }

  static showSuccess(message, context) {
    ErrorHandler.getInstance().showSuccess(message, context);
  }
}