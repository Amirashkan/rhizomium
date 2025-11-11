/**
 * BeatSyncManager.js
 *
 * Handles BPM synchronization and beat detection for VJ performance.
 */

export class BeatSyncManager {
  constructor() {
    this.bpm = 120;
    this.beatsPerMeasure = 4;
    this.beatDivision = 4; // 4 = quarter notes

    // Beat tracking
    this.isPlaying = false;
    this.startTime = null;
    this.pauseTime = 0;
    this.currentBeat = 0;
    this.currentMeasure = 0;

    // Tap tempo
    this.tapTimes = [];
    this.maxTapInterval = 2000; // ms

    // Sync callbacks
    this.beatCallbacks = [];
    this.measureCallbacks = [];

    // Animation frame
    this.animationFrame = null;

  }

  /**
   * Calculate beat duration in seconds
   */
  getBeatDuration() {
    return 60 / this.bpm;
  }

  /**
   * Calculate measure duration in seconds
   */
  getMeasureDuration() {
    return this.getBeatDuration() * this.beatsPerMeasure;
  }

  /**
   * Start beat sync
   */
  start() {
    if (this.isPlaying) return;

    this.isPlaying = true;
    this.startTime = performance.now() - this.pauseTime;
    this.update();

  }

  /**
   * Stop beat sync
   */
  stop() {
    if (!this.isPlaying) return;

    this.isPlaying = false;
    this.pauseTime = 0;
    this.currentBeat = 0;
    this.currentMeasure = 0;

    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

  }

  /**
   * Pause beat sync
   */
  pause() {
    if (!this.isPlaying) return;

    this.isPlaying = false;
    this.pauseTime = performance.now() - this.startTime;

    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

  }

  /**
   * Resume beat sync
   */
  resume() {
    if (this.isPlaying) return;

    this.isPlaying = true;
    this.startTime = performance.now() - this.pauseTime;
    this.update();

  }

  /**
   * Update loop
   */
  update() {
    if (!this.isPlaying) return;

    const elapsed = (performance.now() - this.startTime) / 1000;
    const beatDuration = this.getBeatDuration();

    // Calculate current beat and measure
    const totalBeats = elapsed / beatDuration;
    const newBeat = Math.floor(totalBeats % this.beatsPerMeasure);
    const newMeasure = Math.floor(totalBeats / this.beatsPerMeasure);

    // Check for beat change
    if (newBeat !== this.currentBeat) {
      this.currentBeat = newBeat;
      this.triggerBeatCallbacks(this.currentBeat);
    }

    // Check for measure change
    if (newMeasure !== this.currentMeasure) {
      this.currentMeasure = newMeasure;
      this.triggerMeasureCallbacks(this.currentMeasure);
    }

    this.animationFrame = requestAnimationFrame(() => this.update());
  }

  /**
   * Set BPM
   */
  setBPM(bpm) {
    if (bpm <= 0 || bpm > 300) {
      return false;
    }

    this.bpm = bpm;
    return true;
  }

  /**
   * Set beats per measure
   */
  setBeatsPerMeasure(beats) {
    if (beats <= 0 || beats > 16) {
      return false;
    }

    this.beatsPerMeasure = beats;
    return true;
  }

  /**
   * Tap tempo - call this on each tap
   */
  tap() {
    const now = Date.now();

    // Remove old taps
    this.tapTimes = this.tapTimes.filter(t => now - t < this.maxTapInterval);

    // Add new tap
    this.tapTimes.push(now);

    // Calculate BPM if we have enough taps
    if (this.tapTimes.length >= 2) {
      const intervals = [];
      for (let i = 1; i < this.tapTimes.length; i++) {
        intervals.push(this.tapTimes[i] - this.tapTimes[i - 1]);
      }

      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = Math.round(60000 / avgInterval);

      if (bpm >= 30 && bpm <= 300) {
        this.setBPM(bpm);
      }
    }

  }

  /**
   * Reset tap tempo
   */
  resetTap() {
    this.tapTimes = [];
  }

  /**
   * Register beat callback
   */
  onBeat(callback) {
    this.beatCallbacks.push(callback);
    return () => {
      this.beatCallbacks = this.beatCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Register measure callback
   */
  onMeasure(callback) {
    this.measureCallbacks.push(callback);
    return () => {
      this.measureCallbacks = this.measureCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Trigger beat callbacks
   */
  triggerBeatCallbacks(beat) {
    this.beatCallbacks.forEach(callback => {
      try {
        callback(beat, this.currentMeasure);
      } catch (error) {

      }
    });
  }

  /**
   * Trigger measure callbacks
   */
  triggerMeasureCallbacks(measure) {
    this.measureCallbacks.forEach(callback => {
      try {
        callback(measure);
      } catch (error) {

      }
    });
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      isPlaying: this.isPlaying,
      bpm: this.bpm,
      currentBeat: this.currentBeat,
      currentMeasure: this.currentMeasure,
      beatsPerMeasure: this.beatsPerMeasure
    };
  }

  /**
   * Sync to specific beat
   */
  syncToBeat(beat = 0) {
    const beatDuration = this.getBeatDuration();
    this.startTime = performance.now() - (beat * beatDuration * 1000);
    this.currentBeat = beat % this.beatsPerMeasure;
    this.currentMeasure = Math.floor(beat / this.beatsPerMeasure);
  }

  /**
   * Get time until next beat
   */
  getTimeUntilNextBeat() {
    if (!this.isPlaying) return 0;

    const elapsed = (performance.now() - this.startTime) / 1000;
    const beatDuration = this.getBeatDuration();
    const timeInBeat = elapsed % beatDuration;

    return beatDuration - timeInBeat;
  }

  /**
   * Get phase within current beat (0.0 to 1.0)
   */
  getBeatPhase() {
    if (!this.isPlaying) return 0;

    const elapsed = (performance.now() - this.startTime) / 1000;
    const beatDuration = this.getBeatDuration();
    const timeInBeat = elapsed % beatDuration;

    return timeInBeat / beatDuration;
  }
}
