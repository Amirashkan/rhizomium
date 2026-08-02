/**
 * PlaylistManager.js
 *
 * Manages playlist of scenes for automated playback.
 */

export class PlaylistManager {
  constructor(sceneManager, transitionManager) {
    this.sceneManager = sceneManager;
    this.transitionManager = transitionManager;

    // Playlist
    this.playlist = []; // Array of { sceneId, duration, transitionType, transitionDuration }
    this.currentIndex = -1;
    this.isPlaying = false;
    this.loop = true;

    // Playback state
    this.currentSceneStartTime = null;
    this.playbackTimer = null;

    // Set by the panel so playback that advances on its own (the auto-advance
    // timer, next/previous, a scene that failed to load) redraws the list
    // instead of leaving a stale "current" highlight behind.
    this.onStateChange = null;
  }

  /** Tell the UI something moved. Never let a listener break playback. */
  notifyStateChange() {
    if (typeof this.onStateChange !== 'function') return;
    try {
      this.onStateChange(this.getStatus());
    } catch {
      // A broken listener is not worth stopping the show for.
    }
  }

  /**
   * Add scene to playlist
   */
  addToPlaylist(sceneId, duration = null, transitionType = 'crossfade', transitionDuration = 1.0) {
    const scene = this.sceneManager.getScene(sceneId);
    if (!scene) {

      return false;
    }

    const playlistItem = {
      sceneId,
      duration: duration || scene.duration || 30, // Default 30 seconds
      transitionType,
      transitionDuration
    };

    this.playlist.push(playlistItem);
    this.notifyStateChange();
    return true;
  }

  /**
   * Remove scene from playlist
   */
  removeFromPlaylist(index) {
    if (index < 0 || index >= this.playlist.length) return false;

    this.playlist.splice(index, 1);

    // Adjust current index if needed
    if (this.currentIndex >= index && this.currentIndex > 0) {
      this.currentIndex--;
    }

    if (this.playlist.length === 0) {
      this.stop();
      this.currentIndex = -1;
    }

    this.notifyStateChange();
    return true;
  }

  /**
   * Move playlist item
   */
  movePlaylistItem(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= this.playlist.length) return false;
    if (toIndex < 0 || toIndex >= this.playlist.length) return false;

    const [item] = this.playlist.splice(fromIndex, 1);
    this.playlist.splice(toIndex, 0, item);

    // Adjust current index if needed
    if (this.currentIndex === fromIndex) {
      this.currentIndex = toIndex;
    } else if (fromIndex < this.currentIndex && toIndex >= this.currentIndex) {
      this.currentIndex--;
    } else if (fromIndex > this.currentIndex && toIndex <= this.currentIndex) {
      this.currentIndex++;
    }

