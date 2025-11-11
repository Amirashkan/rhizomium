/**
 * VJControlPanel.js
 *
 * Main UI component for VJ control interface.
 * Provides scene management, transitions, playlist, and performance controls.
 */

import { SceneManager } from './SceneManager.js';
import { PresetManager } from './PresetManager.js';
import { TransitionManager } from './TransitionManager.js';
import { PlaylistManager } from './PlaylistManager.js';
import { BeatSyncManager } from './BeatSyncManager.js';

export class VJControlPanel {
  constructor(editor) {
    this.editor = editor;

    // Initialize managers
    this.sceneManager = new SceneManager(editor, editor.saveLoadManager);
    this.presetManager = new PresetManager(editor);
    this.transitionManager = new TransitionManager(editor);
    this.playlistManager = new PlaylistManager(this.sceneManager, this.transitionManager);
    this.beatSyncManager = new BeatSyncManager();

    // UI state
    this.visible = false;
    this.activeTab = 'scenes'; // 'scenes', 'presets', 'playlist'

    // Performance controls
    this.masterOpacity = 1.0;
    this.playbackSpeed = 1.0;

    this.createUI();
    this.attachEventListeners();
    this.loadFromStorage();

  }

  /**
   * Create the UI elements
   */
  createUI() {
    // Main container
    this.container = document.createElement('div');
    this.container.id = 'vj-control-panel';
    this.container.className = 'vj-control-panel';
    this.container.style.display = 'none';

    // Header
    this.createHeader();

    // Tab navigation
    this.createTabNavigation();

    // Content area
    this.contentArea = document.createElement('div');
    this.contentArea.className = 'vj-content-area';
    this.container.appendChild(this.contentArea);

    // Create tab contents
    this.createScenesTab();
    this.createPresetsTab();
    this.createPlaylistTab();

    // Footer with quick controls
    this.createFooter();

    // Add to document
    document.body.appendChild(this.container);
  }

  /**
   * Create header
   */
  createHeader() {
    const header = document.createElement('div');
    header.className = 'vj-header';

    const title = document.createElement('div');
    title.className = 'vj-title';
    title.textContent = '🎭 VJ Control';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'vj-close-btn';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close VJ Panel';
    closeBtn.onclick = () => this.hide();
    header.appendChild(closeBtn);

    this.container.appendChild(header);
  }

  /**
   * Create tab navigation
   */
  createTabNavigation() {
    const tabNav = document.createElement('div');
    tabNav.className = 'vj-tab-nav';

    const tabs = [
      { id: 'scenes', label: '🎬 Scenes', title: 'Scene management' },
      { id: 'presets', label: '⚡ Presets', title: 'Parameter presets' },
      { id: 'playlist', label: '📋 Playlist', title: 'Playlist & sequencing' }
    ];

    tabs.forEach(tab => {
      const btn = document.createElement('button');
      btn.className = 'vj-tab-btn';
      btn.textContent = tab.label;
      btn.title = tab.title;
      btn.dataset.tab = tab.id;
      btn.onclick = () => this.switchTab(tab.id);
      tabNav.appendChild(btn);
    });

    this.container.appendChild(tabNav);
  }

