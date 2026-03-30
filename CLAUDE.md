# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install          # Install all workspace dependencies
pnpm dev              # Vite dev server (http://localhost:5173)
pnpm build            # tsc -b && vite build
pnpm lint             # ESLint (root-level, covers all packages)
pnpm preview          # Preview production build
```

No test framework is configured.

## Monorepo Structure

pnpm workspaces with two packages:

- **`packages/core`** (`@canvas-md/core`) — Pure TypeScript canvas rendering engine. No React dependency. Contains all editing, layout, parsing, and rendering logic.
- **`apps/web`** (`@canvas-md/web`) — React app shell that consumes `@canvas-md/core`. Thin layer: `App.tsx`, `Scrollbar.tsx`, CSS, Vite config.

## Architecture

Pure Canvas 2D WYSIWYG Markdown editor. React is only used for the outer shell (`apps/web/`); all editing, layout, and rendering happens on two `<canvas>` elements managed by `EditorManager` in `packages/core/`.

### Dual Canvas Rendering

- **StaticCanvas** (z-index 1): Content — blocks, text, syntax highlighting, tables, mermaid diagrams. Redrawn only when data changes or on scroll.
- **SelectionCanvas** (z-index 2): Cursor, selection highlights, IME composition underline. Redrawn on every cursor/selection change (lightweight).
- A **hidden textarea** (opacity 0) captures native IME, clipboard, and keyboard events via `InputManager`.

### Data Model

`Block` is the fundamental unit (defined in `packages/core/src/types.ts`). `BlockStore` is the single source of truth holding `Block[]`.

**Source vs Visual coordinate spaces** — the core design concept:
- **Source space**: indices into `rawText` (includes Markdown markers like `**`, `` ` ``)
- **Visual space**: indices into rendered text (markers stripped)
- Each block carries `sourceToVisual[]` and `visualToSource[]` arrays for O(1) conversion
- All cursor/selection positions are in source space; rendering/layout uses visual space

### Module Singletons

All core modules are instantiated once at module scope in `EditorManager.ts` and wired together there. Key modules:

| Module | Responsibility |
|--------|---------------|
| `BlockStore` | Data model CRUD, block reparsing |
| `MarkdownParser` | Block-level parsing (markdown string → Block[]) |
| `InlineParser` | Inline style parsing + offset map generation |
| `LayoutEngine` | Document flow layout, word-wrap, incremental reflow via `reflowFrom()` |
| `TextMeasurer` | Off-screen canvas text measurement with font+text → width cache |
| `StaticCanvasRenderer` | Renders all block content |
| `SelectionCanvasRenderer` | Renders cursor, selection, IME state |
| `EventDispatcher` | Central event hub + editor state management |
| `KeyboardHandler` | Keyboard → action mapping (returns `KeyboardAction` discriminated union) |
| `HitTester` | Click coordinates → `CursorPosition` in source space |
| `CoordTransformer` | Browser viewport ↔ scene coordinate conversion |
| `InputManager` | Hidden textarea lifecycle for IME/clipboard |
| `MarkdownShortcuts` | Detects block-level shortcuts (`# `, `- `, `` ``` ``, `> `) |
| `BlockSerializer` | Block[] → Markdown string |
| `MermaidRenderer` | Async mermaid diagram SVG rendering |

### Render Flow

```
User action → EventDispatcher
  → BlockStore mutation → InlineParser reparse → LayoutEngine reflow
  → emit render request (full | scroll | selectionOnly)
  → EditorManager dispatches to StaticCanvasRenderer / SelectionCanvasRenderer
  → React state callbacks (markdown source, scroll position)
```

### Performance Patterns

- **Scroll blit**: `ScrollHelper` computes pixel overlap; `drawImage()` copies reusable pixels, only new strip is redrawn.
- **Incremental reflow**: `LayoutEngine.reflowFrom(startIndex)` recalculates layout only from the changed block onward.
- **Viewport culling**: Only blocks within visible bounds are rendered.
- **DPR scaling**: Canvas scaled for Retina via `ctx.scale(dpr, dpr)`.

## Code Conventions

- Comments are in Chinese throughout the codebase.
- TypeScript strict mode; no `any` types.
- PascalCase for classes/types, camelCase for variables/functions.
- Readonly return types for state accessors (`getState()`, `getBlocks()`).
- `KeyboardAction` uses discriminated unions for action dispatch.
- Block data is never mutated directly — always through `BlockStore` methods which trigger reparse/reflow.
