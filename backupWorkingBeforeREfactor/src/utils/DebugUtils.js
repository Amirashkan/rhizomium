function selfCheck() {
  var ok = true,
    msgs = [];
  function add(cond, m) {
    if (!cond) {
      ok = false;
      msgs.push(m);
    }
  }
  try {
    var ed = getEditor && getEditor();
    add(!!ed, "Editor not found");
    if (ed) {
      add(
        typeof ed.createNode === "function" || typeof ed.rebuild === "function",
        "Editor API looks incomplete",
      );
    }
    var can = document.querySelector("canvas");
    add(!!can, "Canvas not found");
    if (window.rendererReady === false) msgs.push("Renderer not ready");
  } catch (e) {
    ok = false;
    msgs.push("selfCheck exception: " + e.message);
  }
  if (!ok) console.warn("[Rhizomium] selfCheck:", msgs);
  return { ok, msgs };
}

(function ensureDebugPill() {
  if (document.getElementById("rhizo-debug-pill")) return;
  var b = document.createElement("div");
  b.id = "rhizo-debug-pill";
  b.textContent = "DBG";
  b.style.cssText =
    "position:fixed;right:8px;bottom:8px;z-index:9999;background:#000;color:#fff;padding:6px 8px;font:12px/1 monospace;border-radius:999px;cursor:pointer;opacity:.4;";
  b.title = "Toggle debug overlay";
  var overlay = null;
  b.onclick = function () {
    if (!overlay) {
      overlay = document.createElement("pre");
      overlay.style.cssText =
        "position:fixed;right:8px;bottom:40px;z-index:9999;max-width:40vw;max-height:50vh;overflow:auto;background:#111;color:#0f0;padding:10px;border:1px solid #333;white-space:pre-wrap;";
      document.body.appendChild(overlay);
    }
    var res = selfCheck();
    overlay.textContent = "[selfCheck]\n" + JSON.stringify(res, null, 2);
    overlay.style.display =
      overlay.style.display === "none" ? "block" : "block";
  };
  document.body.appendChild(b);
})();
