# Cairn — how it works

No framework, no build step — `index.html` + `styles.css` + `script.js` (+ `assets/icons.js` for the vendored icon set, `assets/logo.svg` for the app icon). Everything runs from `localStorage`; open `index.html` directly in a browser.

## Rendering, in general

There's no virtual DOM or diffing. `render()` in `script.js` is a full teardown-and-rebuild: every call removes all `.node` divs and clears the SVG, then recreates everything from `state` (the in-memory data model — see below) plus `computeLayout()`. That's simple and fast enough at the map sizes a person would build by hand, and it sidesteps a whole class of "stale DOM" bugs, at the cost of being wasteful at large scale (not a concern here).

## Node representation

`state.nodes` is a flat object keyed by ID: `{id, parentId, label, text, children: [ids], color?}`. It's a tree, not a general graph — every node has exactly one parent (except root, `parentId: null`).

Layout is computed separately from this data by `computeLayout()`: it walks the tree recursively, giving each node an angular slice of the circle proportional to how many leaf descendants it has (`leafCount()`), then places it at `(cos(angle)*radius, sin(angle)*radius)`, where radius grows with depth. That's a classic radial-tree layout — it's what makes deep branches automatically fan out without overlapping their siblings.

## Auto-fit ("how does the screen fit automatically")

`fitToView()` runs `computeLayout()`, finds the bounding box of every node's position, and picks a zoom `scale` so that box fits the current `canvas.clientWidth/Height` (clamped between 0.25×–2.5× so it never gets absurd), then centers on the box's midpoint. It's called on load, on window resize, on "New map," on Import, and whenever you click empty space.

## Drag and zoom

There's one `<div id="world">` holding both the SVG edges and all node divs, and everything pans/zooms via a single CSS transform: `translate(panX,panY) scale(scale)`. Dragging the empty canvas just adjusts `panX/panY` on `mousemove`. Scrolling adjusts `scale`, and the pan is recalculated so the point under your cursor stays fixed (standard "zoom toward cursor" math: `panX = cursorX - (cursorX - panX) * (newScale/scale)`).

Clicking a node calls `centerOnNode()`, which computes where that node's position would land on screen and animates the transform there — a `.animate` CSS class temporarily adds a transition so programmatic moves feel smooth, while manual dragging stays instant (no transition) so it doesn't feel laggy.

## Reparenting (dragging a branch onto another node)

This is a second, separate drag system layered on top of canvas panning — the two are mutually exclusive by construction, since a `mousedown` either lands on empty canvas (starts a pan) or on a node (starts a potential reparent), never both.

`mousedown` on a non-root node's body (excluding its control buttons, and skipped entirely while its label is mid-rename) stashes a `dragNode` record `{id, el, startX, startY, active:false, fromPos}` — nothing visible happens yet. A shared `mousemove` listener checks `dragNode` on every move; until the cursor has traveled ~6px it does nothing, which is what lets a plain click still just focus the node. Past that threshold it flips `active` and:
- adds a dashed SVG `<line>` from the node's layout position (`fromPos`) to the cursor, converting screen coordinates to world coordinates with `screenToWorld()` (the inverse of the pan/zoom transform: `(clientX - canvasRect.left - panX) / scale`)
- calls `document.elementFromPoint(cursorX, cursorY)` on every move to find whatever's under the cursor, and checks it with `isDescendantOf()` — a node is a valid drop target only if it isn't the dragged node itself and isn't one of its own descendants (either would create a cycle in the tree)
- toggles a `drop-target` highlight class on the current valid target, if any

`mouseup` reads whatever `targetId` was last computed, tears down the drag visuals, and — if there was a valid target — calls `reparentNode(id, newParentId)`, which just removes the id from the old parent's `children` array and pushes it onto the new one, reassigning a fresh palette color if the new parent is root (mirroring `addChild()`) or dropping the color if not (so it inherits its new branch's color via `getBranchColor()`'s ancestor walk).

The one non-obvious bit: releasing the mouse after a real drag still fires a native `click` event right afterward, which would otherwise immediately re-trigger the normal "focus this node" click handling on whatever's now under the cursor. A short-lived `suppressNextClick` flag (set on `mouseup`, cleared either by the very next click handler or, as a fallback, a `setTimeout(fn, 0)`) swallows exactly that one follow-up click without affecting any click that comes later.

## Highlighted paths

When you focus a node, `pathToRoot()` walks `parentId` links up to the root and collects every ID along the way into a set. During render, any node/edge in that set gets an `active` class (full opacity, thicker stroke, glow); everything else gets `dim` (opacity ~0.16–0.1).

Branch *color* is a separate concept: `getBranchColor()` walks a node up to its top-level ancestor (the direct child of root it descends from) and returns that ancestor's assigned palette color — so every node/edge always renders in its branch's color, and focusing just changes opacity/emphasis on top of that.

## Modals and the text editor

Two overlays exist: `#editorOverlay` (Editing mode, has a toolbar) and `#viewerOverlay` (Presenting mode, read-only). Both are just `contenteditable`/plain `innerHTML` containers — no rich-text library.

Formatting uses the browser's built-in (deprecated but still functional) `document.execCommand`:
- **Ctrl+B** → `execCommand('bold')`
- **Ctrl+H** → a custom `toggleHighlight()` that checks the current selection's computed background color to decide whether to apply or clear the highlight
- **"- " → bullet** — listens to `input` events and tracks a tiny state machine (`start → dash → done`) watching for you typing exactly `-` then a space at the top of a fresh line. When it fires, it does two `execCommand('delete')` calls (like two backspaces) to remove what you typed, then `execCommand('insertUnorderedList')`. This went through a couple of failed approaches first (inspecting DOM siblings, `Selection.modify`) — both tried to infer "start of line" from markup that varies by browser, while this just watches the actual keystrokes.

## Export / import

Export takes `{rootId, nodes}` (not UI-only state like which mode you're in, or `previewsOn`), `JSON.stringify`s it, wraps it in a `Blob`, and triggers a download via a throwaway `<a download>` link. Import reads the chosen file with `FileReader`, `JSON.parse`s it, sanity-checks it has `rootId`/`nodes`, confirms with you since it overwrites everything, then replaces `state` wholesale and re-renders.

## Icons

Vendored locally in `assets/icons.js` as an `ICONS` name → SVG-path-markup map (sourced from Lucide, MIT licensed) — no CDN call, works fully offline. `icon(name)` builds a real `<svg>` element from that map. Static icons declared in the HTML as `<i data-lucide="...">` get swapped for real SVGs once at boot by `hydrateStaticIcons()`, which mirrors what the old `lucide.createIcons()` runtime call used to do.
