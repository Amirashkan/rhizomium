// src/core/ServiceLocator.js - Dependency injection container
export class ServiceLocator {
  constructor() {
    this.services = new Map();
    this.instances = new Map();
  }

  register(name, serviceClass, singleton = true) {
    this.services.set(name, { serviceClass, singleton });
  }

  registerInstance(name, instance) {
    this.instances.set(name, instance);
  }

  get(name) {
    // Check if we have a direct instance
    if (this.instances.has(name)) {
      return this.instances.get(name);
    }

    // Check if we have a registered service
    if (!this.services.has(name)) {
      throw new Error(`Service '${name}' not found`);
    }

    const { serviceClass, singleton } = this.services.get(name);

    if (singleton) {
      // Create singleton instance if not exists
      if (!this.instances.has(name)) {
        const instance = new serviceClass();
        this.instances.set(name, instance);
      }
      return this.instances.get(name);
    } else {
      // Create new instance every time
      return new serviceClass();
    }
  }

  has(name) {
    return this.services.has(name) || this.instances.has(name);
  }

  clear() {
    this.services.clear();
    this.instances.clear();
  }
}
