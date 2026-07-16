// ==UserScript==
// @name         NodeNuker
// @namespace    https://github.com/gf-ntiedt/nodenuker
// @version      1.1.1
// @description  Point. Click. Nuke. Interactive DOM element picker, deleter & undo tool.
// @author       Gedankenfolger GmbH
// @match        *://*/*
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @updateURL    https://gf-ntiedt.github.io/nodenuker/nodenuker.user.js
// @downloadURL  https://gf-ntiedt.github.io/nodenuker/nodenuker.user.js
// @license      GPL-3.0-or-later
// ==/UserScript==

window.__NODENUKER_NO_AUTORUN = true;

/**
 * NodeNuker — interactive DOM element picker, deleter & undo tool.
 *
 * Copyright (C) 2026 Gedankenfolger GmbH
 * Licensed under the GNU General Public License v3.0 or later.
 * See LICENSE for details.
 *
 * Activation toggles the tool on/off, so running the bookmarklet again
 * (or pressing Escape) fully tears down all listeners and overlays.
 *
 * Controls while active:
 *   hover        highlight element under cursor
 *   click        select the highlighted element (also exits invert mode)
 *   Delete       remove the hovered element, or the selected one if the
 *                mouse isn't over anything trackable — or, while inverted,
 *                remove every element currently in the inverted selection
 *   z            undo the last removal
 *   p            select the parent of the currently selected element
 *                (recomputes the inverted selection if invert mode is active)
 *   c            select the first child of the currently selected element,
 *                if one exists
 *   b / n        select the previous / next sibling of the currently
 *                selected element, if one exists
 *   i            invert the selection: everything in the document except
 *                the selected element and its ancestor chain gets marked
 *                for removal (toggle again to leave invert mode)
 *   Escape       exit NodeNuker entirely
 *
 * HUD buttons only (no keyboard shortcut):
 *   copy html    copies the selected element's outerHTML to the clipboard
 *   open/download image  shown when the selection is an <img> or has a
 *                        CSS background-image
 *
 * Runs automatically when loaded (bookmarklet / loader-script use), unless
 * window.__NODENUKER_NO_AUTORUN is set beforehand — the userscript build sets
 * that flag and instead triggers nodeNukerToggle() from a menu command.
 */
