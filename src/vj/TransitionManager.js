/**
 * TransitionManager.js
 *
 * Handles transitions between scenes with various effects.
 */

import { setTransitionOpacity, clearTransitionOpacity } from './MasterOutput.js';

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

    // Bumped whenever a transition starts or is cancelled. A running fade
    // compares against it every frame and bails out the moment it is no longer
    // the current transition, so a superseded animation can't keep writing
    // opacity underneath its replacement.
    this.transitionToken = 0;
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
    // A transition already running is not a reason to refuse: a VJ retriggering
    // a scene mid-fade expects the new one to take over. Cancelling also means a
    // transition that threw part-way (a bad project file, say) can never leave
    // the manager latched and silently swallow every later scene change.
    if (this.isTransitioning) {
      this.cancelTransition();
    }

    this.transitionType = type;
    this.transitionDuration = duration;
    this.isTransitioning = true;
    this.transitionProgress = 0;
    this.transitionStartTime = performance.now();

    const token = ++this.transitionToken;

    try {
      // Handle instant transitions
      if (type === TransitionManager.TRANSITIONS.CUT || duration === 0) {
        await this.editor.saveLoadManager.importProject(targetSceneData);
        return true;
      }

      // Handle animated transitions
      switch (type) {
        case TransitionManager.TRANSITIONS.CROSSFADE:
          await this.executeCrossfade(targetSceneData, token);
          break;

        case TransitionManager.TRANSITIONS.FADE_BLACK:
        case TransitionManager.TRANSITIONS.FADE_WHITE:
          await this.executeFade(targetSceneData, type, token);
          break;

        default:
          await this.editor.saveLoadManager.importProject(targetSceneData);
      }

      return true;
    } finally {
      // Only the transition that is still current gets to tidy up - a
      // superseded one would otherwise clear the flag its replacement set.
      if (token === this.transitionToken) {
        this.completeTransition();
      }
    }
  }

  /**
   * Execute crossfade transition
   */
  async executeCrossfade(targetSceneData, token) {
    // Fade out current scene
    await this.fadeOutput(1.0, 0.0, this.transitionDuration / 2, token);

    // Load new scene at 0 opacity
    await this.editor.saveLoadManager.importProject(targetSceneData);

    // Fade in new scene
    await this.fadeOutput(0.0, 1.0, this.transitionDuration / 2, token);
  }

  /**
   * Execute fade through color transition
   */
  async executeFade(targetSceneData, type, token) {
    const color = type === TransitionManager.TRANSITIONS.FADE_BLACK ? 'black' : 'white';

    // Fade to color
    await this.fadeToColor(color, 0.0, 1.0, this.transitionDuration / 2, token);

    // Load new scene while color overlay is visible
    await this.editor.saveLoadManager.importProject(targetSceneData);

    // Fade from color
    await this.fadeToColor(color, 1.0, 0.0, this.transitionDuration / 2, token);
  }

  /**
   * Fade the rendered output. Goes through MasterOutput so the master fader in
   * the VJ panel keeps its say over the final opacity.
   */
  async fadeOutput(fromOpacity, toOpacity, duration, token = this.transitionToken) {
    const startTime = performance.now();

    return new Promise(resolve => {
      const animate = () => {
        if (token !== this.transitionToken) {
          resolve();
          return;
        }

        const elapsed = (performance.now() - startTime) / 1000;
        const t = duration > 0 ? Math.min(elapsed / duration, 1) : 1;
        const eased = this.easeInOutCubic(t);

        const opacity = fromOpacity + (toOpacity - fromOpacity) * eased;
        setTransitionOpacity(opacity);
        this.transitionProgress = t;

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          setTransitionOpacity(toOpacity);
          resolve();
        }
      };

      animate();
    });
  }

  /**
   * Fade to/from a color overlay
   */
  async fadeToColor(color, fromOpacity, toOpacity, duration, token = this.transitionToken) {
    // Create overlay if it doesn't exist
    let overlay = document.getElementById('vj-transition-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'vj-transition-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: none;
        z-index: 9999;
        opacity: 0;
      `;
      document.body.appendChild(overlay);
    }

    overlay.style.backgroundColor = color;

    const startTime = performance.now();

    return new Promise(resolve => {
      const animate = () => {
        if (token !== this.transitionToken) {
          resolve();
          return;
        }

        const elapsed = (performance.now() - startTime) / 1000;
        const t = duration > 0 ? Math.min(elapsed / duration, 1) : 1;
        const eased = this.easeInOutCubic(t);

        const opacity = fromOpacity + (toOpacity - fromOpacity) * eased;
        overlay.style.opacity = opacity.toString();
        this.transitionProgress = t;

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          overlay.style.opacity = toOpacity.toString();
          resolve();
        }
      };

      animate();
    });
  }

  /**
   * Simple delay helper
   */
  async delay(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
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

    // Hand the output back to the master fader. Without this, a transition that
    // ended (or threw) mid-fade would leave the render stuck at whatever
    // opacity the last animation frame wrote.
    clearTransitionOpacity();

    const overlay = document.getElementById('vj-transition-overlay');
    if (overlay) {
      overlay.style.opacity = '0';
    }
  }

  /**
   * Cancel ongoing transition
   */
  cancelTransition() {
    if (!this.isTransitioning) return;

    // Invalidate the running animation before clearing state so its next frame
    // stops instead of fading the output that the next transition now owns.
    this.transitionToken++;
    this.completeTransition();
  }

  /**
   * Set transition type
   */
  setTransitionType(type) {
    if (!Object.values(TransitionManager.TRANSITIONS).includes(type)) {
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
