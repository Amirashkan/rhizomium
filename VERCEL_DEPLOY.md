# Deploying to Vercel

Complete guide for deploying the GLSL Node Editor with Dual-Screen support to Vercel.

---

## Quick Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Amirashkan/glsl-node-editor)

Click the button above to deploy instantly to Vercel!

---

## Manual Deployment

### Prerequisites

- Git installed
- Vercel account (free tier works!)
- GitHub account (optional, but recommended)

### Step 1: Prepare Your Repository

```bash
# Clone the repository
git clone https://github.com/Amirashkan/glsl-node-editor.git
cd glsl-node-editor

# Make sure all files are committed
git add .
git commit -m "Prepare for Vercel deployment"
git push
```

### Step 2: Install Vercel CLI (Optional)

```bash
npm install -g vercel
```

### Step 3: Deploy

**Option A: Using Vercel CLI**

```bash
# From project directory
vercel

# Follow the prompts:
# - Set up and deploy? Yes
# - Which scope? Your account
# - Link to existing project? No
# - Project name? glsl-node-editor (or your choice)
# - Which directory? ./ (current directory)
# - Override settings? No
```

**Option B: Using Vercel Dashboard**

1. Go to [vercel.com](https://vercel.com)
2. Click "New Project"
3. Import your Git repository
4. Click "Deploy"

That's it! 🎉

---

## How It Works on Vercel

### Architecture

The dual-screen system adapts based on deployment environment:

```
┌─────────────────────────────────────────┐
│        Vercel Deployment                │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │  Editor Tab                         │ │
│  │  - WebGPU Rendering                 │ │
│  │  - BroadcastChannel API             │ │
│  │  - Sends frames via browser API     │ │
│  └────────────────────────────────────┘ │
│             ↓ BroadcastChannel          │
│  ┌────────────────────────────────────┐ │
│  │  Viewer Tab                         │ │
│  │  - HTML5 Canvas                     │ │
│  │  - Receives frames via browser      │ │
│  │  - Zero latency (local comm)        │ │
│  └────────────────────────────────────┘ │
│                                          │
│  All in browser - No backend needed!    │
└─────────────────────────────────────────┘
```

### Key Differences from Local Deployment

| Feature | Local (Python) | Vercel (Serverless) |
|---------|---------------|---------------------|
| Backend | Flask + WebSocket | None (static only) |
| Streaming | HTTP/WebSocket | BroadcastChannel |
| Viewer | Python OpenGL | Browser tab |
| Network | LAN/Internet | Same computer only |
| Setup | Requires Python | Deploy and done |

---

## Using the Dual-Screen Feature on Vercel

### Step 1: Open Your Deployed Site

Your site will be available at: `https://your-project.vercel.app`

### Step 2: Navigate to the Editor

Go to: `https://your-project.vercel.app/studio`

### Step 3: Open External Viewer

Click the **"Open External Viewer"** button in the editor.

A new tab will open showing the viewer.

### Step 4: Arrange Windows

- Drag the viewer tab to a separate window
- Move it to your second monitor (if available)
- Press F11 for fullscreen
- Continue editing in the original tab

Frames stream automatically between tabs!

---

## Limitations on Vercel

### BroadcastChannel Limitations

✅ **Works:**
- Multiple tabs/windows on same computer
- Same browser instance
- Zero latency
- No backend required
- Perfect for live editing

❌ **Doesn't Work:**
- Different computers/devices
- Remote viewing over network
- Different browsers
- Incognito/private tabs

### For Remote Viewing

If you need to stream to different devices over network:

**Option 1: Use Partykit** (Recommended)
1. Create a [Partykit](https://partykit.io) account
2. Deploy a Partykit server
3. Update `VercelFrameStream.js` with your Partykit URL
4. Redeploy to Vercel

**Option 2: Use Pusher Channels**
1. Create a [Pusher](https://pusher.com) account
2. Get your API keys
3. Update configuration in `VercelFrameStream.js`
4. Redeploy

**Option 3: Run Locally**
For full network support, run the Python version locally:
```bash
python rhizo_server.py
```

See `DUAL_SCREEN_GUIDE.md` for local setup.

---

## Vercel Configuration

The project includes `vercel.json` with optimal settings:

```json
{
  "version": 2,
  "rewrites": [
    {
      "source": "/studio",
      "destination": "/editor"
    },
    {
      "source": "/api/ws",
      "destination": "/api/websocket"
    }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Cross-Origin-Opener-Policy",
          "value": "same-origin"
        },
        {
          "key": "Cross-Origin-Embedder-Policy",
          "value": "require-corp"
        }
      ]
    }
  ]
}
```

These headers enable:
- WebGPU support
- SharedArrayBuffer
- Cross-origin isolation

---

## Custom Domain

To use a custom domain:

1. Go to your project in Vercel dashboard
2. Click "Settings" → "Domains"
3. Add your domain
4. Update DNS records as instructed
5. Done!

Your site will be available at: `https://your-domain.com`

---

## Environment Variables

No environment variables needed! 🎉

The editor works entirely client-side.

---

## Performance Optimization

### Enable Edge Caching

Vercel automatically caches static assets. For optimal performance:

1. **Browser caching** - Already configured in `vercel.json`
2. **CDN** - Vercel's global edge network
3. **Compression** - Automatic gzip/brotli

### Monitoring

Check your deployment metrics:

```bash
vercel logs
```

Or visit: `https://vercel.com/your-project/deployments`

---

## Troubleshooting

### Issue: Viewer shows "BroadcastChannel not supported"

**Solution:** Use a modern browser:
- ✅ Chrome/Edge 54+
- ✅ Firefox 38+
- ✅ Safari 15.4+
- ❌ Internet Explorer (not supported)

### Issue: Frames not appearing in viewer

**Fixes:**
1. Ensure both tabs are from same deployment URL
2. Check browser console for errors
3. Refresh both tabs
4. Try clearing browser cache

### Issue: Deploy fails

**Check:**
1. All files are committed to Git
2. `vercel.json` is in project root
3. No syntax errors in config
4. Run locally first: `vercel dev`

### Issue: WebGPU not working

**Fixes:**
1. Use HTTPS (Vercel does this automatically)
2. Enable proper headers (check `vercel.json`)
3. Use supported browser

### Issue: Want remote viewing

See "For Remote Viewing" section above.

Use Partykit or run locally for network streaming.

---

## Updating Your Deployment

### Automatic Deploys (Recommended)

Connect your GitHub repository to Vercel:

1. In Vercel dashboard, connect GitHub
2. Select repository
3. Every push to `main` branch auto-deploys

### Manual Updates

```bash
# Make changes
git add .
git commit -m "Update feature"
git push

# Deploy
vercel --prod
```

---

## Cost

**Free Tier Includes:**
- Unlimited deployments
- 100GB bandwidth/month
- Automatic HTTPS
- Global CDN
- Perfect for personal projects!

**Pro Tier ($20/month):**
- More bandwidth
- Analytics
- Password protection
- Team features

For most users, the **free tier is sufficient**! 🎉

---

## Advanced: Partykit Integration

For full network streaming on Vercel, use Partykit:

### 1. Install Partykit

```bash
npm install partykit --save-dev
```

### 2. Create Partykit Server

Create `partykit/server.ts`:

```typescript
import type * as Party from "partykit/server";

export default class FrameStreamServer implements Party.Server {
  constructor(readonly party: Party.Party) {}

  async onConnect(conn: Party.Connection) {
    console.log(`Client ${conn.id} connected`);

    // Broadcast to all connections
    conn.send(JSON.stringify({
      type: 'welcome',
      connections: this.party.getConnections().length
    }));
  }

  async onMessage(message: string, sender: Party.Connection) {
    // Broadcast frame to all except sender
    for (const conn of this.party.getConnections()) {
      if (conn.id !== sender.id) {
        conn.send(message);
      }
    }
  }
}
```

### 3. Deploy Partykit

```bash
npx partykit deploy
```

### 4. Update Config

In `VercelFrameStream.js`, set your Partykit URL:

```javascript
this.partykitHost = 'YOUR_PROJECT.partykit.dev';
```

### 5. Use in Editor

```javascript
// In main.js, use VercelFrameStream instead of BroadcastFrameStream
import { VercelFrameStream } from './src/framestream/VercelFrameStream.js';

const frameStream = new VercelFrameStream({
  partykitHost: 'YOUR_PROJECT.partykit.dev'
});
```

Now you have full network streaming on Vercel! 🚀

---

## Resources

- **Vercel Docs**: https://vercel.com/docs
- **Partykit**: https://partykit.io
- **BroadcastChannel API**: https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel
- **Project Repo**: https://github.com/Amirashkan/glsl-node-editor

---

## Support

For issues:
1. Check this guide
2. Review browser console errors
3. Check Vercel deployment logs
4. Open issue on GitHub

---

**Happy deploying! 🌿✨**
