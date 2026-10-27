// src/accessibility/menuBarKeyboard.js
//
// The top menu bar, without a mouse.
//
// The menus are plain buttons that toggle a dropdown on click (main.js), and their submenus open
// on hover only, so a keyboard could reach the eight titles but not most of what is under them.
// This adds the desktop-menu keys on top of that markup, without changing how a mouse uses it:
//
//   F10                     focus the menu bar (from anywhere but a text field)
//   ← →                     previous / next menu (opening it if one was already open)
//   ↓ Enter Space           open the menu and go to its first item;  ↑ to its last
//   ↑ ↓ Home End            move through a menu's items
//   →  on a "…▸" item       open its submenu;  ←  or Esc back out of it
//   Esc                     close the menu and return to its title; again to leave the bar
//
// Each title also says whether its menu is open (aria-expanded), kept in step with the dropdown's
// own class so a menu opened or closed with the mouse reads correctly too. Focus goes back to
// wherever it was before F10 once a command has run and the menu has closed.

const FOCUSABLE_ITEM =
  'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled])';

function isOpenSubmenu(submenu) {
  if (submenu.classList.contains("show")) return true;
  try {
    return submenu.matches(":focus-within");
  } catch {
    return false; // a DOM without :focus-within support
  }
}

function isVisible(el) {
  if (!el || el.hidden) return false;
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    if (node.style?.display === "none") return false;
    // A submenu's items only count once it is open.
    if (node !== el && node.classList?.contains("menu-submenu") && !isOpenSubmenu(node)) return false;
  }
  return true;
}

function isTextEntry(el) {
  if (!el) return false;
  if (el.tagName === "SELECT" || el.tagName === "TEXTAREA") return true;
  if (el.tagName !== "INPUT") return el.isContentEditable === true;
  const type = (el.getAttribute("type") || "text").toLowerCase();
  return !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file"].includes(type);
}

