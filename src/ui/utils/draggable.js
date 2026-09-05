/**
 * draggable.js - Utility for making panels draggable
 *
 * Usage:
 *   makeDraggable(panel, dragHandle);
 *
 * Positions are clamped through windowBounds so a panel can't be parked under
 * the top menu bar, which would swallow the very header it is dragged by.
 *
 * @param {HTMLElement} panel - The element to make draggable
 * @param {HTMLElement} dragHandle - The element that triggers dragging (e.g., header)
 * @returns {Function} cleanup function to remove event listeners
 */
import { clampPanelPosition, keepPanelInBounds } from './windowBounds.js';
import { rememberDefaultGeometry } from './panelGeometry.js';

export function makeDraggable(panel, dragHandle) {
  if (!panel || !dragHandle) {

    return () => {};
  }

  // Before the first drag, so Window → Reset Layout can undo every drag that
  // follows (see panelGeometry.js).
  rememberDefaultGeometry(panel);

  let isDragging = false;
  let currentX = 0;
  let currentY = 0;
  let initialX = 0;
  let initialY = 0;
  let originalTransition = '';
  let panelWidth = 0;
  let panelHeight = 0;

  const onMouseDown = (e) => {
    // Only drag on left click, and not on buttons or inputs
    if (e.button !== 0) return;
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
      return;
    }

    // Prevent default to avoid text selection
    e.preventDefault();
    e.stopPropagation();

    // Get current position and dimensions
    const rect = panel.getBoundingClientRect();
    currentX = rect.left;
    currentY = rect.top;
    
    // Store panel dimensions for bounds checking
    panelWidth = rect.width || panel.offsetWidth;
    panelHeight = rect.height || panel.offsetHeight;

    // Store initial mouse position relative to panel
    initialX = e.clientX - currentX;
    initialY = e.clientY - currentY;

    // Set dragging state immediately
    isDragging = true;

    // Store and disable transitions for instant response
    originalTransition = panel.style.transition;
    panel.style.transition = 'none';

    // Change cursor immediately for instant feedback
    dragHandle.style.cursor = 'grabbing';
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    // Ensure panel has absolute positioning with current position
    if (panel.style.position !== 'fixed' && panel.style.position !== 'absolute') {
      panel.style.position = 'fixed';
    }
    
    // Clear transform to use left/top positioning instead
    panel.style.transform = 'none';
    panel.style.left = currentX + 'px';
    panel.style.top = currentY + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  };

  const onMouseMove = (e) => {
    if (!isDragging) return;

    e.preventDefault();
    e.stopPropagation();

    // Calculate new position
    const newX = e.clientX - initialX;
    const newY = e.clientY - initialY;

    // Keep the whole window within the viewport, and its header below the top
    // menu bar - dropped under the bar the panel loses the header it is
    // dragged and closed by.
    const bounded = clampPanelPosition(newX, newY, {
      width: panelWidth,
      height: panelHeight,
    });
    currentX = bounded.left;
    currentY = bounded.top;

    // Update position immediately for responsive feel
    panel.style.left = currentX + 'px';
    panel.style.top = currentY + 'px';
  };

  const onMouseUp = () => {
    if (!isDragging) return;

    isDragging = false;

    // Restore transition after a brief delay to avoid snapping
    setTimeout(() => {
      panel.style.transition = originalTransition;
    }, 10);

    dragHandle.style.cursor = 'grab';
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  // A panel dropped near an edge is left off screen when the window shrinks
  // under it - and one near the top ends up inside the menu bar. Only panels
  // actually parked at pixel coordinates are touched; the rest are still
  // anchored by their stylesheet and follow the viewport on their own.
  const onWindowResize = () => {
    keepPanelInBounds(panel);
  };

  // Set initial cursor style
  dragHandle.style.cursor = 'grab';

  // Add event listeners
  dragHandle.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  window.addEventListener('resize', onWindowResize);

  // Return cleanup function
  return () => {
    dragHandle.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('resize', onWindowResize);
    dragHandle.style.cursor = '';
  };
}