  /**
   * Create scenes tab
   */
  createScenesTab() {
    const tab = document.createElement('div');
    tab.className = 'vj-tab-content';
    tab.dataset.tab = 'scenes';

    // Scene buttons area
    const scenesArea = document.createElement('div');
    scenesArea.className = 'vj-scenes-area';
    tab.appendChild(scenesArea);

    this.scenesArea = scenesArea;

    // Transition controls
    const transitionGroup = document.createElement('div');
    transitionGroup.className = 'vj-control-group';

    const transitionLabel = document.createElement('label');
    transitionLabel.textContent = 'Transition';
    transitionGroup.appendChild(transitionLabel);

    const transitionRow = document.createElement('div');
    transitionRow.className = 'vj-control-row';

    // Transition type select
    this.transitionTypeSelect = document.createElement('select');
    this.transitionTypeSelect.className = 'vj-select';
    ['Crossfade', 'Cut', 'Fade Black', 'Fade White'].forEach(type => {
      const option = document.createElement('option');
      option.value = type.toLowerCase().replace(/\s+/g, '_');
      option.textContent = type;
      this.transitionTypeSelect.appendChild(option);
    });
    transitionRow.appendChild(this.transitionTypeSelect);

    // Duration input
    const durationLabel = document.createElement('span');
    durationLabel.textContent = 'Duration:';
    durationLabel.style.marginLeft = '8px';
    transitionRow.appendChild(durationLabel);

    this.transitionDurationInput = document.createElement('input');
    this.transitionDurationInput.type = 'number';
    this.transitionDurationInput.className = 'vj-input-small';
    this.transitionDurationInput.min = '0';
    this.transitionDurationInput.max = '10';
    this.transitionDurationInput.step = '0.1';
    this.transitionDurationInput.value = '1.0';
    transitionRow.appendChild(this.transitionDurationInput);

    const durationUnit = document.createElement('span');
    durationUnit.textContent = 's';
    durationUnit.style.marginLeft = '4px';
    transitionRow.appendChild(durationUnit);

    transitionGroup.appendChild(transitionRow);
    tab.appendChild(transitionGroup);

    // Scene management buttons
    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'vj-button-group';

    const loadBtn = this.createButton('📁 Load Scene', 'Load scene from file', () => this.loadSceneFromFile());
    const captureBtn = this.createButton('📸 Capture Current', 'Capture current state as scene', () => this.captureCurrentScene());
    const saveAllBtn = this.createButton('💾 Save All', 'Save all scenes', () => this.saveAllScenes());

    buttonGroup.appendChild(loadBtn);
    buttonGroup.appendChild(captureBtn);
    buttonGroup.appendChild(saveAllBtn);
    tab.appendChild(buttonGroup);

    this.contentArea.appendChild(tab);
  }

  /**
   * Create presets tab
   */
  createPresetsTab() {
    const tab = document.createElement('div');
    tab.className = 'vj-tab-content';
    tab.dataset.tab = 'presets';
    tab.style.display = 'none';

    // Presets area
    const presetsArea = document.createElement('div');
    presetsArea.className = 'vj-presets-area';
    tab.appendChild(presetsArea);

    this.presetsArea = presetsArea;

    // Preset controls
    const controlGroup = document.createElement('div');
    controlGroup.className = 'vj-control-group';

    const interpolationLabel = document.createElement('label');
    interpolationLabel.textContent = 'Transition Time';
    controlGroup.appendChild(interpolationLabel);

    this.presetTransitionInput = document.createElement('input');
    this.presetTransitionInput.type = 'number';
    this.presetTransitionInput.className = 'vj-input';
    this.presetTransitionInput.min = '0';
    this.presetTransitionInput.max = '5';
    this.presetTransitionInput.step = '0.1';
    this.presetTransitionInput.value = '0.5';
    this.presetTransitionInput.placeholder = 'seconds';
    controlGroup.appendChild(this.presetTransitionInput);

    tab.appendChild(controlGroup);

    // Preset management buttons
    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'vj-button-group';

    const captureBtn = this.createButton('📸 Capture Preset', 'Capture current parameters', () => this.capturePreset());
    const clearBtn = this.createButton('🗑️ Clear All', 'Clear all presets', () => this.clearPresets());

    buttonGroup.appendChild(captureBtn);
    buttonGroup.appendChild(clearBtn);
    tab.appendChild(buttonGroup);

    this.contentArea.appendChild(tab);
  }

  /**
   * Create playlist tab
   */
  createPlaylistTab() {
    const tab = document.createElement('div');
    tab.className = 'vj-tab-content';
    tab.dataset.tab = 'playlist';
    tab.style.display = 'none';

    // Playlist controls
    const playlistControls = document.createElement('div');
    playlistControls.className = 'vj-playlist-controls';

    this.playlistPlayBtn = this.createButton('▶', 'Play playlist', () => this.togglePlaylist());
    this.playlistStopBtn = this.createButton('■', 'Stop playlist', () => this.stopPlaylist());
    this.playlistPrevBtn = this.createButton('⏮', 'Previous scene', () => this.playlistManager.previous());
    this.playlistNextBtn = this.createButton('⏭', 'Next scene', () => this.playlistManager.next());

    const loopLabel = document.createElement('label');
    loopLabel.style.marginLeft = '8px';
    this.playlistLoopCheck = document.createElement('input');
    this.playlistLoopCheck.type = 'checkbox';
    this.playlistLoopCheck.checked = true;
    this.playlistLoopCheck.onchange = () => {
      this.playlistManager.loop = this.playlistLoopCheck.checked;
    };
    loopLabel.appendChild(this.playlistLoopCheck);
    loopLabel.appendChild(document.createTextNode(' Loop'));

    playlistControls.appendChild(this.playlistPlayBtn);
    playlistControls.appendChild(this.playlistStopBtn);
    playlistControls.appendChild(this.playlistPrevBtn);
    playlistControls.appendChild(this.playlistNextBtn);
    playlistControls.appendChild(loopLabel);

    tab.appendChild(playlistControls);

    // Playlist items
    const playlistItems = document.createElement('div');
    playlistItems.className = 'vj-playlist-items';
    tab.appendChild(playlistItems);

    this.playlistItems = playlistItems;

    // Add to playlist button
    const addGroup = document.createElement('div');
    addGroup.className = 'vj-button-group';

    const addBtn = this.createButton('➕ Add Active Scene', 'Add current scene to playlist', () => this.addActiveSceneToPlaylist());
    const clearBtn = this.createButton('🗑️ Clear Playlist', 'Clear all playlist items', () => this.clearPlaylist());

    addGroup.appendChild(addBtn);
    addGroup.appendChild(clearBtn);
    tab.appendChild(addGroup);

    this.contentArea.appendChild(tab);
  }

