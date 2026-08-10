# Cairn

A mind map built for one specific job: helping you talk through something live — an interview, a presentation, a call — without losing your train of thought. Branch out your topics, click through them to stay oriented, and keep your talking points one click away without turning your screen into a wall of text.

No install, no build, no account. It's three files and runs entirely in your browser, offline, with everything saved locally on your machine.

## Getting started

Open `index.html` in a browser. That's it. Your map autosaves to that browser's local storage as you go, so closing the tab and coming back later picks up right where you left off.

## The two modes

The pencil/presentation icon in the top-right switches between them:

- **Editing** — build out your map: add branches, rename them, write notes, delete, drag branches around.
- **Presenting** — a clean view for when you're actually live. No add/delete/rename controls, notes open as plain read-only text instead of an editor. Everything else (clicking, centering, notes) still works.

## Building your map

- **Add a branch** — hover a node and click the **+** icon. New branches focus and open for renaming immediately.
- **Rename** — double-click a node's title.
- **Delete a branch** — hover a node, click the trash icon in the corner (this also deletes everything under it).
- **Move a branch elsewhere** — drag it and drop it onto another node to reconnect it there. A dashed line follows your cursor while dragging, and a valid drop target lights up blue. You can't drop a branch onto itself or onto one of its own children (Editing mode only).
- **Notes** — right-click any node to open its notes. In Editing mode this opens the full editor; in Presenting mode it opens a read-only view (only if that node actually has notes).
  - **Ctrl+B** — bold
  - **Ctrl+H** — toggle a highlight on the selected text
  - Start a line with **"- "** — turns it into a bullet, same as Docs/Notion
  - Click outside the editor, hit Escape, or click **Done** to save. **Cancel** discards.
- **Notes previews** — the eye icon in the header shows/hides a short preview of each node's notes directly on the map. When previews are off, nodes that have notes still show a small icon so you know they're there.

## Getting around

- **Left-click a branch** — highlights its full path back to the root and centers it on screen.
- **Click empty space** (or Escape) — fits the whole map back into view.
- **Drag empty space** — pan around.
- **Scroll** — zoom in/out, centered on your cursor.

Every top-level branch gets its own color, shared by everything underneath it, so you can tell branches apart across the whole map at a glance — not just the one you're currently focused on.

## Backing up your map

The **⋮** menu in the header has:
- **Export map** — downloads your current map as a `.json` file.
- **Import map** — loads a map from a `.json` file (replaces what's currently open — it'll ask you to confirm first).
- **New map** — clears everything and starts over with a single blank node titled "Start."

## Notes on offline use

Everything — the map engine, storage, and icons — is vendored locally, so once you have the files there's no network dependency at all.

## Want the technical details?

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for how the layout, rendering, drag interactions, and text editor actually work under the hood.
