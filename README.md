# NodeNuker

A tool for interactively picking, deleting, and undoing DOM elements on any page — no dependencies, available as a bookmarklet or a userscript.

Current version: **1.2.1**

## Install

Open [`index.html`](index.html) in a browser and pick one of three install methods — all three run the exact same NodeNuker code and behave identically, they only differ in delivery/update mechanism:

1. **Direct bookmarklet** — drag the **🚀 NodeNuker** button to your bookmarks bar. Simplest option, nothing else to install. Downside: every new version needs the button dragged again to replace the old one.
2. **Loader bookmarklet** — drag the **🚀 NodeNuker (auto-update)** button instead. On every click it injects a `<script>` tag pointing at `https://gf-ntiedt.github.io/nodenuker/nodenuker.js` — the current `nodenuker.js` from this repo's `main` branch, served live via GitHub Pages, with a cache-busting `?t=` timestamp so it's never a stale cached copy. Never needs re-adding. Limitation: blocked on pages whose CSP disallows scripts from `gf-ntiedt.github.io`.
3. **Userscript** (Violentmonkey / Tampermonkey) — install a userscript manager first: [Violentmonkey](https://violentmonkey.github.io/) (open source; [Chrome Web Store](https://chrome.google.com/webstore/detail/violent-monkey/jinjaccalgkegednnccohejagnlnfdag), [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/violentmonkey/), [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/eeagobfjdenkkddmbclomhiblgggliao)) or [Tampermonkey](https://www.tampermonkey.net/) (closed source; [App Store](https://apps.apple.com/app/tampermonkey/id6738342400), paid, iOS 15+/macOS 11+; the only one of the two covering all four browsers). Then open [`nodenuker.user.js`](nodenuker.user.js) — the manager offers to install it. Runs on every page, updates itself automatically via `@updateURL`, and is toggled on/off from the manager's toolbar menu (**Toggle NodeNuker**) instead of a bookmarks bar click.

Chrome hides the bookmarks bar by default. Show it with `Ctrl+Shift+B` (`Cmd+Shift+B` on macOS), or via the menu (⋮ → Bookmarks and lists → Show bookmarks bar), before dragging a bookmarklet button.

## Usage

1. Click the bookmarklet on any page to activate it (or use the userscript manager's **Toggle NodeNuker** menu command).
2. Hover over elements — the one under the cursor is outlined in blue.
3. Click an element to select it (outlined in red). Its direct parent is shown with a dashed purple outline — a preview of what `p` would select next.
4. The HUD at the bottom of the page shows keyboard-key-styled buttons for every command — click one directly instead of pressing the key, if you prefer. Hover over any button for a fuller description (native tooltip).

| Key | Button label | Action |
|---|---|---|
| `Delete` / `Backspace` | `Del` / delete | Remove the element currently under the cursor (falls back to the clicked/selected element if the cursor isn't over anything trackable, or removes the whole inverted selection if invert mode is active). Kept on an undo stack. |
| `z` | `z` / undo | Undo the last removal |
| `p` | `p` / parent | Select the parent of the currently selected element (recomputes the inverted selection if invert mode is active) |
| `c` | `c` / child | Select the first child of the currently selected element, if one exists |
| `b` | `b` / back | Select the previous sibling of the currently selected element, if one exists |
| `n` | `n` / next | Select the next sibling of the currently selected element, if one exists |
| `i` | `i` / invert | Invert the selection (see below); press again to leave invert mode |
| `Esc` | `Esc` / quit | Exit NodeNuker completely (removes all listeners and UI) |

You don't need to click first — hovering over an element and pressing `Delete` removes it directly. Click is needed for `p`/`c`/`b`/`n` (parent/child/sibling navigation) and `i` (invert), which all operate on the clicked/selected element.

The live "Hover" readout in the HUD is currently hidden; the HUD still shows Selected, Parent and Inverted state plus the undo stack count.

### Invert selection (`i`)

With an element selected (click), pressing `i` selects everything **else** in the document — except the selected element and its chain of ancestors, which are kept and highlighted green. Concretely: at every level from the selected element up to `<html>`, all sibling elements that are *not* on that ancestor path are marked (in red) for removal; their entire subtree comes along automatically, so nothing needs to be selected individually within them.

This effectively works like an "isolate this element" mode — pressing `Delete` afterwards strips away everything except the selected element and the container chain that leads to it.

- If a given level has more than 6 non-path siblings, NodeNuker highlights the containing parent as a single box instead of drawing one box per sibling (purely visual — each sibling is still deleted individually, the parent itself is never touched).
- Pressing `p` while inverted moves the anchor to its parent and recomputes the inverted selection live.
- Clicking a different element exits invert mode and starts a fresh single selection.
- `Delete` while inverted removes every element in the inverted selection in one go (each pushed onto the undo stack individually, so `z` undoes them one at a time).

Running the bookmarklet again (or the userscript's toggle menu command) while it's active toggles it off, same as `Esc`.

### Image actions (`↗` open / `⬇` download)

When the selected element (via click or `p`) is an `<img>`, or any element with a CSS `background-image`, two extra buttons appear in the HUD:

- `↗` opens the image in a new tab.
- `⬇` downloads it (suggested filename taken from the URL's last path segment, falling back to `image`).

These buttons only appear when applicable and disappear again once a non-image element is selected.

**Limitation:** the download button uses a plain `<a download>` link. For images that are cross-origin and don't send permissive CORS headers, browsers ignore the `download` attribute and open the image in a new tab instead — this is a browser security restriction, not a bug.

### Copy HTML (`</>`)

Whenever an element is selected, a `</>` / `copy html` button appears in the HUD. Clicking it copies the selected element's full `outerHTML` to the clipboard (via the Clipboard API, with a `document.execCommand('copy')` fallback for contexts where it's unavailable). The button label briefly flashes "copied!" as confirmation.

### Copy text (`Aa`)

Whenever an element is selected, an `Aa` / `copy text` button appears alongside `copy html`. Clicking it copies `element.innerText` — the rendered, visible text only (respects `display:none`/`visibility:hidden`, converts line breaks the way they'd appear on screen) — to the clipboard.

### Element info (`ⓘ`)

Whenever an element is selected, an `ⓘ` / `info` button appears in the HUD. Clicking it opens a separate panel (top-right corner) showing a curated set of computed values for that element, each with its own copy button:

- **ID**, **Class** — shown only when the element actually has one.
- **Font size** — the actual computed pixel value plus its rem equivalent, calculated against the document's actual root (`<html>`) font size, not a hardcoded 16px.
- **Font family**, **Font weight**, **Color** — the latter shown alongside its hex equivalent when it can be parsed from the computed `rgb()`/`rgba()` value.
- **Background** — same rgb()/hex pairing, only shown when the element actually has a non-transparent background color.
- **Href** — only shown for `<a>` elements that have one.

The panel updates automatically as the selection changes (via click, `p`, `c`, `b`, `n`, or `z`) while it's open, and stays open across those changes until closed with its `×` button. A `Copy all` button copies every visible field at once. A `Show all styles` button switches the panel to a scrollable, monospace dump of every computed CSS property for the element, grouped into three sections: **Set on this element** (declared via inline style or a matching same-origin stylesheet rule), **Inherited** (a standard-CSS-inherited property whose value comes from an ancestor), and **Browser default** (neither of the above). Its own `Copy all styles` button copies the full grouped dump; `← Back` returns to the curated view.

**Limitation:** the "Set on this element" detection can't read cross-origin stylesheets that don't send permissive CORS headers (`stylesheet.cssRules` throws and is silently skipped) — a property declared only in such a stylesheet is misclassified as "Inherited" or "Browser default" instead. `@media`/`@supports` conditions also aren't evaluated, so a property inside a currently-non-matching conditional block is still counted as set.

## Notes / limitations

- Changes only affect the live DOM in the current tab; reloading the page restores the original markup.
- `<html>` and `<body>` are protected and cannot be deleted.
- Only operates on the top-level document — elements inside `<iframe>` documents are not reachable.
- The undo stack lives in memory only and is lost when NodeNuker is deactivated or the page is reloaded.
- Image detection only recognizes `<img>` elements and the first `url(...)` in `background-image`; SVG `<image>` elements and multiple stacked background images are not specially handled.

## Files

- [`nodenuker.js`](nodenuker.js) — readable source, the single source of truth for all three install methods.
- [`build.js`](build.js) — regenerates all three artifacts below and updates the bookmarklet links in `index.html`. Run `node build.js` after editing `nodenuker.js`.
- [`bookmarklet.uri.txt`](bookmarklet.uri.txt) — the generated direct-bookmarklet `javascript:` URI, kept in sync via the build script.
- [`bookmarklet-loader.uri.txt`](bookmarklet-loader.uri.txt) — the generated loader-bookmarklet `javascript:` URI.
- [`nodenuker.user.js`](nodenuker.user.js) — the generated Violentmonkey/Tampermonkey userscript.
- [`index.html`](index.html) — install page with all three install options and instructions.

## Disclaimer

NodeNuker is provided **as is**, with no warranty of any kind. It only modifies the live, in-memory DOM of the current browser tab — nothing is transmitted, stored, or saved anywhere, and reloading the page restores the original markup. You are solely responsible for how and where you use it. The authors accept no liability for any consequences of using this tool.

## License

GPL-3.0-or-later — see [`LICENSE`](LICENSE). Copyright (C) 2026 Gedankenfolger GmbH.

## Verification status

- The generated bookmarklet source is checked for syntax errors (`new Function(source)` in Node) after every build.
- Tested in Firefox 152.0.5 and Chrome 150.0.7871.115.
- Not yet tested in other browsers.
