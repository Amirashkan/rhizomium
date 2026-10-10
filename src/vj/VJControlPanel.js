/**
 * VJControlPanel.js
 *
 * Main UI component for VJ control interface.
 * Provides scene management, transitions, playlist, and performance controls.
 */

import { SceneManager } from './SceneManager.js';
import { runTransaction, VJ_SCENES_STORE } from '../core/rhizomiumDB.js';
import { setIcon } from '../ui/iconSprite.js';
import { PresetManager } from './PresetManager.js';
import { TransitionManager, VJ_SCENE_IMPORT_SOURCE } from './TransitionManager.js';
import { PlaylistManager } from './PlaylistManager.js';
import { BeatSyncManager } from './BeatSyncManager.js';
import { setMasterOpacity } from './MasterOutput.js';
import { makeDraggable } from '../ui/utils/draggable.js';
import { makeResizable } from '../ui/utils/resizable.js';
import { folderPickerKind, readDirectoryHandle, readFileList } from '../performer/ShowFolder.js';
import { readNarrationFolder, planNarration, applySceneTexts } from './NarrationImport.js';
import { refreshTextNodeTexture } from '../core/TextRasterizer.js';
import { AudioLibrary, formatBytes } from './AudioLibrary.js';
import { getAudioDeck } from '../audio/audioDeck.js';
import { getBrowserAudioCapture } from '../audio/BrowserAudioCapture.js';

// Siblings of SceneManager's 'rhizomium.vj.scenes'.
const PRESETS_STORAGE_KEY = 'rhizomium.vj.presets';
const PLAYLIST_STORAGE_KEY = 'rhizomium.vj.playlist';
const SETTINGS_STORAGE_KEY = 'rhizomium.vj.settings';

// The set last replaced by importSet(), kept beside the scenes so a New Project
// or an opened file can be undone with Restore Previous Set.
const PREVIOUS_SET_RECORD_ID = 'previous';

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

// How often auto-override looks for edits to write back into the live scene,
// and how long the scene set waits after the last write before going to disk.
const AUTO_OVERRIDE_INTERVAL_MS = 1500;
const AUTO_OVERRIDE_PERSIST_DELAY_MS = 1500;

