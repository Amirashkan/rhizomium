// src/core/autoConnect.js
//
// Which pin a wire lands on when a node is created by the "drag + Tab" gesture: drag a wire out of
// a pin into empty space, press Tab, pick a node from the radial menu (RadialMenu._createNode).
//
// Pin 0 is the right landing spot for nearly every node and stays the default. The exception is the
// Transform category, whose nodes take two inputs:
//
//   pin 0  "UV (opt.)"  the vec2 coordinate to transform
//   pin 1  "Texture"    the image the transformed UV samples
//
// Dragging out of a Texture 2D or a Compute node and Tab-creating a Rotate 2D means "rotate this
// image", but pin 0 reads its source as a coordinate: the transform never sees a texture (see
// TransformNodes.getTextureBinding), so it stays in UV mode and passes downstream a "UV" that is
// really whatever colour the image sampled to. Routing texture sources to the Texture pin makes the
// gesture build the graph the user drew.

import { NodeDefs } from '../data/NodeDefs.js';

/**
 * Kinds whose output the fragment shader can bind and sample as a 2D texture.
 *
 * This is exactly the set TransformNodes.getTextureBinding() accepts on the Texture pin. TextureCube
 * is deliberately absent: it binds as a texture_cube and is sampled with a direction vector rather
 * than a 2D UV, so a transform cannot read it and pin 0 remains its best landing spot.
 *
 * @param {string} kind
 * @returns {boolean}
 */
export function isTextureSourceKind(kind) {
  return kind === 'Texture2D' || (typeof kind === 'string' && kind.startsWith('Compute'));
}

/** An input pin's label. pinsIn entries are usually plain strings, a few are `{ label, type }`. */
function inputPinLabel(def, index) {
  const entry = def?.pinsIn?.[index];
  if (!entry) return '';
  return typeof entry === 'string' ? entry : entry.label || '';
}

/**
 * The input pin of a freshly created node that a wire dragged from `sourceKind`'s output should
 * land on.
 *
 * @param {string} sourceKind - kind of the node the wire was dragged from
 * @param {string} targetKind - kind of the node just created
 * @returns {number} pin index, or -1 when the target has no inputs to connect to
 */
export function pickAutoConnectInputPin(sourceKind, targetKind) {
  const def = NodeDefs[targetKind];
  const inputCount = def?.inputs || 0;
  if (inputCount <= 0) return -1;

  if (isTextureSourceKind(sourceKind)) {
    for (let i = 0; i < inputCount; i++) {
      if (inputPinLabel(def, i).trim().toLowerCase() === 'texture') return i;
    }
  }

  return 0;
}
