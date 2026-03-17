import type { CursorPosition, SelectionRange } from './types';
import { BlockStore } from './BlockStore';
import { HitTester } from './HitTester';
import type { KeyboardAction } from './KeyboardHandler';
import { KeyboardHandler } from './KeyboardHandler';
import { CoordTransformer } from './CoordTransformer';

/** 编辑器核心状态：光标、选区、IME 状态、拖拽中标志 */
export interface EditorState {
  cursor: CursorPosition | null;
  selection: SelectionRange | null;
  compositionText: string;
  isDragging: boolean;
}

export type EditorEvent =
  | { type: 'cursorChanged' }
  | { type: 'selectionChanged' }
  | { type: 'dataChanged' }
  | { type: 'scrollChanged' }
  | { type: 'compositionChanged' }
  | { type: 'needsFullRender' };

type EventHandler = (event: EditorEvent) => void;

/** 集中管理编辑器状态和事件派发，解耦 UI 组件与核心逻辑 */
export class EventDispatcher {
  private state: EditorState = {
    cursor: null,
    selection: null,
    compositionText: '',
    isDragging: false,
  };

  private handlers: Set<EventHandler> = new Set();

  private blockStore: BlockStore;
  private hitTester: HitTester;
  private keyboardHandler: KeyboardHandler;
  private coordTransformer: CoordTransformer;

  constructor(
    blockStore: BlockStore,
    hitTester: HitTester,
    keyboardHandler: KeyboardHandler,
    coordTransformer: CoordTransformer,
  ) {
    this.blockStore = blockStore;
    this.hitTester = hitTester;
    this.keyboardHandler = keyboardHandler;
    this.coordTransformer = coordTransformer;
  }

  getState(): Readonly<EditorState> {
    return this.state;
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** 将浏览器坐标转换后 hitTest，命中则更新光标、清空选区、开启拖拽 */
  handlePointerDown(clientX: number, clientY: number) {
    const { sceneX, sceneY } = this.coordTransformer.browserToScene(clientX, clientY);
    const pos = this.hitTester.hitPosition(sceneX, sceneY, this.blockStore.getBlocks());

    if (pos) {
      this.state.cursor = pos;
      this.state.selection = null;
      this.state.isDragging = true;
      this.emit({ type: 'cursorChanged' });
    }
  }

  /** 拖拽中时持续 hitTest，位置变化则更新选区和光标 */
  handlePointerMove(clientX: number, clientY: number) {
    if (!this.state.isDragging || !this.state.cursor) return;

    const { sceneX, sceneY } = this.coordTransformer.browserToScene(clientX, clientY);
    const pos = this.hitTester.hitPosition(sceneX, sceneY, this.blockStore.getBlocks());

    if (pos) {
      const anchor = this.state.selection?.anchor ?? this.state.cursor;
      if (pos.blockId !== anchor.blockId || pos.offset !== anchor.offset) {
        this.state.selection = { anchor, focus: pos };
        this.state.cursor = pos;
        this.emit({ type: 'selectionChanged' });
      }
    }
  }

  /** 结束拖拽 */
  handlePointerUp() {
    this.state.isDragging = false;
  }

  /** 委托 KeyboardHandler 处理，返回 action 供上层执行 */
  handleKeyDown(e: KeyboardEvent): KeyboardAction {
    if (!this.state.cursor) return { type: 'none' };

    return this.keyboardHandler.handleKeyDown(e, this.state.cursor, this.state.selection);
  }

  setCursor(cursor: CursorPosition | null) {
    this.state.cursor = cursor;
  }

  setSelection(selection: SelectionRange | null) {
    this.state.selection = selection;
  }

  setCompositionText(text: string) {
    this.state.compositionText = text;
  }

  private emit(event: EditorEvent) {
    this.handlers.forEach(h => h(event));
  }
}