function nodeNukerToggle() {
  'use strict';
  var NS = 'data-nodenuker-ui';
  var Z_INDEX = 2147483647;
  var INVERT_GROUP_THRESHOLD = 6;
  var COLOR_HOVER = '#4dabf7';
  var COLOR_DELETE = '#ff6b6b';
  var COLOR_KEEP = '#51cf66';
  var COLOR_PARENT = '#9775fa';
  var SAFE_URL_SCHEME = /^(https?|data|blob):/i;
  var VERSION = '1.1.1';

  if (window.__nodeNuker && window.__nodeNuker.active) {
    window.__nodeNuker.deactivate();
    return;
  }

  var state = {
    active: true,
    hovered: null,
    selected: null,
    undoStack: [],
    hoverBox: null,
    selectBox: null,
    parentBox: null,
    hud: null,
    inverted: false,
    invertGroups: [],
    invertTargets: [],
    invertBoxes: [],
    imageUrl: null
  };

  function getImageUrl(el) {
    if (!el || !el.isConnected) return null;
    var url = null;
    if (el.tagName === 'IMG') {
      url = el.currentSrc || el.src || null;
    } else {
      var bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none') {
        var match = /url\((['"]?)(.*?)\1\)/.exec(bg);
        url = match ? match[2] : null;
      }
    }
    return (url && SAFE_URL_SCHEME.test(url)) ? url : null;
  }

  function openImage(url) {
    window.open(url, '_blank', 'noopener');
  }

  function downloadImage(url) {
    var a = document.createElement('a');
    a.setAttribute(NS, '1');
    a.href = url;
    var name = 'image';
    if (!/^data:/.test(url)) {
      var last = url.split('/').pop().split('?')[0].split('#')[0];
      if (last) name = last;
    }
    a.download = name;
    a.rel = 'noopener';
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.setAttribute(NS, '1');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.documentElement.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }

  function copyHtml(btn) {
    var el = state.selected;
    if (!el) return;
    var html = el.outerHTML;
    function flash() {
      if (!btn) return;
      var labelEl = btn.lastChild;
      if (!labelEl) return;
      var original = labelEl.textContent;
      labelEl.textContent = 'copied!';
      setTimeout(function () { labelEl.textContent = original; }, 900);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(html).then(flash).catch(function () {
        legacyCopy(html);
        flash();
      });
    } else {
      legacyCopy(html);
      flash();
    }
  }

  function makeBox(color, dashed, labelBelow) {
    var box = document.createElement('div');
    box.setAttribute(NS, '1');
    box.style.cssText = [
      'position:fixed',
      'top:0', 'left:0',
      'width:0', 'height:0',
      'box-sizing:border-box',
      'border:2px ' + (dashed ? 'dashed' : 'solid') + ' ' + color,
      'background:' + color + '22',
      'pointer-events:none',
      'z-index:' + Z_INDEX,
      'display:none',
      'border-radius:2px'
    ].join(';');

    var label = document.createElement('div');
    label.setAttribute(NS, '1');
    label.style.cssText = [
      'position:absolute',
      labelBelow ? 'bottom:-22px' : 'top:-22px', 'left:-2px',
      'background:' + color,
      'color:#fff',
      'font:11px/1.4 monospace',
      'padding:1px 6px',
      'border-radius:2px',
      'white-space:nowrap'
    ].join(';');
    box.appendChild(label);
    document.documentElement.appendChild(box);
    return box;
  }

  function setBoxColor(box, color) {
    box.style.border = '2px solid ' + color;
    box.style.background = color + '22';
    box.firstChild.style.background = color;
  }

  function describe(el) {
    if (!el) return '';
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.className && typeof el.className === 'string' && el.className.trim()) {
      s += '.' + el.className.trim().split(/\s+/).join('.');
    }
    return s;
  }

  function positionBox(box, el) {
    if (!el || !el.isConnected) {
      box.style.display = 'none';
      return;
    }
    var r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.transform = 'translate(' + r.left + 'px,' + r.top + 'px)';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    box.firstChild.textContent = describe(el);
  }

  function isOwnUI(el) {
    return !!(el && el.closest && el.closest('[' + NS + ']'));
  }

  function isProtected(el) {
    return el === document.documentElement || el === document.body;
  }

  function buildHud() {
    var hud = document.createElement('div');
    hud.setAttribute(NS, '1');
    hud.style.cssText = [
      'position:fixed',
      'bottom:0px', 'left:50%',
      'transform:translateX(-50%)',
      'background:rgba(20,20,20,1)',
      'color:#f5f5f5',
      'font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'padding:10px 14px',
      'border-radius:8px',
      'z-index:' + Z_INDEX,
      'box-shadow:0 4px 16px rgba(0,0,0,.35)',
      'max-width:430px',
      'text-align:center',
      'pointer-events:none'
    ].join(';');
    hud.innerHTML =
      '<div style="display:none;opacity:.85">Hover: <span data-role="hover">none</span></div>' +
      '<div style="opacity:.85">Selected: <span data-role="selected">none</span></div>' +
      '<div style="opacity:.85">Parent: <span data-role="parent">none</span></div>' +
      '<div style="opacity:.85">Inverted: <span data-role="invert">off</span></div>' +
      '<div style="margin-top:4px;opacity:.85">Undo stack: <span data-role="stack">0</span></div>' +
      '<div data-role="keys" style="display:flex;gap:6px;justify-content:center;flex-wrap:nowrap;margin-top:6px"></div>' +
      '<div data-role="elementActions" style="display:none;gap:6px;justify-content:center;flex-wrap:nowrap;margin-top:6px"></div>' +
      '<div data-role="imageActions" style="display:none;gap:6px;justify-content:center;flex-wrap:nowrap;margin-top:6px"></div>' +
      '<div style="font-weight:600;margin-top:6px;color:#ff6b6b">NodeNuker v' + VERSION + '</div>';
    document.documentElement.appendChild(hud);

    function makeKeyButton(key, label, title, fn) {
      var btn = document.createElement('button');
      btn.setAttribute(NS, '1');
      btn.type = 'button';
      btn.title = title;
      btn.style.cssText = [
        'pointer-events:auto',
        'cursor:pointer',
        'display:flex',
        'flex-direction:column',
        'align-items:center',
        'gap:2px',
        'min-width:32px',
        'background:#3a3f4b',
        'border:1px solid #565d6d',
        'border-bottom:3px solid #22262e',
        'border-radius:6px',
        'padding:5px 8px'
      ].join(';');
      var keyEl = document.createElement('span');
      keyEl.style.cssText = 'font:13px/1 monospace;color:#4dabf7;font-weight:700';
      keyEl.textContent = key;
      var labelEl = document.createElement('span');
      labelEl.style.cssText = 'font:9px/1 monospace;color:#4dabf7;opacity:.75;text-transform:uppercase;letter-spacing:.03em';
      labelEl.textContent = label;
      btn.appendChild(keyEl);
      btn.appendChild(labelEl);
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        fn(btn);
      });
      return btn;
    }

    var KEYS = [
      { key: 'Esc', label: 'quit', title: 'Quit: exit NodeNuker completely', fn: deactivate },
      { key: 'Del', label: 'delete', title: 'Delete: remove the hovered/selected element', fn: deleteTarget },
      { key: 'z', label: 'undo', title: 'Undo: restore the last removed element', fn: undo },
      { key: 'p', label: 'parent', title: 'Parent: select the parent of the selected element', fn: selectParent },
      { key: 'c', label: 'child', title: 'Child: select the first child of the selected element', fn: selectChild },
      { key: 'b', label: 'back', title: 'Back: select the previous sibling', fn: function () { selectSibling('prev'); } },
      { key: 'n', label: 'next', title: 'Next: select the next sibling', fn: function () { selectSibling('next'); } },
      { key: 'i', label: 'invert', title: 'Invert: mark everything except the selected element and its ancestors for removal', fn: toggleInvert }
    ];
    var keysRow = hud.querySelector('[data-role="keys"]');
    KEYS.forEach(function (k) {
      keysRow.appendChild(makeKeyButton(k.key, k.label, k.title, k.fn));
    });

    var ELEMENT_ACTIONS = [
      { key: '</>', label: 'copy html', title: 'Copy HTML: copy the selected element\'s outerHTML to the clipboard', fn: function (btn) { copyHtml(btn); } }
    ];
    var elementActionsRow = hud.querySelector('[data-role="elementActions"]');
    ELEMENT_ACTIONS.forEach(function (a) {
      elementActionsRow.appendChild(makeKeyButton(a.key, a.label, a.title, a.fn));
    });

    var IMAGE_ACTIONS = [
      { key: '↗', label: 'open image', title: 'Open image: open the image in a new tab', fn: function () { if (state.imageUrl) openImage(state.imageUrl); } },
      { key: '⬇', label: 'download', title: 'Download: download the image', fn: function () { if (state.imageUrl) downloadImage(state.imageUrl); } }
    ];
    var imageActionsRow = hud.querySelector('[data-role="imageActions"]');
    IMAGE_ACTIONS.forEach(function (a) {
      imageActionsRow.appendChild(makeKeyButton(a.key, a.label, a.title, a.fn));
    });

    return {
      root: hud,
      hoverLabel: hud.querySelector('[data-role="hover"]'),
      selectedLabel: hud.querySelector('[data-role="selected"]'),
      parentLabel: hud.querySelector('[data-role="parent"]'),
      invertLabel: hud.querySelector('[data-role="invert"]'),
      stackLabel: hud.querySelector('[data-role="stack"]'),
      elementActionsRow: elementActionsRow,
      imageActionsRow: imageActionsRow
    };
  }

  function flattenInvertGroups() {
    var nodes = [];
    for (var i = 0; i < state.invertGroups.length; i++) {
      nodes = nodes.concat(state.invertGroups[i]);
    }
    return nodes;
  }

  function updateHud() {
    var parent = state.selected ? state.selected.parentElement : null;
    if (parent && isOwnUI(parent)) parent = null;
    state.hud.hoverLabel.textContent = state.hovered ? describe(state.hovered) : 'none';
    state.hud.selectedLabel.textContent = state.selected ? describe(state.selected) : 'none';
    state.hud.parentLabel.textContent = parent ? describe(parent) : 'none';
    state.hud.invertLabel.textContent = state.inverted
      ? (flattenInvertGroups().length + ' element(s)')
      : 'off';
    state.hud.stackLabel.textContent = state.undoStack.length;
    state.hud.elementActionsRow.style.display = state.selected ? 'flex' : 'none';
  }

  function updateImageState() {
    state.imageUrl = getImageUrl(state.selected);
    state.hud.imageActionsRow.style.display = state.imageUrl ? 'flex' : 'none';
  }

  function updateParentBox() {
    var parent = state.selected ? state.selected.parentElement : null;
    if (!parent || isOwnUI(parent)) {
      state.parentBox.style.display = 'none';
      return;
    }
    positionBox(state.parentBox, parent);
  }

  function updateHoverBox() {
    if (state.hovered && state.hovered !== state.selected) {
      positionBox(state.hoverBox, state.hovered);
    } else {
      state.hoverBox.style.display = 'none';
    }
  }

  var hoverRafId = null;
  var pendingHoverTarget = null;

  function onMouseMove(e) {
    var el = e.target;
    if (isOwnUI(el)) return;
    pendingHoverTarget = el;
    if (hoverRafId !== null) return;
    hoverRafId = requestAnimationFrame(function () {
      hoverRafId = null;
      state.hovered = pendingHoverTarget;
      updateHoverBox();
      updateHud();
    });
  }

  function onClick(e) {
    var el = e.target;
    if (isOwnUI(el)) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    if (state.inverted) exitInvert();
    state.selected = el;
    updateImageState();
    positionBox(state.selectBox, el);
    updateParentBox();
    updateHoverBox();
    updateHud();
  }

  function deleteTarget() {
    if (state.inverted) {
      deleteInvertedSelection();
      return;
    }
    var el = (state.hovered && state.hovered.isConnected) ? state.hovered : state.selected;
    if (!el || !el.isConnected || isProtected(el)) return;
    state.undoStack.push({
      node: el,
      parent: el.parentNode,
      nextSibling: el.nextSibling
    });
    el.remove();
    if (state.selected === el) {
      state.selected = null;
      updateImageState();
      state.selectBox.style.display = 'none';
      state.parentBox.style.display = 'none';
    }
    if (state.hovered === el) {
      state.hovered = null;
      state.hoverBox.style.display = 'none';
    }
    updateHud();
  }

  function deleteInvertedSelection() {
    var nodes = flattenInvertGroups();
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el.isConnected || isProtected(el)) continue;
      state.undoStack.push({
        node: el,
        parent: el.parentNode,
        nextSibling: el.nextSibling
      });
      el.remove();
    }
    exitInvert();
    updateHud();
  }

  function undo() {
    var entry = state.undoStack.pop();
    if (!entry) return;
    entry.parent.insertBefore(entry.node, entry.nextSibling);
    state.selected = entry.node;
    updateImageState();
    positionBox(state.selectBox, entry.node);
    updateParentBox();
    updateHoverBox();
    updateHud();
  }

  function selectParent() {
    var el = state.selected;
    if (!el) return;
    var parent = el.parentElement;
    if (!parent || isOwnUI(parent)) return;
    state.selected = parent;
    updateImageState();
    positionBox(state.selectBox, parent);
    updateParentBox();
    updateHoverBox();
    if (state.inverted) {
      enterInvert();
    } else {
      updateHud();
    }
  }

  function selectChild() {
    var el = state.selected;
    if (!el) return;
    var child = el.firstElementChild;
    while (child && isOwnUI(child)) {
      child = child.nextElementSibling;
    }
    if (!child) return;
    state.selected = child;
    updateImageState();
    positionBox(state.selectBox, child);
    updateParentBox();
    updateHoverBox();
    if (state.inverted) {
      enterInvert();
    } else {
      updateHud();
    }
  }

  function selectSibling(direction) {
    var el = state.selected;
    if (!el) return;
    var sibling = direction === 'next' ? el.nextElementSibling : el.previousElementSibling;
    if (!sibling || isOwnUI(sibling)) return;
    state.selected = sibling;
    updateImageState();
    positionBox(state.selectBox, sibling);
    updateParentBox();
    updateHoverBox();
    if (state.inverted) {
      enterInvert();
    } else {
      updateHud();
    }
  }

  function computeInverseGroups(el) {
    var groups = [];
    var node = el;
    while (node && node.parentElement) {
      var parent = node.parentElement;
      var siblings = [];
      for (var i = 0; i < parent.children.length; i++) {
        var c = parent.children[i];
        if (c !== node && !isOwnUI(c)) siblings.push(c);
      }
      if (siblings.length) groups.push(siblings);
      node = parent;
    }
    return groups;
  }

  function clearInvertBoxes() {
    for (var i = 0; i < state.invertBoxes.length; i++) {
      state.invertBoxes[i].remove();
    }
    state.invertBoxes = [];
    state.invertTargets = [];
  }

  function renderInvertBoxes() {
    clearInvertBoxes();
    for (var g = 0; g < state.invertGroups.length; g++) {
      var group = state.invertGroups[g];
      if (!group.length) continue;
      if (group.length > INVERT_GROUP_THRESHOLD) {
        var parent = group[0].parentElement;
        var box = makeBox(COLOR_DELETE);
        positionBox(box, parent);
        state.invertBoxes.push(box);
        state.invertTargets.push(parent);
      } else {
        for (var i = 0; i < group.length; i++) {
          var b = makeBox(COLOR_DELETE);
          positionBox(b, group[i]);
          state.invertBoxes.push(b);
          state.invertTargets.push(group[i]);
        }
      }
    }
  }

  function repositionInvertBoxes() {
    for (var i = 0; i < state.invertBoxes.length; i++) {
      positionBox(state.invertBoxes[i], state.invertTargets[i]);
    }
  }

  function enterInvert() {
    if (!state.selected) return;
    state.invertGroups = computeInverseGroups(state.selected);
    state.inverted = true;
    setBoxColor(state.selectBox, COLOR_KEEP);
    renderInvertBoxes();
    updateHud();
  }

  function exitInvert() {
    state.inverted = false;
    state.invertGroups = [];
    clearInvertBoxes();
    setBoxColor(state.selectBox, COLOR_DELETE);
    updateHud();
  }

  function toggleInvert() {
    if (state.inverted) {
      exitInvert();
    } else {
      enterInvert();
    }
  }

  function onKeyDown(e) {
    var key = e.key;
    if (key === 'Escape') {
      e.preventDefault();
      deactivate();
      return;
    }
    if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault();
      deleteTarget();
      return;
    }
    if (key === 'z' || key === 'Z') {
      e.preventDefault();
      undo();
      return;
    }
    if (key === 'p' || key === 'P') {
      e.preventDefault();
      selectParent();
      return;
    }
    if (key === 'c' || key === 'C') {
      e.preventDefault();
      selectChild();
      return;
    }
    if (key === 'b' || key === 'B') {
      e.preventDefault();
      selectSibling('prev');
      return;
    }
    if (key === 'n' || key === 'N') {
      e.preventDefault();
      selectSibling('next');
      return;
    }
    if (key === 'i' || key === 'I') {
      e.preventDefault();
      toggleInvert();
      return;
    }
  }

  var scrollRafId = null;

  function onScrollOrResize() {
    if (scrollRafId !== null) return;
    scrollRafId = requestAnimationFrame(function () {
      scrollRafId = null;
      updateHoverBox();
      positionBox(state.selectBox, state.selected);
      updateParentBox();
      if (state.inverted) repositionInvertBoxes();
    });
  }

  function activate() {
    state.hoverBox = makeBox(COLOR_HOVER);
    state.selectBox = makeBox(COLOR_DELETE, false, true);
    state.parentBox = makeBox(COLOR_PARENT, true);
    state.hud = buildHud();
    updateHud();
    updateImageState();

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize, true);
  }

  function deactivate() {
    state.active = false;
    if (hoverRafId !== null) { cancelAnimationFrame(hoverRafId); hoverRafId = null; }
    if (scrollRafId !== null) { cancelAnimationFrame(scrollRafId); scrollRafId = null; }
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onScrollOrResize, true);
    window.removeEventListener('resize', onScrollOrResize, true);
    document.querySelectorAll('[' + NS + ']').forEach(function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
    window.__nodeNuker = null;
  }

  window.__nodeNuker = { active: true, deactivate: deactivate };
  activate();
}

if (typeof window.__NODENUKER_NO_AUTORUN === 'undefined') {
  nodeNukerToggle();
}

if (typeof GM_registerMenuCommand === 'function') {
  GM_registerMenuCommand('Toggle NodeNuker', nodeNukerToggle);
}
