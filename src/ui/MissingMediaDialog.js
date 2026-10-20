// MissingMediaDialog.js — the files an opened project names but could not read.
//
// On the desktop a project saves its media by path (core/mediaRefs.js). Move or
// rename one of those files, or open the project on another machine, and the
// path no longer answers. The project still opens - those nodes just come up
// empty - and this dialog lists what is missing so the artist can point at it:
//
//   Locate…         pick the file for one row
//   Search folder…  pick a folder; every missing file found in it is relinked
//                   at once (desktop only - a browser cannot search)
//
// A row is one file, however many places use it: the open graph, any number
// of VJ scenes, the audio tab. Relinking it relinks all of them.
//
// Closing it is "skip": the references stay with the project and are saved
// again, so nothing is lost by deciding later.
//
// The dialog only renders and reports; the relinking itself is the
// SaveLoadManager's (relinkMissingMedia and friends).

import { modalManager } from './ModalManager.js';
import { SEMANTIC, SURFACE, TEXT, FONT_MONO } from '../core/theme.js';

/** What kind of thing each missing entry was, in the artist's words. */
function describe(item) {
  if (item.kind === 'audio') return 'VJ audio track';
  if (item.kind === 'param') return item.param === 'fontData' ? 'Font' : 'Audio clip';
  return item.entry?.isVideo ? 'Video' : 'Image';
}

/** Where an entry is used, in the artist's words. */
function place(item) {
  if (item.sceneId != null) return item.sceneName ? `scene ${item.sceneName}` : 'a scene';
  if (item.kind === 'audio') return 'the audio tab';
  return 'the open patch';
}

/**
 * `missing` as one row per file: entries naming the same path together, in
 * the order the first of each was listed.
 */
export function groupMissing(missing) {
  const rows = new Map();
  for (const item of missing || []) {
    const key = item?.ref?.path || item;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(item);
  }
  return [...rows.values()];
}

/** The places a row's entries are used, with a long list cut short. */
export function usedIn(items, max = 4) {
  const places = [...new Set(items.map(place))];
  if (places.length <= max) return places.join(', ');
  return `${places.slice(0, max).join(', ')} and ${places.length - max} more`;
}

/**
 * Show the dialog for `missing`, a live array the callbacks shrink as entries
 * are relinked. Resolves when it is closed.
 *
 * @param {object} options
 * @param {object[]} options.missing SaveLoadManager.missingMedia
 * @param {(item: object) => Promise<boolean>} options.onLocate
 * @param {(() => Promise<number>)|null} options.onSearchFolder null hides the button
 */
export function showMissingMediaDialog({ missing, onLocate, onSearchFolder = null }) {
  const body = document.createElement('div');
  body.className = 'missing-media';
  body.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';

  const intro = document.createElement('div');
  intro.style.cssText = `font-size: 12px; color: ${TEXT.secondary};`;
  body.appendChild(intro);

  const list = document.createElement('div');
  list.style.cssText = `
    display: flex; flex-direction: column; gap: 6px; max-height: 50vh; overflow-y: auto;
  `;
  body.appendChild(list);

  const status = document.createElement('div');
  status.style.cssText = `font-size: 11px; min-height: 14px; color: ${TEXT.tertiary};`;
  body.appendChild(status);

  let busy = false;
  const run = async (task) => {
    if (busy) return;
    busy = true;
    status.style.color = TEXT.tertiary;
    status.textContent = 'Working…';
    try {
      status.textContent = (await task()) || '';
    } catch (error) {
      status.style.color = SEMANTIC.error;
      status.textContent = error?.message || String(error);
    } finally {
      busy = false;
      render();
    }
  };

  const render = () => {
    const rows = groupMissing(missing);
    const count = rows.length;
    intro.textContent = count
      ? `${count} media file${count === 1 ? '' : 's'} this project uses could not be found. ` +
        'Those nodes are empty until you point at the files. Skipping keeps the references, ' +
        'so the next save still names them.'
      : 'Every missing file has been relinked.';

    list.replaceChildren();
    for (const items of rows) {
      const [item] = items;
      const row = document.createElement('div');
      row.style.cssText = `
        display: flex; align-items: center; gap: 8px; padding: 6px 8px; box-sizing: border-box;
        border: 1px solid ${SURFACE.line}; border-radius: 8px; background: ${SURFACE.well};
      `;

      const text = document.createElement('div');
      text.style.cssText = 'flex: 1 1 auto; min-width: 0;';
      const name = document.createElement('div');
      name.style.cssText = `font-size: 12px; color: ${TEXT.primary};`;
      name.textContent = `${describe(item)} · ${item.ref?.name || 'unnamed'}`;
      const path = document.createElement('div');
      path.style.cssText = `
        font-size: 10px; color: ${TEXT.tertiary}; font-family: ${FONT_MONO};
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      `;
      path.textContent = item.ref?.path || '';
      path.title = item.ref?.path || '';
      const where = document.createElement('div');
      where.style.cssText = `font-size: 10px; color: ${TEXT.tertiary};`;
      where.textContent = `Used in ${usedIn(items)}`;
      where.title = usedIn(items, Infinity);
      text.append(name, path, where);

      const locate = document.createElement('button');
      locate.type = 'button';
      locate.className = 'modal-button';
      locate.textContent = 'Locate…';
      locate.style.flex = '0 0 auto';
      locate.addEventListener('click', () => run(async () =>
        (await onLocate(item)) ? `Relinked ${item.ref?.name || 'the file'}` : ''));

      row.append(text, locate);
      list.appendChild(row);
    }
  };

  render();

  const buttons = [];
  if (onSearchFolder) {
    buttons.push({
      label: 'Search folder…',
      onClick: () => {
        run(async () => {
          const found = await onSearchFolder();
          if (found == null) return '';
          return found ? `Relinked ${found} file${found === 1 ? '' : 's'}` : 'None of the missing files are in that folder';
        });
        return false; // stays open to show what is left
      },
    });
  }
  buttons.push({ label: 'Close', primary: true, onClick: () => true });

  return modalManager.custom({ title: 'Missing media', body, buttons, requireAction: true });
}
