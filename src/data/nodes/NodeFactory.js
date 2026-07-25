// src/data/nodes/NodeFactory.js

import { NodeDefs, makeNode, validateNodeDef } from '../NodeDefs.js';

/**
 * Factory class for creating and managing nodes
 */

export class NodeFactory {
  /**
   * Create a new node instance
   */
  static createNode(kind, x = 0, y = 0) {
    try {
      if (!this.hasNodeType(kind)) {
        throw new Error(`Unknown node type: ${kind}`);
      }
      return makeNode(kind, x, y);
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'node-creation',
        nodeType: kind,
        position: { x, y }
      });
      throw error;
    }
  }

  /**
   * Get nodes by category
   */
  static getNodesByCategory(category) {
    try {
      return Object.entries(NodeDefs)
        .filter(([_, def]) => def.cat === category)
        .reduce((acc, [key, def]) => ({ ...acc, [key]: def }), {});
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'node-filtering',
        category 
      });
      return {};
    }
  }

  /**
   * Validate all node definitions
   */
  static validateAllNodeDefs() {
    try {
      const errors = [];
      
      for (const [kind, def] of Object.entries(NodeDefs)) {
        try {
          validateNodeDef(def);
        } catch (error) {
          errors.push({ kind, error: error.message });
        }
      }
      
      return errors;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'node-validation' 
      });
      return [];
    }
  }

  /**
   * Clone a node with new position
   */
  static cloneNode(node, offsetX = 50, offsetY = 50) {
    try {
      if (!node || !node.kind) {
        throw new Error('Invalid node to clone');
      }
      
      const newNode = this.createNode(node.kind, node.x + offsetX, node.y + offsetY);
      
      // Copy parameter values safely
      if (node.value !== undefined) newNode.value = node.value;
      if (node.expr !== undefined) newNode.expr = node.expr;
      if (node.props) newNode.props = { ...node.props };
      
      return newNode;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'node-cloning',
        sourceNodeType: node?.kind
      });
      throw error;
    }
  }
}