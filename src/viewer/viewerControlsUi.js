/**
 * viewerControlsUi.js — the panel a visitor turns the patch's knobs with.
 *
 * A patch that offers no controls gets no panel and no keyboard hint: the page
 * stays exactly the full-bleed render it was. Everything below only happens for
 * a patch whose author put something in it.
 *
 * Two decisions shape it.
 *
 * **The artwork keeps the room.** The panel is an overlay that fades away when
 * nothing is happening, in the same spirit as the notes line: a piece is being
 * looked at, not operated. It comes back on any pointer movement, and `C`
 * pins it open for someone who wants to sit and play.
 *
 * **Every input writes through the runtime**, never onto the graph directly, so
 * the choice between a uniform write and a shader rebuild is made in one place
 * (PatchRuntime.setControlValue) and this file only has to build inputs.
 */

/** How long the panel stays up after the last interaction, in ms. */
const IDLE_HIDE_MS = 2600;

/** Format a number for the read-out beside a slider. */
function formatValue(value, step) {
  if (!Number.isFinite(value)) return '0';
  const decimals = step >= 1 ? 0 : Math.min(4, Math.max(0, -Math.floor(Math.log10(step))));
  return value.toFixed(decimals);
}

export class ViewerControlsUi {
  /**
   * @param {HTMLElement} root the panel element
   * @param {import('./PatchRuntime.js').PatchRuntime} runtime
   */
  constructor(root, runtime) {
    this.root = root;
    this.runtime = runtime;
    this.pinned = false;
    this._idleTimer = null;
    this._bound = false;
  }

  /** Build the panel for the runtime's controls. @returns {boolean} shown */
  mount() {
    const entries = this.runtime?.controls || [];
    this.root.replaceChildren();

    if (!entries.length) {
      this.root.hidden = true;
      return false;
    }

    const title = document.createElement('div');
    title.className = 'viewer-controls-title';
    title.textContent = 'Controls';

    const hint = document.createElement('span');
    hint.className = 'viewer-controls-hint';
    hint.textContent = 'C to pin';
    title.append(hint);
    this.root.append(title);

    for (const entry of entries) this.root.append(this._row(entry));

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'viewer-controls-reset';
    reset.textContent = 'Reset';
    reset.title = 'Put every control back to the value the patch was published with';
    reset.addEventListener('click', () => {
      this.runtime.resetControls();
      this.mount(); // rebuild so every input shows the restored value
      this.wake();
    });
    this.root.append(reset);

    this.root.hidden = false;
    this._bind();
    this.wake();
    return true;
  }

  /** One labelled input. */
  _row(entry) {
    const { control } = entry;
    const row = document.createElement('label');
    row.className = 'viewer-control';

    const name = document.createElement('span');
    name.className = 'viewer-control-name';
    name.textContent = control.label;
    row.append(name);

    if (control.kind === 'toggle') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!entry.value;
      input.addEventListener('change', () => {
        this.runtime.setControlValue(control, input.checked);
        this.wake();
      });
      row.append(input);
      return row;
    }

    if (control.kind === 'choice') {
      const input = document.createElement('select');
      for (const option of control.options || []) {
        const el = document.createElement('option');
        el.value = option;
        el.textContent = option;
        if (option === entry.value) el.selected = true;
        input.append(el);
      }
      input.addEventListener('change', () => {
        this.runtime.setControlValue(control, input.value);
        this.wake();
      });
      row.append(input);
      return row;
    }

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(control.min);
    input.max = String(control.max);
    input.step = String(control.step);
    // The authored value may sit outside the offered range; the slider shows
    // the nearest end rather than snapping the patch to it before anyone
    // touches anything.
    input.value = String(Math.min(Math.max(Number(entry.value) || 0, control.min), control.max));

    const readout = document.createElement('output');
    readout.className = 'viewer-control-value';
    readout.textContent = formatValue(Number(entry.value) || 0, control.step);

    input.addEventListener('input', () => {
      const stored = this.runtime.setControlValue(control, input.value);
      readout.textContent = formatValue(Number(stored), control.step);
      this.wake();
    });

    row.append(input, readout);
    return row;
  }

  /**
   * Show the panel and start the fade timer again.
   *
   * A pinned panel still calls this — the timer simply never hides it — so the
   * two states share one code path and pinning cannot leave a stale timer
   * running behind it.
   */
  wake() {
    this.root.classList.remove('is-idle');
    if (this._idleTimer) clearTimeout(this._idleTimer);
    if (this.pinned) return;
    this._idleTimer = setTimeout(() => {
      // Never fade out from under a hand that is on it.
      if (this.root.matches(':hover') || this.root.contains(document.activeElement)) {
        this.wake();
        return;
      }
      this.root.classList.add('is-idle');
    }, IDLE_HIDE_MS);
  }

  /** Pin the panel open, or let it fade again. */
  togglePinned() {
    this.pinned = !this.pinned;
    this.root.classList.toggle('is-pinned', this.pinned);
    this.wake();
  }

  _bind() {
    if (this._bound) return;
    this._bound = true;

    // Any pointer movement over the page brings the panel back — the same
    // gesture that brings back a media player's controls.
    document.addEventListener('pointermove', () => this.wake(), { passive: true });
    this.root.addEventListener('pointerenter', () => this.wake());

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'c' && event.key !== 'C') return;
      // A visitor typing into one of the panel's own inputs is not asking to
      // pin it.
      if (event.target instanceof HTMLElement && event.target.closest('#viewer-controls')) return;
      this.togglePinned();
    });
  }
}
