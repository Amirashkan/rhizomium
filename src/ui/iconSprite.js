// src/ui/iconSprite.js
//
// Single source of truth for the app's icon set. `src/assets/icons-sprite.svg`
// holds every glyph as a <symbol>; call ensureIconSprite() once before the first
// icon renders, then reference glyphs anywhere with:
//
//   <svg><use href="#icon-play"/></svg>
//
// Icons are monochrome and stroke on `currentColor`, so they inherit the text
// colour of whatever element they sit in.
//
// The sprite must live in the main document (not a shadow root) for <use> to
// resolve — nothing in this app uses shadow DOM, so a body-level host is fine.
import spriteMarkup from '../assets/icons-sprite.svg?raw';

const HOST_ID = 'rz-icon-sprite';

let injected = false;

/**
 * Inject the icon sprite into the document. Idempotent — safe to call from any
 * entry point (editor, second monitor) and on every menu open.
 */
export function ensureIconSprite() {
  if (injected || typeof document === 'undefined' || !document.body) return;

  // A previous call (or another entry point) may already have injected it.
  if (document.getElementById(HOST_ID)) {
    injected = true;
    return;
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  host.innerHTML = spriteMarkup;
  document.body.prepend(host);
  injected = true;
}

/**
 * Build an <svg><use/></svg> element for `iconId` ("icon-play" or just "play").
 * Sized square and marked decorative; pass `label` when the icon is the only
 * content of a control and needs an accessible name.
 */
export function createIcon(iconId, { size = 16, label = null, className = '' } = {}) {
  ensureIconSprite();

  const id = iconId.startsWith('icon-') ? iconId : `icon-${iconId}`;
  const NS = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 24 24');
  // `rz-icon` carries the shared alignment/spacing rules — always apply it, or
  // icons built here won't match the stylesheet the way iconMarkup() output does.
  svg.setAttribute('class', className ? `rz-icon ${className}` : 'rz-icon');

  if (label) {
    svg.setAttribute('role', 'img');
    const title = document.createElementNS(NS, 'title');
    title.textContent = label;
    svg.appendChild(title);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }

  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#${id}`);
  // Safari < 12 and the Tauri webview on older Linux WebKit still need xlink.
  use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', `#${id}`);
  svg.appendChild(use);

  return svg;
}

/**
 * Same as createIcon() but returns markup, for the panels that build their DOM
 * from template literals. Callers must have injected the sprite already —
 * ensureIconSprite() runs at startup, so that holds for anything user-visible.
 */
export function iconMarkup(iconId, { size = 16, label = null, className = '' } = {}) {
  const id = iconId.startsWith('icon-') ? iconId : `icon-${iconId}`;
  const a11y = label
    ? `role="img"><title>${label}</title`
    : 'aria-hidden="true"';
  return (
    `<svg class="rz-icon ${className}" width="${size}" height="${size}" ` +
    `viewBox="0 0 24 24" ${a11y}><use href="#${id}"/></svg>`
  );
}

/**
 * Replace an element's contents with an icon plus optional text. Used by the
 * panels that previously assigned an emoji straight to textContent.
 */
export function setIcon(el, iconId, { size = 16, text = '', label = null } = {}) {
  if (!el) return el;
  el.textContent = '';
  // No implicit label: an icon id is not an accessible name. Icon-only controls
  // should pass `label`, or carry a `title`/aria-label on the element itself.
  el.appendChild(createIcon(iconId, { size, label }));
  if (text) {
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
  }
  return el;
}
