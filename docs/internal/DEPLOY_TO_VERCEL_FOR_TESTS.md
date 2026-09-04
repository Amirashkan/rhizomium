# Deploy to Vercel for GPU Performance Tests

## Why Vercel?

✅ **HTTPS by default** (required for WebGPU)  
✅ **Proper headers configured** (Cross-Origin-Isolation)  
✅ **No Flask/Python needed**  
✅ **Easy deployment**  
✅ **Free tier available**

## Quick Deploy Steps

### Option 1: Using Vercel CLI (Recommended)

```bash
# 1. Install Vercel CLI (if not installed)
npm install -g vercel

# 2. Login to Vercel
vercel login

# 3. Deploy from project directory
vercel

# Follow prompts:
# - Set up and deploy? Yes
# - Which scope? Your account
# - Link to existing project? No
# - Project name? glsl-node-editor (or your choice)
# - Which directory? ./ (current directory)
# - Override settings? No
```

### Option 2: Using GitHub + Vercel Dashboard

1. **Push to GitHub:**
   ```bash
   git add .
   git commit -m "Prepare for Vercel deployment"
   git push
   ```

2. **Deploy on Vercel:**
   - Go to [vercel.com](https://vercel.com)
   - Click "New Project"
   - Import your GitHub repository
   - Click "Deploy"

That's it! 🎉

## After Deployment

Your site will be available at:
```
https://your-project.vercel.app
```

### Access the Editor

Go to:
```
https://your-project.vercel.app/studio
```

The `/studio` route is configured in `vercel.json` to redirect to `/editor`.

## Run GPU Tests

1. **Open the editor:**
   ```
   https://your-project.vercel.app/studio
   ```

2. **Wait for application to load** (you should see the node editor)

3. **Open browser console** (F12)

4. **Check if GPU is available:**
   ```javascript
   console.log('WebGPU:', navigator.gpu !== undefined);
   console.log('GPU Device:', window.gpuRenderer?.device);
   console.log('GPU Test:', window.gpuPerformanceTest);
   ```

5. **Run tests:**
   ```javascript
   // Wait a moment for initialization, then:
   await window.gpuPerformanceTest?.runAllTests();
   ```

## Troubleshooting

### If GPUPerformanceTest is still not found:

**Check initialization:**
```javascript
// In browser console
console.log('Device:', window.gpuRenderer?.device);
console.log('Monitor:', window.gpuPerformanceMonitor);
console.log('Profiler:', window.computeProfiler);

// If device exists but test doesn't, manually initialize:
if (window.gpuRenderer?.device && !window.gpuPerformanceTest) {
  const { GPUPerformanceTest } = await import('./src/test/GPUPerformanceTest.js');
  window.gpuPerformanceTest = new GPUPerformanceTest(window.gpuRenderer.device);
  console.log('GPU Test initialized manually');
}
```

### If WebGPU is not available:

1. **Check browser:** Use Chrome 113+ or Edge 113+
2. **Check URL:** Must be HTTPS (Vercel provides this automatically)
3. **Check headers:** Vercel config should handle this, but verify in Network tab

### If deployment fails:

1. **Check `vercel.json`** exists in project root
2. **Check for syntax errors** in config
3. **Check build logs** in Vercel dashboard
4. **Try local test:** `vercel dev` (if you have Vercel CLI)

## Benefits of Vercel Deployment

| Feature | Local HTTP Server | Vercel |
|---------|------------------|--------|
| HTTPS | ❌ No | ✅ Yes (required for WebGPU) |
| Headers | ❌ Manual setup | ✅ Auto-configured |
| Routes | ❌ Limited | ✅ Full routing support |
| Setup | ❌ Complex | ✅ Simple |
| Cost | Free | Free tier available |

## Next Steps After Deployment

1. ✅ Run GPU performance tests
2. ✅ Run performance benchmarks
3. ✅ Monitor real-time performance
4. ✅ Update `PERFORMANCE_TEST_REPORT.md` with results

---

**Ready to deploy?** Run `vercel` in your project directory!

