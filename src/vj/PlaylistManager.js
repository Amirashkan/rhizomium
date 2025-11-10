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

  }

  /**
   * Add scene to playlist
   */
  addToPlaylist(sceneId, duration = null, transitionType = 'crossfade', transitionDuration = 1.0) {
    const scene = this.sceneManager.getScene(sceneId);
    if (!scene) {
      console.error(`[PlaylistManager] Scene not found: ${sceneId}`);
      return false;
    }

    const playlistItem = {
      sceneId,
      duration: duration || scene.duration || 30, // Default 30 seconds
      transitionType,
      transitionDuration
    };

    this.playlist.push(playlistItem);
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

    return true;
  }

  /**
   * Clear playlist
   */
  clearPlaylist() {
    this.stop();
    this.playlist = [];
    this.currentIndex = -1;
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
    this.currentIndex = startIndex;

    await this.playCurrentScene();

    return true;
  }

  /**
   * Stop playlist playback
   */
  stop() {
    if (!this.isPlaying) return;

    this.isPlaying = false;
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }

  }

  /**
   * Pause playlist playback
   */
  pause() {
    if (!this.isPlaying) return;

    this.isPlaying = false;
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }

  }

  /**
   * Resume playlist playback
   */
  resume() {
    if (this.isPlaying) return;

    this.isPlaying = true;
    const elapsed = (performance.now() - this.currentSceneStartTime) / 1000;
    const remaining = this.playlist[this.currentIndex].duration - elapsed;

    if (remaining > 0) {
      this.scheduleNextScene(remaining);
    } else {
      this.next();
    }

  }

  /**
   * Play next scene in playlist
   */
  async next() {
    if (!this.isPlaying && this.currentIndex >= 0) {
      // Manual next
      this.currentIndex = (this.currentIndex + 1) % this.playlist.length;
      await this.playCurrentScene();
      return;
    }

    if (!this.isPlaying) return;

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
      console.error(`[PlaylistManager] Scene not found: ${item.sceneId}`);
      await this.next();
      return;
    }


    // Perform transition
    await this.transitionManager.startTransition(
      scene.data,
      item.transitionType,
      item.transitionDuration
    );

    // Update active scene in scene manager
    this.sceneManager.activeSceneId = item.sceneId;
    scene.lastUsed = Date.now();

    // Record start time
    this.currentSceneStartTime = performance.now();

    // Schedule next scene
    if (this.isPlaying) {
      this.scheduleNextScene(item.duration);
    }
  }

  /**
   * Schedule next scene playback
   */
  scheduleNextScene(delay) {
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
    }

    this.playbackTimer = setTimeout(() => {
      if (this.isPlaying) {
        this.next();
      }
    }, delay * 1000);
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

      return true;
    } catch (error) {
      console.error('[PlaylistManager] Failed to import playlist:', error);
      return false;
    }
  }
}
