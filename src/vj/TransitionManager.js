/**
 * TransitionManager.js
 *
 * Handles transitions between scenes with various effects.
 */

export class TransitionManager {
  constructor(editor) {
    this.editor = editor;

    this.isTransitioning = false;
    this.transitionProgress = 0;
    this.transitionType = 'crossfade';
    this.transitionDuration = 1.0; // seconds

    // Transition state
    this.fromSceneData = null;
    this.toSceneData = null;
    this.transitionStartTime = null;

    console.log('[TransitionManager] Initialized');
  }

  /**
   * Available transition types
   */
  static TRANSITIONS = {
    CROSSFADE: 'crossfade',
    CUT: 'cut',
    FADE_BLACK: 'fade_black',
    FADE_WHITE: 'fade_white'
  };

  /**
   * Start a transition from current scene to target scene
   * @param {Object} targetSceneData - Scene data to transition to
   * @param {string} type - Transition type
   * @param {number} duration - Transition duration in seconds
   */
  async startTransition(targetSceneData, type = 'crossfade', duration = 1.0) {
    if (this.isTransitioning) {
      console.warn('[TransitionManager] Transition already in progress');
      return false;
    }

    this.transitionType = type;
    this.transitionDuration = duration;
    this.isTransitioning = true;
    this.transitionProgress = 0;
    this.transitionStartTime = performance.now();

    console.log(`[TransitionManager] Starting ${type} transition (${duration}s)`);

    // Handle instant transitions
    if (type === TransitionManager.TRANSITIONS.CUT || duration === 0) {
      await this.editor.saveLoadManager.importProject(targetSceneData);
      this.completeTransition();
      return true;
    }

    // Handle animated transitions
    switch (type) {
      case TransitionManager.TRANSITIONS.CROSSFADE:
        await this.executeCrossfade(targetSceneData);
        break;

      case TransitionManager.TRANSITIONS.FADE_BLACK:
      case TransitionManager.TRANSITIONS.FADE_WHITE:
        await this.executeFade(targetSceneData, type);
        break;

      default:
        console.warn(`[TransitionManager] Unknown transition type: ${type}`);
        await this.editor.saveLoadManager.importProject(targetSceneData);
    }

    this.completeTransition();
    return true;
  }

  /**
   * Execute crossfade transition
   */
  async executeCrossfade(targetSceneData) {
    // Simplified transition: wait half duration, switch, wait half duration
    // TODO: Implement actual opacity blending in GPU renderer for smooth crossfade

    console.log(`[TransitionManager] Crossfade: waiting ${this.transitionDuration/2}s...`);
    await this.delay(this.transitionDuration / 2);

    // Load new scene
    await this.editor.saveLoadManager.importProject(targetSceneData);

    console.log(`[TransitionManager] Scene loaded, waiting ${this.transitionDuration/2}s...`);
    await this.delay(this.transitionDuration / 2);
  }

  /**
   * Execute fade through color transition
   */
  async executeFade(targetSceneData, type) {
    // Simplified transition: wait half duration, switch, wait half duration
    // TODO: Implement actual fade to black/white in GPU renderer

    console.log(`[TransitionManager] Fade: waiting ${this.transitionDuration/2}s...`);
    await this.delay(this.transitionDuration / 2);

    // Load new scene
    await this.editor.saveLoadManager.importProject(targetSceneData);

    console.log(`[TransitionManager] Scene loaded, waiting ${this.transitionDuration/2}s...`);
    await this.delay(this.transitionDuration / 2);
  }

  /**
   * Simple delay helper
   */
  async delay(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }

  /**
   * Animate opacity over time
   */
  async animateOpacity(fromOpacity, toOpacity, duration, startTime) {
    return new Promise(resolve => {
      const animate = () => {
        const elapsed = (performance.now() - startTime) / 1000;
        const t = Math.min(elapsed / duration, 1);
        const eased = this.easeInOutCubic(t);

        // Update transition progress
        this.transitionProgress = t;

        // Calculate current opacity
        const opacity = fromOpacity + (toOpacity - fromOpacity) * eased;

        // Apply opacity to all output nodes
        // Note: This is a simplified approach - in production you'd want
        // to modify the shader output directly
        this.applyMasterOpacity(opacity);

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          resolve();
        }
      };

      animate();
    });
  }

  /**
   * Apply master opacity (placeholder - needs shader integration)
   */
  applyMasterOpacity(opacity) {
    // This would need to be integrated with the GPU renderer
    // For now, this is a placeholder that could modify canvas alpha
    // or inject an opacity uniform into the shader

    if (this.editor.gpuCanvas) {
      // Placeholder: Would need actual GPU implementation
      // Could add a post-processing pass or modify output alpha
    }
  }

  /**
   * Easing function
   */
  easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /**
   * Complete the transition
   */
  completeTransition() {
    this.isTransitioning = false;
    this.transitionProgress = 0;
    this.fromSceneData = null;
    this.toSceneData = null;
    this.transitionStartTime = null;

    console.log('[TransitionManager] Transition complete');
  }

  /**
   * Cancel ongoing transition
   */
  cancelTransition() {
    if (!this.isTransitioning) return;

    this.completeTransition();
    console.log('[TransitionManager] Transition cancelled');
  }

  /**
   * Set transition type
   */
  setTransitionType(type) {
    if (!Object.values(TransitionManager.TRANSITIONS).includes(type)) {
      console.warn(`[TransitionManager] Invalid transition type: ${type}`);
      return false;
    }

    this.transitionType = type;
    return true;
  }

  /**
   * Set transition duration
   */
  setTransitionDuration(duration) {
    if (duration < 0) {
      console.warn('[TransitionManager] Duration must be positive');
      return false;
    }

    this.transitionDuration = duration;
    return true;
  }

  /**
   * Get transition status
   */
  getStatus() {
    return {
      isTransitioning: this.isTransitioning,
      progress: this.transitionProgress,
      type: this.transitionType,
      duration: this.transitionDuration
    };
  }
}
