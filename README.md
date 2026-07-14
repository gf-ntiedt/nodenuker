# NodeNuker

A bookmarklet for interactively picking, deleting, and undoing DOM elements on any page — no extension, no dependencies, just drag-and-drop.

Current version: **1.0.1**

## Install

Open [`index.html`](index.html) in a browser and drag the **🚀 NodeNuker** button to your bookmarks bar.

Chrome hides the bookmarks bar by default. Show it with `Ctrl+Shift+B` (`Cmd+Shift+B` on macOS), or via the menu (⋮ → Bookmarks and lists → Show bookmarks bar), before dragging the button.

## Usage

1. Click the bookmarklet on any page to activate it.
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

Running the bookmarklet again while it's active toggles it off, same as `Esc`.

### Image actions (`↗` open / `⬇` download)

When the selected element (via click or `p`) is an `<img>`, or any element with a CSS `background-image`, two extra buttons appear in the HUD:

- `↗` opens the image in a new tab.
- `⬇` downloads it (suggested filename taken from the URL's last path segment, falling back to `image`).

These buttons only appear when applicable and disappear again once a non-image element is selected.

**Limitation:** the download button uses a plain `<a download>` link. For images that are cross-origin and don't send permissive CORS headers, browsers ignore the `download` attribute and open the image in a new tab instead — this is a browser security restriction, not a bug.

### Copy HTML (`</>`)

Whenever an element is selected, a `</>` / `copy html` button appears in the HUD. Clicking it copies the selected element's full `outerHTML` to the clipboard (via the Clipboard API, with a `document.execCommand('copy')` fallback for contexts where it's unavailable). The button label briefly flashes "copied!" as confirmation.

## Notes / limitations

- Changes only affect the live DOM in the current tab; reloading the page restores the original markup.
- `<html>` and `<body>` are protected and cannot be deleted.
- Only operates on the top-level document — elements inside `<iframe>` documents are not reachable.
- The undo stack lives in memory only and is lost when NodeNuker is deactivated or the page is reloaded.
- Image detection only recognizes `<img>` elements and the first `url(...)` in `background-image`; SVG `<image>` elements and multiple stacked background images are not specially handled.

## Files

- [`nodenuker.js`](nodenuker.js) — readable source, the single source of truth.
- [`build.js`](build.js) — regenerates `bookmarklet.uri.txt` and updates the link in `index.html`. Run `node build.js` after editing `nodenuker.js`.
- [`bookmarklet.uri.txt`](bookmarklet.uri.txt) — the generated `javascript:` URI, kept in sync via the build script.
- [`index.html`](index.html) — install page with the draggable bookmarklet link and instructions.

## Disclaimer

NodeNuker is provided **as is**, with no warranty of any kind. It only modifies the live, in-memory DOM of the current browser tab — nothing is transmitted, stored, or saved anywhere, and reloading the page restores the original markup. You are solely responsible for how and where you use it. The authors accept no liability for any consequences of using this tool.

## License

GPL-3.0-or-later — see [`LICENSE`](LICENSE). Copyright (C) 2026 Gedankenfolger GmbH.

## Verification status

- The generated bookmarklet source is checked for syntax errors (`new Function(source)` in Node) after every build.
- Tested in Firefox 152.0.5 and Chrome 150.0.7871.115.
- Not yet tested in other browsers.
