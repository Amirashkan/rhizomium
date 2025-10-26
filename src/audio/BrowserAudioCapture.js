/**
 * BrowserAudioCapture.js - Handles browser audio file loading with Web Audio API
 * Fixes: HTMLMediaElement can only be connected to one MediaElementSourceNode
 */

export class BrowserAudioCapture {
  constructor() {
    this.audioContext = null;
    this.audioElement = null;
    this.sourceNode = null;
    this.analyser = null;
    this.gainNode = null;
    this.currentFile = null;
  }

  /**
   * Initialize the audio context (must be called after user interaction)
   */
  initialize() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      console.log('[BrowserAudio] AudioContext initialized');
    }
    return this.audioContext;
  }

  /**
   * Load an audio file
   * FIX: Creates a new audio element each time to avoid the
   * "HTMLMediaElement already connected" error
   */
  async loadFile(file) {
    try {
      console.log('[BrowserAudio] Loading file:', file.name);

      // Ensure audio context is initialized
      if (!this.audioContext) {
        this.initialize();
      }

      // Resume audio context if suspended (browser autoplay policy)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // IMPORTANT: Clean up previous audio element and source
      this.cleanup();

      // Create a NEW audio element each time
      // This avoids the "already connected" error
      this.audioElement = new Audio();
      this.audioElement.crossOrigin = 'anonymous';

      // Create object URL for the file
      const fileURL = URL.createObjectURL(file);
      this.audioElement.src = fileURL;

      // Set up audio element properties
      this.audioElement.loop = false;
      this.audioElement.volume = 1.0;

      // Wait for the audio to be loadable
      await new Promise((resolve, reject) => {
        this.audioElement.addEventListener('canplaythrough', resolve, { once: true });
        this.audioElement.addEventListener('error', (e) => {
          reject(new Error(`Audio load error: ${e.message || 'Unknown error'}`));
        }, { once: true });

        // Start loading
        this.audioElement.load();

        // Timeout after 10 seconds
        setTimeout(() => reject(new Error('Audio load timeout')), 10000);
      });

      // NOW create the MediaElementSourceNode
      // Since we created a fresh audio element, it's not connected to anything
      this.sourceNode = this.audioContext.createMediaElementSource(this.audioElement);

      // Create analyser for visualization
      if (!this.analyser) {
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;
      }

      // Create gain node if it doesn't exist
      if (!this.gainNode) {
        this.gainNode = this.audioContext.createGain();
      }

      // Connect the audio graph:
      // source -> analyser -> gain -> destination
      this.sourceNode.connect(this.analyser);
      this.analyser.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);

      this.currentFile = file;

      console.log('[BrowserAudio] File loaded successfully:', file.name);
      console.log('[BrowserAudio] Audio duration:', this.audioElement.duration, 'seconds');

      return {
        success: true,
        duration: this.audioElement.duration,
        fileName: file.name
      };

    } catch (error) {
      console.error('[BrowserAudio] Failed to load file:', error);
      this.cleanup();
      throw error;
    }
  }

  /**
   * Clean up audio resources
   * IMPORTANT: This prevents memory leaks and connection errors
   */
  cleanup() {
    // Disconnect and clean up source node
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (e) {
        // Already disconnected, ignore
      }
      this.sourceNode = null;
    }

    // Clean up the audio element
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.src = '';

      // Revoke the object URL to free memory
      if (this.audioElement.src.startsWith('blob:')) {
        URL.revokeObjectURL(this.audioElement.src);
      }

      this.audioElement.load(); // Clears the element
      this.audioElement = null;
    }

    this.currentFile = null;
  }

  /**
   * Play the loaded audio
   */
  play() {
    if (this.audioElement) {
      this.audioElement.play().catch(err => {
        console.error('[BrowserAudio] Play failed:', err);
      });
    }
  }

  /**
   * Pause the audio
   */
  pause() {
    if (this.audioElement) {
      this.audioElement.pause();
    }
  }

  /**
   * Stop and reset the audio
   */
  stop() {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
    }
  }

  /**
   * Set the volume (0.0 to 1.0)
   */
  setVolume(value) {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(1, value));
    }
  }

  /**
   * Get frequency data for visualization
   */
  getFrequencyData() {
    if (!this.analyser) return null;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);

    return dataArray;
  }

  /**
   * Get time domain data (waveform)
   */
  getWaveformData() {
    if (!this.analyser) return null;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteTimeDomainData(dataArray);

    return dataArray;
  }

  /**
   * Destroy the entire audio system
   */
  destroy() {
    this.cleanup();

    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch (e) {
        // Already disconnected
      }
      this.analyser = null;
    }

    if (this.gainNode) {
      try {
        this.gainNode.disconnect();
      } catch (e) {
        // Already disconnected
      }
      this.gainNode = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(err => {
        console.warn('[BrowserAudio] Failed to close AudioContext:', err);
      });
      this.audioContext = null;
    }

    console.log('[BrowserAudio] Destroyed');
  }
}
