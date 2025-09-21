// src/data/nodes/NodeFactory.js

import { NodeDefs, makeNode, validateNodeDef } from '../NodeDefs.js';
import { NodeCategories } from './NodeTypes.js';

/**
 * Factory class for creating and managing nodes
 */
export class NodeFactory {
  /**
   * Create a new node instance
   */
  static createNode(kind, x = 0, y = 0) {
    return makeNode(kind, x, y);
  }

  /**
   * Get all available node types
   */
  static getAvailableNodeTypes() {
    return Object.keys(NodeDefs);
  }

  /**
   * Get nodes by category
   */
  static getNodesByCategory(category) {
    return Object.entries(NodeDefs)
      .filter(([_, def]) => def.cat === category)
      .reduce((acc, [key, def]) => ({ ...acc, [key]: def }), {});
  }

  /**
   * Get all categories
   */
  static getCategories() {
    return Object.values(NodeCategories);
  }

  /**
   * Check if a node type exists
   */
  static hasNodeType(kind) {
    return kind in NodeDefs;
  }

  /**
   * Get node definition
   */
  static getNodeDefinition(kind) {
    return NodeDefs[kind] || null;
  }

  /**
   * Validate all node definitions
   */
  static validateAllNodeDefs() {
    const errors = [];
    
    for (const [kind, def] of Object.entries(NodeDefs)) {
      try {
        validateNodeDef(def);
      } catch (error) {
        errors.push({ kind, error: error.message });
      }
    }
    
    return errors;
  }

  /**
   * Get nodes that can connect to a specific output type
   */
  static getCompatibleNodes(outputType) {
    return Object.entries(NodeDefs)
      .filter(([_, def]) => {
        return def.pinsIn.some(pin => {
          // Simple type compatibility check - you might want to expand this
          return pin === outputType || 
                 (outputType === 'vec3' && ['vec2', 'f32'].includes(pin)) ||
                 (outputType === 'vec2' && pin === 'f32');
        });
      })
      .map(([kind, _]) => kind);
  }

  /**
   * Create a default graph with basic nodes
   */
  static createDefaultGraph() {
    const nodes = [];
    
    // Create UV input
    const uvNode = this.createNode('UV', 100, 100);
    nodes.push(uvNode);
    
    // Create output node
    const outputNode = this.createNode('OutputFinal', 400, 100);
    nodes.push(outputNode);
    
    return { nodes, connections: [] };
  }

  /**
   * Clone a node with new position
   */
  static cloneNode(node, offsetX = 50, offsetY = 50) {
    const newNode = this.createNode(node.kind, node.x + offsetX, node.y + offsetY);
    
    // Copy parameter values
    if (node.value !== undefined) newNode.value = node.value;
    if (node.expr !== undefined) newNode.expr = node.expr;
    if (node.props) newNode.props = { ...node.props };
    
    return newNode;
  }
}