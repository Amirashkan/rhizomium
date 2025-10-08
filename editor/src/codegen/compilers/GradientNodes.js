// src/codegen/compilers/GradientNodes.js
export class GradientNodes {
  handles(kind) {
    return ['LinearGradient', 'RadialGradient', 'AngularGradient', 'ConicGradient'].includes(kind);
  }
  
  compile(node, getInput) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    
    switch (node.kind) {
      case 'LinearGradient':
        return this.compileLinearGradient(node, getInput, nodeId);
      case 'RadialGradient':
        return this.compileRadialGradient(node, getInput, nodeId);
      case 'AngularGradient':
        return this.compileAngularGradient(node, getInput, nodeId);
      case 'ConicGradient':
        return this.compileConicGradient(node, getInput, nodeId);
      default:
        return null;
    }
  }
  
  compileLinearGradient(node, getInput, nodeId) {
    const angle = node.params?.angle ?? 0.0;
    const offset = node.params?.offset ?? 0.0;
    const scale = node.params?.scale ?? 1.0;
    
    return {
      line: `
  let dir_${nodeId} = vec2<f32>(cos(${angle}), sin(${angle}));
  let proj_${nodeId} = dot(in.uv - vec2<f32>(0.5), dir_${nodeId}) * ${scale} + ${offset};
  let node_${nodeId} = proj_${nodeId};`,
      outputType: "f32"
    };
  }
  
  compileRadialGradient(node, getInput, nodeId) {
    const centerX = node.params?.centerX ?? 0.5;
    const centerY = node.params?.centerY ?? 0.5;
    const radius = node.params?.radius ?? 0.5;
    const falloff = node.params?.falloff ?? 1.0;
    
    return {
      line: `
  let center_${nodeId} = vec2<f32>(${centerX}, ${centerY});
  let dist_${nodeId} = length(in.uv - center_${nodeId}) / ${radius};
  let node_${nodeId} = pow(clamp(dist_${nodeId}, 0.0, 1.0), ${falloff});`,
      outputType: "f32"
    };
  }
  
  compileAngularGradient(node, getInput, nodeId) {
    const centerX = node.params?.centerX ?? 0.5;
    const centerY = node.params?.centerY ?? 0.5;
    const rotation = node.params?.rotation ?? 0.0;
    const repeat = node.params?.repeat ?? 1.0;
    
    return {
      line: `
  let center_${nodeId} = vec2<f32>(${centerX}, ${centerY});
  let angle_${nodeId} = atan2(in.uv.y - center_${nodeId}.y, in.uv.x - center_${nodeId}.x) + ${rotation};
  let node_${nodeId} = fract((angle_${nodeId} / (3.14159265359 * 2.0) + 0.5) * ${repeat});`,
      outputType: "f32"
    };
  }
  
  compileConicGradient(node, getInput, nodeId) {
    const centerX = node.params?.centerX ?? 0.5;
    const centerY = node.params?.centerY ?? 0.5;
    const startAngle = node.params?.startAngle ?? 0.0;
    const endAngle = node.params?.endAngle ?? 6.28318530718; // 2*PI
    
    return {
      line: `
  let center_${nodeId} = vec2<f32>(${centerX}, ${centerY});
  let angle_${nodeId} = atan2(in.uv.y - center_${nodeId}.y, in.uv.x - center_${nodeId}.x);
  let t_${nodeId} = clamp((angle_${nodeId} - ${startAngle}) / (${endAngle} - ${startAngle}), 0.0, 1.0);
  let node_${nodeId} = t_${nodeId};`,
      outputType: "f32"
    };
  }
}