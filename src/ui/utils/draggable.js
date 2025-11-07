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
  let originalTransition = '';
  let originalTransform = '';

  const onMouseDown = (e) => {
    // Only drag on left click, and not on buttons or inputs
    if (e.button !== 0) return;
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
      return;
    }

    // Prevent default to avoid text selection
    e.preventDefault();
    e.stopPropagation();

    // Get current position
    const rect = panel.getBoundingClientRect();
    currentX = rect.left;
    currentY = rect.top;

    // Store initial mouse position relative to panel
    initialX = e.clientX - currentX;
    initialY = e.clientY - currentY;

    // Set dragging state immediately
    isDragging = true;

    // Store and disable transitions for instant response
    originalTransition = panel.style.transition;
    originalTransform = panel.style.transform;
    panel.style.transition = 'none';

    // Change cursor immediately for instant feedback
    dragHandle.style.cursor = 'grabbing';
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    // Ensure panel has absolute positioning with current position
    if (panel.style.position !== 'fixed' && panel.style.position !== 'absolute') {
      panel.style.position = 'fixed';
    }
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

    // Keep panel within viewport bounds
    const panelRect = panel.getBoundingClientRect();
    const maxX = window.innerWidth - panelRect.width;
    const maxY = window.innerHeight - panelRect.height;

    currentX = Math.max(0, Math.min(newX, maxX));
    currentY = Math.max(0, Math.min(newY, maxY));

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
