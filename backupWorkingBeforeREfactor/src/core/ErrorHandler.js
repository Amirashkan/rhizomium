// src/core/ErrorHandler.js - Centralized error handling
import { EventEmitter } from "../utils/EventEmitter.js";

export class ErrorHandler extends EventEmitter {
  constructor() {
    super();
    this.errors = [];
    this.maxErrors = 50; // Keep last 50 errors
  }

  handleError(error, context = {}) {
    const errorRecord = {
      id: this.generateErrorId(),
      timestamp: Date.now(),
      message: error.message || String(error),
      stack: error.stack,
      context,
      type: this.categorizeError(error, context),
    };

    this.errors.unshift(errorRecord);
    if (this.errors.length > this.maxErrors) {
      this.errors = this.errors.slice(0, this.maxErrors);
    }

    console.error(`[${errorRecord.type}] ${errorRecord.message}`, error);

    this.emit("error", errorRecord);

    return errorRecord;
  }

  categorizeError(error, context) {
    if (context.type) return context.type;

    if (error.name === "TypeError") return "type-error";
    if (error.message?.includes("WebGPU")) return "webgpu-error";
    if (error.message?.includes("shader")) return "shader-error";
    if (error.message?.includes("texture")) return "texture-error";
    if (error.message?.includes("compile")) return "compilation-error";
    if (context.component) return `${context.component}-error`;

    return "unknown-error";
  }

  generateErrorId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  getRecentErrors(count = 10) {
    return this.errors.slice(0, count);
  }

  clearErrors() {
    this.errors = [];
    this.emit("errors-cleared");
  }

  getErrorsByType(type) {
    return this.errors.filter((error) => error.type === type);
  }
}
