# ✅ Final GPU Test Instructions

## The App is at `/studio` - Here's How to Access It

### On Vercel (Deployed):

**Access the studio:**
```
https://your-project.vercel.app/studio
```

The `/studio` route works perfectly on Vercel because routing is configured in `vercel.json`.

### With Local HTTP Server:

**Direct access:**
```
http://localhost:8000/editor/index.html
```

The `/studio` route is a **Flask route** that doesn't work with Python's simple HTTP server. The actual application is at `editor/index.html`.

## Solution: Use the Redirect

I've created `studio.html` that redirects to the editor. Access it at:
```
http://localhost:8000/studio.html
```

## After Loading the App:

1. **Wait for the application to fully load** (you should see the node editor interface)

2. **Open browser console** (F12)

3. **Check if GPU is initialized:**
   ```javascript
   console.log('Device:', window.gpuRenderer?.device);
   console.log('GPU Test:', window.gpuPerformanceTest);
   ```

4. **If GPUPerformanceTest is not found, initialize it manually:**
   ```javascript
   // Wait a moment for app to initialize, then:
   if (window.gpuRenderer?.device && !window.gpuPerformanceTest) {
     const { GPUPerformanceTest } = await import('./src/test/GPUPerformanceTest.js');
     window.gpuPerformanceTest = new GPUPerformanceTest(window.gpuRenderer.device);
     console.log('✅ GPU Test initialized!');
   }
   ```

5. **Run the tests:**
   ```javascript
   await window.gpuPerformanceTest?.runAllTests();
   ```

## Better Solution: Deploy to Vercel

On Vercel, `/studio` works correctly because of the routing configuration in `vercel.json`.

**Deploy to Vercel:**
```bash
npm install -g vercel
vercel
```

Then access: `https://your-project.vercel.app/studio`

This will work perfectly because:
- ✅ HTTPS (required for WebGPU)
- ✅ Proper routing configured
- ✅ Headers set correctly
- ✅ No Flask needed

---

**Quick Test URL:** `http://localhost:8000/studio.html` (redirects to editor)

**Direct URL:** `http://localhost:8000/editor/index.html`