    this.notifyStateChange();
    return true;
  }

  /**
   * Clear playlist
   */
  clearPlaylist() {
    this.stop();
    this.playlist = [];
    this.currentIndex = -1;
    this.notifyStateChange();
  }

  /**
   * Start playlist playback
   */
  async play(startIndex = 0) {
    if (this.playlist.length === 0) {
      return false;
    }

    if (this.isPlaying) {
      return false;
    }

    this.isPlaying = true;
    this.currentIndex = Math.min(Math.max(startIndex, 0), this.playlist.length - 1);

    await this.playCurrentScene();

    return true;
  }

  /**
   * Stop playlist playback
   */
  stop() {
    this.clearPlaybackTimer();

    const wasActive = this.isPlaying || this.currentIndex >= 0;
    this.isPlaying = false;
    // Stop rewinds; pause is the one that holds its place. Leaving the index
    // parked here made the next press of ▶ resume into an already-elapsed scene
    // and skip straight to the following one.
    this.currentIndex = -1;
    this.currentSceneStartTime = null;

    if (wasActive) {
      this.notifyStateChange();
    }
  }

  /**
   * Pause playlist playback
   */
  pause() {
    if (!this.isPlaying) return;

    this.isPlaying = false;
    this.clearPlaybackTimer();
    this.notifyStateChange();
  }

  /**
   * Resume playlist playback
   */
  resume() {
    if (this.isPlaying) return;

    if (this.currentIndex < 0 || this.currentIndex >= this.playlist.length) {
      // Nothing was paused - start from the top instead of reading a duration
      // off an item that isn't there.
      return this.play(0);
    }

    this.isPlaying = true;

    const elapsed = this.currentSceneStartTime === null
      ? 0
      : (performance.now() - this.currentSceneStartTime) / 1000;
    const remaining = this.playlist[this.currentIndex].duration - elapsed;

    if (remaining > 0) {
      this.scheduleNextScene(remaining);
    } else {
      this.next();
    }

    this.notifyStateChange();
    return true;
  }

  /**
   * Play next scene in playlist
   */
  async next() {
    if (this.playlist.length === 0) return;

    if (!this.isPlaying && this.currentIndex >= 0) {
      // Manual next
      this.currentIndex = (this.currentIndex + 1) % this.playlist.length;
      await this.playCurrentScene();
      return;
    }

    if (!this.isPlaying) {
      // Stopped: a manual next starts the sequence from the beginning.
      this.currentIndex = 0;
      await this.playCurrentScene();
      return;
    }

    this.currentIndex++;

    if (this.currentIndex >= this.playlist.length) {
      if (this.loop) {
        this.currentIndex = 0;
      } else {
        this.stop();
        return;
      }
    }

    await this.playCurrentScene();
  }

  /**
   * Play previous scene in playlist
   */
  async previous() {
    if (this.playlist.length === 0) return;

    if (this.currentIndex <= 0) {
      if (this.loop) {
        this.currentIndex = this.playlist.length - 1;
      } else {
        return;
      }
    } else {
      this.currentIndex--;
    }

    await this.playCurrentScene();
  }

  /**
   * Jump to specific scene in playlist
   */
  async jumpTo(index) {
    if (index < 0 || index >= this.playlist.length) return false;

    this.currentIndex = index;
    await this.playCurrentScene();
    return true;
  }

  /**
   * Play current scene
   */
  async playCurrentScene() {
    if (this.currentIndex < 0 || this.currentIndex >= this.playlist.length) {
      return;
    }

    const item = this.playlist[this.currentIndex];
    const scene = this.sceneManager.getScene(item.sceneId);

    if (!scene) {
      // The scene was removed since it was queued - drop the dead entry so the
      // playlist can't loop forever on an item that will never load.
      this.playlist.splice(this.currentIndex, 1);
      this.currentIndex--;
      await this.next();
      return;
    }

    this.notifyStateChange();

    // Perform transition. A scene that fails to load must not take playback with
    // it: the show carries on to the next item.
    try {
      await this.transitionManager.startTransition(
        scene.data,
        item.transitionType,
        item.transitionDuration
      );
    } catch {
      if (this.isPlaying) {
        this.scheduleNextScene(item.duration);
      }
      return;
    }

    // Update active scene in scene manager
    this.sceneManager.activeSceneId = item.sceneId;
    scene.lastUsed = Date.now();

    // Record start time
    this.currentSceneStartTime = performance.now();

    // Schedule next scene
    if (this.isPlaying) {
      this.scheduleNextScene(item.duration);
    }

    this.notifyStateChange();
  }

  /**
   * Schedule next scene playback
   */
  scheduleNextScene(delay) {
    this.clearPlaybackTimer();

    this.playbackTimer = setTimeout(() => {
      this.playbackTimer = null;
      if (this.isPlaying) {
        this.next();
      }
    }, Math.max(0, delay) * 1000);
  }

  /** Drop any pending auto-advance. */
  clearPlaybackTimer() {
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }
  }

  /**
   * Update playlist item
   */
  updatePlaylistItem(index, updates) {
    if (index < 0 || index >= this.playlist.length) return false;

    const item = this.playlist[index];

    if (updates.duration !== undefined) item.duration = updates.duration;
    if (updates.transitionType !== undefined) item.transitionType = updates.transitionType;
    if (updates.transitionDuration !== undefined) item.transitionDuration = updates.transitionDuration;

    this.notifyStateChange();
    return true;
  }

  /**
   * Get playlist info
   */
  getPlaylist() {
    return this.playlist.map((item, index) => {
      const scene = this.sceneManager.getScene(item.sceneId);
      return {
        index,
        sceneId: item.sceneId,
        sceneName: scene?.name || 'Unknown',
        duration: item.duration,
        transitionType: item.transitionType,
        transitionDuration: item.transitionDuration,
        isCurrent: index === this.currentIndex
      };
    });
  }

  /**
   * Get playback status
   */
  getStatus() {
    return {
      isPlaying: this.isPlaying,
      currentIndex: this.currentIndex,
      loop: this.loop,
      playlistLength: this.playlist.length
    };
  }

  /**
   * Toggle loop
   */
  toggleLoop() {
    this.loop = !this.loop;
    return this.loop;
  }

  /**
   * Export playlist
   */
  exportPlaylist() {
    return {
      version: 1,
      playlist: this.playlist,
      loop: this.loop
    };
  }

  /**
   * Import playlist
   */
  importPlaylist(data) {
    if (!data || !data.playlist) return false;

    try {
      this.stop();
      this.playlist = [...data.playlist];
      this.loop = data.loop !== undefined ? data.loop : true;
      this.currentIndex = -1;

      this.notifyStateChange();
      return true;
    } catch {

      return false;
    }
  }
}
