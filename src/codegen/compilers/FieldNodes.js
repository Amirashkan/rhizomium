export class FieldNodes {
  handles(kind) {
    return ['CircleField', 'RectField'].includes(kind);
  }
  
  compile(node, getInput) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    
    switch (node.kind) {
      case 'CircleField':
        return this.compileCircleField(node, getInput, nodeId);
      case 'RectField':
        return this.compileRectField(node, getInput, nodeId);
      default:
        return null;
    }
  }
  
getParam(node, paramName, defaultValue) {
  if (node.params && node.params.hasOwnProperty(paramName)) {
    const value = node.params[paramName];
    
    // Handle expressions starting with '='
    if (typeof value === 'string' && value.trim().startsWith('=')) {
      try {
        const expressionSystem = window.expressionSystem;
        if (expressionSystem) {
          const result = expressionSystem.evaluateExpression(value, {}, node);
          if (result !== null && result !== undefined && typeof result === 'number' && isFinite(result)) {
            return result;
          }
        }
      } catch (error) {
        console.warn(`Expression evaluation failed for ${paramName}:`, error);
      }
      
      // Fallback: try to parse as number
      const numericValue = parseFloat(value.substring(1));
      return isNaN(numericValue) ? defaultValue : numericValue;
    }
    
    if (typeof value === 'number' && isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? defaultValue : parsed;
    }
  }
  return defaultValue;
}

// And update your compile methods to ensure numbers:
compileRectField(node, getInput, nodeId) {
  const uv = getInput(0, "vec2", "in.uv");
  const width = Number(this.getParam(node, 'width', 0.5)).toFixed(6);
  const height = Number(this.getParam(node, 'height', 0.3)).toFixed(6);
  const centerX = Number(this.getParam(node, 'centerX', 0.5)).toFixed(6);
  const centerY = Number(this.getParam(node, 'centerY', 0.5)).toFixed(6);
  const epsilon = Number(this.getParam(node, 'epsilon', 0.02)).toFixed(6);
  
  const line = `let node_${nodeId} = rectField(${uv}, vec2<f32>(${centerX}, ${centerY}), vec2<f32>(${width}, ${height}), max(${epsilon}, 0.0001));`;
  
  return { line, outputType: "f32" };
}
  
  compileCircleField(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const radius = this.getParam(node, 'radius', 0.25).toFixed(6);
    const epsilon = this.getParam(node, 'epsilon', 0.02).toFixed(6);
    const centerX = this.getParam(node, 'centerX', 0.5).toFixed(6);
    const centerY = this.getParam(node, 'centerY', 0.5).toFixed(6);
    
    const line = `let node_${nodeId} = 1.0 - smoothstep(${radius} - max(${epsilon}, 0.0001), ${radius} + max(${epsilon}, 0.0001), distance(${uv}, vec2<f32>(${centerX}, ${centerY})));`;
    
    return { line, outputType: "f32" };
  }
  
  compileRectField(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const width = this.getParam(node, 'width', 0.5).toFixed(6);
    const height = this.getParam(node, 'height', 0.3).toFixed(6);
    const centerX = this.getParam(node, 'centerX', 0.5).toFixed(6);
    const centerY = this.getParam(node, 'centerY', 0.5).toFixed(6);
    const epsilon = this.getParam(node, 'epsilon', 0.02).toFixed(6);
    
    const line = `let node_${nodeId} = rectField(${uv}, vec2<f32>(${centerX}, ${centerY}), vec2<f32>(${width}, ${height}), max(${epsilon}, 0.0001));`;
    
    return { line, outputType: "f32" };
  }
}