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
 *   info         opens a separate panel with quick facts (font size incl.
 *                px/rem conversion, font family/weight, color, background,
 *                href) for the selected element, each individually
 *                copyable, plus a toggle to view/copy all computed styles
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
  var COLOR_HOVER = '#c5ba2d';
  var COLOR_DELETE = '#c5ba2d';
  var COLOR_KEEP = '#51cf66';
  var COLOR_PARENT = '#9775fa';
  var COLOR_TEXT = '#f5f5f5';
  var COLOR_BTN_BG = '#555760';
  var COLOR_KEY_QUIT = '#3a3c44';
  var COLOR_KEY_NAV = '#5d5f69';
  var COLOR_KEY_ACTION = '#8a8c96';
  var COLOR_BTN_BORDER = '#565d6d';
  var COLOR_BTN_BORDER_BOTTOM = '#22262e';
  var FONT_UI = '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
  var FONT_MONO_11 = '11px/1.4 monospace';
  var SHADOW_PANEL = '0 4px 16px rgba(0,0,0,.35)';
  var PTR_AUTO = 'pointer-events:auto;cursor:pointer';
  var SAFE_URL_SCHEME = /^(https?|data|blob):/i;
  var VERSION = '1.4.0';
  var SETTINGS_KEY = 'nodenuker:settings';
  var DEFAULT_SETTINGS = { autoOpenInfoPanel: false };

  // Settings persist across sessions via localStorage (per host origin), so
  // wrapped in try/catch: some pages block storage access entirely (strict
  // sandboxed iframes, certain privacy modes), which must not crash NodeNuker.
  function loadSettings() {
    var settings = {};
    for (var key in DEFAULT_SETTINGS) settings[key] = DEFAULT_SETTINGS[key];
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        for (var k in parsed) settings[k] = parsed[k];
      }
    } catch (e) {}
    return settings;
  }

  function saveSettings(settings) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
  }

  // Small square icon buttons rendered inline in info-panel rows (copy,
  // style detail, back, close). appearance:none strips the browser's native
  // button chrome first — without it, some browsers/OS themes enforce a
  // native minimum button width (seen well over 100px) regardless of the
  // width set below. Fixed box size + overflow:hidden then keeps them
  // compact even if a glyph's fallback rendering comes out larger than the
  // requested font-size.
  function smallIconBtnStyle(color, fontSize) {
    return PTR_AUTO + ';appearance:none' +
      ';box-sizing:border-box;background:none;border:0;color:' + (color || COLOR_HOVER) +
      ';font-size:' + (fontSize || 13) + 'px;line-height:1;flex:none;width:20px;height:20px;min-width:20px;padding:0' +
      ';display:inline-flex;align-items:center;justify-content:center;overflow:hidden';
  }

  // Shared cssText fragments for the two fixed floating panels (HUD, info
  // panel): same text color, UI font, corner radius, stacking and shadow —
  // only background, position and inner padding differ between them.
  function panelChrome(bg) {
    return [
      'box-sizing:border-box',
      'background:' + bg,
      'color:' + COLOR_TEXT,
      'font:12px/1.5 ' + FONT_UI,
      'border-radius:8px',
      'z-index:' + Z_INDEX,
      'box-shadow:' + SHADOW_PANEL
    ];
  }

  // Shared cssText string for the small monospace toolbar buttons rendered
  // via innerHTML (Copy all / Show all styles). flex-basis:auto sizes each
  // button to its own label first (so a longer label isn't squeezed into an
  // equal share while the shorter one sits half-empty); the ellipsis
  // fallback only kicks in if both together still can't fit, instead of
  // forcing a horizontal scrollbar on the panel.
  function toolbarBtnStyle() {
    return PTR_AUTO + ';appearance:none;box-sizing:border-box' +
      ';flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center' +
      ';background:' + COLOR_BTN_BG + ';border:1px solid ' + COLOR_BTN_BORDER +
      ';border-radius:6px;color:' + COLOR_TEXT + ';padding:4px 8px;font:11px monospace';
  }

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
    imageUrl: null,
    infoPanel: null,
    infoPanelOpen: false,
    infoView: 'quick',
    settings: loadSettings(),
    settingsToolbar: null,
    settingsPanel: null,
    settingsPanelOpen: false,
    converterPanel: null,
    converterPanelOpen: false,
    autoOpenedInfoPanel: false
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

  function copyText(text, flashEl) {
    function flash() {
      if (!flashEl) return;
      var original = flashEl.textContent;
      flashEl.textContent = 'copied!';
      setTimeout(function () { flashEl.textContent = original; }, 900);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(flash).catch(function () {
        legacyCopy(text);
        flash();
      });
    } else {
      legacyCopy(text);
      flash();
    }
  }

  function copyHtml(btn) {
    var el = state.selected;
    if (!el) return;
    copyText(el.outerHTML, btn ? btn.lastChild : null);
  }

  function copyElementText(btn) {
    var el = state.selected;
    if (!el) return;
    copyText(el.innerText || '', btn ? btn.lastChild : null);
  }

  // The actual HTML attributes present on the element (id, class, style,
  // href, data-*, ...), in source order — as opposed to the computed-style
  // fields below, which reflect the final rendered result.
  function getElementAttributes(el) {
    var attrs = [];
    for (var i = 0; i < el.attributes.length; i++) {
      var value = el.attributes[i].value;
      if (value === '') continue;
      attrs.push({ label: el.attributes[i].name, value: value });
    }
    return attrs;
  }

  // The inline style attribute's own declarations, individually — used by
  // the "style" row's detail view, not the unrelated "Show all styles"
  // (computed own/inherited/default) view.
  function getInlineStyleEntries(el) {
    var entries = [];
    for (var i = 0; i < el.style.length; i++) {
      var prop = el.style[i];
      var value = el.style.getPropertyValue(prop);
      if (value === '') continue;
      entries.push({ label: prop, value: value });
    }
    return entries;
  }

  // Standard CSS "inherited by default" properties (per spec). Used below to
  // tell apart values inherited from an ancestor from plain browser defaults
  // once a property isn't explicitly declared on the element itself.
  var INHERITED_PROPS = {
    'color': 1, 'cursor': 1, 'direction': 1, 'empty-cells': 1,
    'font': 1, 'font-family': 1, 'font-size': 1, 'font-size-adjust': 1,
    'font-style': 1, 'font-variant': 1, 'font-weight': 1, 'font-stretch': 1,
    'letter-spacing': 1, 'line-height': 1,
    'list-style': 1, 'list-style-image': 1, 'list-style-position': 1, 'list-style-type': 1,
    'orphans': 1, 'widows': 1, 'quotes': 1, 'tab-size': 1,
    'text-align': 1, 'text-align-last': 1, 'text-indent': 1, 'text-justify': 1,
    'text-shadow': 1, 'text-transform': 1,
    'visibility': 1, 'white-space': 1,
    'word-break': 1, 'word-spacing': 1, 'overflow-wrap': 1,
    'caption-side': 1, 'border-collapse': 1, 'border-spacing': 1,
    'hyphens': 1, 'image-rendering': 1, 'writing-mode': 1
  };

  function collectMatchingRuleProps(rules, el, props) {
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (rule.selectorText && rule.style) {
        var matches = false;
        try { matches = el.matches(rule.selectorText); } catch (e) { matches = false; }
        if (matches) {
          for (var j = 0; j < rule.style.length; j++) {
            props[rule.style[j]] = true;
          }
        }
      } else if (rule.cssRules) {
        collectMatchingRuleProps(rule.cssRules, el, props);
      }
    }
  }

  // Properties actually declared for this element: inline style plus any
  // same-origin stylesheet rule whose selector matches it. Cross-origin
  // stylesheets without CORS headers throw on .cssRules and are skipped, so
  // properties coming purely from such a sheet are misreported as
  // "inherited"/"default" below — a real limitation, not a bug.
  function getOwnDeclaredProps(el) {
    var props = {};
    for (var i = 0; i < el.style.length; i++) {
      props[el.style[i]] = true;
    }
    var sheets = document.styleSheets;
    for (var s = 0; s < sheets.length; s++) {
      var rules;
      try {
        rules = sheets[s].cssRules;
      } catch (e) {
        continue;
      }
      if (!rules) continue;
      collectMatchingRuleProps(rules, el, props);
    }
    return props;
  }

  // Every computed CSS property for the element, split into the same three
  // groups as before (own/inherited/default) but as {label, value} entries
  // instead of pre-joined text lines, so the info panel can render one row
  // per property (with its own copy button) rather than a monospace dump.
  function getAllStyleEntries(el) {
    var cs = getComputedStyle(el);
    var own = getOwnDeclaredProps(el);
    var groups = { own: [], inherited: [], default: [] };
    for (var i = 0; i < cs.length; i++) {
      var prop = cs[i];
      var value = cs.getPropertyValue(prop);
      if (value === '') continue;
      var entry = { label: prop, value: value };
      if (own[prop]) {
        groups.own.push(entry);
      } else if (INHERITED_PROPS[prop]) {
        groups.inherited.push(entry);
      } else {
        groups.default.push(entry);
      }
    }
    return groups;
  }

  function getAllStylesText(el) {
    var groups = getAllStyleEntries(el);
    function toLines(entries) {
      return entries.map(function (f) { return f.label + ': ' + f.value + ';'; });
    }
    var ownLines = toLines(groups.own);
    var inheritedLines = toLines(groups.inherited);
    var defaultLines = toLines(groups.default);
    return [
      '/* Set on this element (' + ownLines.length + ') */',
      ownLines.length ? ownLines.join('\n') : '(none)',
      '',
      '/* Inherited (' + inheritedLines.length + ') */',
      inheritedLines.length ? inheritedLines.join('\n') : '(none)',
      '',
      '/* Browser default (' + defaultLines.length + ') */',
      defaultLines.join('\n')
    ].join('\n');
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
      'font:' + FONT_MONO_11,
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
    hud.setAttribute('data-role', 'hud');
    hud.tabIndex = -1;
    hud.style.cssText = [
      'position:fixed',
      'bottom:0px', 'left:50%',
      'transform:translateX(-50%)'
    ].concat(panelChrome('rgba(20,20,20,1)')).concat([
      'padding:10px 14px',
      'max-width:430px',
      'text-align:center',
      'pointer-events:none'
    ]).join(';');
    hud.innerHTML =
      '<div style="display:none;opacity:.85">Hover: <span data-role="hover">none</span></div>' +
      '<div style="opacity:.85">Selected: <span data-role="selected">none</span></div>' +
      '<div style="opacity:.85">Parent: <span data-role="parent">none</span></div>' +
      '<div style="opacity:.85">Inverted: <span data-role="invert">off</span></div>' +
      '<div style="margin-top:4px;opacity:.85">Undo stack: <span data-role="stack">0</span></div>' +
      '<div data-role="keys"></div>' +
      '<div data-role="elementActions" style="display:none;gap:6px;justify-content:center;flex-wrap:nowrap;margin-top:6px"></div>' +
      '<div data-role="imageActions" style="display:none;gap:6px;justify-content:center;flex-wrap:nowrap;margin-top:6px"></div>' +
      '<div style="font-weight:600;margin-top:6px;color:' + COLOR_DELETE + '">NodeNuker v' + VERSION + '</div>';
    document.documentElement.appendChild(hud);

    var keycapIdSeq = 0;
    function keycapSvgMarkup(color) {
      var uid = 'nnKeycap' + (keycapIdSeq++);
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 192" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;--key-color:' + (color || COLOR_BTN_BG) + '">' +
        '<defs>' +
        '<linearGradient id="' + uid + '-sideShade" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#000000" stop-opacity="0.08"/>' +
        '<stop offset="0.55" stop-color="#000000" stop-opacity="0.14"/>' +
        '<stop offset="0.82" stop-color="#000000" stop-opacity="0.28"/>' +
        '<stop offset="1" stop-color="#000000" stop-opacity="0.42"/>' +
        '</linearGradient>' +
        '<linearGradient id="' + uid + '-sideLight" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/>' +
        '<stop offset="0.22" stop-color="#ffffff" stop-opacity="0"/>' +
        '</linearGradient>' +
        '<radialGradient id="' + uid + '-dish" cx="0.5" cy="0.42" r="0.78">' +
        '<stop offset="0" stop-color="#000000" stop-opacity="0.07"/>' +
        '<stop offset="0.65" stop-color="#000000" stop-opacity="0.02"/>' +
        '<stop offset="1" stop-color="#ffffff" stop-opacity="0.10"/>' +
        '</radialGradient>' +
        '<linearGradient id="' + uid + '-topSheen" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/>' +
        '<stop offset="0.35" stop-color="#ffffff" stop-opacity="0.06"/>' +
        '<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>' +
        '</linearGradient>' +
        '</defs>' +
        '<rect x="0" y="0" width="200" height="192" rx="22" fill="var(--key-color,#f4f4f6)"/>' +
        '<rect x="0" y="0" width="200" height="192" rx="22" fill="url(#' + uid + '-sideShade)"/>' +
        '<rect x="0" y="0" width="200" height="192" rx="22" fill="url(#' + uid + '-sideLight)"/>' +
        '<rect x="0.75" y="0.75" width="198.5" height="190.5" rx="21.25" fill="none" stroke="#000000" stroke-opacity="0.12" stroke-width="1.5"/>' +
        '<rect x="22" y="13" width="156" height="141" rx="15" fill="var(--key-color,#f4f4f6)"/>' +
        '<rect x="22" y="13" width="156" height="141" rx="15" fill="url(#' + uid + '-dish)"/>' +
        '<rect x="22" y="13" width="156" height="141" rx="15" fill="url(#' + uid + '-topSheen)"/>' +
        '<rect x="22" y="13" width="156" height="141" rx="15" fill="none" stroke="#000000" stroke-opacity="0.07" stroke-width="1.2"/>' +
        '<rect x="23.2" y="14.2" width="153.6" height="138.6" rx="13.8" fill="none" stroke="#ffffff" stroke-opacity="0.65" stroke-width="1.4"/>' +
        '</svg>';
    }

    function makeKeyButton(key, label, title, fn, keyColor, compact) {
      var btn = document.createElement('button');
      btn.setAttribute(NS, '1');
      btn.type = 'button';
      btn.title = title;
      if (compact) {
        btn.style.cssText = [
          PTR_AUTO,
          'appearance:none',
          'box-sizing:border-box',
          'position:relative',
          'z-index:0',
          'display:flex',
          'align-items:center',
          'justify-content:center',
          'width:50px',
          'height:48px',
          'min-width:0',
          'min-height:0',
          'padding:0',
          'padding-bottom:10%',
          'background:none',
          'border:0'
        ].join(';');
        btn.insertAdjacentHTML('afterbegin', keycapSvgMarkup(keyColor));
      } else {
        btn.style.cssText = [
          PTR_AUTO,
          'display:flex',
          'flex-direction:column',
          'align-items:center',
          'gap:2px',
          'min-width:32px',
          'background:' + COLOR_BTN_BG,
          'border:1px solid ' + COLOR_BTN_BORDER,
          'border-bottom:3px solid ' + COLOR_BTN_BORDER_BOTTOM,
          'border-radius:6px',
          'padding:5px 8px'
        ].join(';');
      }
      var keyEl = document.createElement('span');
      keyEl.style.cssText = 'font:' + (compact ? 20 : 17) + 'px/1 monospace;color:' + COLOR_HOVER + ';font-weight:700';
      keyEl.textContent = key;
      btn.appendChild(keyEl);
      if (!compact) {
        var divider = document.createElement('span');
        divider.style.cssText = 'align-self:stretch;height:1px;background:' + COLOR_BTN_BORDER;
        var labelEl = document.createElement('span');
        labelEl.style.cssText = 'font:9px/1 monospace;color:' + COLOR_HOVER + ';opacity:.75;text-transform:uppercase;letter-spacing:.03em';
        labelEl.textContent = label;
        btn.appendChild(divider);
        btn.appendChild(labelEl);
      }
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        fn(btn);
      });
      return btn;
    }

    var KEYS = [
      { key: 'Esc', label: 'quit', title: 'Quit: exit NodeNuker completely', fn: deactivate, row: 1, col: 1, color: COLOR_KEY_QUIT },
      { key: 'P', label: 'parent', title: 'Parent: select the parent of the selected element', fn: selectParent, row: 1, col: 3, color: COLOR_KEY_NAV },
      { key: 'Del', label: 'delete', title: 'Delete: remove the hovered/selected element', fn: deleteTarget, row: 1, col: 5, color: COLOR_KEY_ACTION },
      { key: 'B', label: 'back', title: 'Back: select the previous sibling', fn: function () { selectSibling('prev'); }, row: 2, col: 2, color: COLOR_KEY_NAV },
      { key: 'N', label: 'next', title: 'Next: select the next sibling', fn: function () { selectSibling('next'); }, row: 2, col: 4, color: COLOR_KEY_NAV },
      { key: 'I', label: 'invert', title: 'Invert: mark everything except the selected element and its ancestors for removal', fn: toggleInvert, row: 2, col: 5, color: COLOR_KEY_ACTION },
      { key: 'C', label: 'child', title: 'Child: select the first child of the selected element', fn: selectChild, row: 3, col: 3, color: COLOR_KEY_NAV },
      { key: 'Z', label: 'undo', title: 'Undo: restore the last removed element', fn: undo, row: 3, col: 5, color: COLOR_KEY_ACTION }
    ];
    var keysRow = hud.querySelector('[data-role="keys"]');
    keysRow.style.cssText = 'display:grid;grid-template-columns:repeat(5,auto);grid-template-rows:repeat(3,auto);gap:2px;justify-content:center;margin-top:6px';
    KEYS.forEach(function (k) {
      var btn = makeKeyButton(k.key, k.label, k.title, k.fn, k.color, true);
      btn.style.gridRow = k.row;
      btn.style.gridColumn = k.col;
      keysRow.appendChild(btn);
    });

    var ELEMENT_ACTIONS = [
      { key: '</>', label: 'copy html', title: 'Copy HTML: copy the selected element\'s outerHTML to the clipboard', fn: function (btn) { copyHtml(btn); } },
      { key: 'Aa', label: 'copy text', title: 'Copy text: copy the selected element\'s rendered visible text (element.innerText) to the clipboard', fn: function (btn) { copyElementText(btn); } },
      { key: 'ⓘ', label: 'info', title: 'Info: show font, color, background and href values for the selected element in a separate panel, with an option to view and copy all computed styles', fn: function () { toggleInfoPanel(); } }
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

  function buildInfoPanel() {
    var panel = document.createElement('div');
    panel.setAttribute(NS, '1');
    panel.setAttribute('data-role', 'infoPanel');
    panel.style.cssText = [
      'position:fixed',
      'top:20px', 'right:20px',
      'width:320px',
      'max-height:70vh',
      'overflow:auto'
    ].concat(panelChrome('rgba(20,20,20,.97)')).concat([
      'padding:12px 14px',
      'pointer-events:auto',
      'display:none'
    ]).join(';');
    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px">' +
        '<button type="button" data-role="infoBack" title="Back" style="' + smallIconBtnStyle() + ';display:none">←</button>' +
        '<strong data-role="infoTitle" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">Element info</strong>' +
        '<button type="button" data-role="infoClose" title="Close" style="' + smallIconBtnStyle(COLOR_TEXT, 16) + '">×</button>' +
      '</div>' +
      '<div data-role="infoBody"></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px">' +
        '<button type="button" data-role="infoCopyAll" style="' + toolbarBtnStyle() + '">Copy all</button>' +
        '<button type="button" data-role="infoToggleAll" style="' + toolbarBtnStyle() + '">Show all styles</button>' +
      '</div>';
    document.documentElement.appendChild(panel);
    var api = {
      root: panel,
      back: panel.querySelector('[data-role="infoBack"]'),
      title: panel.querySelector('[data-role="infoTitle"]'),
      close: panel.querySelector('[data-role="infoClose"]'),
      body: panel.querySelector('[data-role="infoBody"]'),
      copyAll: panel.querySelector('[data-role="infoCopyAll"]'),
      toggleAll: panel.querySelector('[data-role="infoToggleAll"]')
    };
    api.close.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      hideInfoPanel();
    });
    return api;
  }

  // Fixed top-left toolbar, mirroring the HUD's pattern of a
  // pointer-events:none wrapper with pointer-events:auto buttons inside —
  // one button per row: Settings and the standalone unit converter are two
  // separate, equally-ranked entry points, each opening its own panel.
  function buildSettingsToolbar() {
    var toolbar = document.createElement('div');
    toolbar.setAttribute(NS, '1');
    toolbar.setAttribute('data-role', 'settingsToolbar');
    toolbar.style.cssText = [
      'position:fixed', 'top:20px', 'left:0',
      'display:flex', 'flex-direction:column', 'gap:6px',
      'z-index:' + Z_INDEX,
      'pointer-events:none'
    ].join(';');
    document.documentElement.appendChild(toolbar);

    function makeToolbarButton(glyph, title, onClick) {
      var btn = document.createElement('button');
      btn.setAttribute(NS, '1');
      btn.type = 'button';
      btn.title = title;
      btn.style.cssText = [
        PTR_AUTO,
        'appearance:none',
        'box-sizing:border-box',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'flex:none',
        'width:36px',
        'height:36px',
        'min-width:0',
        'min-height:0',
        'font-size:16px',
        'background:' + COLOR_BTN_BG,
        'border:1px solid ' + COLOR_BTN_BORDER,
        'border-bottom:3px solid ' + COLOR_BTN_BORDER_BOTTOM,
        'border-radius:6px',
        'color:' + COLOR_TEXT
      ].join(';');
      btn.textContent = glyph;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      return btn;
    }

    toolbar.appendChild(makeToolbarButton('⚙', 'Settings', toggleSettingsPanel));
    toolbar.appendChild(makeToolbarButton('⇄', 'Unit converter', toggleConverterPanel));

    return { root: toolbar };
  }

  function buildSettingsPanel() {
    var panel = document.createElement('div');
    panel.setAttribute(NS, '1');
    panel.setAttribute('data-role', 'settingsPanel');
    panel.style.cssText = [
      'position:fixed',
      'top:20px', 'left:50px',
      'width:280px',
      'max-height:70vh',
      'overflow:auto'
    ].concat(panelChrome('rgba(20,20,20,.97)')).concat([
      'padding:12px 14px',
      'pointer-events:auto',
      'display:none'
    ]).join(';');
    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">' +
        '<strong style="flex:1">Settings</strong>' +
        '<button type="button" data-role="settingsClose" title="Close" style="' + smallIconBtnStyle(COLOR_TEXT, 16) + '">×</button>' +
      '</div>' +
      '<label style="display:flex;align-items:center;gap:6px;cursor:pointer">' +
        '<input type="checkbox" data-role="autoOpenInfo">' +
        '<span>Open info panel automatically on first selection</span>' +
      '</label>';
    document.documentElement.appendChild(panel);

    var api = {
      root: panel,
      close: panel.querySelector('[data-role="settingsClose"]'),
      autoOpenCheckbox: panel.querySelector('[data-role="autoOpenInfo"]')
    };
    api.close.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      hideSettingsPanel();
    });
    api.autoOpenCheckbox.checked = !!state.settings.autoOpenInfoPanel;
    api.autoOpenCheckbox.addEventListener('change', function () {
      state.settings.autoOpenInfoPanel = api.autoOpenCheckbox.checked;
      saveSettings(state.settings);
    });
    return api;
  }

  function showSettingsPanel() {
    if (!state.settingsPanel) state.settingsPanel = buildSettingsPanel();
    state.settingsPanelOpen = true;
    state.settingsPanel.root.style.display = 'block';
  }

  function hideSettingsPanel() {
    state.settingsPanelOpen = false;
    if (state.settingsPanel) state.settingsPanel.root.style.display = 'none';
  }

  function toggleSettingsPanel() {
    if (state.settingsPanelOpen) {
      hideSettingsPanel();
    } else {
      showSettingsPanel();
    }
  }

  // Standalone unit converter: independent of any selected element, reusing
  // the same getValueConversions() logic as the click-to-convert feature in
  // "Show all styles".
  function buildConverterPanel() {
    var panel = document.createElement('div');
    panel.setAttribute(NS, '1');
    panel.setAttribute('data-role', 'converterPanel');
    panel.style.cssText = [
      'position:fixed',
      'top:20px', 'left:340px',
      'width:280px',
      'max-height:70vh',
      'overflow:auto'
    ].concat(panelChrome('rgba(20,20,20,.97)')).concat([
      'padding:12px 14px',
      'pointer-events:auto',
      'display:none'
    ]).join(';');
    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">' +
        '<strong style="flex:1">Unit converter</strong>' +
        '<button type="button" data-role="converterClose" title="Close" style="' + smallIconBtnStyle(COLOR_TEXT, 16) + '">×</button>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">' +
        '<label style="flex:1;display:flex;align-items:center;gap:6px;opacity:.85">' +
          '<span style="white-space:nowrap">Root font-size</span>' +
          '<input type="number" data-role="converterRoot" min="1" step="0.1" style="width:60px;box-sizing:border-box' +
            ';background:' + COLOR_BTN_BG + ';border:1px solid ' + COLOR_BTN_BORDER +
            ';border-radius:6px;color:' + COLOR_TEXT + ';padding:4px 6px;font:11px monospace">' +
          '<span>px</span>' +
        '</label>' +
        '<button type="button" data-role="converterRootReset" title="Reset to current page root font-size" style="' + smallIconBtnStyle() + '">↻</button>' +
      '</div>' +
      '<input type="text" data-role="converterInput" placeholder="e.g. 16px, rgb(0,0,0), #fff" style="display:block;width:100%;box-sizing:border-box' +
        ';background:' + COLOR_BTN_BG + ';border:1px solid ' + COLOR_BTN_BORDER +
        ';border-radius:6px;color:' + COLOR_TEXT + ';padding:4px 8px;font:11px monospace;margin-bottom:8px">' +
      '<div data-role="converterResult"></div>';
    document.documentElement.appendChild(panel);

    var api = {
      root: panel,
      close: panel.querySelector('[data-role="converterClose"]'),
      input: panel.querySelector('[data-role="converterInput"]'),
      result: panel.querySelector('[data-role="converterResult"]'),
      rootInput: panel.querySelector('[data-role="converterRoot"]'),
      rootReset: panel.querySelector('[data-role="converterRootReset"]')
    };
    api.rootInput.value = getRootFontSizePx() || 16;

    function recompute() {
      var value = api.input.value;
      api.result.innerHTML = '';
      if (!value) return;
      var rootPx = parseFloat(api.rootInput.value);
      if (!(rootPx > 0)) rootPx = null;
      var conversions = isConvertibleValue(value) ? getValueConversions(value, rootPx) : null;
      if (!conversions || !conversions.length) {
        var msg = document.createElement('div');
        msg.style.cssText = 'opacity:.6;padding:3px 0';
        msg.textContent = 'No conversion available';
        api.result.appendChild(msg);
        return;
      }
      conversions.forEach(function (cv) {
        renderInfoRow(api.result, cv.label, cv.value);
      });
    }

    api.close.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      hideConverterPanel();
    });
    api.input.addEventListener('input', recompute);
    api.rootInput.addEventListener('input', recompute);
    api.rootReset.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      api.rootInput.value = getRootFontSizePx() || 16;
      recompute();
    });
    return api;
  }

  function showConverterPanel() {
    if (!state.converterPanel) state.converterPanel = buildConverterPanel();
    state.converterPanelOpen = true;
    state.converterPanel.root.style.display = 'block';
  }

  function hideConverterPanel() {
    state.converterPanelOpen = false;
    if (state.converterPanel) state.converterPanel.root.style.display = 'none';
  }

  function toggleConverterPanel() {
    if (state.converterPanelOpen) {
      hideConverterPanel();
    } else {
      showConverterPanel();
    }
  }

  // Converts a computed-style value (color or px length) into alternative
  // representations for the click-to-convert feature in "Show all styles".
  // Returns null when the value isn't a recognized, convertible format.
  function toHex2(n) {
    var h = n.toString(16);
    return h.length === 1 ? '0' + h : h;
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
  }

  function getRootFontSizePx() {
    var m = /^([\d.]+)px$/.exec(getComputedStyle(document.documentElement).fontSize);
    return m ? parseFloat(m[1]) : null;
  }

  // rootPx overrides the root font-size used for px->rem (used by the
  // standalone converter panel, where the current page's actual root
  // font-size is often not what the user means). When omitted, falls back
  // to the current page's live root font-size — correct for the info
  // panel's click-to-convert, which converts a value actually taken from
  // that page.
  function getValueConversions(value, rootPx) {
    var v = value.trim();
    var c = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/i.exec(v);
    if (c) {
      var r = parseInt(c[1], 10), g = parseInt(c[2], 10), b = parseInt(c[3], 10);
      var a = c[4] !== undefined ? parseFloat(c[4]) : 1;
      var hsl = rgbToHsl(r, g, b);
      return [
        { label: 'hex', value: '#' + toHex2(r) + toHex2(g) + toHex2(b) },
        { label: 'rgb', value: 'rgb(' + r + ', ' + g + ', ' + b + ')' },
        { label: 'rgba', value: 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')' },
        { label: 'hsl', value: 'hsl(' + hsl[0] + ', ' + hsl[1] + '%, ' + hsl[2] + '%)' },
        { label: 'hsla', value: 'hsla(' + hsl[0] + ', ' + hsl[1] + '%, ' + hsl[2] + '%, ' + a + ')' }
      ];
    }
    var px = /^(-?[\d.]+)px$/.exec(v);
    if (px) {
      var root = (typeof rootPx === 'number' && rootPx > 0) ? rootPx : getRootFontSizePx();
      if (root) {
        var rem = Math.round((parseFloat(px[1]) / root) * 10000) / 10000;
        return [{ label: 'rem', value: rem + 'rem' }];
      }
    }
    return null;
  }

  // Cheap, getComputedStyle-free check used at render time to decide whether
  // a value gets the clickable/underline styling — the actual conversion
  // (and the getComputedStyle(document.documentElement) call it requires for
  // px->rem) is deferred to the click handler in renderInfoRow, since running
  // it eagerly for every one of the ~300+ rows in "Show all styles" forces
  // repeated style/layout recalculation of the whole host page.
  function isConvertibleValue(value) {
    var v = value.trim();
    return /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+)?\s*\)$/i.test(v) ||
      /^-?[\d.]+px$/.test(v);
  }

  function renderInfoRow(container, label, value, extraBtn, convertible) {
    var wrap = document.createElement('div');
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;gap:10px;align-items:baseline;padding:3px 0;border-bottom:1px solid #333';
    var labelEl = document.createElement('span');
    labelEl.style.cssText = 'opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto;max-width:50%';
    labelEl.textContent = label;
    labelEl.title = label;
    var valueEl = document.createElement('span');
    valueEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;text-align:right';
    valueEl.textContent = value;
    valueEl.title = value;
    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = '⧉';
    copyBtn.title = 'Copy ' + label;
    copyBtn.style.cssText = smallIconBtnStyle() + ';margin-left:6px';
    copyBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      copyText(value, valueEl);
    });
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    row.appendChild(copyBtn);
    if (extraBtn) row.appendChild(extraBtn);
    wrap.appendChild(row);

    if (convertible && isConvertibleValue(value)) {
      valueEl.style.cursor = 'pointer';
      valueEl.style.textDecoration = 'underline dotted';
      valueEl.title = value + ' (click to convert)';
      var convBox = null;
      valueEl.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!convBox) {
          var conversions = getValueConversions(value);
          if (!conversions || !conversions.length) return;
          convBox = document.createElement('div');
          convBox.style.cssText = 'display:none;padding:2px 0 2px 10px;margin-bottom:4px;border-left:2px solid ' + COLOR_BTN_BORDER;
          conversions.forEach(function (cv) {
            renderInfoRow(convBox, cv.label, cv.value);
          });
          wrap.appendChild(convBox);
        }
        convBox.style.display = convBox.style.display === 'none' ? 'block' : 'none';
      });
    }

    container.appendChild(wrap);
  }

  // Small inline button rendered next to the "style" attribute row, opening
  // a per-declaration breakdown of just that attribute (not the unrelated
  // "Show all styles" computed own/inherited/default view).
  function makeStyleDetailButton(panel, el) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '⋯';
    btn.title = 'Show inline style declarations individually';
    btn.style.cssText = smallIconBtnStyle() + ';margin-left:6px';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      state.infoView = 'style';
      renderStyleDetail(panel, el);
    });
    return btn;
  }

  // Shared "go back to the main attribute list" action, wired to both the
  // top infoBack button and the bottom toggleAll button (labeled "← Back")
  // whenever a sub-view (style detail, all styles) is showing.
  function backToQuickInfo(panel, el) {
    return function () {
      state.infoView = 'quick';
      renderQuickInfo(panel, el);
    };
  }

  function renderQuickInfo(panel, el) {
    panel.title.textContent = 'Info: ' + describe(el);
    panel.back.style.display = 'none';
    panel.body.setAttribute('data-view', 'quick');
    panel.body.innerHTML = '';
    var fields = getElementAttributes(el);
    if (!fields.length) {
      var empty = document.createElement('div');
      empty.style.opacity = '.7';
      empty.textContent = '(no attributes)';
      panel.body.appendChild(empty);
    } else {
      fields.forEach(function (f) {
        var extra = f.label === 'style' ? makeStyleDetailButton(panel, el) : null;
        renderInfoRow(panel.body, f.label, f.value, extra);
      });
    }
    panel.toggleAll.textContent = 'Show all styles';
    panel.copyAll.onclick = function () {
      var text = fields.map(function (f) { return f.label + ': ' + f.value; }).join('\n');
      copyText(text, panel.copyAll);
    };
    panel.toggleAll.onclick = function () {
      state.infoView = 'all';
      renderAllStyles(panel, el);
    };
  }

  function renderStyleDetail(panel, el) {
    panel.title.textContent = 'Inline style: ' + describe(el);
    panel.back.style.display = '';
    panel.back.onclick = backToQuickInfo(panel, el);
    panel.body.setAttribute('data-view', 'style');
    panel.body.innerHTML = '';
    var entries = getInlineStyleEntries(el);
    if (!entries.length) {
      var empty = document.createElement('div');
      empty.style.opacity = '.7';
      empty.textContent = '(no inline style declarations)';
      panel.body.appendChild(empty);
    } else {
      entries.forEach(function (f) {
        renderInfoRow(panel.body, f.label, f.value);
      });
    }
    panel.toggleAll.textContent = '← Back';
    panel.copyAll.onclick = function () {
      var text = entries.map(function (f) { return f.label + ': ' + f.value + ';'; }).join('\n');
      copyText(text, panel.copyAll);
    };
    panel.toggleAll.onclick = backToQuickInfo(panel, el);
  }

  function renderStyleGroup(container, name, title, entries, collapsed, onToggle) {
    var group = document.createElement('div');
    group.id = 'style-group-' + name;

    var header = document.createElement('div');
    header.id = 'style-group-toggle-' + name;
    header.style.cssText = 'opacity:.55;text-transform:uppercase;letter-spacing:.04em;font-size:10px;font-weight:700;margin:10px 0 2px' +
      (onToggle ? ';cursor:pointer;user-select:none' : '');
    header.textContent = (onToggle ? (collapsed ? '▸ ' : '▾ ') : '') + title + ' (' + entries.length + ')';
    if (onToggle) header.addEventListener('click', onToggle);
    group.appendChild(header);

    if (!collapsed) {
      if (!entries.length) {
        var empty = document.createElement('div');
        empty.style.opacity = '.7';
        empty.textContent = '(none)';
        group.appendChild(empty);
      } else {
        entries.forEach(function (f) { renderInfoRow(group, f.label, f.value, null, true); });
      }
    }

    container.appendChild(group);
  }

  function renderAllStyles(panel, el) {
    panel.title.textContent = 'All styles: ' + describe(el);
    panel.back.style.display = '';
    panel.back.onclick = backToQuickInfo(panel, el);
    panel.body.setAttribute('data-view', 'all');
    var groups = getAllStyleEntries(el);
    panel.body.innerHTML = '';

    var search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Filter styles…';
    search.style.cssText = 'pointer-events:auto;display:block;width:100%;box-sizing:border-box' +
      ';background:' + COLOR_BTN_BG + ';border:1px solid ' + COLOR_BTN_BORDER +
      ';border-radius:6px;color:' + COLOR_TEXT + ';padding:4px 8px;font:11px monospace;margin-bottom:8px';
    panel.body.appendChild(search);

    var list = document.createElement('div');
    panel.body.appendChild(list);

    var collapsedState = { own: false, inherited: true, def: true };

    function renderFiltered() {
      var q = search.value.trim().toLowerCase();
      function matching(entries) {
        if (!q) return entries;
        return entries.filter(function (f) { return f.label.toLowerCase().indexOf(q) !== -1; });
      }
      list.innerHTML = '';
      renderStyleGroup(list, 'own', 'Set on this element', matching(groups.own), collapsedState.own, function () {
        collapsedState.own = !collapsedState.own;
        renderFiltered();
      });
      renderStyleGroup(list, 'inherited', 'Inherited', matching(groups.inherited), collapsedState.inherited, function () {
        collapsedState.inherited = !collapsedState.inherited;
        renderFiltered();
      });
      renderStyleGroup(list, 'default', 'Browser default', matching(groups.default), collapsedState.def, function () {
        collapsedState.def = !collapsedState.def;
        renderFiltered();
      });
    }
    search.addEventListener('input', renderFiltered);
    renderFiltered();

    panel.toggleAll.textContent = '← Back';
    panel.copyAll.onclick = function () {
      copyText(getAllStylesText(el), panel.copyAll);
    };
    panel.toggleAll.onclick = backToQuickInfo(panel, el);
  }

  function showInfoPanel() {
    if (!state.selected) return;
    if (!state.infoPanel) state.infoPanel = buildInfoPanel();
    state.infoPanelOpen = true;
    state.infoView = 'quick';
    state.infoPanel.root.style.display = 'block';
    renderQuickInfo(state.infoPanel, state.selected);
  }

  function hideInfoPanel() {
    state.infoPanelOpen = false;
    if (state.infoPanel) state.infoPanel.root.style.display = 'none';
  }

  function toggleInfoPanel() {
    if (state.infoPanelOpen) {
      hideInfoPanel();
    } else {
      showInfoPanel();
    }
  }

  function updateInfoPanel() {
    if (!state.infoPanelOpen) return;
    if (!state.selected) {
      hideInfoPanel();
      return;
    }
    if (state.infoView === 'all') {
      renderAllStyles(state.infoPanel, state.selected);
    } else if (state.infoView === 'style') {
      renderStyleDetail(state.infoPanel, state.selected);
    } else {
      renderQuickInfo(state.infoPanel, state.selected);
    }
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
    if (state.settings.autoOpenInfoPanel && !state.autoOpenedInfoPanel) {
      state.autoOpenedInfoPanel = true;
      showInfoPanel();
    } else {
      updateInfoPanel();
    }
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
      updateInfoPanel();
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
    updateInfoPanel();
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
    updateInfoPanel();
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
    updateInfoPanel();
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
    updateInfoPanel();
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
    if (isOwnUI(e.target)) return;
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

  // Returning to the browser window/tab after switching away (another app,
  // another tab) can leave keyboard focus stuck on browser chrome (e.g. the
  // address bar) rather than the page, which silently swallows NodeNuker's
  // keydown shortcuts until the user clicks into the page. Pulling focus
  // onto the (invisible, tabIndex:-1) HUD root on window focus avoids that.
  function onWindowFocus() {
    if (state.hud && state.hud.root) {
      try { state.hud.root.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  function activate() {
    state.hoverBox = makeBox(COLOR_HOVER);
    state.selectBox = makeBox(COLOR_DELETE, false, true);
    state.parentBox = makeBox(COLOR_PARENT, true);
    state.hud = buildHud();
    state.settingsToolbar = buildSettingsToolbar();
    updateHud();
    updateImageState();

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize, true);
    window.addEventListener('focus', onWindowFocus);
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
    window.removeEventListener('focus', onWindowFocus);
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