  /**
   * Create footer with quick controls
   */
  createFooter() {
    const footer = document.createElement('div');
    footer.className = 'vj-footer';

    // BPM controls
    const bpmGroup = document.createElement('div');
    bpmGroup.className = 'vj-control-group-inline';

    const bpmLabel = document.createElement('label');
    bpmLabel.textContent = 'BPM:';
    bpmGroup.appendChild(bpmLabel);

    this.bpmInput = document.createElement('input');
    this.bpmInput.type = 'number';
    this.bpmInput.className = 'vj-input-small';
    this.bpmInput.min = '30';
    this.bpmInput.max = '300';
    this.bpmInput.value = '120';
    this.bpmInput.onchange = () => {
      this.beatSyncManager.setBPM(parseFloat(this.bpmInput.value));
    };
    bpmGroup.appendChild(this.bpmInput);

    const tapBtn = this.createButton('👆 Tap', 'Tap tempo', () => this.tapTempo());
    tapBtn.className = 'vj-btn-small';
    bpmGroup.appendChild(tapBtn);

    // Beat indicator
    this.beatIndicator = document.createElement('div');
    this.beatIndicator.className = 'vj-beat-indicator';
    this.beatIndicator.textContent = '○○○○';
    bpmGroup.appendChild(this.beatIndicator);

    footer.appendChild(bpmGroup);

    // Quick controls separator
    const separator = document.createElement('div');
    separator.style.borderTop = '1px solid rgba(255,255,255,0.1)';
    separator.style.margin = '8px 0';
    footer.appendChild(separator);

    // Opacity control
    const opacityGroup = document.createElement('div');
    opacityGroup.className = 'vj-control-group-inline';

    const opacityLabel = document.createElement('label');
    opacityLabel.textContent = 'Opacity:';
    opacityGroup.appendChild(opacityLabel);

    this.opacitySlider = document.createElement('input');
    this.opacitySlider.type = 'range';
    this.opacitySlider.className = 'vj-slider';
    this.opacitySlider.min = '0';
    this.opacitySlider.max = '100';
    this.opacitySlider.value = '100';
    this.opacitySlider.oninput = () => {
      this.masterOpacity = parseFloat(this.opacitySlider.value) / 100;
      this.opacityValue.textContent = `${this.opacitySlider.value}%`;
    };
    opacityGroup.appendChild(this.opacitySlider);

    this.opacityValue = document.createElement('span');
    this.opacityValue.className = 'vj-value';
    this.opacityValue.textContent = '100%';
    opacityGroup.appendChild(this.opacityValue);

    footer.appendChild(opacityGroup);

    // Speed control
    const speedGroup = document.createElement('div');
    speedGroup.className = 'vj-control-group-inline';

    const speedLabel = document.createElement('label');
    speedLabel.textContent = 'Speed:';
    speedGroup.appendChild(speedLabel);

    this.speedSlider = document.createElement('input');
    this.speedSlider.type = 'range';
    this.speedSlider.className = 'vj-slider';
    this.speedSlider.min = '0';
    this.speedSlider.max = '200';
    this.speedSlider.value = '100';
    this.speedSlider.oninput = () => {
      this.playbackSpeed = parseFloat(this.speedSlider.value) / 100;
      this.speedValue.textContent = `${(this.playbackSpeed).toFixed(2)}x`;
      this.applyPlaybackSpeed();
    };
    speedGroup.appendChild(this.speedSlider);

    this.speedValue = document.createElement('span');
    this.speedValue.className = 'vj-value';
    this.speedValue.textContent = '1.00x';
    speedGroup.appendChild(this.speedValue);

    footer.appendChild(speedGroup);

    this.container.appendChild(footer);
  }