export function installMenuBarKeyboard({ doc = document, bar = doc.getElementById("top-menu-bar") } = {}) {
  if (!bar) return () => {};

  const titles = () => [...bar.querySelectorAll(".menu-button")].filter(isVisible);
  const dropdownFor = (title) => doc.getElementById(title.id.replace(/^menu-/, "dropdown-"));
  const titleFor = (dropdown) => doc.getElementById(dropdown.id.replace(/^dropdown-/, "menu-"));
  const openDropdown = () => bar.querySelector(".menu-dropdown.show");
  let returnTarget = null;
  let lastTitle = null;
  // A press outside the bar is the user moving on with the mouse: never pull focus back after it.
  let lastOutsidePress = 0;
  const onPointerDown = (event) => {
    if (!bar.contains(event.target)) lastOutsidePress = Date.now();
  };

  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Menu bar");
  for (const title of bar.querySelectorAll(".menu-button")) {
    const dropdown = dropdownFor(title);
    title.setAttribute("aria-haspopup", "true");
    title.setAttribute("aria-expanded", "false");
    if (dropdown) title.setAttribute("aria-controls", dropdown.id);
  }
  for (const trigger of bar.querySelectorAll(".menu-submenu-trigger")) {
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-expanded", "false");
  }
  for (const separator of bar.querySelectorAll(".menu-separator")) {
    separator.setAttribute("role", "separator");
  }

  // At a larger interface size the dropdowns are zoomed (accessibility.css). A dropdown cannot
  // scroll — that would clip its submenus, which hang outside it — so a long one at a large size
  // is zoomed only as far as still fits under the bar.
  const fitDropdown = (dropdown) => {
    const scale = parseFloat(getComputedStyle(doc.documentElement).getPropertyValue("--rz-ui-scale")) || 1;
    if (scale <= 1 || !dropdown.classList.contains("show")) {
      dropdown.style.removeProperty("zoom");
      dropdown.style.removeProperty("top");
      return;
    }
    const natural = dropdown.offsetHeight; // unzoomed CSS pixels
    const room = (doc.defaultView?.innerHeight || 0) - 48;
    const zoom = natural > 0 && room > 0 ? Math.max(1, Math.min(scale, room / natural)) : scale;
    dropdown.style.zoom = String(zoom);
    dropdown.style.top = `${40 / zoom}px`;
  };

  // aria-expanded follows the dropdowns however they were opened.
  const syncExpanded = () => {
    for (const title of bar.querySelectorAll(".menu-button")) {
      const dropdown = dropdownFor(title);
      title.setAttribute("aria-expanded", String(!!dropdown?.classList.contains("show")));
      if (dropdown) fitDropdown(dropdown);
    }
    for (const trigger of bar.querySelectorAll(".menu-submenu-trigger")) {
      const submenu = trigger.nextElementSibling;
      trigger.setAttribute("aria-expanded", String(!!submenu?.classList.contains("show")));
    }
  };
  const observer =
    typeof MutationObserver === "function" ? new MutationObserver(() => syncExpanded()) : null;
  observer?.observe(bar, { subtree: true, attributes: true, attributeFilter: ["class"] });

  const itemsOf = (container) =>
    [...container.querySelectorAll(FOCUSABLE_ITEM)].filter((el) => {
      if (!isVisible(el)) return false;
      // Items of a nested submenu belong to that submenu, not to the menu around it.
      const owner = el.closest(".menu-submenu, .menu-dropdown");
      return owner === container;
    });

  const closeSubmenus = (dropdown) => {
    dropdown?.querySelectorAll(".menu-submenu.show").forEach((s) => s.classList.remove("show"));
  };

  const open = (title, focusLast = false) => {
    const dropdown = dropdownFor(title);
    if (!dropdown) return;
    lastTitle = title;
    if (!dropdown.classList.contains("show")) title.click(); // main.js closes the others
    const items = itemsOf(dropdown);
    (focusLast ? items.at(-1) : items[0])?.focus();
  };

  const closeAll = () => {
    bar.querySelectorAll(".menu-dropdown.show").forEach((d) => {
      closeSubmenus(d);
      d.classList.remove("show");
      titleFor(d)?.classList.remove("active");
    });
  };

  const moveTitle = (from, delta) => {
    const list = titles();
    const index = list.indexOf(from);
    const next = list[(index + delta + list.length) % list.length];
    const wasOpen = !!openDropdown();
    if (wasOpen) open(next);
    else next?.focus();
  };

  const moveItem = (container, current, delta) => {
    const items = itemsOf(container);
    if (!items.length) return;
    const index = items.indexOf(current);
    const next = index < 0 ? items[0] : items[(index + delta + items.length) % items.length];
    next.focus();
  };

  const onKeyDown = (event) => {
    const target = event.target;
    const key = event.key;

    // On a menu title.
    if (target.classList?.contains("menu-button")) {
      switch (key) {
        case "ArrowRight":
        case "ArrowLeft":
          moveTitle(target, key === "ArrowRight" ? 1 : -1);
          break;
        case "ArrowDown":
        case "Enter":
        case " ":
          open(target);
          break;
        case "ArrowUp":
          open(target, true);
          break;
        case "Home":
          titles()[0]?.focus();
          break;
        case "End":
          titles().at(-1)?.focus();
          break;
        case "Escape":
          if (openDropdown()) {
            closeAll();
          } else if (returnTarget?.isConnected) {
            returnTarget.focus();
            returnTarget = null;
          } else {
            target.blur();
          }
          break;
        default:
          return;
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Inside a dropdown or one of its submenus.
    const container = target.closest?.(".menu-submenu, .menu-dropdown");
    if (!container) return;
    const dropdown = target.closest(".menu-dropdown");
    const title = dropdown ? titleFor(dropdown) : null;
    const inSubmenu = container.classList.contains("menu-submenu");
    // Fields keep their own arrow keys: a number field steps, a select changes value.
    const ownsArrows = isTextEntry(target);

    switch (key) {
      case "ArrowDown":
      case "ArrowUp":
        if (ownsArrows) return;
        moveItem(container, target, key === "ArrowDown" ? 1 : -1);
        break;
      case "Home":
      case "End": {
        if (ownsArrows) return;
        const items = itemsOf(container);
        (key === "Home" ? items[0] : items.at(-1))?.focus();
        break;
      }
      case "ArrowRight":
        if (ownsArrows) return;
        if (target.classList.contains("menu-submenu-trigger")) {
          const submenu = target.nextElementSibling;
          submenu?.classList.add("show");
          itemsOf(submenu)[0]?.focus();
        } else if (title) {
          moveTitle(title, 1);
        }
        break;
      case "ArrowLeft":
        if (ownsArrows) return;
        if (inSubmenu) {
          container.classList.remove("show");
          container.previousElementSibling?.focus();
        } else if (title) {
          moveTitle(title, -1);
        }
        break;
      case "Enter":
      case " ":
        if (!target.classList.contains("menu-submenu-trigger")) return; // buttons click natively
        target.nextElementSibling?.classList.add("show");
        itemsOf(target.nextElementSibling)[0]?.focus();
        break;
      case "Escape":
        if (inSubmenu) {
          container.classList.remove("show");
          container.previousElementSibling?.focus();
        } else {
          closeAll();
          title?.focus();
        }
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  // A command that leaves focus stranded (its row disappeared with the menu) hands it back to
  // where the keyboard was before F10 — usually the patch canvas.
  const onFocusOut = (event) => {
    const next = event.relatedTarget;
    if (next && bar.contains(next)) return;
    setTimeout(() => {
      if (Date.now() - lastOutsidePress < 500) return;
      const active = doc.activeElement;
      if (active && active !== doc.body && !bar.contains(active)) {
        // Focus went somewhere on purpose (a dialog, a panel): leave it, and close the menus a
        // keyboard user tabbed out of.
        if (openDropdown() && !next?.closest?.(".menu-dropdown")) closeAll();
        return;
      }
      if (active && bar.contains(active) && isVisible(active)) return;
      if (returnTarget?.isConnected) {
        returnTarget.focus();
        returnTarget = null;
      } else if (lastTitle?.isConnected && !openDropdown()) {
        // Arrived by Tab rather than F10: stay on the menu the command came from.
        lastTitle.focus();
      }
    }, 150);
  };

  const onDocKeyDown = (event) => {
    if (event.key !== "F10" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.defaultPrevented || isTextEntry(event.target)) return;
    const first = titles()[0];
    if (!first) return;
    event.preventDefault();
    if (!bar.contains(doc.activeElement)) {
      returnTarget = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
    }
    first.focus();
  };

  bar.addEventListener("keydown", onKeyDown);
  bar.addEventListener("focusout", onFocusOut);
  doc.addEventListener("keydown", onDocKeyDown);
  doc.addEventListener("pointerdown", onPointerDown, true);
  syncExpanded();

  return () => {
    observer?.disconnect();
    bar.removeEventListener("keydown", onKeyDown);
    bar.removeEventListener("focusout", onFocusOut);
    doc.removeEventListener("keydown", onDocKeyDown);
    doc.removeEventListener("pointerdown", onPointerDown, true);
  };
}
