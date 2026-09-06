// Landing-page behaviour: the hero flow field, the build readout, the
// showreel's reduced-motion opt-out, and the sign-up form.
//
// Everything here is progressive enhancement. With this module blocked or
// broken the page still renders, the copy still reads, and every link still
// resolves — the canvas just stays empty and the showreel plays as the markup
// asks it to.

import { APP_VERSION } from "../utils/appVersion.js";

const prefersReducedMotion = window.matchMedia?.(
  "(prefers-reduced-motion: reduce)",
).matches;

/* --- Hero flow field ----------------------------------------------------
   A 2D advection field: particles walk a smooth noise-ish angle function and
   trail over a slowly-fading ground, which is what gives the growth look.
   Deliberately canvas-2D rather than WebGPU — this runs on the machines that
   cannot run the editor, and it must never be the reason the page stutters. */

function startField(canvas, onSample) {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let points = [];
  let time = 0;
  let raf = 0;
  let running = false;

  // Frame accounting for the hero readout.
  let frames = 0;
  let windowStart = 0;

  function resize() {
    const parent = canvas.parentElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = parent.clientWidth;
    height = parent.clientHeight;
    if (width === 0 || height === 0) return;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0e0c0a";
    ctx.fillRect(0, 0, width, height);
  }

  function spawn(point = {}) {
    point.x = Math.random() * width;
    point.y = Math.random() * height;
    point.life = 40 + Math.random() * 220;
    point.age = 0;
    // A minority of strands run olive, the rest rust — the same two-colour
    // split the rest of the page uses.
    point.hue = Math.random() < 0.22 ? 88 + Math.random() * 24 : 16 + Math.random() * 20;
    point.speed = 0.5 + Math.random() * 1.1;
    return point;
  }

  function seed() {
    resize();
    if (width === 0 || height === 0) return false;
    // Scale the population to the area so a wide monitor is not sparse and a
    // laptop is not overdrawn, but never past 1100 strands.
    const count = Math.min(1100, Math.max(400, Math.round((width * height) / 900)));
    points = Array.from({ length: count }, () => spawn());
    return true;
  }

  function angleAt(x, y, t) {
    const a =
      Math.sin(x * 0.0026 + t) * Math.cos(y * 0.0021 - t * 0.6) +
      Math.sin((x + y) * 0.0015 + t * 0.35) +
      Math.cos(y * 0.004 - t * 0.5) * 0.5;
    return a * Math.PI * 0.9;
  }

  function step() {
    time += 0.0016;
    ctx.fillStyle = "rgba(14,12,10,0.055)";
    ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 1.1;
    ctx.lineCap = "round";

    for (const p of points) {
      const angle = angleAt(p.x, p.y, time);
      const nx = p.x + Math.cos(angle) * p.speed;
      const ny = p.y + Math.sin(angle) * p.speed;
      // Fade in over the first 20 frames, then out across the remaining life,
      // so strands never pop into or out of existence.
      const fade = Math.min(1, p.age / 20) * (1 - p.age / p.life);
      ctx.strokeStyle = `hsla(${p.hue},58%,52%,${(0.34 * fade).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      p.x = nx;
      p.y = ny;
      p.age++;
      if (p.age > p.life || nx < -20 || nx > width + 20 || ny < -20 || ny > height + 20) {
        spawn(p);
      }
    }
  }

  function frame(now) {
    step();
    frames++;
    if (now - windowStart >= 500) {
      onSample?.(Math.round((frames * 1000) / (now - windowStart)), points.length);
      frames = 0;
      windowStart = now;
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || points.length === 0) return;
    running = true;
    frames = 0;
    windowStart = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  if (!seed()) return;

  if (prefersReducedMotion) {
    // One settled composition instead of motion: advance the simulation far
    // enough for the strands to draw themselves, then leave it alone.
    for (let i = 0; i < 260; i++) step();
    onSample?.(null, points.length);
    return;
  }

  // The hero is one screen of a long page; there is no reason to keep
  // painting it while the reader is down in the pricing table.
  const observer = new IntersectionObserver(
    ([entry]) => (entry.isIntersecting ? start() : stop()),
    { threshold: 0 },
  );
  observer.observe(canvas.parentElement);

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const wasRunning = running;
      stop();
      if (seed() && wasRunning) start();
    }, 150);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (canvas.parentElement.getBoundingClientRect().bottom > 0) start();
  });
}

/* --- Hero readout ------------------------------------------------------- */

function initTelemetry() {
  const build = document.querySelector("[data-build]");
  const readout = document.querySelector("[data-readout]");
  if (build) {
    build.textContent = APP_VERSION
      ? `v${APP_VERSION} · experimental build`
      : "experimental build";
  }
  return (fps, nodes) => {
    if (!readout) return;
    // `fps` is null under reduced motion, where there is nothing to measure.
    const rate = fps === null ? "——" : String(fps).padStart(2, "0");
    const signal = fps === null ? "held" : "live";
    readout.textContent = `fps ${rate} · nodes ${nodes} · signal ${signal}`;
  };
}

/* --- Sign-up ------------------------------------------------------------
   Accounts live in the gallery (art.tenderworld.org), not here, so the form
   does not collect an address — it hands one over. The markup is a plain GET
   form aimed at the gallery's sign-in page, which prefills the address and
   mails a link back, and that trip happens with or without this module.

   All that is added here is the check before the trip, so a typo is caught on
   this page rather than after the navigation, and a word about where the
   button is taking you. */

function initSignup() {
  const form = document.querySelector("[data-signup]");
  if (!form) return;
  const status = form.querySelector("[data-signup-status]");
  const input = form.querySelector("input[type=email]");

  const say = (message, tone) => {
    if (!status) return;
    status.textContent = message;
    if (tone) status.setAttribute("data-tone", tone);
    else status.removeAttribute("data-tone");
  };

  form.addEventListener("submit", (event) => {
    if (!input.value.trim() || !input.checkValidity()) {
      event.preventDefault();
      say("Enter a valid email address.", "error");
      return;
    }

    // Nothing to preventDefault: the browser navigates to the form's action,
    // which is the gallery. Saying so covers the moment before it does.
    say("Taking you to the gallery to finish signing up…");
  });
}

/* --- Showreel -----------------------------------------------------------
   The reel autoplays from markup, which is the only way it starts at all if
   this file fails to load. All that is left to do here is take it back for
   someone who asked for less motion: pausing is not enough on its own,
   because `loop` and `autoplay` would start it again on the next load, so
   the attribute goes too and the poster is what stays on screen. */

function settleShowreel() {
  if (!prefersReducedMotion) return;
  for (const video of document.querySelectorAll(".reel-video")) {
    video.removeAttribute("autoplay");
    video.removeAttribute("loop");
    video.pause();
  }
}

/* --- Boot --------------------------------------------------------------- */

settleShowreel();
initSignup();

const sample = initTelemetry();
const field = document.querySelector("[data-field]");
if (field) startField(field, sample);
