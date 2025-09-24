import { Node } from "./Node.js";

export class ExpressionNode extends Node {
  constructor(x, y, expression = "a + b") {
    super(x, y);
    this.label = "Expr";
    this.inputPins = [null, null];
    this.outputPins = [null];
    this.expression = expression;
  }

  getGLSL(id) {
    try {
      // Validate expression
      if (!this.expression || typeof this.expression !== 'string') {
        throw new Error('Invalid expression');
      }

      const a = `node${this.inputs?.[0] ?? 0}`;
      const b = `node${this.inputs?.[1] ?? 1}`;
      
      // Basic validation - check for dangerous patterns
      if (this.expression.includes('import') || 
          this.expression.includes('require') ||
          this.expression.includes('eval')) {
        throw new Error('Expression contains forbidden keywords');
      }

      const expr = this.expression.replace(/a/g, a).replace(/b/g, b);
      return `let node${id} = ${expr};`;
      
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'node-processing',
        nodeType: 'ExpressionNode',
        nodeId: id,
        expression: this.expression
      });
      
      // Return safe fallback
      return `let node${id} = 0.0;`;
    }
  }
}