/**
 * TransitionManager.js
 *
 * Handles transitions between scenes with various effects.
 */

import { setTransitionOpacity, clearTransitionOpacity } from './MasterOutput.js';

/**
 * How long a fade will wait for an animation frame before stepping itself.
 *
 * Long enough that it never beats rAF on a window that is being painted - the
 * slowest frame a rig in trouble serves is still well under this - and short
 * enough that a fade running in an unpainted window finishes in a few steps
 * rather than hanging. See runFade().
 */
const FADE_WATCHDOG_MS = 250;

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
    return this.runFade(duration, token, (eased, done) => {
      setTransitionOpacity(done ? toOpacity : fromOpacity + (toOpacity - fromOpacity) * eased);
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

    return this.runFade(duration, token, (eased, done) => {
      const opacity = done ? toOpacity : fromOpacity + (toOpacity - fromOpacity) * eased;
      overlay.style.opacity = opacity.toString();
    });
  }

  /**
   * Drive one fade to its end, and *guarantee* it gets there.
   *
   * The loop used to be a bare `requestAnimationFrame` recursion, and that is
   * the one shape of async work in this file that can simply stop. A window the
   * compositor is no longer painting - the editor behind a full-screen
   * projector output, a minimised laptop lid, a backgrounded tab - stops being
   * served frames, so the callback is never called again, the promise never
   * settles, and everything awaiting it waits for the rest of the night.
   *
   * That was not a dropped frame or two. `startTransition` awaits this, so the
   * await never returns: `completeTransition` in its `finally` never runs, the
   * output is left pinned at whatever opacity the last frame happened to write
   * - mid-crossfade, that is near zero - and the scene being faded to is never
   * imported. Upstream, ActionExecutor.doScene() clears `sceneChangeInFlight`
   * off this same promise, so a performance that hit it refused every later
   * scene change with "a scene change is already running" while the previous
   * look sat on the output, barely visible, still reacting to the music.
   *
   * So a timer is armed beside every frame request. Timers are throttled in a
   * background window but they are not suspended, which makes them the coarse,
   * reliable clock this needs: whichever of the two arrives first advances the
   * fade, and the other is cancelled. The visible result is unchanged when
   * frames are flowing - rAF always wins a race against a 250ms timer - and
   * when they are not, the fade still completes, just in bigger steps.
   *
   * @param {number} duration seconds
   * @param {number} token the transition this fade belongs to
   * @param {(eased: number, done: boolean) => void} write applies one step
   */
  runFade(duration, token, write) {
    const startTime = performance.now();

    return new Promise((resolve) => {
      let settled = false;
      let frame = 0;
      let timer = 0;

      const cancelPending = () => {
        if (timer) { clearTimeout(timer); timer = 0; }
        if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
        frame = 0;
      };

      const stop = () => {
        if (settled) return;
        settled = true;
        cancelPending();
        resolve();
      };

      const step = () => {
        if (settled) return;
        cancelPending();

        // Superseded. Stop writing, and leave the opacity alone - it belongs to
        // whichever transition took this one's place.
        if (token !== this.transitionToken) {
          stop();
          return;
        }

        const elapsed = (performance.now() - startTime) / 1000;
        const t = duration > 0 ? Math.min(elapsed / duration, 1) : 1;
        this.transitionProgress = t;

        if (t < 1) {
          write(this.easeInOutCubic(t), false);
          schedule();
          return;
        }

        // The end value exactly, rather than the easing's approach to it.
        write(1, true);
        stop();
      };

      const schedule = () => {
        if (settled) return;
        timer = setTimeout(step, FADE_WATCHDOG_MS);
        frame = requestAnimationFrame(step);
      };

      step();
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
