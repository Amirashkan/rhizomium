// A MIDI controller for recordings with no hardware attached. Run in the page
// (page.evaluate) before MIDI is enabled: it answers requestMIDIAccess with one
// input port, and draws that port as a small on-screen controller whose knobs
// and fader turn as CCs are sent through window.__midi.
//
//   window.__midi.send(cc, value)          one Control Change, 0-127
//   window.__midi.sweep(cc, from, to, ms)   a turn of the control, ~60 messages a second
//
// `controls` lists what the controller shows: [{ cc, label, type: 'knob' | 'fader' }].
export function installVirtualMidi({ controls, name = 'Virtual Controller', at = { left: 24, bottom: 24 } }) {
  if (window.__midi) return;
  const input = {
    id: 'virtual-controller', name, manufacturer: 'On-screen', state: 'connected',
    connection: 'open', type: 'input', onmidimessage: null,
    addEventListener() {}, removeEventListener() {},
  };
  const access = {
    inputs: new Map([[input.id, input]]), outputs: new Map(), sysexEnabled: false,
    onstatechange: null, addEventListener() {}, removeEventListener() {},
  };
  navigator.requestMIDIAccess = async () => access;

  const box = document.createElement('div');
  box.id = 'virtual-midi';
  box.style.cssText = `position: fixed; left: ${at.left}px; bottom: ${at.bottom}px; z-index: 99990;
    display: none; gap: 18px; align-items: flex-end; padding: 14px 18px 10px; border-radius: 12px;
    background: rgba(20, 18, 14, 0.92); border: 1px solid rgba(255, 244, 230, 0.12);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); font: 600 11px system-ui, sans-serif; color: #b9b0a3;
    pointer-events: none;`;
  const title = document.createElement('div');
  title.textContent = name;
  title.style.cssText = 'position: absolute; top: -22px; left: 4px; color: #8f867a; font-size: 12px;';
  box.appendChild(title);

  const views = new Map();
  for (const c of controls) {
    const cell = document.createElement('div');
    cell.style.cssText = 'display: flex; flex-direction: column; align-items: center; gap: 6px; width: 64px;';
    let draw;
    if (c.type === 'fader') {
      cell.innerHTML = `<div style="position: relative; width: 10px; height: 96px; border-radius: 5px; background: #0d0b08; border: 1px solid #2c2720;">
        <div class="fill" style="position: absolute; left: 0; right: 0; bottom: 0; border-radius: 5px; background: #d9733f;"></div>
        <div class="cap" style="position: absolute; left: -11px; width: 32px; height: 14px; border-radius: 3px; background: #e8e1d6; box-shadow: 0 1px 3px #000;"></div></div>`;
      const fill = cell.querySelector('.fill');
      const cap = cell.querySelector('.cap');
      draw = (v) => { fill.style.height = `${(v / 127) * 100}%`; cap.style.bottom = `${(v / 127) * 82}px`; };
    } else {
      cell.innerHTML = `<svg width="56" height="56" viewBox="0 0 56 56">
        <path d="M 13.9 42.1 A 20 20 0 1 1 42.1 42.1" fill="none" stroke="#2c2720" stroke-width="5" stroke-linecap="round"/>
        <path class="arc" d="M 13.9 42.1 A 20 20 0 1 1 42.1 42.1" fill="none" stroke="#d9733f" stroke-width="5" stroke-linecap="round" pathLength="100"/>
        <circle cx="28" cy="28" r="14" fill="#e8e1d6"/>
        <line class="tick" x1="28" y1="28" x2="28" y2="16" stroke="#14110a" stroke-width="3" stroke-linecap="round"/></svg>`;
      const arc = cell.querySelector('.arc');
      const tick = cell.querySelector('.tick');
      draw = (v) => {
        const t = v / 127;
        arc.setAttribute('stroke-dasharray', `${t * 100} 100`);
        tick.setAttribute('transform', `rotate(${-135 + t * 270} 28 28)`);
      };
    }
    const label = document.createElement('div');
    label.innerHTML = `<div style="color: #f3ede4; text-align: center;">${c.label}</div><div style="text-align: center; font-weight: 500;">CC ${c.cc}</div>`;
    cell.appendChild(label);
    box.appendChild(cell);
    const view = { draw, value: c.value ?? 0, cell };
    draw(view.value);
    views.set(c.cc, view);
  }
  document.body.appendChild(box);

  const send = (cc, value) => {
    const v = Math.max(0, Math.min(127, Math.round(value)));
    const view = views.get(cc);
    if (view) { view.value = v; view.draw(v); }
    input.onmidimessage?.({ data: new Uint8Array([0xb0, cc, v]), timeStamp: performance.now() });
  };
  window.__midi = {
    send,
    show(on = true) { box.style.display = on ? 'flex' : 'none'; },
    value: (cc) => views.get(cc)?.value ?? 0,
    /** Mark a control as the one being moved. */
    hot(cc) {
      for (const [k, v] of views) v.cell.style.filter = k === cc ? 'drop-shadow(0 0 6px rgba(217, 115, 63, 0.7))' : '';
    },
    sweep(cc, from, to, ms) {
      return new Promise((done) => {
        const t0 = performance.now();
        const step = () => {
          const t = Math.min(1, (performance.now() - t0) / ms);
          const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
          const v = Math.round(from + (to - from) * e);
          if (v !== views.get(cc)?.value || t === 0) send(cc, v);
          if (t < 1) setTimeout(step, 16); else done();
        };
        step();
      });
    },
  };
}
