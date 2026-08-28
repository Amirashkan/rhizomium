import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScreensPanel } from '../src/ui/ScreensPanel.js';
import { ScreenModel, MAIN_SCREEN_ID, MAX_SCREENS } from '../src/screens/ScreenModel.js';

describe('ScreensPanel', () => {
  let model, panel, statuses;

  const build = (opts = {}) => {
    model = new ScreenModel();
    statuses = [];
    panel = new ScreensPanel(model, {
      onStatus: (m, kind) => statuses.push([m, kind]),
      getCompositionAspect: () => 32 / 9,
      ...opts,
    });
    panel.open();
    return panel;
  };

  const el = (sel) => panel.panel.querySelector(sel);
  const all = (sel) => [...panel.panel.querySelectorAll(sel)];
  const click = (sel) => el(sel).dispatchEvent(new window.Event('click', { bubbles: true }));

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    panel?.destroy();
    document.body.innerHTML = '';
  });

  it('opens and closes without leaving anything behind', () => {
    build();
    expect(panel.panel.classList.contains('rz-scr-open')).toBe(true);
    panel.close();
    expect(panel.panel.classList.contains('rz-scr-open')).toBe(false);
    panel.destroy();
    expect(document.getElementById('screens-panel')).toBeNull();
    panel = null;
  });

  it('says how to start when the rig is empty', () => {
    build();
    expect(el('[data-role="summary"]').textContent).toBe('No screens');
    expect(el('.rz-scr-empty')).not.toBeNull();
  });

  it('lays a panorama out from one button', () => {
    build();
    click('[data-layout="span3"]');

    expect(model.count).toBe(3);
    expect(all('.rz-scr-row')).toHaveLength(3);
    expect(el('[data-role="summary"]').textContent).toBe('3 screens, 3 on');
    expect(statuses.at(-1)[0]).toContain('3 screens');
  });

  it('draws every screen’s region on the layout map, in the composition’s shape', () => {
    build();
    click('[data-layout="span3"]');

    expect(panel.mapEl.style.aspectRatio.startsWith(String(32 / 9))).toBe(true);
    const regions = all('.rz-scr-region');
    expect(regions).toHaveLength(3);
    // The picture is the same numbers the fields show, so the two cannot drift.
    expect(regions[1].style.left.startsWith('33.3')).toBe(true);
    expect(regions[0].querySelector('span').textContent).toBe('Left');
  });

  it('applies the edge blend to the next layout', () => {
    build();
    const slider = el('[data-role="overlap"]');
    slider.value = '10';
    slider.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(el('[data-role="overlap-out"]').textContent).toBe('10%');

    click('[data-layout="span2"]');
    // Overlapping tiles are the headroom a projector rig blends across.
    const [a, b] = model.list();
    expect(a.region.w).toBeGreaterThan(0.5);
    expect(a.region.x + a.region.w).toBeGreaterThan(b.region.x);
  });

  it('edits a screen’s region from the percentage fields', () => {
    build();
    click('[data-layout="single"]');
    const field = el('[data-role="region-w"]');
    field.value = '40';
    field.dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(model.get(MAIN_SCREEN_ID).region.w).toBeCloseTo(0.4, 6);
  });

  it('renames a screen and sets its presentation resolution', () => {
    build();
    click('[data-layout="single"]');

    const name = el('[data-role="name"]');
    name.value = 'Stage left';
    name.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(model.get(MAIN_SCREEN_ID).name).toBe('Stage left');

    const res = el('[data-role="res"]');
    res.value = '1920';
    res.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(model.get(MAIN_SCREEN_ID).displayMaxDim).toBe(1920);
  });

  it('switches one screen off without removing it from the rig', () => {
    build();
    click('[data-layout="span2"]');
    all('[data-act="toggle"]')[1].dispatchEvent(new window.Event('click', { bubbles: true }));

    expect(model.count).toBe(2);
    expect(model.enabledScreens()).toHaveLength(1);
    expect(el('[data-role="summary"]').textContent).toBe('2 screens, 1 on');
  });

  it('mirrors the composition onto every screen without closing any', () => {
    build();
    click('[data-layout="span3"]');
    const ids = model.list().map((s) => s.id);

    click('[data-layout="mirror"]');

    // The same image on three projectors — the rig itself is untouched.
    expect(model.list().map((s) => s.id)).toEqual(ids);
    expect(model.list().every((s) => s.region.w === 1 && s.region.x === 0)).toBe(true);
    expect(statuses.at(-1)[0]).toContain('3 screens');
  });

  it('removes a screen', () => {
    build();
    click('[data-layout="span2"]');
    all('[data-act="remove"]')[0].dispatchEvent(new window.Event('click', { bubbles: true }));
    expect(model.count).toBe(1);
  });

  it('refuses to grow past the rig limit, and says why', () => {
    build();
    for (let i = 0; i < MAX_SCREENS; i++) model.add({});
    click('[data-act="add"]');
    expect(model.count).toBe(MAX_SCREENS);
    expect(statuses.at(-1)[0]).toContain(String(MAX_SCREENS));
  });

  describe('when multi-screen is not entitled', () => {
    beforeEach(() => build({ canUseMultiScreen: () => false }));

    it('still allows the single output screen', () => {
      click('[data-act="add"]');
      expect(model.count).toBe(1);
      click('[data-layout="single"]');
      expect(model.count).toBe(1);
    });

    it('refuses a second screen and a multi-screen layout', () => {
      click('[data-act="add"]');
      click('[data-act="add"]');
      expect(model.count).toBe(1);

      click('[data-layout="span3"]');
      expect(model.count).toBe(1);
    });

    it('explains the gate in the footer', () => {
      expect(el('[data-role="foot"]').textContent).toContain('Cloude Plus');
      expect(el('[data-role="foot"]').classList.contains('rz-scr-gated')).toBe(true);
    });
  });

  it('offers the connected displays, and keeps an assignment for one that is not', () => {
    build();
    panel.displays = [
      { name: 'Internal', size: { width: 2560, height: 1440 } },
      { name: 'Projector A', size: { width: 1920, height: 1080 } },
    ];
    model.add({ id: 'a', displayIndex: 5 });

    const options = [...el('[data-role="display"]').options].map((o) => o.textContent);
    expect(options[0]).toContain('Auto');
    expect(options[2]).toBe('Projector A — 1920×1080');
    // A rig saved against gear that is not plugged in right now must survive
    // being looked at.
    expect(options.at(-1)).toContain('not connected');
    expect(el('[data-role="display"]').value).toBe('5');
  });

  it('escapes a screen name rather than letting it write markup', () => {
    build();
    model.add({ id: 'a', name: '<img src=x onerror=alert(1)>' });
    expect(panel.listEl.querySelector('img')).toBeNull();
    expect(el('[data-role="name"]').value).toBe('<img src=x onerror=alert(1)>');
  });
});
