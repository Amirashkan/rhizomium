// src/utils/RedrawTriggerSimulator.js
// Simulates background operations to test redraw trigger detection

export class RedrawTriggerSimulator {
  constructor() {
    this.simulations = new Map();
    this.isRunning = false;
  }

  /**
   * Simulate auto-save operations
   */
  simulateAutoSave(interval = 30000, duration = 60000) {
    const id = `autosave_${Date.now()}`;
    let count = 0;
    const maxCount = Math.floor(duration / interval);

    const intervalId = setInterval(() => {
      count++;
      
      // Simulate auto-save triggering a redraw
      if (window.editor && window.editor.markDirty) {
        window.editor.markDirty('simulated-autosave');
      }
      if (window.editor && window.editor.draw) {
        window.editor.draw();
      }

      if (count >= maxCount) {
        clearInterval(intervalId);
        this.simulations.delete(id);
      }
    }, interval);

    this.simulations.set(id, {
      type: 'autosave',
      intervalId,
      count: 0,
      maxCount
    });

    console.log(`[RedrawTriggerSimulator] Started auto-save simulation: ${id}`);
    return id;
  }

  /**
   * Simulate background sync operations
   */
  simulateBackgroundSync(interval = 10000, duration = 60000) {
    const id = `sync_${Date.now()}`;
    let count = 0;
    const maxCount = Math.floor(duration / interval);

    const intervalId = setInterval(() => {
      count++;
      
      // Simulate sync operation
      if (window.editor && window.editor.markDirty) {
        window.editor.markDirty('simulated-sync');
      }

      if (count >= maxCount) {
        clearInterval(intervalId);
        this.simulations.delete(id);
      }
    }, interval);

    this.simulations.set(id, {
      type: 'sync',
      intervalId,
      count: 0,
      maxCount
    });

    console.log(`[RedrawTriggerSimulator] Started background sync simulation: ${id}`);
    return id;
  }

  /**
   * Simulate observer-triggered updates
   */
  simulateObserverUpdates(interval = 5000, duration = 60000) {
    const id = `observer_${Date.now()}`;
    let count = 0;
    const maxCount = Math.floor(duration / interval);

    // Create a dummy element and observer
    const element = document.createElement('div');
    element.style.display = 'none';
    document.body.appendChild(element);

    const observer = new MutationObserver(() => {
      if (window.editor && window.editor.markDirty) {
        window.editor.markDirty('simulated-observer');
      }
    });

    observer.observe(element, { attributes: true });

    const intervalId = setInterval(() => {
      count++;
      
      // Trigger mutation
      element.setAttribute('data-update', count.toString());

      if (count >= maxCount) {
        clearInterval(intervalId);
        observer.disconnect();
        document.body.removeChild(element);
        this.simulations.delete(id);
      }
    }, interval);

    this.simulations.set(id, {
      type: 'observer',
      intervalId,
      observer,
      element,
      count: 0,
      maxCount
    });

    console.log(`[RedrawTriggerSimulator] Started observer simulation: ${id}`);
    return id;
  }

  /**
   * Simulate worker message spam
   */
  simulateWorkerMessages(interval = 1000, duration = 60000) {
    const id = `worker_${Date.now()}`;
    let count = 0;
    const maxCount = Math.floor(duration / interval);

    // Create a dummy worker (inline worker)
    const workerCode = `
      setInterval(() => {
        self.postMessage({ type: 'update', count: Date.now() });
      }, ${interval});
    `;
    
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));

    worker.onmessage = (_event) => {
      // Simulate worker message triggering a redraw
      if (window.editor && window.editor.markDirty) {
        window.editor.markDirty('simulated-worker-message');
      }
    };

    const timeoutId = setTimeout(() => {
      worker.terminate();
      URL.revokeObjectURL(blob);
      this.simulations.delete(id);
    }, duration);

    this.simulations.set(id, {
      type: 'worker',
      worker,
      timeoutId,
      count: 0,
      maxCount
    });

    console.log(`[RedrawTriggerSimulator] Started worker simulation: ${id}`);
    return id;
  }

  /**
   * Simulate requestAnimationFrame spam
   */
  simulateRAFSpam(duration = 60000) {
    const id = `raf_${Date.now()}`;
    let startTime = performance.now();
    let frameCount = 0;

    const animate = () => {
      frameCount++;
      
      // Simulate RAF triggering redraws
      if (window.editor && window.editor.markDirty) {
        window.editor.markDirty('simulated-raf');
      }

      if (performance.now() - startTime < duration) {
        requestAnimationFrame(animate);
      } else {
        this.simulations.delete(id);
      }
    };

    requestAnimationFrame(animate);

    this.simulations.set(id, {
      type: 'raf',
      frameCount: 0,
      startTime
    });

    console.log(`[RedrawTriggerSimulator] Started RAF simulation: ${id}`);
    return id;
  }

  /**
   * Stop a specific simulation
   */
  stopSimulation(simulationId) {
    const sim = this.simulations.get(simulationId);
    if (!sim) return false;

    if (sim.intervalId) {
      clearInterval(sim.intervalId);
    }
    if (sim.timeoutId) {
      clearTimeout(sim.timeoutId);
    }
    if (sim.observer) {
      sim.observer.disconnect();
    }
    if (sim.element) {
      document.body.removeChild(sim.element);
    }
    if (sim.worker) {
      sim.worker.terminate();
    }

    this.simulations.delete(simulationId);
    console.log(`[RedrawTriggerSimulator] Stopped simulation: ${simulationId}`);
    return true;
  }

  /**
   * Stop all simulations
   */
  stopAll() {
    const ids = Array.from(this.simulations.keys());
    ids.forEach(id => this.stopSimulation(id));
    console.log(`[RedrawTriggerSimulator] Stopped all simulations`);
  }

  /**
   * Run a comprehensive test suite
   */
  runTestSuite(duration = 60000) {
    console.log(`[RedrawTriggerSimulator] Starting test suite (${duration/1000}s)`);
    
    const simulations = [
      this.simulateAutoSave(30000, duration),
      this.simulateBackgroundSync(10000, duration),
      this.simulateObserverUpdates(5000, duration),
      this.simulateWorkerMessages(1000, duration),
      this.simulateRAFSpam(duration)
    ];

    // Auto-stop after duration
    setTimeout(() => {
      this.stopAll();
      console.log(`[RedrawTriggerSimulator] Test suite completed`);
    }, duration);

    return simulations;
  }

  /**
   * Get active simulations
   */
  getActiveSimulations() {
    return Array.from(this.simulations.entries()).map(([id, sim]) => ({
      id,
      type: sim.type,
      count: sim.count || 0,
      maxCount: sim.maxCount || 0
    }));
  }
}

// Global instance
let globalSimulator = null;

/**
 * Get or create global simulator instance
 */
export function getRedrawTriggerSimulator() {
  if (!globalSimulator) {
    globalSimulator = new RedrawTriggerSimulator();
  }
  return globalSimulator;
}

// Expose to window
if (typeof window !== 'undefined') {
  window.RedrawTriggerSimulator = RedrawTriggerSimulator;
  window.getRedrawTriggerSimulator = getRedrawTriggerSimulator;
}

