/**
 * PanningTestScenarios.js
 * 
 * Predefined test scenarios for canvas panning performance testing.
 * Includes various panning patterns to test different performance characteristics.
 */

export const PanningTestScenarios = {
  /**
   * Simple horizontal panning
   */
  horizontalPan: {
    name: 'Horizontal Pan',
    description: 'Pan horizontally across the canvas',
    setup: async (canvas, viewport) => {
      // Setup initial state
      if (viewport) {
        viewport.offsetX = 0;
        viewport.offsetY = 0;
      }
    },
    onFrame: (frameNumber, timestamp, canvas, viewport, eventHandler) => {
      if (!viewport || !eventHandler) return;
      
      // Simulate horizontal panning
      const panSpeed = 5; // pixels per frame
      const startX = 100;
      const startY = 100;
      
      if (frameNumber === 0) {
        // Start pan
        if (viewport.startPan) {
          viewport.startPan(startX, startY);
        }
      } else {
        // Continue panning
        const currentX = startX + (frameNumber * panSpeed);
        if (viewport.updatePan) {
          viewport.updatePan(currentX, startY);
        }
        
        // Request redraw
        if (eventHandler._requestDraw) {
          eventHandler._requestDraw();
        }
      }
    },
    cleanup: async (viewport) => {
      if (viewport && viewport.stopPan) {
        viewport.stopPan();
      }
    }
  },
  
  /**
   * Vertical panning
   */
  verticalPan: {
    name: 'Vertical Pan',
    description: 'Pan vertically across the canvas',
    setup: async (canvas, viewport) => {
      if (viewport) {
        viewport.offsetX = 0;
        viewport.offsetY = 0;
      }
    },
    onFrame: (frameNumber, timestamp, canvas, viewport, eventHandler) => {
      if (!viewport || !eventHandler) return;
      
      const panSpeed = 5;
      const startX = 100;
      const startY = 100;
      
      if (frameNumber === 0) {
        if (viewport.startPan) {
          viewport.startPan(startX, startY);
        }
      } else {
        const currentY = startY + (frameNumber * panSpeed);
        if (viewport.updatePan) {
          viewport.updatePan(startX, currentY);
        }
        
        if (eventHandler._requestDraw) {
          eventHandler._requestDraw();
        }
      }
    },
    cleanup: async (viewport) => {
      if (viewport && viewport.stopPan) {
        viewport.stopPan();
      }
    }
  },
  
  /**
   * Diagonal panning
   */
  diagonalPan: {
    name: 'Diagonal Pan',
    description: 'Pan diagonally across the canvas',
    setup: async (canvas, viewport) => {
      if (viewport) {
        viewport.offsetX = 0;
        viewport.offsetY = 0;
      }
    },
    onFrame: (frameNumber, timestamp, canvas, viewport, eventHandler) => {
      if (!viewport || !eventHandler) return;
      
      const panSpeed = 5;
      const startX = 100;
      const startY = 100;
      
      if (frameNumber === 0) {
        if (viewport.startPan) {
          viewport.startPan(startX, startY);
        }
      } else {
        const currentX = startX + (frameNumber * panSpeed);
        const currentY = startY + (frameNumber * panSpeed);
        if (viewport.updatePan) {
          viewport.updatePan(currentX, currentY);
        }
        
        if (eventHandler._requestDraw) {
          eventHandler._requestDraw();
        }
      }
    },
    cleanup: async (viewport) => {
      if (viewport && viewport.stopPan) {
        viewport.stopPan();
      }
    }
  },
  
  /**
   * Circular panning pattern
   */
  circularPan: {
    name: 'Circular Pan',
    description: 'Pan in a circular pattern',
    setup: async (canvas, viewport) => {
      if (viewport) {
        viewport.offsetX = 0;
        viewport.offsetY = 0;
      }
    },
    onFrame: (frameNumber, timestamp, canvas, viewport, eventHandler) => {
      if (!viewport || !eventHandler) return;
      
      const radius = 200;
      const centerX = 400;
      const centerY = 300;
      const speed = 0.1; // radians per frame
      
      if (frameNumber === 0) {
        if (viewport.startPan) {
          viewport.startPan(centerX, centerY);
        }
      } else {
        const angle = frameNumber * speed;
        const currentX = centerX + Math.cos(angle) * radius;
        const currentY = centerY + Math.sin(angle) * radius;
        if (viewport.updatePan) {
          viewport.updatePan(currentX, currentY);
        }
        
        if (eventHandler._requestDraw) {
          eventHandler._requestDraw();
        }
      }
    },
    cleanup: async (viewport) => {
      if (viewport && viewport.stopPan) {
        viewport.stopPan();
      }
    }
  },
  
  /**
   * Fast panning (stress test)
   */
  fastPan: {
    name: 'Fast Pan',
    description: 'Fast panning to stress test performance',
    setup: async (canvas, viewport) => {
      if (viewport) {
        viewport.offsetX = 0;
        viewport.offsetY = 0;
      }
    },
    onFrame: (frameNumber, timestamp, canvas, viewport, eventHandler) => {
      if (!viewport || !eventHandler) return;
      
      const panSpeed = 20; // Fast panning
      const startX = 100;
      const startY = 100;
      
      if (frameNumber === 0) {
        if (viewport.startPan) {
          viewport.startPan(startX, startY);
        }
      } else {
        const currentX = startX + (frameNumber * panSpeed);
        if (viewport.updatePan) {
          viewport.updatePan(currentX, startY);
        }
        
        if (eventHandler._requestDraw) {
          eventHandler._requestDraw();
        }
      }
    },
    cleanup: async (viewport) => {
      if (viewport && viewport.stopPan) {
        viewport.stopPan();
      }
    }
  },
  
  /**
   * Slow panning (precision test)
   */
  slowPan: {
    name: 'Slow Pan',
    description: 'Slow panning to test precision and smoothness',
    setup: async (canvas, viewport) => {
      if (viewport) {
        viewport.offsetX = 0;
        viewport.offsetY = 0;
      }
    },
    onFrame: (frameNumber, timestamp, canvas, viewport, eventHandler) => {
      if (!viewport || !eventHandler) return;
      
      const panSpeed = 1; // Slow panning
      const startX = 100;
      const startY = 100;
      
      if (frameNumber === 0) {
        if (viewport.startPan) {
          viewport.startPan(startX, startY);
        }
      } else {
        const currentX = startX + (frameNumber * panSpeed);
        if (viewport.updatePan) {
          viewport.updatePan(currentX, startY);
        }
        
        if (eventHandler._requestDraw) {
          eventHandler._requestDraw();
        }
      }
    },
    cleanup: async (viewport) => {
      if (viewport && viewport.stopPan) {
        viewport.stopPan();
      }
    }
  },
  
  /**
   * Random panning pattern
   */
  randomPan: {
    name: 'Random Pan',
    description: 'Random panning pattern to test unpredictable scenarios',
    setup: async (canvas, viewport) => {
      if (viewport) {
        viewport.offsetX = 0;
        viewport.offsetY = 0;
      }
    },
    onFrame: (frameNumber, timestamp, canvas, viewport, eventHandler) => {
      if (!viewport || !eventHandler) return;
      
      const startX = 400;
      const startY = 300;
      const maxOffset = 200;
      
      if (frameNumber === 0) {
        if (viewport.startPan) {
          viewport.startPan(startX, startY);
        }
      } else {
        // Random offset within bounds
        const offsetX = (Math.random() - 0.5) * 2 * maxOffset;
        const offsetY = (Math.random() - 0.5) * 2 * maxOffset;
        const currentX = startX + offsetX;
        const currentY = startY + offsetY;
        
        if (viewport.updatePan) {
          viewport.updatePan(currentX, currentY);
        }
        
        if (eventHandler._requestDraw) {
          eventHandler._requestDraw();
        }
      }
    },
    cleanup: async (viewport) => {
      if (viewport && viewport.stopPan) {
        viewport.stopPan();
      }
    }
  },
  
  /**
   * Create a custom panning scenario
   */
  createCustom(name, description, onFrame, setup = null, cleanup = null) {
    return {
      name,
      description,
      setup: setup || (async () => {}),
      onFrame,
      cleanup: cleanup || (async () => {})
    };
  }
};

/**
 * Helper function to create a test scenario with editor context
 */
export function createPanningTestScenario(scenario, editor) {
  const canvas = editor?.canvas;
  const viewport = editor?.viewport;
  const eventHandler = editor?.eventHandler;
  
  return {
    name: scenario.name,
    description: scenario.description,
    setup: async () => {
      if (scenario.setup) {
        await scenario.setup(canvas, viewport);
      }
    },
    onFrame: (frameNumber, timestamp) => {
      if (scenario.onFrame) {
        scenario.onFrame(frameNumber, timestamp, canvas, viewport, eventHandler);
      }
    },
    cleanup: async () => {
      if (scenario.cleanup) {
        await scenario.cleanup(viewport);
      }
    }
  };
}

