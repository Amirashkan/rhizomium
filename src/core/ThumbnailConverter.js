// src/core/ThumbnailConverter.js
// Helper utility to convert ImageData to Canvas elements
// This ensures thumbnails are always Canvas elements, eliminating blocking putImageData calls during rendering

/**
 * Convert ImageData to HTMLCanvasElement
 * @param {ImageData} imageData - The ImageData to convert
 * @returns {HTMLCanvasElement} Canvas element containing the image data
 */
export function imageDataToCanvas(imageData) {
  if (!imageData || !(imageData instanceof ImageData)) {
    throw new Error('imageDataToCanvas: Expected ImageData instance');
  }
  
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    throw new Error('imageDataToCanvas: Failed to get 2D context');
  }
  
  // Convert ImageData to Canvas - this is a blocking operation, but it's done
  // when thumbnails are created, not during rendering
  ctx.putImageData(imageData, 0, 0);
  
  return canvas;
}

/**
 * Ensure a thumbnail is always a Canvas element
 * If it's already a Canvas, returns it unchanged
 * If it's ImageData, converts it to Canvas
 * @param {ImageData|HTMLCanvasElement} thumbnail - The thumbnail to normalize
 * @returns {HTMLCanvasElement} Canvas element
 */
export function ensureCanvasThumbnail(thumbnail) {
  if (!thumbnail) {
    return null;
  }
  
  if (thumbnail instanceof HTMLCanvasElement) {
    return thumbnail; // Already a canvas, return as-is
  }
  
  if (thumbnail instanceof ImageData) {
    return imageDataToCanvas(thumbnail); // Convert ImageData to Canvas
  }
  
  // Unknown type, try to convert
  console.warn('ensureCanvasThumbnail: Unknown thumbnail type, attempting conversion');
  return imageDataToCanvas(thumbnail);
}

