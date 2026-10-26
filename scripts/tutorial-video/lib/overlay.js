// Injected into the editor page before it loads (page.addInitScript). Draws the
// things a screen recording needs and the app itself does not: a visible
// cursor (headless/automated input has none), a chapter card, highlight boxes
// and, optionally, burned-in captions. Everything sits in one fixed layer with
// pointer-events: none, so it never intercepts the clicks it is filming.
(() => {
  if (window.__tour) return;

  const css = `
    #tour-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
      font-family: 'Space Grotesk', 'Inter', system-ui, sans-serif; }
    #tour-cursor { position: absolute; width: 22px; height: 22px; margin: -3px 0 0 -3px;
      transition: transform 90ms ease-out; filter: drop-shadow(0 2px 3px rgba(0,0,0,.6)); }
    #tour-cursor.down { transform: scale(.82); }
    .tour-ripple { position: absolute; width: 36px; height: 36px; margin: -18px 0 0 -18px;
      border: 2px solid #c6f04a; border-radius: 50%; animation: tour-ripple 520ms ease-out forwards; }
    @keyframes tour-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.6); opacity: 0 } }
    .tour-box { position: absolute; border: 2px solid #c6f04a; border-radius: 10px;
      box-shadow: 0 0 0 4000px rgba(0,0,0,.28), 0 0 24px rgba(198,240,74,.55);
      transition: opacity 300ms; animation: tour-pulse 1.6s ease-in-out infinite; }
    @keyframes tour-pulse { 50% { box-shadow: 0 0 0 4000px rgba(0,0,0,.28), 0 0 40px rgba(198,240,74,.85) } }
    .tour-label { position: absolute; left: 0; top: -34px; white-space: nowrap; padding: 4px 10px;
      background: #c6f04a; color: #111; font-size: 15px; font-weight: 600; border-radius: 6px; }
    #tour-chapter { position: absolute; left: 40px; bottom: 70px; padding: 14px 22px 14px 18px;
      background: rgba(14,13,12,.88); border-left: 4px solid #c6f04a; border-radius: 8px; color: #f3f1ea;
      opacity: 0; transform: translateY(12px); transition: opacity 400ms, transform 400ms; }
    #tour-chapter.show { opacity: 1; transform: none; }
    #tour-chapter small { display: block; color: #c6f04a; font-size: 13px; letter-spacing: .12em;
      text-transform: uppercase; margin-bottom: 4px; }
    #tour-chapter b { font-size: 28px; font-weight: 600; }
    #tour-caption { position: absolute; left: 50%; bottom: 46px; transform: translateX(-50%);
      max-width: 1300px; padding: 10px 20px; border-radius: 8px; background: rgba(0,0,0,.78);
      color: #fff; font-size: 30px; line-height: 1.3; text-align: center; opacity: 0; transition: opacity 200ms; }
    #tour-caption.show { opacity: 1; }
    #tour-card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 14px; background: radial-gradient(ellipse at 30% 20%, #2a2140, #0e0d0c 70%);
      color: #f3f1ea; opacity: 0; transition: opacity 600ms; }
    #tour-card.show { opacity: 1; }
    #tour-card h1 { margin: 0; font-size: 84px; font-weight: 600; letter-spacing: -.02em; }
    #tour-card p { margin: 0; font-size: 30px; color: #c9c4b8; }
    #tour-card .accent { color: #c6f04a; }
    #tour-card ol, #tour-card ul { margin: 6px 0 0; padding-left: 1.2em; font-size: 32px; line-height: 1.6;
      color: #f3f1ea; max-width: 1300px; }
    #tour-card li::marker { color: #c6f04a; }
    #tour-card code { font-family: 'JetBrains Mono', Consolas, monospace; font-size: .85em; padding: 2px 8px;
      border-radius: 6px; background: rgba(255,255,255,.08); color: #c6f04a; }
    #tour-card small { font-size: 22px; color: #8f8a7f; }
  `;

  const cursorSvg = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2 L3 19 L7.5 14.8 L10.6 21.4 L13.4 20.1 L10.4 13.7 L16.6 13.7 Z"
    fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

  let layer, cursor, chapter, caption, card;

  function mount() {
    if (layer || !document.body) return;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    layer = document.createElement('div');
    layer.id = 'tour-layer';
    layer.innerHTML = `<div id="tour-card"></div><div id="tour-chapter"></div>
      <div id="tour-caption"></div><div id="tour-cursor">${cursorSvg}</div>`;
    document.body.appendChild(layer);
    cursor = layer.querySelector('#tour-cursor');
    chapter = layer.querySelector('#tour-chapter');
    caption = layer.querySelector('#tour-caption');
    card = layer.querySelector('#tour-card');
    cursor.style.left = '-100px';
  }

  // Capture phase on window, so an app handler that stops propagation can't
  // leave the drawn cursor behind the real one.
  window.addEventListener('mousemove', (e) => {
    mount();
    if (!cursor) return;
    cursor.style.left = `${e.clientX}px`;
    cursor.style.top = `${e.clientY}px`;
  }, true);
  window.addEventListener('mousedown', (e) => {
    mount();
    if (!cursor) return;
    cursor.classList.add('down');
    const r = document.createElement('div');
    r.className = 'tour-ripple';
    r.style.left = `${e.clientX}px`;
    r.style.top = `${e.clientY}px`;
    layer.appendChild(r);
    setTimeout(() => r.remove(), 600);
  }, true);
  window.addEventListener('mouseup', () => cursor?.classList.remove('down'), true);
  document.addEventListener('DOMContentLoaded', mount);

  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

  window.__tour = {
    chapter(num, title, ms = 4200) {
      mount();
      chapter.innerHTML = `<small>${esc(num)}</small><b>${esc(title)}</b>`;
      chapter.classList.add('show');
      clearTimeout(chapter._t);
      chapter._t = setTimeout(() => chapter.classList.remove('show'), ms);
    },
    caption(text) {
      mount();
      if (!text) { caption.classList.remove('show'); return; }
      caption.textContent = text;
      caption.classList.add('show');
    },
    card(html) {
      mount();
      if (!html) { card.classList.remove('show'); return; }
      card.innerHTML = html;
      card.classList.add('show');
    },
    // rect in client pixels; returns an id for clear()
    highlight(rect, label, pad = 8) {
      mount();
      const box = document.createElement('div');
      box.className = 'tour-box';
      Object.assign(box.style, {
        left: `${rect.x - pad}px`, top: `${rect.y - pad}px`,
        width: `${rect.width + pad * 2}px`, height: `${rect.height + pad * 2}px`,
      });
      if (label) box.innerHTML = `<span class="tour-label">${esc(label)}</span>`;
      if (rect.y - pad < 40 && label) box.firstChild.style.top = `${rect.height + pad * 2 + 8}px`;
      layer.insertBefore(box, cursor);
      return box;
    },
    clearHighlights() {
      layer?.querySelectorAll('.tour-box').forEach((b) => b.remove());
    },
  };
})();
