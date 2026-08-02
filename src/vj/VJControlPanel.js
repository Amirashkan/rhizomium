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
import { setMasterOpacity } from './MasterOutput.js';
import { makeDraggable } from '../ui/utils/draggable.js';

// Siblings of SceneManager's 'rhizomium.vj.scenes'.
const PRESETS_STORAGE_KEY = 'rhizomium.vj.presets';
const PLAYLIST_STORAGE_KEY = 'rhizomium.vj.playlist';

function readStoredJSON(key) {
  try {
    const json = localStorage.getItem(key);
    return json ? JSON.parse(json) : null;
  } catch {
    // Unreadable or corrupt storage should not stop the panel from opening.
    return null;
  }
}

function writeStoredJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota exceeded, or storage blocked entirely.
    return false;
  }
}

// Values match TransitionManager.TRANSITIONS. Shared by the scenes tab's
// default-transition picker and the per-item picker on each playlist row.
const TRANSITION_TYPES = [
  { value: 'crossfade', label: 'Crossfade' },
  { value: 'cut', label: 'Cut' },
  { value: 'fade_black', label: 'Fade Black' },
  { value: 'fade_white', label: 'Fade White' }
];

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

    // Playback that advances on its own (auto-advance, next/previous, a scene
    // that dropped out) has to be able to redraw the list.
    this.playlistManager.onStateChange = () => this.syncPlaylistUI();
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
    this.header = header;

    // Drag by the header, like every other floating panel in the editor. The
    // helper ignores mousedown on buttons, so × still closes.
    this.cleanupDraggable = makeDraggable(this.container, header);
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
    TRANSITION_TYPES.forEach(({ value, label }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
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
    const saveAllBtn = this.createButton('💾 Save All', 'Save scenes, presets and playlist', () => this.saveAllScenes());

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

    // Add to playlist: pick any scene, loaded or not.
    const addGroup = document.createElement('div');
    addGroup.className = 'vj-button-group';

    this.playlistSceneSelect = document.createElement('select');
    this.playlistSceneSelect.className = 'vj-select';
    this.playlistSceneSelect.title = 'Scene to add';
    addGroup.appendChild(this.playlistSceneSelect);

    const addBtn = this.createButton('➕ Add', 'Add the selected scene to the playlist', () => {
      this.addSceneToPlaylist(this.playlistSceneSelect.value);
    });
    const clearBtn = this.createButton('🗑️ Clear Playlist', 'Clear all playlist items', () => this.clearPlaylist());

    addGroup.appendChild(addBtn);
    addGroup.appendChild(clearBtn);
    tab.appendChild(addGroup);

    this.contentArea.appendChild(tab);
  }

  /**
   * Keep the scene picker in step with the scene collection, holding the current
   * choice where it still exists.
   */
  refreshPlaylistSceneOptions() {
    if (!this.playlistSceneSelect) return;

    const scenes = this.sceneManager.getAllScenes();
    const previous = this.playlistSceneSelect.value;

    this.playlistSceneSelect.innerHTML = '';

    if (scenes.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No scenes available';
      this.playlistSceneSelect.appendChild(option);
      this.playlistSceneSelect.disabled = true;
      return;
    }

    this.playlistSceneSelect.disabled = false;
    scenes.forEach(scene => {
      const option = document.createElement('option');
      option.value = scene.id;
      option.textContent = scene.name;
      this.playlistSceneSelect.appendChild(option);
    });

    const keep = scenes.some(scene => scene.id === previous)
      ? previous
      : (this.sceneManager.activeSceneId && scenes.some(s => s.id === this.sceneManager.activeSceneId)
        ? this.sceneManager.activeSceneId
        : scenes[0].id);
    this.playlistSceneSelect.value = keep;
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
      // Reject out-of-range entries by snapping the field back, rather than
      // leaving it showing a tempo the clock never took.
      if (!this.beatSyncManager.setBPM(parseFloat(this.bpmInput.value))) {
        this.bpmInput.value = String(this.beatSyncManager.bpm);
      }
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
      this.setMasterOpacity(parseFloat(this.opacitySlider.value) / 100);
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
      this.setPlaybackSpeed(parseFloat(this.speedSlider.value) / 100);
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
    // The playlist's scene picker reads from the same collection.
    this.refreshPlaylistSceneOptions();

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

      // Queue straight from the scene list. Requiring a scene to be loaded
      // before it could be queued meant building a playlist tore down the graph
      // once per entry - and any scene that failed to load could never be added.
      const queueBtn = this.createButton('＋', 'Add to playlist', () => {
        this.addSceneToPlaylist(scene.id);
      });
      queueBtn.className = 'vj-btn-small';
      actions.appendChild(queueBtn);

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
        this.applyPreset(preset.id);
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
          this.applyPreset(preset.id);
        }
      };

      this.presetsArea.appendChild(presetCard);
    });
  }

  /**
   * Apply a preset, then redraw so the active marker lands on it. The redraw
   * waits for the transition to finish - an interpolated preset only becomes
   * the active one once it has arrived.
   */
  async applyPreset(presetId) {
    const transitionTime = parseFloat(this.presetTransitionInput.value) || 0;
    const applied = await this.presetManager.applyPreset(presetId, transitionTime);
    this.refreshPresets();
    return applied;
  }

  /**
   * Refresh playlist display
   */
  refreshPlaylist() {
    this.refreshPlaylistSceneOptions();
    this.updateTransportButtons();
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

      // How long the scene holds and how it arrives are the two things a set
      // gets built out of, so they are editable per row - PlaylistManager has
      // always had updatePlaylistItem, nothing ever called it.
      const itemDetails = document.createElement('div');
      itemDetails.className = 'vj-playlist-details';

      const durationInput = document.createElement('input');
      durationInput.type = 'number';
      durationInput.className = 'vj-input-tiny';
      durationInput.min = '0.1';
      durationInput.step = '0.5';
      durationInput.value = String(item.duration);
      durationInput.title = 'Seconds to hold this scene';
      durationInput.onchange = () => {
        const seconds = parseFloat(durationInput.value);
        if (!Number.isFinite(seconds) || seconds <= 0) {
          durationInput.value = String(item.duration);
          return;
        }
        this.playlistManager.updatePlaylistItem(index, { duration: seconds });
      };
      itemDetails.appendChild(durationInput);

      const unit = document.createElement('span');
      unit.textContent = 's';
      itemDetails.appendChild(unit);

      const transitionSelect = document.createElement('select');
      transitionSelect.className = 'vj-select-tiny';
      transitionSelect.title = 'Transition into this scene';
      TRANSITION_TYPES.forEach(({ value, label }) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        transitionSelect.appendChild(option);
      });
      transitionSelect.value = item.transitionType;
      transitionSelect.onchange = () => {
        this.playlistManager.updatePlaylistItem(index, { transitionType: transitionSelect.value });
      };
      itemDetails.appendChild(transitionSelect);

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

      // Click to jump to item - but not when the click was meant for the row's
      // own controls, or setting a duration would also load the scene.
      itemCard.onclick = (e) => {
        if (e.target.closest('.vj-playlist-actions')) return;
        if (e.target.closest('.vj-playlist-details')) return;
        this.playlistManager.jumpTo(index);
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
   * Save the whole VJ set - scenes, presets and playlist.
   */
  saveAllScenes() {
    if (this.saveToStorage()) {
      alert('Scenes, presets and playlist saved to browser storage');
    } else {
      alert('Could not save the VJ set - browser storage is full or unavailable.');
    }
  }

  /**
   * Switch to scene
   */
  async switchToScene(sceneId) {
    const transitionType = this.transitionTypeSelect.value;
    const transitionDuration = parseFloat(this.transitionDurationInput.value) || 0;

    const scene = this.sceneManager.getScene(sceneId);
    if (!scene) return false;

    try {
      await this.transitionManager.startTransition(
        scene.data,
        transitionType,
        transitionDuration
      );
    } catch (error) {
      // Surface the failure instead of leaving an unhandled rejection behind a
      // panel that looks like it did nothing.
      alert(`Failed to load scene "${scene.name}": ${error?.message || error}`);
      this.refreshScenes();
      return false;
    }

    this.sceneManager.activeSceneId = sceneId;
    scene.lastUsed = Date.now();
    this.refreshScenes();
    return true;
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
   * Add a scene to the playlist.
   *
   * Any scene can be queued, whether or not it is the one currently loaded -
   * a playlist is a list of scenes to come, so demanding that each be loaded
   * first made building one impossible past the first entry.
   */
  addSceneToPlaylist(sceneId) {
    const id = sceneId || this.sceneManager.activeSceneId;
    const scene = id ? this.sceneManager.getScene(id) : null;

    if (!scene) {
      alert('No scene to add. Capture or load a scene first.');
      return false;
    }

    const transitionType = this.transitionTypeSelect.value;
    // `|| 1.0` here turned a deliberate 0 back into a one-second fade, so an
    // instant change could not be queued at all.
    const parsedDuration = parseFloat(this.transitionDurationInput.value);
    const transitionDuration = Number.isFinite(parsedDuration) && parsedDuration >= 0
      ? parsedDuration
      : 1.0;

    const added = this.playlistManager.addToPlaylist(
      scene.id,
      scene.duration || 30,
      transitionType,
      transitionDuration
    );

    this.refreshPlaylist();
    return added;
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
    } else if (status.playlistLength === 0) {
      // Nothing queued - don't claim to be playing.
      this.updateTransportButtons();
      return;
    } else if (status.currentIndex < 0) {
      await this.playlistManager.play(0);
    } else {
      await this.playlistManager.resume();
    }

    this.updateTransportButtons();
  }

  /**
   * Stop playlist
   */
  stopPlaylist() {
    this.playlistManager.stop();
    this.refreshPlaylist();
  }

  /**
   * Transport buttons reflect real playback state, whoever changed it - the
   * play button used to be flipped by hand and would lie as soon as playback
   * ended, looped out, or ran off the end of a non-looping playlist.
   */
  updateTransportButtons() {
    const status = this.playlistManager.getStatus();
    const empty = status.playlistLength === 0;

    if (this.playlistPlayBtn) {
      this.playlistPlayBtn.textContent = status.isPlaying ? '⏸' : '▶';
      this.playlistPlayBtn.title = status.isPlaying ? 'Pause playlist' : 'Play playlist';
      this.playlistPlayBtn.disabled = empty;
    }
    if (this.playlistStopBtn) this.playlistStopBtn.disabled = empty;
    if (this.playlistPrevBtn) this.playlistPrevBtn.disabled = empty;
    if (this.playlistNextBtn) this.playlistNextBtn.disabled = empty;
  }

  /**
   * Redraw the playlist tab in response to playback state changes. Only when
   * that tab is on screen - rebuilding hidden DOM mid-show is wasted work.
   */
  syncPlaylistUI() {
    if (!this.visible || this.activeTab !== 'playlist') return;

    // Rebuilding the rows destroys their inputs. If one is focused the user is
    // part-way through setting a duration or transition - leave it alone and
    // let the next refresh pick the change up.
    const focused = document.activeElement;
    if (focused && this.playlistItems.contains(focused)) return;

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
   * Master opacity fader.
   *
   * Goes through MasterOutput rather than writing the canvas directly, so a
   * scene transition running at the same time composes with the fader instead of
   * one overwriting the other.
   */
  setMasterOpacity(opacity) {
    const clamped = Math.min(1, Math.max(0, Number.isFinite(opacity) ? opacity : 1));
    this.masterOpacity = clamped;

    const percent = Math.round(clamped * 100);
    if (this.opacitySlider && this.opacitySlider.value !== String(percent)) {
      this.opacitySlider.value = String(percent);
    }
    if (this.opacityValue) this.opacityValue.textContent = `${percent}%`;

    setMasterOpacity(clamped);
    return clamped;
  }

  /**
   * Playback speed fader - drives the render loop's time scale.
   */
  setPlaybackSpeed(speed) {
    const clamped = Math.min(4, Math.max(0, Number.isFinite(speed) ? speed : 1));
    this.playbackSpeed = clamped;

    const percent = Math.round(clamped * 100);
    if (this.speedSlider && this.speedSlider.value !== String(percent)) {
      this.speedSlider.value = String(percent);
    }
    if (this.speedValue) this.speedValue.textContent = `${clamped.toFixed(2)}x`;

    this.applyPlaybackSpeed();
    return clamped;
  }

  /**
   * Apply playback speed
   *
   * Preview settings own the render loop's time scale, so route through them
   * where possible - that keeps the settings window's own speed control in sync
   * and reuses the code path that already refreshes the preview. The fallback
   * covers the panel running before the floating preview exists.
   */
  applyPlaybackSpeed() {
    const scale = this.playbackSpeed;

    const previewSettings = typeof window !== 'undefined' ? window.floatingPreview?.settings : null;
    if (previewSettings && typeof previewSettings.updateSetting === 'function') {
      previewSettings.updateSetting('timeScale', scale);
      return;
    }

    if (typeof window !== 'undefined') {
      window.timeScale = scale;
      if (window.expressionSystem) {
        window.expressionSystem.timeScale = scale;
      }
      window.renderLoop?.setTimeScale?.(scale);
      window.renderLoop?.renderNow?.({ advance: false });
    }

    if (this.editor) {
      this.editor.timeScale = scale;
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
            this.applyPreset(presets[fNum - 1].id);
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

    // The beat clock was never started, so BPM and tap tempo drove nothing and
    // the indicator sat blank. Run it while the panel is open.
    this.beatSyncManager.start();
  }

  /**
   * Hide panel
   */
  hide() {
    this.visible = false;
    this.container.style.display = 'none';

    // No need to burn a frame callback on an indicator nobody can see.
    this.beatSyncManager.pause();
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
   * Load from storage.
   *
   * Scenes were the only thing ever restored, so presets and playlists - which
   * take a set apart and rebuild it - vanished on every reload.
   */
  loadFromStorage() {
    this.sceneManager.loadFromLocalStorage();

    const presets = readStoredJSON(PRESETS_STORAGE_KEY);
    if (presets) this.presetManager.importPresets(presets);

    const playlist = readStoredJSON(PLAYLIST_STORAGE_KEY);
    if (playlist) {
      this.playlistManager.importPlaylist(playlist);
      if (this.playlistLoopCheck) {
        this.playlistLoopCheck.checked = this.playlistManager.loop;
      }
    }
  }

  /**
   * Save to storage. Returns false if any part could not be written, so the
   * caller can tell the user rather than claiming a save that did not happen.
   */
  saveToStorage() {
    const scenesSaved = this.sceneManager.saveToLocalStorage();
    const presetsSaved = writeStoredJSON(PRESETS_STORAGE_KEY, this.presetManager.exportPresets());
    const playlistSaved = writeStoredJSON(PLAYLIST_STORAGE_KEY, this.playlistManager.exportPlaylist());

    return scenesSaved && presetsSaved && playlistSaved;
  }
}
