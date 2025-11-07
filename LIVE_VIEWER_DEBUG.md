# Live Viewer Debugging Guide

## If you see a black screen:

### Step 1: Check Browser Console

Open **both** the editor tab and viewer tab, and check the console in each:

#### In the Editor Tab Console:
Look for these messages:
```
[main.js] Cloud deployment detected, using LiveShaderStream
[main.js] LiveShaderStream initialized
[LiveShaderStream] 📤 Sending shader update: ...
[LiveShaderStream] ✅ Sent shader update #1
```

If you see `⚠️ No shader available yet`, make a small change in the graph to trigger a rebuild.

#### In the Viewer Tab Console:
Look for these messages:
```
[LiveViewer] Initialized and ready
[LiveViewer] Received shader update: ...
[LiveViewer] Compiling shader...
[LiveViewer] ✅ Shader compiled successfully
[LiveViewer] Rendering at 60 FPS
```

### Step 2: Common Issues

**Issue: "No shader available yet"**
- Solution: Make a change in the node graph (move a slider, connect a node)
- This will trigger a shader rebuild and send it to the viewer

**Issue: Viewer shows "Waiting for shader..." forever**
- Check both tabs are from the same origin (same domain/port)
- BroadcastChannel only works within same origin
- Try refreshing the viewer tab

**Issue: "BroadcastChannel not supported"**
- Update your browser to the latest version
- Use Chrome 113+, Edge 113+, Firefox, or Safari

**Issue: Shader compilation error in viewer**
- Check the viewer console for the specific error
- The shader might be using features not available in the viewer
- Try a simpler shader first (just a color node connected to output)

### Step 3: Test with Simple Shader

1. In the editor, delete all nodes
2. Add just these nodes:
   - Color node (set to red)
   - Output node
   - Connect Color → Output
3. Click "Open External Viewer"
4. You should see red in the viewer

### Step 4: Check Environment Detection

Open the editor console and run:
```javascript
console.log('Hostname:', window.location.hostname);
console.log('Is cloud hosted:',
  window.location.hostname.includes('vercel.app') ||
  window.location.hostname.includes('netlify.app') ||
  window.location.hostname.includes('github.io') ||
  (!window.location.hostname.includes('localhost') &&
   !window.location.hostname.includes('127.0.0.1') &&
   !window.location.hostname.match(/^192\.168\./))
);
```

If "Is cloud hosted" is `false` but you're on Vercel/cloud, that's the problem.

### Step 5: Manual Test

In the **Editor tab** console:
```javascript
// Test sending a simple shader
if (window.liveShaderStream) {
  const testShader = `
struct U { aspect: f32 };
@group(0) @binding(0) var<uniform> u: U;
struct G { resolution: vec2<f32>, time: f32, audioEnvelope: f32, audioEnvelopeBass: f32, audioEnvelopeMids: f32, audioEnvelopeHighs: f32, audioEnvelopeFull: f32 };
@group(0) @binding(1) var<uniform> g: G;
struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  var p = array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
  var out: VSOut; out.pos = vec4<f32>(p[vid], 0.0, 1.0); out.uv = 0.5 * (p[vid] + vec2<f32>(1.0, 1.0)); return out;
}
@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 0.0, 0.0, 1.0); // RED
}`;

  window.liveShaderStream.sendShaderUpdate(testShader, {}, {width: 1920, height: 1080});
  console.log('Sent test shader - viewer should turn RED');
}
```

If the viewer turns red, the system is working! The issue is with your shader.

### Step 6: Check Shader Code

In the **Editor tab** console:
```javascript
console.log('Current shader length:', window.latestGeneratedWGSL?.length);
console.log('Shader preview:', window.latestGeneratedWGSL?.substring(0, 500));
```

Make sure a shader exists and looks valid.

## Still Black?

Report the issue with:
1. Screenshot of editor console
2. Screenshot of viewer console
3. Your browser and version
4. Whether you're on localhost or deployed
