// workers/parameter-expression-worker.js
// Web Worker for ParameterExpressionSystem - Offloads expression evaluation

import { UnifiedExpressionSystem } from '../src/utils/UnifiedExpressionSystem.js';

let expressionSystem = null;
let expressionCache = new Map();

// Initialize worker
self.onmessage = async (e) => {
  const { type, expressions, expression, context, nodeId, id } = e.data;
  
  try {
    switch (type) {
      case 'init':
        expressionSystem = new UnifiedExpressionSystem();
        self.postMessage({ type: 'ready', id });
        break;
        
      case 'evaluateBatch': {
        // Evaluate batch of expressions
        const results = await evaluateExpressionBatch(expressions);
        self.postMessage({
          type: 'result',
          id,
          result: results
        });
        break;
      }
        
      case 'evaluate': {
        // Single expression evaluation
        const result = await evaluateExpression(expression, context, nodeId);
        self.postMessage({
          type: 'result',
          id,
          result: result
        });
        break;
      }
        
      case 'heartbeat-request':
        // Respond to heartbeat immediately
        self.postMessage({
          type: 'heartbeat',
          timestamp: e.data.timestamp,
          workerTime: performance.now()
        });
        break;
        
      default:
        self.postMessage({
          type: 'error',
          id,
          error: `Unknown message type: ${type}`
        });
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      id,
      error: error.message,
      stack: error.stack
    });
  }
};

/**
 * Evaluate batch of expressions
 */
async function evaluateExpressionBatch(expressions) {
  const results = [];
  
  for (const expr of expressions) {
    try {
      const value = await evaluateExpression(
        expr.expression,
        expr.context,
        expr.nodeId
      );
      results.push({
        key: expr.key,
        value,
        error: null
      });
    } catch (error) {
      results.push({
        key: expr.key,
        value: null,
        error: error.message
      });
    }
  }
  
  return results;
}

/**
 * Evaluate a single expression
 */
async function evaluateExpression(expression, context, nodeId) {
  // Check cache
  const cacheKey = `${expression}|${nodeId}|${JSON.stringify(context)}`;
  
  // Skip caching for time-dependent expressions
  const isTimeDep = expression.includes('time') || 
                    expression.includes('audioEnvelope') ||
                    expression.includes('frame');
  
  if (!isTimeDep && expressionCache.has(cacheKey)) {
    const cached = expressionCache.get(cacheKey);
    // Check if cache is still valid (within 16ms)
    if (performance.now() - cached.timestamp < 16) {
      return cached.value;
    }
  }
  
  // Evaluate expression
  let result;
  try {
    // Remove = prefix if present
    const cleanExpression = expression.startsWith('=') ? expression.slice(1) : expression;
    result = expressionSystem.evaluateCPU(cleanExpression, context);
  } catch {
    // Fallback: try to parse as number
    const parsed = parseFloat(expression);
    result = isNaN(parsed) ? 0 : parsed;
  }
  
  // Cache result (only for non-time-dependent expressions)
  if (!isTimeDep) {
    expressionCache.set(cacheKey, {
      value: result,
      timestamp: performance.now()
    });
    
    // Limit cache size
    if (expressionCache.size > 1000) {
      // Remove oldest entries
      const entries = Array.from(expressionCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = entries.slice(0, 100);
      for (const [key] of toRemove) {
        expressionCache.delete(key);
      }
    }
  }
  
  return result;
}

// Send periodic heartbeats
setInterval(() => {
  self.postMessage({
    type: 'heartbeat',
    timestamp: performance.now(),
    workerTime: performance.now()
  });
}, 1000); // Every second

