import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * The status bar's cursor readout, over two surfaces.
 *
 * The graph and the render are different spaces with different origins, and the
 * readout used to quote graph coordinates while the pointer was over the render
 * — which reads as the bar having the wrong 0,0. What is worth pinning down is
 * that each surface reports its own space: node coordinates over the graph, and
 * the pixel of the output frame over the render, measured from the frame's
 * top-left however large the panel has been dragged.
 */

const { StatusBar } = await import('../src/ui/StatusBar.js');
const { setOutputFormat } = await import('../src/ui/OutputFormat.js');

/** A canvas that reports the box we hand it, since happy-dom lays nothing out. */
function fakeCanvas(id, rect) {
  const el = document.createElement('canvas');
  el.id = id;
  el.getBoundingClientRect = () => ({
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
  });
  document.body.appendChild(el);
  return el;
}

/** Dispatch a pointermove carrying client coordinates — happy-dom's Event
 *  has none of its own, so they are defined on the instance. */
function pointerMove(el, clientX, clientY) {
  const event = new window.Event('pointermove', { bubbles: true });
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'clientY', { value: clientY });
  el.dispatchEvent(event);
}

describe('status bar cursor readout', () => {
  let bar;
  let graphCanvas;
  let gpuCanvas;

  beforeEach(() => {
    document.body.innerHTML = '';
    // Graph canvas below the 40px menu bar, render panel floating over it.
    graphCanvas = fakeCanvas('ui-canvas', { left: 0, top: 40, width: 1280, height: 760 });
    gpuCanvas = fakeCanvas('gpu-canvas', { left: 20, top: 100, width: 640, height: 360 });

    setOutputFormat(1920, 1080, 'test');

    bar = new StatusBar({
      canvas: graphCanvas,
      graph: { nodes: [], connections: [] },
      viewport: {
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        screenToCanvas: (x, y) => ({ x, y }),
      },
    });
    bar.mount();
  });

  afterEach(() => {
    bar.destroy();
    document.body.innerHTML = '';
  });

  it('reports graph coordinates over the graph canvas', () => {
    pointerMove(graphCanvas, 400, 300);
    expect(bar.cursorEl.textContent).toBe('x 400  y 260');
    expect(bar.cursorEl.title).toMatch(/graph space/);
  });

  it('reports output-frame pixels over the render, not graph coordinates', () => {
    pointerMove(gpuCanvas, 20 + 320, 100 + 180); // centre of the render
    expect(bar.cursorEl.textContent).toBe('out x 960  y 540');
    expect(bar.cursorEl.title).toContain('1920×1080');
    expect(bar.cursorEl.title).toContain('uv 0.500, 0.500');
  });

  it('measures the output from the frame top-left, whatever size the panel is', () => {
    pointerMove(gpuCanvas, 20, 100); // the render's own top-left corner
    expect(bar.cursorEl.textContent).toBe('out x 0  y 0');
  });

  it('follows the output format rather than the panel size', () => {
    setOutputFormat(1280, 720, 'test');
    pointerMove(gpuCanvas, 20 + 320, 100 + 180);
    expect(bar.cursorEl.textContent).toBe('out x 640  y 360');
  });

  it('switches back to graph space when the pointer leaves the render', () => {
    pointerMove(gpuCanvas, 20 + 320, 100 + 180);
    pointerMove(graphCanvas, 100, 140);
    expect(bar.cursorEl.textContent).toBe('x 100  y 100');
    expect(bar.cursorEl.title).toMatch(/graph space/);
  });

  it('stops listening on both surfaces once destroyed', () => {
    bar.destroy();
    expect(bar.cursorEl).toBeTruthy();
    const before = bar.cursorEl.textContent;
    pointerMove(gpuCanvas, 20 + 320, 100 + 180);
    expect(bar.cursorEl.textContent).toBe(before);
  });
});
