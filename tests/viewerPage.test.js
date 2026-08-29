// The viewer page document: the room a published patch hangs in.
//
// Two properties matter more than any individual field. A page nobody has
// touched must serialize to nothing, so a patch saved today reads like one
// saved before the setting existed. And nothing the document says may reach CSS
// except a colour — a patch that could name a URL there would be a beacon, which
// is what patchSource.js and patchTextures.js refuse one level up.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ViewerPageModel,
  DEFAULT_VIEWER_PAGE,
  MAX_PAGE_TITLE_LENGTH,
  isDefaultPage,
  makeViewerPage,
  normalizeColor,
  resolveViewerPage,
} from '../src/viewer/ViewerPage.js';

describe('normalizeColor', () => {
  it('takes a hex colour, in either length', () => {
    expect(normalizeColor('#1A2B3C')).toBe('#1a2b3c');
    expect(normalizeColor('  #abc ')).toBe('#aabbcc');
  });

  it('refuses everything that is not one', () => {
    for (const value of [
      'red',
      'rgb(1,2,3)',
      'url(https://tracker.example/pixel.png)',
      '#12345',
      '#gggggg',
      'black; background-image: url(x)',
      '',
      null,
      42,
    ]) {
      expect(normalizeColor(value)).toBe(null);
    }
  });
});

describe('makeViewerPage', () => {
  it('fills every field in from nothing', () => {
    expect(makeViewerPage()).toEqual({ ...DEFAULT_VIEWER_PAGE });
  });

  it('falls back to the default rather than letting junk through', () => {
    expect(makeViewerPage({ background: 'url(x)' }).background).toBe(DEFAULT_VIEWER_PAGE.background);
    expect(makeViewerPage({ fit: 'stretch' }).fit).toBe('contain');
    expect(makeViewerPage({ controls: 'always' }).controls).toBe('auto');
  });

  it('keeps the settings it does understand', () => {
    expect(makeViewerPage({ fit: 'cover', controls: 'pinned', showNotes: false })).toMatchObject({
      fit: 'cover',
      controls: 'pinned',
      showNotes: false,
    });
  });

  it('flattens and clamps a title', () => {
    expect(makeViewerPage({ title: '  a\nb   c ' }).title).toBe('a b c');
    expect(makeViewerPage({ title: 'x'.repeat(200) }).title).toHaveLength(MAX_PAGE_TITLE_LENGTH);
  });
});

describe('resolveViewerPage', () => {
  it('gives a patch that says nothing the page the viewer always had', () => {
    expect(resolveViewerPage(undefined)).toEqual({ ...DEFAULT_VIEWER_PAGE });
    expect(resolveViewerPage(null)).toEqual({ ...DEFAULT_VIEWER_PAGE });
    expect(resolveViewerPage('nonsense')).toEqual({ ...DEFAULT_VIEWER_PAGE });
  });

  it('completes a patch that says only some of it', () => {
    expect(resolveViewerPage({ fit: 'cover' })).toEqual({
      ...DEFAULT_VIEWER_PAGE,
      fit: 'cover',
    });
  });
});

describe('ViewerPageModel', () => {
  let model;
  beforeEach(() => {
    model = new ViewerPageModel();
  });

  it('starts on the default page and writes nothing for it', () => {
    expect(model.isDefault).toBe(true);
    expect(model.serialize()).toBe(null);
  });

  it('writes the page once something is changed', () => {
    model.update({ background: '#112233' });
    expect(model.isDefault).toBe(false);
    expect(model.serialize()).toMatchObject({ background: '#112233' });
  });

  it('notifies once per real change, and not at all for a no-op', () => {
    let calls = 0;
    model.onChange(() => calls++);

    model.update({ fit: 'cover' });
    expect(calls).toBe(1);

    model.update({ fit: 'cover' });
    expect(calls).toBe(1);

    // Refused values change nothing, so they notify nothing.
    model.update({ fit: 'stretch' });
    expect(calls).toBe(1);

    model.update({ showNotes: false });
    expect(calls).toBe(2);
  });

  it('goes back to writing nothing when reset', () => {
    model.update({ background: '#112233', fit: 'cover', controls: 'hidden' });
    model.reset();
    expect(model.isDefault).toBe(true);
    expect(model.serialize()).toBe(null);
  });

  it('round-trips through the project file', () => {
    model.update({ title: 'Slow bloom', background: '#101018', fit: 'cover', showNotes: false });
    const loaded = new ViewerPageModel();
    loaded.deserialize(model.serialize());
    expect(loaded.get()).toEqual(model.get());
  });

  it('restores the defaults when a patch carries no page', () => {
    model.update({ background: '#ff0000' });
    // Opening a second patch must not leave the first one's ground behind it.
    model.deserialize(null);
    expect(model.isDefault).toBe(true);
  });

  it('hands out copies, so the settings cannot be edited behind its back', () => {
    const page = model.get();
    page.background = '#ff0000';
    expect(model.get().background).toBe(DEFAULT_VIEWER_PAGE.background);
  });
});

describe('isDefaultPage', () => {
  it('reads a partial record as default when its fields are', () => {
    expect(isDefaultPage({})).toBe(true);
    expect(isDefaultPage({ fit: 'contain' })).toBe(true);
    expect(isDefaultPage({ fit: 'cover' })).toBe(false);
  });
});
