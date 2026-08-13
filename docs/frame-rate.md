# Frame Rate & Display Refresh

> **Short version:** the `fps` number in the status bar counts the frames your
> window actually puts on screen. If it reads lower than your monitor's refresh
> rate and the editor still feels responsive, the most likely cause is your
> browser — not your graph and not Rhizomium. See
> [Known limitation](#known-limitation-multi-monitor-refresh-rates-on-chrome--windows).

---

## What the number means

The status bar's `fps` readout counts **presented frames** — frames the browser
actually handed to your display. It is the same thing a game's FPS counter
reports, and it is the only rate you can actually see.

It follows your display. A 60Hz monitor reads ~60, a 120Hz laptop panel reads
~120, a 144Hz one reads ~144. There is no fixed target it is measuring against.

The preview panel's overlay shows the same number alongside a second one:

```
120 fps · 4.2 ms GPU
```

- **`fps`** — frames your window presented. What you see.
- **`ms GPU`** — how long the GPU spent on a frame. What your graph costs.

Reading them together tells you where a problem is:

| Reading | Meaning |
| --- | --- |
| `120 fps · 4 ms GPU` | Healthy. GPU has headroom. |
| `30 fps · 31 ms GPU` | **Your graph is too heavy.** The GPU is the bottleneck — simplify it, or lower the preview resolution. |
| `48 fps · 5 ms GPU` | **Not your graph.** The GPU is finishing frames quickly but they are not reaching the screen. Almost always the limitation below. |

That third row is the one that confuses people, and it is why the two numbers
are shown separately.

---

## Known limitation: multi-monitor refresh rates on Chrome / Windows

**If you run more than one display at different refresh rates, Chrome may cap
every one of its windows to a single lower rate — including Rhizomium.**

This is a browser-level limitation. Native applications give each window the
refresh rate of the display it is on. A browser composites all of its windows
through one pipeline on one clock, and in mixed-refresh setups it can pick the
wrong one. Every tab and every window is affected equally.

### How to tell that this is what you are hitting

1. **Open any other web page** — a blank tab, any website — and run the check
   below. If that page shows the same low number, the cap is browser-wide and
   has nothing to do with Rhizomium.
2. **Check a native application** on the same display. If your desktop and other
   apps are smooth while every browser window is not, that confirms it.
3. **Unplug the second display** and re-check. If the number jumps to your
   panel's full rate, the cap came from the display combination.

### Measuring it yourself

Open the browser console (**F12** → Console) and paste this. It reports the
actual spacing between presented frames over about three seconds:

```js
(() => { const g = []; let last = performance.now();
  const k = (now) => { g.push(now - last); last = now;
    if (g.length < 200) requestAnimationFrame(k);
    else { g.shift(); const s = g.slice().sort((a, b) => a - b);
      console.log('median', s[s.length >> 1].toFixed(1), 'ms →',
        (1000 / (g.reduce((a, b) => a + b, 0) / g.length)).toFixed(1), 'fps'); } };
  requestAnimationFrame(k); })();
```

| Result | What it means |
| --- | --- |
| A single tight cluster (e.g. every frame ~20.8 ms) | A hard clock at that rate. Nothing is being dropped — the browser is simply presenting at 48Hz. This is the limitation above. |
| A mix of ~16.7 ms and ~33.3 ms | Frames genuinely being dropped on a 60Hz display. That *is* a workload problem — check the `ms GPU` figure. |
| Wide scatter | Variable refresh rate (VRR / G-Sync / FreeSync / ProMotion) doing its own pacing. |

`chrome://gpu` → search for **"Display refresh rate"** shows what Chrome
believes your display is running at.

### What you can do about it

None of these are things Rhizomium can do for you — they are display and browser
settings:

- **Set your displays to the same refresh rate.** Windows: Settings → System →
  Display → select each display → Advanced display → Choose a refresh rate.
  Projectors and TVs often negotiate a 24Hz or 48Hz film mode, which is a common
  source of an oddly specific cap.
- **Change which display is primary.** Windows: Settings → System → Display →
  select the display → "Make this my main display".
- **Try a different browser.** Firefox uses a different compositor and may not
  have the same behaviour on your setup.
- **Change the display combination.** If one particular monitor drags the clock
  down, running without it restores the full rate.

### Why Rhizomium does not "fix" this

It cannot. The application cannot make the browser present more frames than the
browser's compositor is producing — there is no setting, canvas option, or
rendering trick that raises that ceiling from inside a web page. It applies
identically to a blank page with no graphics on it at all.

What Rhizomium *does* do is report the rate honestly rather than displaying a
target and pretending. If the readout says 48, you are seeing 48.

---

## Getting the most out of a high-refresh display

If your display runs above 60Hz, check your timing mode:

**Preview / Export Settings → Timing → Timing Mode**

- **V-Sync (display refresh)** — renders one frame per display refresh. On a
  120Hz or 144Hz panel this is what gives you motion at the full rate.
- **Fixed step** — renders at the rate set by the Frame Rate slider, regardless
  of your display. Useful when you need a deterministic rate; on a 120Hz display
  a fixed 60 caps your motion at 60 even though the display could show twice
  that.

If you are on a high-refresh panel and motion looks smoother in other
applications, this setting is worth checking first.

---

## When the frame rate really is your graph

If `ms GPU` is high (above ~16 ms), the GPU is the limit and the fixes are in
your patch:

- Lower the preview resolution — **Preview / Export Settings → Quality**
- Reduce compute node resolution and iteration counts
- Check the [Performance Profiler](profiler.md) to find which dispatches cost
  the most
- See [Performance Tips](performance.md) for the full list

---

## See also

- [Performance Tips](performance.md)
- [Performance Profiler](profiler.md)
- [Frame Timing Monitoring](frame-timing-monitoring.md)
- [Dual Screen Setup](dual-screen.md)
- [Troubleshooting](troubleshooting.md)
