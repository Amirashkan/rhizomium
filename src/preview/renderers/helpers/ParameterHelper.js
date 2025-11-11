// src/core/preview/renderers/helpers/ParameterHelper.js
export function getEvaluatedParam(node, paramName, defaultValue) {
  // First try to get the evaluated value from uniform manager
  if (window.nodeCompiler?.uniformManager) {
    const uniformMgr = window.nodeCompiler.uniformManager;
    const key = `${node.id}.${paramName}`;
    
    // If this parameter has a dynamic uniform value, use it
    if (uniformMgr.uniformValues && uniformMgr.uniformValues.has(key)) {
      const evaluated = uniformMgr.uniformValues.get(key);

      return evaluated;
    }
  }
  
  // Fall back to static parameter value
  const rawValue = node.params?.[paramName] ?? defaultValue;
  
  // If it's a number, return it
  if (typeof rawValue === 'number') {
    return rawValue;
  }
  
  // Try to parse as number
  const parsed = parseFloat(rawValue);
  return isNaN(parsed) ? defaultValue : parsed;
}