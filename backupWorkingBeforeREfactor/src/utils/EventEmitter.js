// src/utils/EventEmitter.js - Simple event system
export class EventEmitter {
  constructor() {
    this.events = new Map();
  }

  on(event, handler) {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event).add(handler);

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  off(event, handler) {
    if (this.events.has(event)) {
      this.events.get(event).delete(handler);
    }
  }

  emit(event, data) {
    if (this.events.has(event)) {
      this.events.get(event).forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  once(event, handler) {
    const onceHandler = (data) => {
      handler(data);
      this.off(event, onceHandler);
    };
    return this.on(event, onceHandler);
  }

  removeAllListeners(event = null) {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
  }

  listenerCount(event) {
    return this.events.has(event) ? this.events.get(event).size : 0;
  }
}