  /**
   * Switch tab
   */
  switchTab(tabId) {
    this.activeTab = tabId;

    // Update tab buttons
    const tabBtns = this.container.querySelectorAll('.vj-tab-btn');
    tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // Update tab content
    const tabContents = this.container.querySelectorAll('.vj-tab-content');
    tabContents.forEach(content => {
      content.style.display = content.dataset.tab === tabId ? 'block' : 'none';
    });

    // Refresh content
    this.refreshActiveTab();
  }

  /**
   * Refresh active tab content
   */
  refreshActiveTab() {
    switch (this.activeTab) {
      case 'scenes':
        this.refreshScenes();
        break;
      case 'presets':
        this.refreshPresets();
        break;
      case 'playlist':
        this.refreshPlaylist();
        break;
    }
  }

  /**
   * Refresh scenes display
   */
  refreshScenes() {
    this.scenesArea.innerHTML = '';

    const scenes = this.sceneManager.getAllScenes();

    if (scenes.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'vj-empty-message';
      emptyMsg.textContent = 'No scenes loaded. Load a scene or capture current state.';
      this.scenesArea.appendChild(emptyMsg);
      return;
    }

    scenes.forEach(scene => {
      const sceneCard = document.createElement('div');
      sceneCard.className = 'vj-scene-card';
      if (scene.id === this.sceneManager.activeSceneId) {
        sceneCard.classList.add('active');
      }

      const sceneName = document.createElement('div');
      sceneName.className = 'vj-scene-name';
      sceneName.textContent = scene.name;
      sceneCard.appendChild(sceneName);

      const sceneInfo = document.createElement('div');
      sceneInfo.className = 'vj-scene-info';
      sceneInfo.textContent = `${scene.duration}s`;
      sceneCard.appendChild(sceneInfo);

      const actions = document.createElement('div');
      actions.className = 'vj-scene-actions';

      const switchBtn = this.createButton('Load', 'Switch to this scene', () => {
        this.switchToScene(scene.id);
      });
      switchBtn.className = 'vj-btn-small';
      actions.appendChild(switchBtn);

      const deleteBtn = this.createButton('×', 'Remove scene', () => {
        if (confirm(`Remove scene "${scene.name}"?`)) {
          this.sceneManager.removeScene(scene.id);
          this.refreshScenes();
        }
      });
      deleteBtn.className = 'vj-btn-small vj-btn-danger';
      actions.appendChild(deleteBtn);

      sceneCard.appendChild(actions);

      // Click to switch
      sceneCard.onclick = (e) => {
        if (!e.target.closest('.vj-scene-actions')) {
          this.switchToScene(scene.id);
        }
      };

      this.scenesArea.appendChild(sceneCard);
    });
  }

  /**
   * Refresh presets display
   */
  refreshPresets() {
    this.presetsArea.innerHTML = '';

    const presets = this.presetManager.getAllPresets();

    if (presets.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'vj-empty-message';
      emptyMsg.textContent = 'No presets captured. Capture current parameters as a preset.';
      this.presetsArea.appendChild(emptyMsg);
      return;
    }

    presets.forEach(preset => {
      const presetCard = document.createElement('div');
      presetCard.className = 'vj-preset-card';
      if (preset.id === this.presetManager.activePresetId) {
        presetCard.classList.add('active');
      }

      const presetName = document.createElement('div');
      presetName.className = 'vj-preset-name';
      presetName.textContent = preset.name;
      presetCard.appendChild(presetName);

      const actions = document.createElement('div');
      actions.className = 'vj-preset-actions';

      const applyBtn = this.createButton('Apply', 'Apply this preset', () => {
        const transitionTime = parseFloat(this.presetTransitionInput.value) || 0;
        this.presetManager.applyPreset(preset.id, transitionTime);
        this.refreshPresets();
      });
      applyBtn.className = 'vj-btn-small';
      actions.appendChild(applyBtn);

      const deleteBtn = this.createButton('×', 'Delete preset', () => {
        if (confirm(`Delete preset "${preset.name}"?`)) {
          this.presetManager.deletePreset(preset.id);
          this.refreshPresets();
        }
      });
      deleteBtn.className = 'vj-btn-small vj-btn-danger';
      actions.appendChild(deleteBtn);

      presetCard.appendChild(actions);

      // Click to apply
      presetCard.onclick = (e) => {
        if (!e.target.closest('.vj-preset-actions')) {
          const transitionTime = parseFloat(this.presetTransitionInput.value) || 0;
          this.presetManager.applyPreset(preset.id, transitionTime);
          this.refreshPresets();
        }
      };

      this.presetsArea.appendChild(presetCard);
    });
  }