// djb2 over the JSON, for an editor that has no _computeProjectHash.
function hashProject(projectData) {
  try {
    const str = JSON.stringify(projectData);
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return `${hash}:${str.length}`;
  } catch {
    return null;
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
  /**
   * @param {object} editor
   * @param {object} [options]
   * @param {AudioLibrary} [options.audioLibrary] the tests' in-memory library.
   * @param {object} [options.audioDeck] the transport tracks are loaded into;
   *   left out, the editor's own (src/audio/audioDeck.js).
   * @param {object} [options.audioClient] the capture client whose events say
   *   a track started, stopped or was replaced from elsewhere.
   */
  constructor(editor, options = {}) {
    this.editor = editor;

    // The audio tab's files, and the transport they are loaded into. The deck
    // and client are looked up on first use so a panel that never opens its
    // audio tab never creates the capture client.
    this.audioLibrary = options.audioLibrary || new AudioLibrary();
    this.audioLibrary.onChange = () => {
      if (this.visible && this.activeTab === 'audio') this.refreshAudio();
    };
    this._audioDeck = options.audioDeck || null;
    this._audioClient = options.audioClient || null;
    this._audioListening = false;
    this._loadedAudioId = null;
    this._audioStatus = '';

    // Initialize managers
    this.sceneManager = new SceneManager(editor, editor.saveLoadManager);
    this.presetManager = new PresetManager(editor);
    this.transitionManager = new TransitionManager(editor);
    this.playlistManager = new PlaylistManager(this.sceneManager, this.transitionManager);
    this.beatSyncManager = new BeatSyncManager();

    // UI state
    this.visible = false;
    this.activeTab = 'scenes'; // 'scenes', 'presets', 'playlist', 'audio'

    // Performance controls
    this.masterOpacity = 1.0;
    this.playbackSpeed = 1.0;
    this.beatSyncEnabled = true;

    this.createUI();
    this.attachEventListeners();
    // Scenes come back from IndexedDB, so restoring is async; anything that
    // needs the saved set in place (tests, the AI timeline reader) can await it.
    this.ready = this.loadFromStorage();

    // Playback that advances on its own (auto-advance, next/previous, a scene
    // that dropped out) has to be able to redraw the list.
    this.playlistManager.onStateChange = () => this.syncPlaylistUI();

    // Auto-override: which scene the editor is linked to and what was last
    // written into it. See autoOverrideTick().
    this._autoLink = null;
    this._autoOverrideTimer = null;
    this._autoPersistTimer = null;
    this.ready.then(() => this.updateAutoOverrideWatch());
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
    this.createAudioTab();

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
    setIcon(title, 'vj', { text: 'VJ Control', size: 16 });
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
    // Parked against the bottom-left corner, so the top edge is the one that
    // moves when the panel is made taller - keep it anchored there.
    this.cleanupResizable = makeResizable(this.container, {
      minWidth: 340,
      minHeight: 260,
      anchor: { x: 'left', y: 'bottom' },
    });
  }

  /**
   * Create tab navigation
   */
  createTabNavigation() {
    const tabNav = document.createElement('div');
    tabNav.className = 'vj-tab-nav';

    const tabs = [
      { id: 'scenes', label: 'Scenes', icon: 'scenes', title: 'Scene management' },
      { id: 'presets', label: 'Presets', icon: 'presets', title: 'Parameter presets' },
      { id: 'playlist', label: 'Playlist', icon: 'playlist', title: 'Playlist & sequencing' },
      { id: 'audio', label: 'Audio', icon: 'waveform', title: 'Audio files for the audio system' }
    ];

    tabs.forEach(tab => {
      const btn = document.createElement('button');
      btn.className = 'vj-tab-btn';
      setIcon(btn, tab.icon, { text: tab.label, size: 14 });
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

    const loadBtn = this.createButton('Load Scene', 'Load scene from file', () => this.loadSceneFromFile(), 'folder');
    const captureBtn = this.createButton('Capture Current', 'Capture current state as scene', () => this.captureCurrentScene(), 'capture');
    const saveAllBtn = this.createButton('Save All', 'Save scenes, presets and playlist', () => this.saveAllScenes(), 'save-disk');

    buttonGroup.appendChild(loadBtn);
    buttonGroup.appendChild(captureBtn);
    buttonGroup.appendChild(saveAllBtn);
    tab.appendChild(buttonGroup);

    // The whole set as one file: a backup, a set moved to another machine, or
    // one recovered by scripts/recover_vj_set.py.
    const setGroup = document.createElement('div');
    setGroup.className = 'vj-button-group';
    setGroup.appendChild(this.createButton('Import Set', 'Replace the set with one from a file', () => this.importSetFromFile(), 'upload'));
    setGroup.appendChild(this.createButton('Export Set', 'Save scenes, presets and playlist to a file', () => this.exportSetToFile(), 'download'));
    setGroup.appendChild(this.createButton('Restore Previous Set', 'Bring back the set that was last replaced', () => this.restorePreviousSet(), 'undo'));
    tab.appendChild(setGroup);

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

    const captureBtn = this.createButton('Capture Preset', 'Capture current parameters', () => this.capturePreset(), 'capture');
    const clearBtn = this.createButton('Clear All', 'Clear all presets', () => this.clearPresets(), 'trash');

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

    this.playlistPlayBtn = this.createButton('', 'Play playlist', () => this.togglePlaylist(), 'play');
    this.playlistStopBtn = this.createButton('', 'Stop playlist', () => this.stopPlaylist(), 'stop');
    this.playlistPrevBtn = this.createButton('', 'Previous scene', () => this.playlistManager.previous(), 'skip-prev');
    this.playlistNextBtn = this.createButton('', 'Next scene', () => this.playlistManager.next(), 'skip-next');

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

    const addBtn = this.createButton('Add', 'Add the selected scene to the playlist', () => {
      this.addSceneToPlaylist(this.playlistSceneSelect.value);
    }, 'add');
    const clearBtn = this.createButton('Clear Playlist', 'Clear all playlist items', () => this.clearPlaylist(), 'trash');

    addGroup.appendChild(addBtn);
    addGroup.appendChild(clearBtn);
    tab.appendChild(addGroup);

    // The narrator's words, read from a transmissions folder into the Text
    // nodes of the scenes above, in playlist order.
    const narrationGroup = document.createElement('div');
    narrationGroup.className = 'vj-button-group';
    const narrationBtn = this.createButton(
      'Narration from Folder…',
      'Read the narration from a transmissions project, episode or projects folder and '
        + 'write it into the Text nodes of the playlist scenes, in order',
      () => this.importNarrationFromFolder()
    );
    narrationGroup.appendChild(narrationBtn);
    tab.appendChild(narrationGroup);

    this.contentArea.appendChild(tab);
  }

  /**
   * Create audio tab: the library of audio files, any of which can be put
   * into the audio system from here.
   */
  createAudioTab() {
    const tab = document.createElement('div');
    tab.className = 'vj-tab-content';
    tab.dataset.tab = 'audio';
    tab.style.display = 'none';

    // What the audio system is playing, and its transport. The same element
    // the Audio panel drives, so a press here shows up there and back.
    const transport = document.createElement('div');
    transport.className = 'vj-playlist-controls vj-audio-transport';

    this.audioPlayBtn = this.createButton('', 'Play / pause the loaded track', () => this.toggleAudioPlayback(), 'play');
    this.audioStopBtn = this.createButton('', 'Stop the loaded track', () => this.stopAudio(), 'stop');
    transport.appendChild(this.audioPlayBtn);
    transport.appendChild(this.audioStopBtn);

    this.audioNowPlaying = document.createElement('div');
    this.audioNowPlaying.className = 'vj-audio-now';
    transport.appendChild(this.audioNowPlaying);
    tab.appendChild(transport);

    const items = document.createElement('div');
    items.className = 'vj-playlist-items vj-audio-items';
    tab.appendChild(items);
    this.audioItems = items;

    // On the list rather than each row: the first click of a double-click
    // loads the track and redraws the rows, so the row the second click lands
    // on is a new one.
    items.addEventListener('dblclick', (e) => {
      if (e.target.closest('.vj-playlist-actions, input')) return;
      const row = e.target.closest('.vj-audio-item');
      if (row) this.loadAudioTrack(row.dataset.audioId, { play: true });
    });

    // Files dropped anywhere on the tab join the library. Only files: a row
    // being dragged to reorder is handled by the row.
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
    tab.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      tab.classList.add('vj-audio-dropping');
    });
    tab.addEventListener('dragleave', (e) => {
      if (e.target === tab) tab.classList.remove('vj-audio-dropping');
    });
    tab.addEventListener('drop', (e) => {
      tab.classList.remove('vj-audio-dropping');
      if (!hasFiles(e)) return;
      e.preventDefault();
      this.addAudioFiles(e.dataTransfer.files);
    });

    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'vj-button-group';
    const addBtn = this.createButton('Add Audio Files…', 'Add audio files to the list', () => this.pickAudioFiles(), 'add');
    const clearBtn = this.createButton('Clear All', 'Remove every audio file from the list', () => this.clearAudioLibrary(), 'trash');
    buttonGroup.appendChild(addBtn);
    buttonGroup.appendChild(clearBtn);
    tab.appendChild(buttonGroup);

    this.contentArea.appendChild(tab);
  }

  /** The transport tracks are loaded into. */
  audioDeck() {
    if (!this._audioDeck) this._audioDeck = getAudioDeck();
    return this._audioDeck;
  }

  /**
   * Follow the capture client, so a track started, stopped or replaced from
   * the Audio panel or the performer repaints the list. Once, on first use.
   */
  listenToAudio() {
    if (this._audioListening) return;
    let client = this._audioClient;
    if (!client) {
      try {
        client = getBrowserAudioCapture();
      } catch {
        return;
      }
      this._audioClient = client;
    }
    this._audioListening = true;
    for (const event of ['loaded', 'started', 'stopped', 'error']) {
      client?.on?.(event, () => {
        if (this.visible && this.activeTab === 'audio') this.refreshAudio();
      });
    }
  }

  /**
   * The library track the audio system is holding, if it is one of ours.
   *
   * The id remembers what this panel loaded; the name on the element says
   * whether it is still there, since the Audio panel or the performer can
   * load something else over it without telling us.
   */
  loadedAudioTrackId() {
    if (!this._loadedAudioId) return null;
    const track = this.audioLibrary.get(this._loadedAudioId);
    if (!track) return null;
    let state;
    try {
      state = this.audioDeck().describe();
    } catch {
      return null;
    }
    return state.loaded && state.file === track.name ? track.id : null;
  }

  refreshAudio() {
    if (!this.audioItems) return;
    this.listenToAudio();
    this.closeContextMenu();
    this.audioItems.innerHTML = '';

    let state = { file: '', loaded: false, playing: false };
    try {
      state = this.audioDeck().describe();
    } catch {
      // No audio system here; the list still works.
    }
    const loadedId = this.loadedAudioTrackId();

    // Transport and the line beside it.
    setIcon(this.audioPlayBtn, state.playing ? 'pause' : 'play', {
      label: state.playing ? 'Pause' : 'Play'
    });
    this.audioPlayBtn.disabled = !state.loaded;
    this.audioStopBtn.disabled = !state.loaded;
    const nowText = state.loaded
      ? `${state.playing ? 'Playing' : 'Loaded'}: ${state.file || 'untitled track'}`
      : 'Nothing loaded';
    this.audioNowPlaying.textContent = this._audioStatus ? `${nowText} — ${this._audioStatus}` : nowText;
    this.audioNowPlaying.title = this.audioNowPlaying.textContent;

    const tracks = this.audioLibrary.getAll();
    if (tracks.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'vj-empty-message';
      emptyMsg.textContent = this.audioLibrary.persistent
        ? 'No audio files. Add some, or drop them here.'
        : 'No audio files. Add some, or drop them here (kept for this session only).';
      this.audioItems.appendChild(emptyMsg);
      return;
    }

    tracks.forEach((track, index) => {
      const row = document.createElement('div');
      row.className = 'vj-playlist-item vj-audio-item';
      row.dataset.audioId = track.id;
      row.title = 'Click to load into the audio system, double-click to load and play';
      const isLoaded = track.id === loadedId;
      if (isLoaded) row.classList.add('current');

      const number = document.createElement('div');
      number.className = 'vj-playlist-number';
      number.textContent = `${index + 1}.`;
      row.appendChild(number);

      const info = document.createElement('div');
      info.className = 'vj-playlist-info';
      const name = document.createElement('div');
      name.className = 'vj-playlist-name vj-audio-name';
      name.textContent = track.name;
      info.appendChild(name);
      const details = document.createElement('div');
      details.className = 'vj-playlist-details';
      details.textContent = isLoaded
        ? `${formatBytes(track.size)} · ${state.playing ? 'playing' : 'loaded'}`
        : formatBytes(track.size);
      info.appendChild(details);
      row.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'vj-playlist-actions';

      const playBtn = this.createButton('', isLoaded && state.playing ? 'Pause' : 'Load and play', () => {
        if (isLoaded) this.toggleAudioPlayback();
        else this.loadAudioTrack(track.id, { play: true });
      }, isLoaded && state.playing ? 'pause' : 'play');
      playBtn.className = 'vj-btn-small';
      actions.appendChild(playBtn);

      const moreBtn = this.createButton('⋯', 'More actions', () => {
        const rect = moreBtn.getBoundingClientRect();
        this.showContextMenu(rect.left, rect.bottom, this.audioMenuItems(track.id));
      });
      moreBtn.className = 'vj-btn-small';
      actions.appendChild(moreBtn);

      const removeBtn = this.createButton('×', 'Remove from the list', () => this.removeAudioTrack(track.id));
      removeBtn.className = 'vj-btn-small vj-btn-danger';
      actions.appendChild(removeBtn);
      row.appendChild(actions);

      row.onclick = (e) => {
        if (e.target.closest('.vj-playlist-actions, input')) return;
        if (!isLoaded) this.loadAudioTrack(track.id);
      };
      row.oncontextmenu = (e) => {
        e.preventDefault();
        this.showContextMenu(e.clientX, e.clientY, this.audioMenuItems(track.id));
      };

      this.makeReorderable(row, index, {
        group: 'audio',
        axis: 'y',
        onMove: (from, to) => this.moveAudioTrack(tracks[from].id, to)
      });

      this.audioItems.appendChild(row);
    });
  }

  /** The audio row's context menu. */
  audioMenuItems(trackId) {
    const index = this.audioLibrary.order.indexOf(trackId);
    const last = this.audioLibrary.order.length - 1;
    return [
      { label: 'Load', onSelect: () => this.loadAudioTrack(trackId) },
      { label: 'Load and play', onSelect: () => this.loadAudioTrack(trackId, { play: true }) },
      { label: 'Rename…', onSelect: () => this.renameAudioTrack(trackId) },
      { separator: true },
      { label: 'Move up', disabled: index <= 0, onSelect: () => this.moveAudioTrack(trackId, index - 1) },
      { label: 'Move down', disabled: index >= last, onSelect: () => this.moveAudioTrack(trackId, index + 1) },
      { separator: true },
      { label: 'Remove', danger: true, onSelect: () => this.removeAudioTrack(trackId) }
    ];
  }

  /**
   * Put a library track into the audio system, in place of whatever it was
   * playing. Playback carries over: a track picked while the last one was
   * playing starts playing, so a swap mid-set does not drop to silence.
   */
  async loadAudioTrack(trackId, { play = false } = {}) {
    const track = this.audioLibrary.get(trackId);
    const file = this.audioLibrary.fileFor(trackId);
    if (!track || !file) return false;

    const deck = this.audioDeck();
    let wasPlaying = false;
    try { wasPlaying = !!deck.describe().playing; } catch { /* nothing loaded */ }

    this._audioStatus = '';
    try {
      await deck.load(file, track.name);
    } catch {
      this._audioStatus = `could not read ${track.name}`;
      this.refreshAudio();
      return false;
    }
    this._loadedAudioId = trackId;

    let ok = true;
    if (play || wasPlaying) {
      const result = await deck.play();
      if (!result?.ok) {
        ok = false;
        this._audioStatus = 'playback was blocked — press play';
      } else if (result.stoppedLive) {
        this._audioStatus = `live input (${result.stoppedLive}) stopped`;
      }
    }
    this.refreshAudio();
    return ok;
  }

  async toggleAudioPlayback() {
    const deck = this.audioDeck();
    let state;
    try { state = deck.describe(); } catch { return false; }
    this._audioStatus = '';
    if (state.playing) {
      deck.pause();
    } else {
      const result = await deck.play();
      if (!result?.ok) this._audioStatus = 'playback was blocked — press play';
      else if (result.stoppedLive) this._audioStatus = `live input (${result.stoppedLive}) stopped`;
    }
    this.refreshAudio();
    return true;
  }

  stopAudio() {
    try { this.audioDeck().stop(); } catch { /* nothing loaded */ }
    this._audioStatus = '';
    this.refreshAudio();
  }

  pickAudioFiles() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.multiple = true;
    input.onchange = (e) => this.addAudioFiles(e.target.files);
    input.click();
  }

  async addAudioFiles(files) {
    const { added, skipped } = await this.audioLibrary.add(files);
    this._audioStatus = skipped.length
      ? `skipped ${skipped.length} file${skipped.length === 1 ? '' : 's'} that ${skipped.length === 1 ? 'is' : 'are'} not audio`
      : '';
    if (!this.audioLibrary.persistent && added.length) {
      this._audioStatus = 'could not save — kept for this session only';
    }
    this.refreshAudio();
    return added;
  }

  renameAudioTrack(trackId) {
    const track = this.audioLibrary.get(trackId);
    const row = this.audioItems?.querySelector(`.vj-audio-item[data-audio-id="${CSS.escape(trackId)}"]`);
    const nameEl = row?.querySelector('.vj-audio-name');
    if (!track || !nameEl) return;

    const wasLoaded = this.loadedAudioTrackId() === trackId;
    this.beginRename(nameEl, track.name, (name) => {
      this.audioLibrary.rename(trackId, name);
      // The loaded element is named after the track; keep it naming the new
      // one, or the loaded marker and every meter label lose it.
      if (wasLoaded) {
        const el = this._audioClient?.audioElement || getBrowserAudioCapture().audioElement;
        if (el?.dataset) el.dataset.fileName = name;
      }
      this.refreshAudio();
    });
  }

  moveAudioTrack(trackId, toIndex) {
    this.audioLibrary.move(trackId, toIndex);
    this.refreshAudio();
  }

  removeAudioTrack(trackId) {
    const track = this.audioLibrary.get(trackId);
    if (!track) return false;
    if (!confirm(`Remove "${track.name}" from the audio list?`)) return false;
    // Whatever is already in the audio system keeps playing: removing a file
    // from the list is not a request for silence.
    if (this._loadedAudioId === trackId) this._loadedAudioId = null;
    this.audioLibrary.remove(trackId);
    this.refreshAudio();
    return true;
  }

  clearAudioLibrary() {
    if (!this.audioLibrary.size) return false;
    if (!confirm('Remove every audio file from the list?')) return false;
    this._loadedAudioId = null;
    this.audioLibrary.clear();
    this.refreshAudio();
    return true;
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

    // Beat sync is a performance aid, not something every set wants running -
    // this switches the whole clock off, indicator included.
    const bpmLabel = document.createElement('label');
    bpmLabel.title = 'Enable beat sync';
    this.beatEnabledCheck = document.createElement('input');
    this.beatEnabledCheck.type = 'checkbox';
    this.beatEnabledCheck.checked = this.beatSyncEnabled;
    this.beatEnabledCheck.onchange = () => {
      this.setBeatSyncEnabled(this.beatEnabledCheck.checked);
    };
    bpmLabel.appendChild(this.beatEnabledCheck);
    bpmLabel.appendChild(document.createTextNode(' BPM:'));
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

    this.tapBtn = this.createButton('Tap', 'Tap tempo', () => this.tapTempo(), 'tap-tempo');
    this.tapBtn.className = 'vj-btn-small';
    bpmGroup.appendChild(this.tapBtn);

    // Beat indicator
    this.beatIndicator = document.createElement('div');
    this.beatIndicator.className = 'vj-beat-indicator';
    this._renderBeat(-1);
    bpmGroup.appendChild(this.beatIndicator);

    footer.appendChild(bpmGroup);

    this.updateBeatSyncControls();

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
      case 'audio':
        this.refreshAudio();
        break;
    }
  }

  /**
   * Refresh scenes display
   */
  refreshScenes() {
    this.closeContextMenu();
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

    scenes.forEach((scene, index) => {
      const sceneCard = document.createElement('div');
      sceneCard.className = 'vj-scene-card';
      sceneCard.dataset.sceneId = scene.id;
      if (scene.id === this.sceneManager.activeSceneId) {
        sceneCard.classList.add('active');
      }

      const titleRow = document.createElement('div');
      titleRow.className = 'vj-card-title-row';

      const sceneName = document.createElement('div');
      sceneName.className = 'vj-scene-name';
      sceneName.textContent = scene.name;
      titleRow.appendChild(sceneName);

      // Keep this scene following the editor while it is the live one.
      const autoBtn = document.createElement('button');
      autoBtn.className = 'vj-btn-toggle vj-auto-override-btn';
      autoBtn.textContent = 'Auto';
      autoBtn.onclick = (e) => {
        e.stopPropagation();
        this.setSceneAutoOverride(scene.id, !scene.autoOverride);
      };
      titleRow.appendChild(autoBtn);

      sceneCard.appendChild(titleRow);

      const sceneInfo = document.createElement('div');
      sceneInfo.className = 'vj-scene-info';
      sceneInfo.textContent = `${scene.duration}s`;
      sceneCard.appendChild(sceneInfo);

      // Cue note: what this scene is for, when to fire it. Saved on the scene,
      // so it rides along with the rest of the set into storage.
      const notes = document.createElement('textarea');
      notes.className = 'vj-scene-notes';
      notes.rows = 2;
      notes.placeholder = 'Notes…';
      notes.title = 'Notes for this scene';
      notes.value = scene.notes || '';
      notes.onchange = () => {
        this.sceneManager.updateSceneMetadata(scene.id, { notes: notes.value });
        this.persistScenes();
      };
      // The card switches scene on click; typing a note must not load it.
      notes.onclick = (e) => e.stopPropagation();
      sceneCard.appendChild(notes);

      const actions = document.createElement('div');
      actions.className = 'vj-scene-actions';

      const switchBtn = this.createButton('Load', 'Switch to this scene', () => {
        this.switchToScene(scene.id);
      });
      switchBtn.className = 'vj-btn-small';
      actions.appendChild(switchBtn);

      const overrideBtn = this.createButton('Override', 'Replace this saved scene with the current editor state', () => {
        this.overrideScene(scene.id);
      });
      overrideBtn.className = 'vj-btn-small';
      actions.appendChild(overrideBtn);

      // Queue straight from the scene list. Requiring a scene to be loaded
      // before it could be queued meant building a playlist tore down the graph
      // once per entry - and any scene that failed to load could never be added.
      const queueBtn = this.createButton('＋', 'Add to playlist', () => {
        this.addSceneToPlaylist(scene.id);
      });
      queueBtn.className = 'vj-btn-small';
      actions.appendChild(queueBtn);

      const moreBtn = this.createButton('⋯', 'More actions', (e) => {
        const rect = moreBtn.getBoundingClientRect();
        this.showContextMenu(rect.left, rect.bottom, this.sceneMenuItems(scene.id));
        e.stopPropagation();
      });
      moreBtn.className = 'vj-btn-small';
      actions.appendChild(moreBtn);

      const deleteBtn = this.createButton('×', 'Remove scene', () => {
        this.removeScene(scene.id);
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

      sceneCard.oncontextmenu = (e) => {
        // A note keeps the browser's own menu - copy and paste live there.
        if (e.target.closest('textarea, input')) return;
        e.preventDefault();
        this.showContextMenu(e.clientX, e.clientY, this.sceneMenuItems(scene.id));
      };

      this.makeReorderable(sceneCard, index, {
        group: 'scenes',
        axis: 'x',
        onMove: (from, to) => this.moveScene(scenes[from].id, to)
      });

      this.scenesArea.appendChild(sceneCard);
    });

    this.updateAutoOverrideBadges();
  }

  /** The scene card's context menu. */
  sceneMenuItems(sceneId) {
    const scene = this.sceneManager.getScene(sceneId);
    if (!scene) return [];
    const index = this.sceneManager.sceneOrder.indexOf(sceneId);
    const last = this.sceneManager.sceneOrder.length - 1;
    return [
      { label: 'Load', onSelect: () => this.switchToScene(sceneId) },
      { label: 'Rename…', onSelect: () => this.renameScene(sceneId) },
      { label: 'Duplicate', onSelect: () => this.duplicateScene(sceneId) },
      { separator: true },
      { label: 'Override with current state', onSelect: () => this.overrideScene(sceneId) },
      {
        label: 'Auto-override while live',
        checked: !!scene.autoOverride,
        onSelect: () => this.setSceneAutoOverride(sceneId, !scene.autoOverride)
      },
      { separator: true },
      { label: 'Add to playlist', onSelect: () => this.addSceneToPlaylist(sceneId) },
      { label: 'Move to start', disabled: index <= 0, onSelect: () => this.moveScene(sceneId, 0) },
      { label: 'Move to end', disabled: index >= last, onSelect: () => this.moveScene(sceneId, last) },
      { label: 'Save to file…', onSelect: () => this.exportSceneToFile(sceneId) },
      { separator: true },
      { label: 'Remove', danger: true, onSelect: () => this.removeScene(sceneId) }
    ];
  }

  /** Rename a scene in place on its card. */
  renameScene(sceneId) {
    const scene = this.sceneManager.getScene(sceneId);
    const card = this.scenesArea.querySelector(`.vj-scene-card[data-scene-id="${CSS.escape(sceneId)}"]`);
    const nameEl = card?.querySelector('.vj-scene-name');
    if (!scene || !nameEl) return;

    this.beginRename(nameEl, scene.name, (name) => {
      this.sceneManager.updateSceneMetadata(sceneId, { name });
      this.persistScenes();
      this.refreshScenes();
    });
  }

  duplicateScene(sceneId) {
    const copy = this.sceneManager.duplicateScene(sceneId);
    if (!copy) {
      alert('Could not duplicate this scene.');
      return null;
    }
    this.persistScenes();
    this.refreshScenes();
    return copy;
  }

  moveScene(sceneId, toIndex) {
    if (!this.sceneManager.moveScene(sceneId, toIndex)) return false;
    this.persistScenes();
    this.refreshScenes();
    return true;
  }

  removeScene(sceneId) {
    const scene = this.sceneManager.getScene(sceneId);
    if (!scene) return false;
    if (!confirm(`Remove scene "${scene.name}"?`)) return false;
    this.sceneManager.removeScene(sceneId);
    this.persistScenes();
    this.refreshScenes();
    this.updateAutoOverrideWatch();
    return true;
  }

  overrideScene(sceneId) {
    const scene = this.sceneManager.getScene(sceneId);
    if (!scene) return false;
    if (!confirm(`Replace scene "${scene.name}" with the current editor state? This cannot be undone.`)) return false;
    if (!this.sceneManager.overrideSceneWithCurrentState(sceneId)) {
      alert('Could not override this scene. The current project could not be captured.');
      return false;
    }
    // The scene now matches the editor - auto-override has nothing to catch up on.
    if (this._autoLink?.sceneId === sceneId) this._autoLink = null;
    this.persistScenes();
    this.refreshScenes();
    return true;
  }

  /** Download a scene as a project file that Load Scene (or File > Open) reads back. */
  exportSceneToFile(sceneId) {
    const scene = this.sceneManager.getScene(sceneId);
    if (!scene) return false;
    try {
      const blob = new Blob([JSON.stringify(scene.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(scene.name || 'scene').replace(/[\\/:*?"<>|]+/g, '_')}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      return true;
    } catch (error) {
      alert(`Could not save scene: ${error?.message || error}`);
      return false;
    }
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

    presets.forEach((preset, index) => {
      const presetCard = document.createElement('div');
      presetCard.className = 'vj-preset-card';
      presetCard.dataset.presetId = preset.id;
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

      const moreBtn = this.createButton('⋯', 'More actions', () => {
        const rect = moreBtn.getBoundingClientRect();
        this.showContextMenu(rect.left, rect.bottom, this.presetMenuItems(preset.id));
      });
      moreBtn.className = 'vj-btn-small';
      actions.appendChild(moreBtn);

      const deleteBtn = this.createButton('×', 'Delete preset', () => {
        this.deletePreset(preset.id);
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

      presetCard.oncontextmenu = (e) => {
        e.preventDefault();
        this.showContextMenu(e.clientX, e.clientY, this.presetMenuItems(preset.id));
      };

      this.makeReorderable(presetCard, index, {
        group: 'presets',
        axis: 'x',
        onMove: (from, to) => this.movePreset(presets[from].id, to)
      });

      this.presetsArea.appendChild(presetCard);
    });
  }

  /** The preset card's context menu. */
  presetMenuItems(presetId) {
    const index = this.presetManager.presetOrder.indexOf(presetId);
    const last = this.presetManager.presetOrder.length - 1;
    return [
      { label: 'Apply', onSelect: () => this.applyPreset(presetId) },
      { label: 'Rename…', onSelect: () => this.renamePreset(presetId) },
      { label: 'Duplicate', onSelect: () => this.duplicatePreset(presetId) },
      { label: 'Update from current', onSelect: () => this.updatePresetFromCurrent(presetId) },
      { separator: true },
      { label: 'Move to start', disabled: index <= 0, onSelect: () => this.movePreset(presetId, 0) },
      { label: 'Move to end', disabled: index >= last, onSelect: () => this.movePreset(presetId, last) },
      { separator: true },
      { label: 'Delete', danger: true, onSelect: () => this.deletePreset(presetId) }
    ];
  }

  renamePreset(presetId) {
    const preset = this.presetManager.presets.get(presetId);
    const card = this.presetsArea.querySelector(`.vj-preset-card[data-preset-id="${CSS.escape(presetId)}"]`);
    const nameEl = card?.querySelector('.vj-preset-name');
    if (!preset || !nameEl) return;

    this.beginRename(nameEl, preset.name, (name) => {
      this.presetManager.renamePreset(presetId, name);
      this.persistPresets();
      this.refreshPresets();
    });
  }

  duplicatePreset(presetId) {
    const copy = this.presetManager.duplicatePreset(presetId);
    if (!copy) return null;
    this.persistPresets();
    this.refreshPresets();
    return copy;
  }

  updatePresetFromCurrent(presetId) {
    const preset = this.presetManager.presets.get(presetId);
    if (!preset) return false;
    if (!confirm(`Replace preset "${preset.name}" with the current parameters?`)) return false;
    this.presetManager.updatePresetFromCurrent(presetId);
    this.persistPresets();
    this.refreshPresets();
    return true;
  }

  movePreset(presetId, toIndex) {
    if (!this.presetManager.movePreset(presetId, toIndex)) return false;
    this.persistPresets();
    this.refreshPresets();
    return true;
  }

  deletePreset(presetId) {
    const preset = this.presetManager.presets.get(presetId);
    if (!preset) return false;
    if (!confirm(`Delete preset "${preset.name}"?`)) return false;
    this.presetManager.deletePreset(presetId);
    this.persistPresets();
    this.refreshPresets();
    return true;
  }

  /** Presets are small - write them as soon as they change. */
  persistPresets() {
    return writeStoredJSON(PRESETS_STORAGE_KEY, this.presetManager.exportPresets());
  }

  /** As persistPresets(), for the playlist. */
  persistPlaylist() {
    return writeStoredJSON(PLAYLIST_STORAGE_KEY, this.playlistManager.exportPlaylist());
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
      itemCard.dataset.index = String(index);
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
        this.persistPlaylist();
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
        this.persistPlaylist();
      };
      itemDetails.appendChild(transitionSelect);

      itemInfo.appendChild(itemDetails);

      itemCard.appendChild(itemInfo);

      const actions = document.createElement('div');
      actions.className = 'vj-playlist-actions';

      const upBtn = this.createButton('↑', 'Move up', () => {
        this.movePlaylistItem(index, index - 1);
      });
      upBtn.className = 'vj-btn-tiny';
      upBtn.disabled = index === 0;
      actions.appendChild(upBtn);

      const downBtn = this.createButton('↓', 'Move down', () => {
        this.movePlaylistItem(index, index + 1);
      });
      downBtn.className = 'vj-btn-tiny';
      downBtn.disabled = index === playlist.length - 1;
      actions.appendChild(downBtn);

      const deleteBtn = this.createButton('×', 'Remove from playlist', () => {
        this.removePlaylistItem(index);
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

      itemCard.oncontextmenu = (e) => {
        if (e.target.closest('input')) return;
        e.preventDefault();
        this.showContextMenu(e.clientX, e.clientY, this.playlistMenuItems(index));
      };

      this.makeReorderable(itemCard, index, {
        group: 'playlist',
        axis: 'y',
        onMove: (from, to) => this.movePlaylistItem(from, to)
      });

      this.playlistItems.appendChild(itemCard);
    });
  }

  /** A playlist row's context menu. */
  playlistMenuItems(index) {
    const last = this.playlistManager.playlist.length - 1;
    const sceneId = this.playlistManager.playlist[index]?.sceneId;
    return [
      { label: 'Jump to', onSelect: () => this.playlistManager.jumpTo(index) },
      { label: 'Duplicate', onSelect: () => this.duplicatePlaylistItem(index) },
      {
        label: 'Show scene',
        disabled: !this.sceneManager.getScene(sceneId),
        onSelect: () => this.revealScene(sceneId)
      },
      { separator: true },
      { label: 'Move up', disabled: index <= 0, onSelect: () => this.movePlaylistItem(index, index - 1) },
      { label: 'Move down', disabled: index >= last, onSelect: () => this.movePlaylistItem(index, index + 1) },
      { separator: true },
      { label: 'Remove', danger: true, onSelect: () => this.removePlaylistItem(index) }
    ];
  }

  movePlaylistItem(fromIndex, toIndex) {
    if (fromIndex === toIndex) return false;
    if (!this.playlistManager.movePlaylistItem(fromIndex, toIndex)) return false;
    this.persistPlaylist();
    this.refreshPlaylist();
    return true;
  }

  duplicatePlaylistItem(index) {
    if (!this.playlistManager.duplicatePlaylistItem(index)) return false;
    this.persistPlaylist();
    this.refreshPlaylist();
    return true;
  }

  removePlaylistItem(index) {
    if (!this.playlistManager.removeFromPlaylist(index)) return false;
    this.persistPlaylist();
    this.refreshPlaylist();
    return true;
  }

  /** Switch to the scenes tab and bring a scene's card into view. */
  revealScene(sceneId) {
    this.switchTab('scenes');
    const card = this.scenesArea.querySelector(`.vj-scene-card[data-scene-id="${CSS.escape(sceneId)}"]`);
    card?.scrollIntoView?.({ block: 'nearest' });
  }

  /**
   * Pop a small menu at (x, y). Items are { label, onSelect, disabled, danger,
   * checked } or { separator: true }. Closes on a pick, Escape, or any press
   * outside it.
   */
  showContextMenu(x, y, items) {
    this.closeContextMenu();
    if (!items?.length) return null;

    const menu = document.createElement('div');
    menu.className = 'vj-context-menu';
    menu.setAttribute('role', 'menu');

    items.forEach(item => {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'vj-context-separator';
        menu.appendChild(sep);
        return;
      }
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'vj-context-item';
      if (item.danger) row.classList.add('danger');
      row.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
      if (item.checked !== undefined) row.setAttribute('aria-checked', String(!!item.checked));
      row.disabled = !!item.disabled;

      const check = document.createElement('span');
      check.className = 'vj-context-check';
      check.textContent = item.checked ? '✓' : '';
      row.appendChild(check);

      const label = document.createElement('span');
      label.textContent = item.label;
      row.appendChild(label);

      row.onclick = (e) => {
        e.stopPropagation();
        this.closeContextMenu();
        item.onSelect?.();
      };
      menu.appendChild(row);
    });

    document.body.appendChild(menu);

    // Keep it on screen.
    const rect = menu.getBoundingClientRect();
    const maxX = Math.max(0, window.innerWidth - rect.width - 4);
    const maxY = Math.max(0, window.innerHeight - rect.height - 4);
    menu.style.left = `${Math.min(Math.max(0, x), maxX)}px`;
    menu.style.top = `${Math.min(Math.max(0, y), maxY)}px`;

    const onPointerDown = (e) => {
      if (!menu.contains(e.target)) this.closeContextMenu();
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeContextMenu();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const rows = [...menu.querySelectorAll('.vj-context-item:not(:disabled)')];
        if (!rows.length) return;
        const at = rows.indexOf(document.activeElement);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        rows[(at + step + rows.length) % rows.length].focus();
      }
    };
    const onBlur = () => this.closeContextMenu();
    // Capture, so a handler that stops propagation can't keep it open.
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onBlur);

    this._contextMenu = {
      element: menu,
      dispose: () => {
        document.removeEventListener('mousedown', onPointerDown, true);
        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('blur', onBlur);
        menu.remove();
      }
    };

    menu.querySelector('.vj-context-item:not(:disabled)')?.focus();
    return menu;
  }

  closeContextMenu() {
    const open = this._contextMenu;
    this._contextMenu = null;
    open?.dispose();
  }

  /**
   * Swap a name label for a text field. Enter or leaving the field commits,
   * Escape puts the old name back. Empty names are ignored.
   */
  beginRename(nameEl, currentName, onCommit) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'vj-rename-input';
    input.value = currentName;

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (commit && name && name !== currentName) {
        onCommit(name);
      } else {
        nameEl.textContent = currentName;
      }
    };

    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    };
    input.onblur = () => finish(true);
    // Clicking into the field must not load the scene or apply the preset.
    input.onclick = (e) => e.stopPropagation();
    input.onmousedown = (e) => e.stopPropagation();

    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus();
    input.select();
    return input;
  }

  /**
   * Let a card be dragged onto its siblings in the same `group` to reorder
   * them. `axis` says which half of the target means "after": 'x' for the
   * wrapping card grids, 'y' for the playlist's column. onMove gets the
   * dragged item's index and the index it should end up at.
   */
  makeReorderable(card, index, { group, axis, onMove }) {
    card.draggable = true;
    card.dataset.reorderGroup = group;
    card.dataset.reorderIndex = String(index);

    // A draggable parent stops text being selected in its fields (Firefox), and
    // a drag started from a field is never meant as a reorder.
    card.addEventListener('mousedown', (e) => {
      card.draggable = !e.target.closest('input, textarea, select');
    });

    const clearMarks = () => {
      card.classList.remove('vj-drop-before', 'vj-drop-after');
    };
    const isAfter = (e) => {
      const rect = card.getBoundingClientRect();
      return axis === 'y'
        ? e.clientY > rect.top + rect.height / 2
        : e.clientX > rect.left + rect.width / 2;
    };

    card.addEventListener('dragstart', (e) => {
      this._drag = { group, from: index };
      card.classList.add('vj-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        // Firefox will not start a drag without data.
        try { e.dataTransfer.setData('text/plain', `${group}:${index}`); } catch { /* ignore */ }
      }
    });

    card.addEventListener('dragover', (e) => {
      if (this._drag?.group !== group) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const after = isAfter(e);
      card.classList.toggle('vj-drop-after', after);
      card.classList.toggle('vj-drop-before', !after);
    });

    card.addEventListener('dragleave', (e) => {
      if (!card.contains(e.relatedTarget)) clearMarks();
    });

    card.addEventListener('drop', (e) => {
      const drag = this._drag;
      if (drag?.group !== group) return;
      e.preventDefault();
      clearMarks();
      this._drag = null;

      let to = index + (isAfter(e) ? 1 : 0);
      if (drag.from < to) to--;
      if (to !== drag.from) onMove(drag.from, to);
    });

    card.addEventListener('dragend', () => {
      this._drag = null;
      card.draggable = true;
      card.classList.remove('vj-dragging');
      card.parentElement?.querySelectorAll('.vj-drop-before, .vj-drop-after')
        .forEach(el => el.classList.remove('vj-drop-before', 'vj-drop-after'));
    });
  }

  /**
   * Pick a folder and put its narration into the playlist's scenes.
   *
   * Shows what will change and asks first: it rewrites saved scenes, and the
   * text it replaces is not kept anywhere else.
   */
  async importNarrationFromFolder() {
    const rows = this.playlistManager.getPlaylist();
    if (!rows.length) {
      alert('The playlist is empty. Add the scenes for the show first, in order.');
      return null;
    }

    let entries;
    try {
      entries = folderPickerKind() === 'directory'
        ? await readDirectoryHandle(await window.showDirectoryPicker({ id: 'rhizo-narration', mode: 'read' }))
        : await this.pickNarrationFolderFallback();
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      alert(`Could not read that folder: ${error?.message || error}`);
      return null;
    }
    if (!entries) return null;

    return this.applyNarrationEntries(entries, rows);
  }

  /** The folder picker for browsers with no showDirectoryPicker. */
  pickNarrationFolderFallback() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.webkitdirectory = true;
      input.multiple = true;
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        resolve(files.length ? readFileList(files) : null);
      });
      input.click();
    });
  }

  /**
   * Read, plan, confirm, write. Split from the picker so it can be driven
   * with entries directly.
   */
  async applyNarrationEntries(entries, rows = this.playlistManager.getPlaylist()) {
    const folder = await readNarrationFolder(entries);
    const plan = planNarration(rows, (id) => this.sceneManager.getScene(id), folder);
    const writable = plan.rows.filter((row) => row.changes.length);

    const lines = plan.rows.map((row) => {
      const what = row.changes.length
        ? `${row.changes.length} text${row.changes.length === 1 ? '' : 's'}`
        : `skipped — ${row.note}`;
      return `${row.index + 1}. ${row.sceneName}  ←  ${row.source}  (${what})`;
    });
    const summary = [...lines, ...(plan.problems.length ? ['', ...plan.problems] : [])].join('\n');

    if (!writable.length) {
      alert(`Nothing to write.\n\n${summary}`);
      return { written: 0, plan };
    }
    if (!confirm(`Replace the text in these scenes?\n\n${summary}`)) {
      return { written: 0, plan };
    }

    let written = 0;
    for (const row of writable) {
      const scene = this.sceneManager.getScene(row.sceneId);
      const count = applySceneTexts(scene?.data, row.changes);
      if (count && scene) scene.updatedAt = Date.now();
      written += count;
    }

    // The scene on screen is the editor's live graph, not the saved copy.
    // Write it there too: it should show the new words now, and with
    // auto-override on the next edit would otherwise save the old ones back.
    const live = writable.find((row) => row.sceneId === this.sceneManager.activeSceneId);
    if (live && this.editorShowsVJScene() && this.editor?.graph) {
      applySceneTexts(this.editor.graph, live.changes, (node) => {
        // A texture that fails to redraw is one frame of old text, not a
        // reason to leave the saved scenes unwritten.
        try { refreshTextNodeTexture(node); } catch { /* redrawn on the next rebuild */ }
      });
      this.editor.onChange?.();
    }

    await this.persistScenes();
    this.refreshScenes();
    this.refreshPlaylist();
    return { written, plan };
  }

  /**
   * Helper to create button
   */
  createButton(text, title, onClick, icon = null) {
    const btn = document.createElement('button');
    btn.className = 'vj-btn';
    if (icon) {
      // Icon-only buttons (transport) get their accessible name from `title`.
      setIcon(btn, icon, { text, label: text ? null : title });
    } else {
      btn.textContent = text;
    }
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
        this.persistScenes();
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
    this.persistScenes();
    this.refreshScenes();
  }

  /**
   * Write the scene set straight away. Scenes used to persist only through
   * Save All, so a captured, imported or deleted scene was lost on reload
   * unless the user also remembered to press it.
   */
  async persistScenes() {
    clearTimeout(this._autoPersistTimer);
    this._autoPersistTimer = null;
    const saved = await this.sceneManager.save();
    if (!saved && !this._sceneSaveWarned) {
      // Once per session - every edit would otherwise raise the same alert.
      this._sceneSaveWarned = true;
      alert('Could not save your scenes - browser storage is full or unavailable.');
    }
    if (saved) this._sceneSaveWarned = false;
    return saved;
  }

  /**
   * The VJ set as the project file carries it. BPM and beat sync stay out:
   * they are the performer's settings, not the project's.
   */
  exportSet() {
    return {
      version: 1,
      scenes: this.sceneManager.exportScenes(),
      presets: this.presetManager.exportPresets(),
      playlist: this.playlistManager.exportPlaylist()
    };
  }

  /**
   * Replace the set with one from a project file, or with an empty one when
   * `set` is null. Written through to browser storage so a reload shows the
   * project's set and not the one before it.
   *
   * The set being replaced is kept first, so Restore Previous Set can bring it
   * back - a New Project or an opened file must never be the end of a set that
   * took hours to build.
   */
  async importSet(set) {
    // A restore still in flight would land the old set back over this one.
    await this.ready;

    if (!this.isSetEmpty()) {
      await this.keepPreviousSet(this.exportSet());
    }

    this.playlistManager.clearPlaylist();
    this.sceneManager.clear();
    this.presetManager.clear();

    if (set) {
      if (set.scenes) this.sceneManager.importScenes(set.scenes);
      if (set.presets) this.presetManager.importPresets(set.presets);
      if (set.playlist) this.playlistManager.importPlaylist(set.playlist);
    }
    if (this.playlistLoopCheck) {
      this.playlistLoopCheck.checked = this.playlistManager.loop;
    }

    this.refreshActiveTab();
    this.syncPlaylistUI();
    return this.saveToStorage();
  }

  isSetEmpty() {
    return this.sceneManager.getAllScenes().length === 0
      && this.presetManager.getAllPresets().length === 0
      && this.playlistManager.getPlaylist().length === 0;
  }

  /**
   * Store a set as the one to restore. In memory as well, so the undo still
   * works for this session where IndexedDB is missing or full.
   */
  async keepPreviousSet(set) {
    this._previousSet = set;
    try {
      const json = JSON.stringify(set);
      await runTransaction(VJ_SCENES_STORE, 'readwrite', (store) =>
        store.put({ id: PREVIOUS_SET_RECORD_ID, json, keptAt: Date.now() })
      );
      return true;
    } catch {
      return false;
    }
  }

  async readPreviousSet() {
    try {
      const record = await runTransaction(VJ_SCENES_STORE, 'readonly', (store) =>
        store.get(PREVIOUS_SET_RECORD_ID)
      );
      if (typeof record?.json === 'string') return JSON.parse(record.json);
    } catch {
      // Fall through to the copy kept this session.
    }
    return this._previousSet || null;
  }

  /**
   * Swap the set back to the one last replaced. The set on screen becomes the
   * previous one in turn, so pressing it twice is a no-op, not a loss.
   */
  async restorePreviousSet() {
    const previous = await this.readPreviousSet();
    if (!previous) {
      alert('There is no previous VJ set to restore.');
      return false;
    }
    const scenes = previous.scenes?.scenes?.length || 0;
    const items = previous.playlist?.playlist?.length || 0;
    if (!confirm(`Restore the previous VJ set (${scenes} scene(s), ${items} playlist item(s))? The current set becomes the previous one.`)) {
      return false;
    }
    await this.importSet(previous);
    return true;
  }

  /**
   * The set inside a file: a set exported here or recovered by
   * scripts/recover_vj_set.py, or a project file that carries one.
   */
  static setFromFileData(data) {
    if (data && data.vjSet && typeof data.vjSet === 'object') return data.vjSet;
    if (data && (data.scenes || data.presets || data.playlist) && !Array.isArray(data.nodes)) return data;
    return null;
  }

  async importSetFromFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const set = VJControlPanel.setFromFileData(JSON.parse(await file.text()));
        if (!set) throw new Error('no VJ set in this file');
        const scenes = set.scenes?.scenes?.length || 0;
        const items = set.playlist?.playlist?.length || 0;
        if (!confirm(`Load "${file.name}" (${scenes} scene(s), ${items} playlist item(s))? The current set is kept - Restore Previous Set brings it back.`)) return;
        await this.importSet(set);
      } catch (error) {
        alert(`Could not import the VJ set: ${error.message}`);
      }
    };
    input.click();
  }

  exportSetToFile() {
    const blob = new Blob([JSON.stringify(this.exportSet())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vj-set-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /**
   * Start an empty VJ set for a new project. BPM and beat sync are the
   * performer's settings, not the project's, so they stay.
   */
  startNewSet() {
    return this.importSet(null);
  }

  /**
   * Save the whole VJ set - scenes, presets and playlist.
   */
  async saveAllScenes() {
    if (await this.saveToStorage()) {
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

    // Leaving a scene with auto-override on: catch its last edits before the
    // editor is torn down for the next one.
    this.autoOverrideTick();
    this._switchingScene = true;
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
    } finally {
      this._switchingScene = false;
    }

    this.sceneManager.activeSceneId = sceneId;
    scene.lastUsed = Date.now();
    this.refreshScenes();
    return true;
  }

  /**
   * Turn auto-override on or off for a scene. While on and the scene is the
   * live one, edits made in the editor are written back into it.
   */
  setSceneAutoOverride(sceneId, enabled) {
    if (!this.sceneManager.updateSceneMetadata(sceneId, { autoOverride: enabled })) return false;
    if (this._autoLink?.sceneId === sceneId) this._autoLink = null;
    this.persistScenes();
    this.updateAutoOverrideBadges();
    this.updateAutoOverrideWatch();
    return true;
  }

  /**
   * Where a scene's auto-override stands:
   *   'off'    - not switched on
   *   'armed'  - on, but another scene (or none) is live
   *   'paused' - on and live, but the editor has since loaded something that
   *              is not this scene (a file, a backup), so nothing is written
   *   'live'   - on, live, and following the editor
   */
  autoOverrideState(sceneId) {
    const scene = this.sceneManager.getScene(sceneId);
    if (!scene?.autoOverride) return 'off';
    if (this.sceneManager.activeSceneId !== sceneId) return 'armed';
    return this.editorShowsVJScene() ? 'live' : 'paused';
  }

  /**
   * True when the project in the editor was put there by a VJ scene load and
   * nothing has replaced it since. An editor that does not track import
   * sources is taken at its word.
   */
  editorShowsVJScene() {
    const slm = this.editor?.saveLoadManager;
    if (!slm || !('lastImportSource' in slm)) return true;
    return slm.lastImportSource === VJ_SCENE_IMPORT_SOURCE;
  }

  /** Paint each scene card's Auto button for its current state. */
  updateAutoOverrideBadges() {
    if (!this.scenesArea) return;
    const titles = {
      off: 'Auto-override is off. Turn on to keep this scene updated with your edits while it is live.',
      armed: 'Auto-override is on. Load this scene and your edits will be saved into it automatically.',
      paused: 'Auto-override is paused: the editor no longer shows this scene. Load it again to resume.',
      live: 'Auto-override is live: edits are being saved into this scene.'
    };
    this.scenesArea.querySelectorAll('.vj-scene-card[data-scene-id]').forEach(card => {
      const state = this.autoOverrideState(card.dataset.sceneId);
      const btn = card.querySelector('.vj-auto-override-btn');
      card.classList.toggle('auto-live', state === 'live');
      if (!btn) return;
      btn.classList.toggle('on', state !== 'off');
      btn.dataset.state = state;
      btn.setAttribute('aria-pressed', String(state !== 'off'));
      btn.title = titles[state];
    });
  }

  /** Run the auto-override poll only while some scene wants it. */
  updateAutoOverrideWatch() {
    const wanted = this.sceneManager.getAllScenes().some(scene => scene.autoOverride);
    if (wanted && !this._autoOverrideTimer) {
      this._autoOverrideTimer = setInterval(() => this.autoOverrideTick(), AUTO_OVERRIDE_INTERVAL_MS);
    } else if (!wanted && this._autoOverrideTimer) {
      clearInterval(this._autoOverrideTimer);
      this._autoOverrideTimer = null;
      this._autoLink = null;
    }
  }

  /**
   * One auto-override pass: if the live scene has auto-override on and the
   * editor has changed since the last pass, write the editor's state into it.
   * Returns true when the scene was updated.
   *
   * Never writes mid-transition or mid-import, and never once the editor has
   * loaded a project that is not a VJ scene - otherwise opening a file would
   * quietly overwrite whatever scene was live.
   */
  autoOverrideTick() {
    const sm = this.sceneManager;
    const slm = this.editor?.saveLoadManager;
    const scene = sm.activeSceneId ? sm.getScene(sm.activeSceneId) : null;

    if (!scene?.autoOverride || !slm?.exportProject) {
      this._autoLink = null;
      return false;
    }
    if (this.transitionManager.isTransitioning || slm.isImporting || this._switchingScene) return false;

    const importCount = slm.importCount ?? 0;
    let link = this._autoLink;
    const state = this.editorShowsVJScene() ? 'live' : 'paused';

    // A new scene went live, or the same one was reloaded: start from what
    // is stored for it, so the first pass only writes real edits.
    if (!link || link.sceneId !== scene.id || link.importCount !== importCount) {
      link = this._autoLink = {
        sceneId: scene.id,
        importCount,
        hash: this.hashProject(scene.data),
        dirtyStamp: undefined,
        state: null
      };
      this.updateAutoOverrideBadges();
    }

    if (link.state !== state) {
      link.state = state;
      this.updateAutoOverrideBadges();
    }
    if (state !== 'live') return false;

    // Skip the export when the editor has not been touched since last time.
    const dirtyStamp = this.editor._lastDirtyTimestamp;
    if (dirtyStamp !== undefined && dirtyStamp === link.dirtyStamp) return false;
    link.dirtyStamp = dirtyStamp;

    let projectData;
    try {
      projectData = slm.exportProject();
    } catch {
      return false;
    }
    if (!projectData || !Array.isArray(projectData.nodes)) return false;

    const hash = this.hashProject(projectData);
    if (hash !== null && hash === link.hash) return false;

    if (!sm.overrideSceneWithCurrentState(scene.id, projectData)) return false;
    link.hash = hash;
    this.flashAutoOverride(scene.id);
    this.scheduleAutoOverridePersist();
    return true;
  }

  hashProject(projectData) {
    const slm = this.editor?.saveLoadManager;
    if (typeof slm?._computeProjectHash === 'function') {
      return slm._computeProjectHash(projectData);
    }
    return hashProject(projectData);
  }

  /** Writes come in bursts while editing; save once they settle. */
  scheduleAutoOverridePersist() {
    clearTimeout(this._autoPersistTimer);
    this._autoPersistTimer = setTimeout(() => {
      this._autoPersistTimer = null;
      this.persistScenes();
    }, AUTO_OVERRIDE_PERSIST_DELAY_MS);
  }

  /** Blink the Auto button so it is visible that the scene just took edits. */
  flashAutoOverride(sceneId) {
    const card = this.scenesArea?.querySelector(`.vj-scene-card[data-scene-id="${CSS.escape(sceneId)}"]`);
    const btn = card?.querySelector('.vj-auto-override-btn');
    if (!btn) return;
    btn.classList.remove('flash');
    // Restart the animation.
    void btn.offsetWidth;
    btn.classList.add('flash');
  }

  /**
   * Capture preset
   */
  capturePreset() {
    const name = prompt('Enter preset name:', 'Preset ' + (this.presetManager.presets.size + 1));
    if (!name) return;

    this.presetManager.capturePreset(name);
    this.persistPresets();
    this.refreshPresets();
  }

  /**
   * Clear presets
   */
  clearPresets() {
    if (!confirm('Clear all presets?')) return;

    this.presetManager.clear();
    this.persistPresets();
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

    if (added) this.persistPlaylist();
    this.refreshPlaylist();
    return added;
  }

  /**
   * Clear playlist
   */
  clearPlaylist() {
    if (!confirm('Clear playlist?')) return;

    this.playlistManager.clearPlaylist();
    this.persistPlaylist();
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
      setIcon(this.playlistPlayBtn, status.isPlaying ? 'pause' : 'play');
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
    if (!this.beatSyncEnabled) return;
    this.beatSyncManager.tap();
    this.bpmInput.value = this.beatSyncManager.bpm;
  }

  /**
   * Turn beat sync on or off. Off stops the clock outright rather than just
   * hiding it, so nothing is running behind a set that does not use it.
   */
  setBeatSyncEnabled(enabled) {
    this.beatSyncEnabled = !!enabled;

    if (this.beatEnabledCheck) {
      this.beatEnabledCheck.checked = this.beatSyncEnabled;
    }

    if (this.beatSyncEnabled) {
      if (this.visible) this.beatSyncManager.start();
    } else {
      this.beatSyncManager.stop();
      this.beatSyncManager.resetTap();
    }

    this.updateBeatSyncControls();
    return this.beatSyncEnabled;
  }

  /** Grey out the tempo controls and blank the indicator while sync is off. */
  updateBeatSyncControls() {
    const off = !this.beatSyncEnabled;

    if (this.bpmInput) this.bpmInput.disabled = off;
    if (this.tapBtn) this.tapBtn.disabled = off;
    if (this.beatIndicator) {
      this.beatIndicator.classList.toggle('disabled', off);
      if (off) this._renderBeat(-1);
    }
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
    if (!this.beatSyncEnabled) return;
    this._renderBeat(currentBeat % 4);
  }

  /**
   * Paint the four-beat indicator, filling the beat at `activeIndex` (-1 = none).
   */
  _renderBeat(activeIndex) {
    if (!this.beatIndicator) return;
    // Four state dots, not icons — `icon-beat` is a single glyph containing the
    // whole row, so it can't express which beat is active. Plain CSS circles can.
    this.beatIndicator.textContent = '';
    this.beatIndicator.style.display = 'flex';
    this.beatIndicator.style.alignItems = 'center';
    this.beatIndicator.style.gap = '6px';
    for (let i = 0; i < 4; i++) {
      const dot = document.createElement('span');
      dot.style.cssText =
        'width:8px;height:8px;border-radius:50%;background:currentColor;' +
        `opacity:${i === activeIndex ? '1' : '0.25'}`;
      this.beatIndicator.appendChild(dot);
    }
  }

  /**
   * Show panel
   */
  show() {
    this.visible = true;
    this.container.style.display = 'flex';
    this.switchTab(this.activeTab);

    // The beat clock was never started, so BPM and tap tempo drove nothing and
    // the indicator sat blank. Run it while the panel is open - unless the user
    // has switched beat sync off.
    if (this.beatSyncEnabled) this.beatSyncManager.start();
  }

  /**
   * Hide panel
   */
  hide() {
    this.closeContextMenu();
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
  async loadFromStorage() {
    const presets = readStoredJSON(PRESETS_STORAGE_KEY);
    if (presets) this.presetManager.importPresets(presets);

    const playlist = readStoredJSON(PLAYLIST_STORAGE_KEY);
    if (playlist) {
      this.playlistManager.importPlaylist(playlist);
      if (this.playlistLoopCheck) {
        this.playlistLoopCheck.checked = this.playlistManager.loop;
      }
    }

    const settings = readStoredJSON(SETTINGS_STORAGE_KEY);
    if (settings) {
      if (Number.isFinite(settings.bpm) && this.beatSyncManager.setBPM(settings.bpm)) {
        this.bpmInput.value = String(this.beatSyncManager.bpm);
      }
      if (settings.beatSyncEnabled !== undefined) {
        this.setBeatSyncEnabled(settings.beatSyncEnabled);
      }
    }

    // Last, so presets, playlist and settings are in place without waiting on
    // IndexedDB. The audio library is its own store and does not hold scenes up.
    this.audioLibrary.load();
    if (await this.sceneManager.load()) {
      if (this.activeTab === 'scenes') this.refreshScenes();
      this.syncPlaylistUI();
    }
  }

  /**
   * Save to storage. Returns false if any part could not be written, so the
   * caller can tell the user rather than claiming a save that did not happen.
   */
  async saveToStorage() {
    const scenesSaved = await this.sceneManager.save();
    const presetsSaved = writeStoredJSON(PRESETS_STORAGE_KEY, this.presetManager.exportPresets());
    const playlistSaved = writeStoredJSON(PLAYLIST_STORAGE_KEY, this.playlistManager.exportPlaylist());
    const settingsSaved = writeStoredJSON(SETTINGS_STORAGE_KEY, {
      version: 1,
      beatSyncEnabled: this.beatSyncEnabled,
      bpm: this.beatSyncManager.bpm
    });

    return scenesSaved && presetsSaved && playlistSaved && settingsSaved;
  }
}
