# TamTap Diagram Editor — Full Overhaul Plan

The diagram editor ([tamtap_diagram_editor.html](file:///c:/Users/Charles/Desktop/TamTap/diagram/tamtap_diagram_editor.html)) is a 3,500-line single-file canvas-based web app. It has critical bugs preventing basic interaction (missing `selectBox()` function, broken drag), and lacks key features like direct-to-folder saving, multi-select, alignment guides, and a component library. This plan covers all fixes and enhancements.

---

## User Review Required

> [!IMPORTANT]
> **Save-to-Desktop approach**: We will use the **File System Access API** (`showDirectoryPicker` / `showSaveFilePicker`) available in Chrome/Edge. This lets you pick `C:\Users\Charles\Desktop\TamTapDiagrams` once, and all future saves go directly there without browser downloads. No server needed — stays as a single HTML file. **If you prefer a Node.js local server approach instead, let me know.**

> [!WARNING]
> **File will grow significantly** — adding multi-select, minimap, component library, and SVG export to a single HTML file will bring it to ~5,000+ lines. If you'd prefer to split into separate `.js`/`.css` files, say the word. Otherwise I'll keep it as one file for simplicity.

---

## Proposed Changes

### Phase 1: Critical Bug Fixes

#### [MODIFY] [tamtap_diagram_editor.html](file:///c:/Users/Charles/Desktop/TamTap/diagram/tamtap_diagram_editor.html)

**1. Add missing `selectBox()` function** (~line 1760 area)
```js
function selectBox(id) {
  selectedId = id;
  selectedWireId = null;
  updatePanel();
  redraw();
}
```
This function is called in 6+ places but never defined — it's the root cause of components not being selectable or movable.

**2. Fix `idCounter` synchronization**
After loading any diagram (TamTap preset or JSON file), scan all existing IDs and set `idCounter` to `max + 1` to prevent ID collisions:
```js
function syncIdCounter() {
  let max = 0;
  boxes.forEach(b => { const n = parseInt(b.id.replace(/\D/g,'')); if(!isNaN(n)) max = Math.max(max, n); });
  wires.forEach(w => { const n = parseInt(w.id.replace(/\D/g,'')); if(!isNaN(n)) max = Math.max(max, n); });
  idCounter = max + 1;
}
```
Call this in [loadTamTap()](file:///c:/Users/Charles/Desktop/TamTap/diagram/tamtap_diagram_editor.html#2701-3500), [loadJSONFile()](file:///c:/Users/Charles/Desktop/TamTap/diagram/tamtap_diagram_editor.html#2412-2441), and [loadAutoSave()](file:///c:/Users/Charles/Desktop/TamTap/diagram/tamtap_diagram_editor.html#1320-1343).

> [!IMPORTANT]
> `syncIdCounter()` must be called **after** `boxes` and `wires` are assigned and **before** any `newId()` call within the same function. Calling it in the wrong order will not prevent collisions.

**3. Fix component dragging for string IDs**
The drag system already works by ID matching — with `selectBox()` defined, all components (including TamTap defaults with string IDs like `"cam"`, `"pi"`) will be selectable and draggable.

**4. Fix wire endpoint validation after load**
When wires reference box IDs that no longer exist (e.g. after a JSON load with ID collisions), `getWirePts()` silently fails and wires detach with no error. Add a validation pass after every load:
```js
function validateWires() {
  const ids = new Set(boxes.map(b => b.id));
  wires.forEach(w => {
    if (w.fromId && !ids.has(w.fromId)) w.fromId = null;
    if (w.toId   && !ids.has(w.toId))   w.toId   = null;
  });
}
```
Call this in `loadJSONFile()`, `loadAutoSave()`, and `loadTamTap()` immediately after `syncIdCounter()`.

---

### Phase 2: Save & Export Enhancements

#### [MODIFY] [tamtap_diagram_editor.html](file:///c:/Users/Charles/Desktop/TamTap/diagram/tamtap_diagram_editor.html)

**5. File System Access API integration**
- Add a `dirHandle` variable to store the persistent directory reference
- Add browser detection guard before exposing the feature:
```js
const FS_SUPPORTED = 'showDirectoryPicker' in window;
```
- New `pickSaveFolder()` function using `showDirectoryPicker()` to select `TamTapDiagrams`
- Replace [saveProgress()](file:///c:/Users/Charles/Desktop/TamTap/diagram/tamtap_diagram_editor.html#2387-2409) to write directly to the chosen folder:
  - JSON file: `tamtap-diagram-YYYY-MM-DD_HH-mm.json`
  - Fallback: if `FS_SUPPORTED` is false, use the existing download approach and show toast `"Direct folder save not supported — downloading instead"`
- Show "📁 Set Folder" toolbar button **only** when `FS_SUPPORTED` is true — hide it otherwise to avoid user confusion

> [!WARNING]
> **Mobile Chrome on Android** has partial and inconsistent support for `showDirectoryPicker`. **Firefox does not support it at all.** Since this editor is used on your phone, test the File System API on your actual device before relying on it. The fallback download path must work correctly as the primary flow on unsupported browsers.

**6. Auto-save JSON alongside PNG export**
- Modify [exportPNG()](file:///c:/Users/Charles/Desktop/TamTap/diagram/tamtap_diagram_editor.html#2442-2488) to also call [saveProgress()](file:///c:/Users/Charles/Desktop/TamTap/diagram/tamtap_diagram_editor.html#2387-2409) automatically
- Both PNG and JSON get written to the same directory
- Toast notification confirms both were saved

**7. Add "Save As" with directory picker**
- New `saveAs()` function using `showSaveFilePicker()` for one-off saves to any location

**8. Add state versioning and migration**
- All saved JSON files must include `"v": 2` in the root object (already present in current code)
- Add a `migrateState(data)` function that detects `v: 1` files and upgrades them gracefully:
```js
function migrateState(data) {
  if (!data.v || data.v < 2) {
    // v1 → v2: ensure all boxes have opacity and dash fields
    (data.boxes || []).forEach(b => {
      if (b.opacity === undefined) b.opacity = 1;
      if (!b.dash) b.dash = 'solid';
    });
    data.v = 2;
  }
  return data;
}
```
Call `migrateState(d)` inside `loadJSONFile()` before assigning `boxes` and `wires`.

#### Pre-work: Create the save folder

```powershell
mkdir "C:\Users\Charles\Desktop\TamTapDiagrams"
```

---

### Phase 3: Multi-Select & Interaction

#### [MODIFY] [tamtap_diagram_editor.html](file:///c:/Users/Charles/Desktop/TamTap/diagram/tamtap_diagram_editor.html)

**9. Multi-select system**
- New `selectedIds = new Set()` to track multiple selections
- **Shift+Click** on a box **or wire** toggles it in/out of the selection set
- **Drag-select rectangle**: Click empty canvas and drag to draw a selection lasso; all boxes intersecting it get selected
- Draw selection highlight (blue glow) on all selected boxes
- **Move all selected**: Dragging any selected box moves all items in the set together
- Update [deleteSelected()](file:///c:/Users/Charles/Desktop/TamTap/diagram/tamtap_diagram_editor.html#2250-2267), [duplicateSel()](file:///c:/Users/Charles/Desktop/TamTap/diagram/tamtap_diagram_editor.html#2267-2279), [bringFront()](file:///c:/Users/Charles/Desktop/TamTap/diagram/tamtap_diagram_editor.html#2279-2288), [sendBack()](file:///c:/Users/Charles/Desktop/TamTap/diagram/tamtap_diagram_editor.html#2288-2297) to work with multi-select

> [!IMPORTANT]
> Multi-select delete must also remove all wires whose `fromId` or `toId` points to any deleted box — same orphan cleanup logic as single-select delete. Wires should also be multi-selectable via Shift+Click for bulk deletion.

**10. Snap alignment guides**
- When dragging a box, compare its edges/center against all other boxes
- If within 3px tolerance, draw a colored guide line across the canvas
- Snap the box to the guide position
- Guide types: horizontal center, vertical center, top edge, bottom edge, left edge, right edge

**11. Group/ungroup components**
- New `groups = []` array; each group is `{ id, memberIds: [] }`
- **Ctrl+G** groups selected components; **Ctrl+Shift+G** ungroups
- Clicking any member of a group selects the entire group
- Groups are preserved in save/load JSON
- Toolbar buttons: "Group" and "Ungroup"

---

### Phase 4: Visual Enhancements

#### [MODIFY] [tamtap_diagram_editor.html](file:///c:/Users/Charles/Desktop/TamTap/diagram/tamtap_diagram_editor.html)

**12. Minimap**
- Small 160×120px overlay in the bottom-right corner (above zoom badge)
- Renders a scaled-down version of the entire diagram
- Shows a viewport rectangle (semi-transparent blue) indicating what's currently visible
- Click the minimap to jump to that area
- Toggle on/off with a toolbar button

> [!WARNING]
> **Performance**: Rendering the minimap on every `redraw()` call is expensive when the diagram has 30+ components. The minimap must be throttled — re-render it at most once every **100ms** using a timestamp check, not on every frame. A naive implementation will cause visible lag on mobile.
> ```js
> let minimapLastRender = 0;
> function maybeRenderMinimap() {
>   const now = Date.now();
>   if (now - minimapLastRender < 100) return;
>   minimapLastRender = now;
>   renderMinimap();
> }
> ```
> Call `maybeRenderMinimap()` at the end of `redraw()` instead of `renderMinimap()` directly.

**13. Better wire routing — edge port snapping**
- Instead of always connecting center-to-center, calculate the nearest edge point:
  - Determine which edge of the source box faces the target (top/right/bottom/left)
  - Attach wire endpoint to that edge midpoint
- Visual connection ports: Draw small circles on box edges when in wire mode and hovering near a box
- For orthogonal wires, use proper L-shaped routing that exits from the correct edge

> [!WARNING]
> **This is the most complex feature in Phase 4.** Three design decisions must be made before implementation to avoid having to rewrite routing logic mid-session:
>
> **1. Port storage format** — Store port position as a structured object on the wire, not as raw coordinates:
> ```js
> // Add to wire object:
> fromPort: { side: 'right', offset: 0.5 },  // side = 'top'|'right'|'bottom'|'left', offset = 0..1 along that edge
> toPort:   { side: 'left',  offset: 0.5 },
> ```
> Resolve the actual screen coordinate at draw time from the box geometry. This way resizing a box automatically updates all connected wire endpoints — no manual coordinate updates needed.
>
> **2. Existing wire migration** — All existing wires in the TamTap preset and any loaded JSON files use center-to-center routing (no `fromPort`/`toPort` fields). These must be handled gracefully:
> - If `fromPort` is absent, fall back to center-to-center routing (current behavior)
> - Do not force-migrate old wires — let them coexist until the user re-draws them
>
> **3. Resize behavior** — Because port coordinates are resolved from box geometry at draw time (not stored as fixed coordinates), resizing a box will automatically move all attached wire endpoints. This is the correct behavior and requires no extra code — but it must be confirmed as intentional in the implementation, not worked around.

**14. SVG export**
- New `exportSVG()` function that generates an SVG string from the diagram data
- Reuse box/wire data to create `<rect>`, `<circle>`, `<path>`, `<text>` elements
- Download as `.svg` file
- Add "SVG" button to toolbar next to PNG

> [!WARNING]
> **`roundRect` is not an SVG primitive.** The canvas API's `roundRect()` has no direct SVG equivalent. When generating SVG `<rect>` elements, use `rx` and `ry` attributes instead:
> ```js
> // Canvas: ctx.roundRect(x, y, w, h, r)
> // SVG equivalent:
> `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}"/>`
> ```
> For `shape === 'pill'`, set `rx` to `h/2`. For `shape === 'diamond'`, use a `<polygon>` with four points. For `shape === 'circle'`, use `<ellipse>` or `<circle>`.

**15. Component library sidebar**
- Collapsible left sidebar with categorized pre-built components:
  - **Electronics**: Resistor, LED, Capacitor, Transistor, IC Chip, Relay, Buzzer, Sensor
  - **Connectors**: Header Pin, Terminal Block, USB, Power Jack
  - **Labels**: Title, Subtitle, Annotation, Pin Label
  - **Shapes**: Rectangle, Circle, Diamond, Pill, Hexagon
- Each item is a template with preset colors, sizes, shapes, and labels
- **Drag-and-drop** from sidebar onto canvas (or click to place at center)
- Searchable filter input at top of sidebar
- Toggle with a toolbar button "🧩 Library"

> [!WARNING]
> **Scope risk — consider deferring to a follow-up phase.** The component library requires: drag ghost rendering during hover, drop zone detection on the canvas, a separate scrollable list container, and template management. This alone adds an estimated 300–400 lines. If file size is a concern, the minimap + wire routing + SVG export (items 12–14) deliver more value per line of code. Recommend shipping Phase 4 without the library first, then adding it as Phase 4.5 once the other features are stable.

---

### Phase 5: Polish & UX

#### [MODIFY] [tamtap_diagram_editor.html](file:///c:/Users/Charles/Desktop/TamTap/diagram/tamtap_diagram_editor.html)

**16. Enhanced keyboard shortcuts**
| Shortcut | Action |
|----------|--------|
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+A` | Select all |
| `Ctrl+G` | Group selected |
| `Ctrl+Shift+G` | Ungroup |
| `Ctrl+S` | Save progress |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+E` | Export PNG |
| `Ctrl+Shift+E` | Export SVG |
| `M` | Toggle minimap |
| `L` | Toggle library sidebar |
| `G` | Toggle grid mode (cycle none→dots→lines) |
| `S` | Switch to Select mode |
| `W` | Switch to Wire mode |
| `B` | Add new box |
| `Arrow keys` | Nudge selected box 1px |
| `Delete` / `Backspace` | Delete selected |

**17. Improved toast notifications**
- Stack multiple toasts instead of replacing
- Auto-dismiss with animated slide-out
- Color-coded by type (success green, error red, info blue)

**18. Better cursor feedback**
- Show crosshair when hovering in wire mode near a valid port
- Show grab cursor when hovering over a box
- Show grabbing cursor when actively dragging

**19. Error boundary for canvas rendering**

> [!IMPORTANT]
> Wrap the `redraw()` function body in a `try/catch`. If any single component has malformed data (NaN coordinates, null reference, corrupted JSON), the entire canvas goes blank with no feedback. A caught error should show a red toast instead of a silent white screen:
> ```js
> function redraw() {
>   try {
>     // ... existing redraw logic ...
>   } catch (err) {
>     console.error('Render error:', err);
>     toast('Render error: ' + err.message, 'err');
>   }
> }
> ```

---

## Verification Plan

### Automated (Browser-Based)

Since this is a single HTML file with no build system, verification is manual browser testing:

1. **Open the file in Chrome/Edge** — Navigate to `file:///c:/Users/Charles/Desktop/TamTap/diagram/tamtap_diagram_editor.html`

### Manual Verification Steps

**Test 1 — Bug fixes (selection & drag)**
1. Open the page — the TamTap diagram should auto-load
2. Click on any component (e.g., "Raspberry Pi 4B") — it should highlight with a blue glow and show resize handles
3. Drag it — it should move smoothly, wires should follow
4. Click "Box" to add a new component — should appear without errors
5. Press Ctrl+Z to undo — should revert

**Test 2 — Save to folder**
1. Click "📁 Set Folder" in toolbar
2. Select or create `C:\Users\Charles\Desktop\TamTapDiagrams`
3. Click "Save" — JSON file should appear in that folder
4. Close browser, reopen the file — click "Load" and pick the saved JSON — diagram should restore perfectly

**Test 2b — Fallback save (Firefox / mobile)**
1. Open in Firefox or Android Chrome
2. Verify "📁 Set Folder" button is hidden
3. Click "Save" — should trigger a file download with toast `"Direct folder save not supported — downloading instead"`

**Test 3 — Export**
1. Click "PNG" — should download PNG AND auto-save JSON to the selected folder
2. Click "SVG" — should download an SVG file
3. Open SVG in a browser tab — rounded corners, wire labels, and colors should match the canvas exactly

**Test 4 — Multi-select**
1. Shift+click on 3 boxes — all 3 should highlight
2. Drag one — all 3 should move together
3. Press Delete — all 3 should be deleted, all wires connected to them should also be deleted
4. Ctrl+Z to undo — all 3 boxes and their wires should reappear
5. Draw a selection rectangle around several components — they should all select
6. Shift+click on a wire — it should join the multi-select set

**Test 5 — Alignment guides**
1. Drag a box near another box — colored guide lines should appear when edges or centers align
2. Release — the box should snap to the guide

**Test 6 — Group/Ungroup**
1. Multi-select 3 boxes, press Ctrl+G — they form a group
2. Click any one of them — all 3 select
3. Press Ctrl+Shift+G — they ungroup
4. Click one — only that one selects

**Test 7 — Minimap performance**
1. Press M or click the minimap toggle button — minimap should appear in bottom-right
2. Zoom out until diagram is very small — minimap should show full diagram with a viewport rectangle
3. Click on the minimap — canvas should jump to that area
4. Rapidly drag multiple components — minimap should update smoothly without causing lag (throttle check)

**Test 8 — Wire edge ports**
1. Switch to Wire mode, hover over a box — small port circles should appear on edges
2. Click a port and drag to another box — wire should route from the nearest edge, not center
3. Resize the source box — the wire endpoint should automatically move with the edge
4. Load a saved JSON with old center-to-center wires — they should render correctly using fallback routing

**Test 9 — SVG export shape accuracy**
1. Create a diagram with all four shape types: rect, circle, diamond, pill
2. Export SVG
3. Open in Inkscape or a browser — verify rounded corners use `rx/ry`, pill uses `rx=h/2`, diamond uses `<polygon>`, circle uses `<ellipse>`

**Test 10 — Component Library**
1. Press L or click "🧩 Library" — sidebar should slide open on the left
2. Click "LED" in Electronics category — an LED component should appear at canvas center
3. Type "relay" in search filter — list should filter to show only relay
4. Drag a component from the sidebar onto canvas — should place at drop position

**Test 11 — Error boundary**
1. Open browser DevTools console
2. Manually corrupt a box by setting `box.x = NaN` in the console
3. Trigger a redraw — a red toast should appear with the error message, canvas should not go fully blank