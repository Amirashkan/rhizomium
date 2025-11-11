// src/ui/StatusManager.js
export class StatusManager {
  constructor() {
    this.statusElement = null;
    this.initializeStatusElement();
  }

  initializeStatusElement() {
    // Try to find existing status element
    this.statusElement =
      document.getElementById("status") ||
      document.getElementById("status-bar") ||
      document.querySelector(".status");

    // If not found, create one
    if (!this.statusElement) {
      this.statusElement = document.createElement("div");
      this.statusElement.id = "status";
      this.statusElement.style.cssText = `
        position: fixed;
        bottom: 10px;
        left: 10px;
        padding: 8px 12px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        border-radius: 4px;
        font-size: 12px;
        z-index: 1000;
        transition: opacity 0.3s;
      `;
      document.body.appendChild(this.statusElement);
    }
  }

  updateStatus(message, type = "info") {
    if (!this.statusElement) {
      return;
    }

    this.statusElement.textContent = message;

    // Set color based on type
    const colors = {
      info: "#4A90E2",
      success: "#7ED321",
      warning: "#F5A623",
      error: "#D0021B",
    };

    this.statusElement.style.backgroundColor = colors[type] || colors.info;
    this.statusElement.style.opacity = "1";

    // Auto-hide after 3 seconds for non-error messages
    if (type !== "error") {
      setTimeout(() => {
        this.statusElement.style.opacity = "0.5";
      }, 3000);
    }
  }

  hide() {
    if (this.statusElement) {
      this.statusElement.style.opacity = "0";
    }
  }

  show() {
    if (this.statusElement) {
      this.statusElement.style.opacity = "1";
    }
  }
}
