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

    return () => {};
  }

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

    // Allow dragging anywhere on screen - keep the entire window within viewport
    // This allows dragging to bottom half of screen
    const maxX = window.innerWidth - panelWidth;
    const maxY = window.innerHeight - panelHeight;

    // Clamp to viewport bounds - this allows dragging to bottom of screen
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
