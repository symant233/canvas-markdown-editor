export type InputHandler = {
  onTextInput: (text: string) => void;
  onCompositionStart: () => void;
  onCompositionUpdate: (text: string) => void;
  onCompositionEnd: (text: string) => void;
  onCopy: (e: ClipboardEvent) => void;
  onPaste: (e: ClipboardEvent) => void;
};

/**
 * 管理一个隐藏的 textarea，用于接收键盘输入、IME 组合和剪贴板事件，不参与视觉渲染。
 * 不直接参与 Canvas 绘制，仅作为输入事件的「接收器」。
 */
export class InputManager {
  private textarea: HTMLTextAreaElement;
  /** IME 组合期间阻止 input 事件重复提交 */
  private isComposing = false;
  private handler: InputHandler | null = null;

  constructor(container: HTMLElement) {
    this.textarea = document.createElement('textarea');
    /* 使用 opacity:0 + 1px 尺寸隐藏，而非 display:none，否则无法获得焦点和输入事件 */
    /**
     * textarea 使用 opacity:0 隐藏但保持可 focus/可输入。
     * 宽度 200px 避免组合输入时浏览器内部滚动导致 IME 候选窗跳动。
     * clip-path 裁切到 1x1 像素防止意外可见区域。
     */
    Object.assign(this.textarea.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '200px',
      height: '1px',
      opacity: '0',
      border: 'none',
      outline: 'none',
      resize: 'none',
      overflow: 'hidden',
      padding: '0',
      margin: '0',
      caretColor: 'transparent',
      color: 'transparent',
      background: 'transparent',
      pointerEvents: 'none',
      fontSize: '16px',
      lineHeight: '1',
      clipPath: 'inset(0 0 0 0)',
    });
    /* 禁用浏览器自动补全、拼写检查等行为，避免干扰输入 */
    this.textarea.setAttribute('autocomplete', 'off');
    this.textarea.setAttribute('autocorrect', 'off');
    this.textarea.setAttribute('autocapitalize', 'off');
    this.textarea.setAttribute('spellcheck', 'false');
    this.textarea.setAttribute('tabindex', '0');

    container.appendChild(this.textarea);

    this.textarea.addEventListener('input', this.onInput);
    this.textarea.addEventListener('compositionstart', this.onCompositionStart);
    this.textarea.addEventListener('compositionupdate', this.onCompositionUpdate);
    this.textarea.addEventListener('compositionend', this.onCompositionEnd);
    this.textarea.addEventListener('copy', this.onCopy);
    this.textarea.addEventListener('paste', this.onPaste);
  }

  setHandler(handler: InputHandler) {
    this.handler = handler;
  }

  /** 临时开启 pointerEvents 以允许 focus()，之后立即关闭防止抢占指针事件 */
  focus() {
    this.textarea.style.pointerEvents = 'auto';
    this.textarea.focus({ preventScroll: true });
    this.textarea.style.pointerEvents = 'none';
  }

  /** 移动 textarea 到指定位置（容器内坐标），高度和行高匹配当前行，使 IME 紧贴内容 */
  updatePosition(x: number, y: number, height: number) {
    this.textarea.style.left = `${x}px`;
    this.textarea.style.top = `${y}px`;
    this.textarea.style.height = `${height}px`;
    this.textarea.style.lineHeight = `${height}px`;
    this.textarea.style.fontSize = `${height}px`;
  }

  blur() {
    this.textarea.blur();
  }

  get composing(): boolean {
    return this.isComposing;
  }

  get focused(): boolean {
    return document.activeElement === this.textarea;
  }

  onBlur(handler: () => void) {
    this.textarea.addEventListener('blur', handler);
  }

  destroy() {
    this.textarea.removeEventListener('input', this.onInput);
    this.textarea.removeEventListener('compositionstart', this.onCompositionStart);
    this.textarea.removeEventListener('compositionupdate', this.onCompositionUpdate);
    this.textarea.removeEventListener('compositionend', this.onCompositionEnd);
    this.textarea.removeEventListener('copy', this.onCopy);
    this.textarea.removeEventListener('paste', this.onPaste);
    this.textarea.remove();
  }

  /** 非组合态下取出 textarea 内容并清空，触发文本输入回调 */
  private onInput = () => {
    if (this.isComposing) return;
    const text = this.textarea.value;
    this.textarea.value = '';
    if (text) {
      this.handler?.onTextInput(text);
    }
  };

  private onCompositionStart = () => {
    this.isComposing = true;
    this.handler?.onCompositionStart();
    this.preventContainerScroll();
  };

  private onCompositionUpdate = (e: CompositionEvent) => {
    this.handler?.onCompositionUpdate(e.data);
    this.preventContainerScroll();
  };

  /** 组合结束时提交最终文本并清空 textarea */
  private onCompositionEnd = (e: CompositionEvent) => {
    this.isComposing = false;
    this.textarea.value = '';
    this.handler?.onCompositionEnd(e.data);
    this.preventContainerScroll();
  };

  /** 防止 textarea 内容溢出导致容器或自身发生滚动偏移 */
  private preventContainerScroll() {
    this.textarea.scrollLeft = 0;
    this.textarea.scrollTop = 0;
    const container = this.textarea.parentElement;
    if (container) {
      container.scrollLeft = 0;
      container.scrollTop = 0;
    }
  }

  private onCopy = (e: ClipboardEvent) => {
    this.handler?.onCopy(e);
  };

  private onPaste = (e: ClipboardEvent) => {
    this.handler?.onPaste(e);
  };
}