  /**
   * Refresh playlist display
   */
  refreshPlaylist() {
    this.playlistItems.innerHTML = '';

    const playlist = this.playlistManager.getPlaylist();

    if (playlist.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'vj-empty-message';
      emptyMsg.textContent = 'Playlist is empty. Add scenes to create a sequence.';
      this.playlistItems.appendChild(emptyMsg);
      return;
    }

    playlist.forEach((item, index) => {
      const itemCard = document.createElement('div');
      itemCard.className = 'vj-playlist-item';
      if (item.isCurrent) {
        itemCard.classList.add('current');
      }

      const itemNumber = document.createElement('div');
      itemNumber.className = 'vj-playlist-number';
      itemNumber.textContent = `${index + 1}.`;
      itemCard.appendChild(itemNumber);

      const itemInfo = document.createElement('div');
      itemInfo.className = 'vj-playlist-info';

      const itemName = document.createElement('div');
      itemName.className = 'vj-playlist-name';
      itemName.textContent = item.sceneName;
      itemInfo.appendChild(itemName);

      const itemDetails = document.createElement('div');
      itemDetails.className = 'vj-playlist-details';
      itemDetails.textContent = `${item.duration}s · ${item.transitionType}`;
      itemInfo.appendChild(itemDetails);

      itemCard.appendChild(itemInfo);

      const actions = document.createElement('div');
      actions.className = 'vj-playlist-actions';

      const upBtn = this.createButton('▲', 'Move up', () => {
        if (index > 0) {
          this.playlistManager.movePlaylistItem(index, index - 1);
          this.refreshPlaylist();
        }
      });
      upBtn.className = 'vj-btn-tiny';
      upBtn.disabled = index === 0;
      actions.appendChild(upBtn);

      const downBtn = this.createButton('▼', 'Move down', () => {
        if (index < playlist.length - 1) {
          this.playlistManager.movePlaylistItem(index, index + 1);
          this.refreshPlaylist();
        }
      });
      downBtn.className = 'vj-btn-tiny';
      downBtn.disabled = index === playlist.length - 1;
      actions.appendChild(downBtn);

      const deleteBtn = this.createButton('×', 'Remove from playlist', () => {
        this.playlistManager.removeFromPlaylist(index);
        this.refreshPlaylist();
      });
      deleteBtn.className = 'vj-btn-tiny vj-btn-danger';
      actions.appendChild(deleteBtn);

      itemCard.appendChild(actions);

      // Click to jump to item
      itemCard.onclick = (e) => {
        if (!e.target.closest('.vj-playlist-actions')) {
          this.playlistManager.jumpTo(index);
        }
      };

      this.playlistItems.appendChild(itemCard);
    });
  }

  /**
   * Helper to create button
   */
  createButton(text, title, onClick) {
    const btn = document.createElement('button');
    btn.className = 'vj-btn';
    btn.textContent = text;
    btn.title = title;
    btn.onclick = onClick;
    return btn;
  }

