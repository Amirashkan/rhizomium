// src/codegen/compilers/UtilityNodes.js
export class UtilityNodes {
  /**
   * Check if this compiler handles the given node kind
   * @param {string} kind 
   * @returns {boolean}
   */
  handles(kind) {
    return [
      'OutputFinal', 'Expr', 'Remap', 'Posterize',
      'ColorToGrayscale', 'ColorInvert', 'ColorSaturate', 
      'ColorContrast', 'ColorBrightness',
      'HSVToRGB', 'RGBToHSV', 'Select', 'Compare'
    ].includes(kind);
  }
  
  /**
   * Compile utility nodes
   * @param {Object} node 
   * @param {Function} getInput 
   * @returns {Object} { line, outputType }
   */
  compile(node, getInput) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    
    switch (node.kind) {
      case 'OutputFinal':
        return this.compileOutputFinal(node, getInput, nodeId);
      case 'Expr':
        return this.compileExpression(node, getInput, nodeId);
      case 'Remap':
        return this.compileRemap(node, getInput, nodeId);
      case 'Posterize':
        return this.compilePosterize(node, getInput, nodeId);
      case 'ColorToGrayscale':
        return this.compileColorToGrayscale(node, getInput, nodeId);
      case 'ColorInvert':
        return this.compileColorInvert(nodeId, getInput);
      case 'ColorSaturate':
        return this.compileColorSaturate(node, getInput, nodeId);
      case 'ColorContrast':
        return this.compileColorContrast(node, getInput, nodeId);
      case 'ColorBrightness':
        return this.compileColorBrightness(node, getInput, nodeId);
      case 'HSVToRGB':
        return this.compileHSVToRGB(nodeId, getInput);
      case 'RGBToHSV':
        return this.compileRGBToHSV(nodeId, getInput);
      case 'Select':
        return this.compileSelect(node, getInput, nodeId);
      case 'Compare':
        return this.compileCompare(node, getInput, nodeId);
      default:
        return null;
    }
  }
  
  compileOutputFinal(node, getInput, nodeId) {
    const color = getInput(0, "vec3", "vec3<f32>(0.0)");
    return {
      line: `finalColor = ${color};`,
      outputType: "vec3"
    };
  }
  
  compileExpression(node, getInput, nodeId) {
    const a = getInput(0, "f32", "0.0");
    const b = getInput(1, "f32", "0.0");
    let expr = (node.expr || "a").toString();
    
    expr = expr.replace(/\ba\b/g, `(${a})`);
    expr = expr.replace(/\bb\b/g, `(${b})`);
    expr = expr.replace(/\bu_time\b/g, "g.time");
    expr = expr.replace(/\buv\b/g, "in.uv");
    expr = expr.replace(/\bpi\b/g, "3.14159265359");
    expr = expr.replace(/\bPI\b/g, "3.14159265359");
    
    return {
      line: `let node_${nodeId} = ${expr};`,
      outputType: "f32"
    };
  }
  
  compileRemap(node, getInput, nodeId) {
    const value = getInput(0, "f32", "0.0");
    const inMin = node.params?.inMin ?? 0.0;
    const inMax = node.params?.inMax ?? 1.0;
    const outMin = node.params?.outMin ?? 0.0;
    const outMax = node.params?.outMax ?? 1.0;
    const doClamp = node.params?.clamp ?? false;
    
    const remapped = `(((${value}) - ${inMin}) / max(${inMax} - ${inMin}, 0.0001)) * (${outMax} - ${outMin}) + ${outMin}`;
    const final = doClamp ? `clamp(${remapped}, min(${outMin}, ${outMax}), max(${outMin}, ${outMax}))` : remapped;
    
    return {
      line: `let node_${nodeId} = ${final};`,
      outputType: "f32"
    };
  }
  
  compilePosterize(node, getInput, nodeId) {
    const value = getInput(0, "f32", "0.0");
    const steps = node.params?.steps ?? 8.0;
    
    return {
      line: `let node_${nodeId} = floor(${value} * ${steps}) / ${steps};`,
      outputType: "f32"
    };
  }
  
  compileColorToGrayscale(node, getInput, nodeId) {
    const color = getInput(0, "vec3", "vec3<f32>(0.0)");
    const method = node.params?.method || "luminance";
    
    let formula;
    switch (method) {
      case "luminance":
        formula = `dot(${color}, vec3<f32>(0.299, 0.587, 0.114))`;
        break;
      case "average":
        formula = `(${color}.x + ${color}.y + ${color}.z) / 3.0`;
        break;
      case "lightness":
        formula = `(max(max(${color}.x, ${color}.y), ${color}.z) + min(min(${color}.x, ${color}.y), ${color}.z)) / 2.0`;
        break;
      default:
        formula = `dot(${color}, vec3<f32>(0.299, 0.587, 0.114))`;
    }
    
    return {
      line: `let node_${nodeId} = ${formula};`,
      outputType: "f32"
    };
  }
  
  compileColorInvert(nodeId, getInput) {
    const color = getInput(0, "vec3", "vec3<f32>(0.0)");
    return {
      line: `let node_${nodeId} = vec3<f32>(1.0) - (${color});`,
      outputType: "vec3"
    };
  }
  
  compileColorSaturate(node, getInput, nodeId) {
    const color = getInput(0, "vec3", "vec3<f32>(0.0)");
    const saturation = node.params?.saturation ?? 1.0;
    
    return {
      line: `
  let gray_${nodeId} = dot(${color}, vec3<f32>(0.299, 0.587, 0.114));
  let node_${nodeId} = mix(vec3<f32>(gray_${nodeId}), ${color}, ${saturation});`,
      outputType: "vec3"
    };
  }
  
  compileColorContrast(node, getInput, nodeId) {
    const color = getInput(0, "vec3", "vec3<f32>(0.5)");
    const contrast = node.params?.contrast ?? 1.0;
    const pivot = node.params?.pivot ?? 0.5;
    
    return {
      line: `let node_${nodeId} = ((${color}) - ${pivot}) * ${contrast} + ${pivot};`,
      outputType: "vec3"
    };
  }
  
  compileColorBrightness(node, getInput, nodeId) {
    const color = getInput(0, "vec3", "vec3<f32>(0.0)");
    const brightness = node.params?.brightness ?? 0.0;
    
    return {
      line: `let node_${nodeId} = (${color}) + vec3<f32>(${brightness});`,
      outputType: "vec3"
    };
  }
  
  compileHSVToRGB(nodeId, getInput) {
    const hsv = getInput(0, "vec3", "vec3<f32>(0.0, 0.0, 1.0)");
    return {
      line: `let node_${nodeId} = hsvToRgb(${hsv});`,
      outputType: "vec3"
    };
  }
  
  compileRGBToHSV(nodeId, getInput) {
    const rgb = getInput(0, "vec3", "vec3<f32>(1.0)");
    return {
      line: `let node_${nodeId} = rgbToHsv(${rgb});`,
      outputType: "vec3"
    };
  }
  
  compileSelect(node, getInput, nodeId) {
    const a = getInput(0, "vec3", "vec3<f32>(0.0)");
    const b = getInput(1, "vec3", "vec3<f32>(1.0)");
    const condition = getInput(2, "f32", "0.5");
    const threshold = node.params?.threshold ?? 0.5;
    
    return {
      line: `let node_${nodeId} = select(${a}, ${b}, ${condition} > ${threshold});`,
      outputType: "vec3"
    };
  }
  
  compileCompare(node, getInput, nodeId) {
    const a = getInput(0, "f32", "0.0");
    const b = getInput(1, "f32", "0.0");
    const operator = node.params?.operator || "greater";
    const epsilon = node.params?.epsilon ?? 0.001;
    
    let comparison;
    switch (operator) {
      case "equal":
        comparison = `abs(${a} - ${b}) < ${epsilon}`;
        break;
      case "notEqual":
        comparison = `abs(${a} - ${b}) >= ${epsilon}`;
        break;
      case "greater":
        comparison = `${a} > ${b}`;
        break;
      case "greaterEqual":
        comparison = `${a} >= ${b}`;
        break;
      case "less":
        comparison = `${a} < ${b}`;
        break;
      case "lessEqual":
        comparison = `${a} <= ${b}`;
        break;
      default:
        comparison = `${a} > ${b}`;
    }
    
    return {
      line: `let node_${nodeId} = select(0.0, 1.0, ${comparison});`,
      outputType: "f32"
    };
  }
}
