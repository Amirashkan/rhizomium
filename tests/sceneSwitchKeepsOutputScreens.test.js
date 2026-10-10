import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SaveLoadManager } from '../src/core/SaveLoadManager.js';
import { ScreenModel, resetScreenIdCounter } from '../src/screens/ScreenModel.js';

/**
 * A VJ scene is a project, and a scene switch loads it through importProject —
 * which restores the project's output screens. Deserializing a rig switches
 * every screen off, and the viewer closes whatever is off, so every scene change
 * shut the second-monitor window. A live rig must be left alone.
 */
describe('importOutputScreens', () => {
  const importOutputScreens = SaveLoadManager.prototype.importOutputScreens;
  let model;

  beforeEach(() => {
    resetScreenIdCounter(1);
    model = new ScreenModel();
    global.window = { screenModel: model };
  });

  afterEach(() => {
    delete global.window;
  });

  it('leaves a live rig open when a scene loads', () => {
    model.ensureMain();
    expect(model.enabledScreens()).toHaveLength(1);
    let changes = 0;
    model.onChange(() => { changes += 1; });

    importOutputScreens.call({}, { screens: [{ id: 'main', name: 'Main output' }] });

    expect(model.enabledScreens()).toHaveLength(1);
    expect(changes).toBe(0);
  });

  it('still restores the saved rig, switched off, when no output is live', () => {
    importOutputScreens.call({}, { screens: [{ id: 'screen-4', name: 'Left' }] });

    expect(model.list().map((s) => s.id)).toEqual(['screen-4']);
    expect(model.enabledScreens()).toHaveLength(0);
  });
});