  /**
   * Load scene from file
   */
  async loadSceneFromFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.rhizo';

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        await this.sceneManager.loadSceneFromFile(file);
        this.refreshScenes();
      } catch (error) {
        alert(`Failed to load scene: ${error.message}`);
      }
    };

    input.click();
  }

  /**
   * Capture current scene
   */
  captureCurrentScene() {
    const name = prompt('Enter scene name:', 'Scene ' + (this.sceneManager.scenes.size + 1));
    if (!name) return;

    this.sceneManager.captureCurrentScene(name);
    this.refreshScenes();
  }

  /**
   * Save all scenes
   */
  saveAllScenes() {
    this.sceneManager.saveToLocalStorage();
    alert('Scenes saved to browser storage');
  }

  /**
   * Switch to scene
   */
  async switchToScene(sceneId) {
    const transitionType = this.transitionTypeSelect.value;
    const transitionDuration = parseFloat(this.transitionDurationInput.value) || 0;

    const scene = this.sceneManager.getScene(sceneId);
    if (!scene) return;

    await this.transitionManager.startTransition(
      scene.data,
      transitionType,
      transitionDuration
    );

    this.sceneManager.activeSceneId = sceneId;
    this.refreshScenes();
  }

  /**
   * Capture preset
   */
  capturePreset() {
    const name = prompt('Enter preset name:', 'Preset ' + (this.presetManager.presets.size + 1));
    if (!name) return;

    this.presetManager.capturePreset(name);
    this.refreshPresets();
  }

  /**
   * Clear presets
   */
  clearPresets() {
    if (!confirm('Clear all presets?')) return;

    this.presetManager.clear();
    this.refreshPresets();
  }

  /**
   * Add active scene to playlist
   */
  addActiveSceneToPlaylist() {
    const activeSceneId = this.sceneManager.activeSceneId;
    if (!activeSceneId) {
      alert('No active scene. Switch to a scene first.');
      return;
    }

    const transitionType = this.transitionTypeSelect.value;
    const transitionDuration = parseFloat(this.transitionDurationInput.value) || 1.0;
    const scene = this.sceneManager.getScene(activeSceneId);

    this.playlistManager.addToPlaylist(
      activeSceneId,
      scene?.duration || 30,
      transitionType,
      transitionDuration
    );

    this.refreshPlaylist();
  }

  /**
   * Clear playlist
   */
  clearPlaylist() {
    if (!confirm('Clear playlist?')) return;

    this.playlistManager.clearPlaylist();
    this.refreshPlaylist();
  }

  /**
   * Toggle playlist playback
   */
  async togglePlaylist() {
    const status = this.playlistManager.getStatus();

    if (status.isPlaying) {
      this.playlistManager.pause();
      this.playlistPlayBtn.textContent = '▶';
    } else {
      if (status.currentIndex < 0) {
        await this.playlistManager.play(0);
      } else {
        this.playlistManager.resume();
      }
      this.playlistPlayBtn.textContent = '⏸';
    }
  }

  /**
   * Stop playlist
   */
  stopPlaylist() {
    this.playlistManager.stop();
    this.playlistPlayBtn.textContent = '▶';
    this.refreshPlaylist();
  }

  /**
   * Tap tempo
   */
  tapTempo() {
    this.beatSyncManager.tap();
    this.bpmInput.value = this.beatSyncManager.bpm;
  }

  /**
   * Apply playback speed
   */
  applyPlaybackSpeed() {
    // This would need to be integrated with the timeline manager
    if (this.editor.timelineManager) {
      // Modify time scale
      // This is a placeholder - actual implementation would depend on
      // how the timeline manager handles playback speed
    }
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Beat sync visualization
    this.beatSyncManager.onBeat((beat) => {
      this.updateBeatIndicator(beat);
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (!this.visible) return;

      // Scene shortcuts (1-9)
      if (e.key >= '1' && e.key <= '9' && e.ctrlKey) {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        const scenes = this.sceneManager.getAllScenes();
        if (scenes[index]) {
          this.switchToScene(scenes[index].id);
        }
      }

      // Preset shortcuts (F1-F12)
      if (e.key.startsWith('F') && e.key.length <= 3) {
        const fNum = parseInt(e.key.substring(1));
        if (fNum >= 1 && fNum <= 12) {
          e.preventDefault();
          const presets = this.presetManager.getAllPresets();
          if (presets[fNum - 1]) {
            const transitionTime = parseFloat(this.presetTransitionInput.value) || 0;
            this.presetManager.applyPreset(presets[fNum - 1].id, transitionTime);
          }
        }
      }

      // Playlist controls
      if (e.code === 'Space' && e.shiftKey) {
        e.preventDefault();
        this.togglePlaylist();
      }
    });
  }

  /**
   * Update beat indicator
   */
  updateBeatIndicator(currentBeat) {
    const indicators = ['●○○○', '○●○○', '○○●○', '○○○●'];
    this.beatIndicator.textContent = indicators[currentBeat % 4];
  }

  /**
   * Show panel
   */
  show() {
    this.visible = true;
    this.container.style.display = 'flex';
    this.switchTab(this.activeTab);
  }

  /**
   * Hide panel
   */
  hide() {
    this.visible = false;
    this.container.style.display = 'none';
  }

  /**
   * Toggle panel
   */
  toggle() {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Load from storage
   */
  loadFromStorage() {
    this.sceneManager.loadFromLocalStorage();
  }

  /**
   * Save to storage
   */
  saveToStorage() {
    this.sceneManager.saveToLocalStorage();
  }
}
