/**
 * draggable.js - Utility for making panels draggable
 *
 * Usage:
 *   makeDraggable(panel, dragHandle);
 *
 * @param {HTMLElement} panel - The element to make draggable
 * @param {HTMLElement} dragHandle - The element that triggers dragging (e.g., header)
 * @returns {Function} cleanup function to remove event listeners
 */
export function makeDraggable(panel, dragHandle) {
  if (!panel || !dragHandle) {
    console.warn('[makeDraggable] Invalid panel or dragHandle');
    return () => {};
  }

  let isDragging = false;
  let currentX = 0;
  let currentY = 0;
  let initialX = 0;
  let initialY = 0;

  const onMouseDown = (e) => {
    // Only drag on left click, and not on buttons or inputs
    if (e.button !== 0) return;
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
      return;
    }

    isDragging = true;

    // Get current position
    const rect = panel.getBoundingClientRect();
    currentX = rect.left;
    currentY = rect.top;

    // Store initial mouse position
    initialX = e.clientX - currentX;
    initialY = e.clientY - currentY;

    // Change cursor
    dragHandle.style.cursor = 'grabbing';
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    e.preventDefault();
  };

  const onMouseMove = (e) => {
    if (!isDragging) return;

    e.preventDefault();

    // Calculate new position
    currentX = e.clientX - initialX;
    currentY = e.clientY - initialY;

    // Keep panel within viewport bounds
    const panelRect = panel.getBoundingClientRect();
    const maxX = window.innerWidth - panelRect.width;
    const maxY = window.innerHeight - panelRect.height;

    currentX = Math.max(0, Math.min(currentX, maxX));
    currentY = Math.max(0, Math.min(currentY, maxY));

    // Update position
    panel.style.left = currentX + 'px';
    panel.style.top = currentY + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  };

  const onMouseUp = () => {
    if (!isDragging) return;

    isDragging = false;
    dragHandle.style.cursor = 'grab';
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  // Set initial cursor style
  dragHandle.style.cursor = 'grab';

  // Add event listeners
  dragHandle.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // Return cleanup function
  return () => {
    dragHandle.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    dragHandle.style.cursor = '';
  };
}
