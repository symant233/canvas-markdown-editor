import { useRef, useEffect, useCallback, useState } from 'react';
import { editorManager } from '@canvas-md/core';
import type { ScrollState } from '@canvas-md/core';
import SAMPLE_MARKDOWN from '../../../README.md?raw';
import { Scrollbar } from './components/Scrollbar';
import './App.css';

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  const selectionCanvasRef = useRef<HTMLCanvasElement>(null);

  const [rawMarkdown, setRawMarkdown] = useState(SAMPLE_MARKDOWN);
  const [scrollState, setScrollState] = useState<ScrollState>({ scrollY: 0, contentHeight: 0, viewportHeight: 600 });

  useEffect(() => {
    const container = containerRef.current;
    const staticCanvas = staticCanvasRef.current;
    const selCanvas = selectionCanvasRef.current;
    if (!container || !staticCanvas || !selCanvas) return;

    return editorManager.init(container, staticCanvas, selCanvas, SAMPLE_MARKDOWN, {
      onRawMarkdownChange: setRawMarkdown,
      onScrollStateChange: setScrollState,
    });
  }, []);

  const handleRawMarkdownChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    editorManager.updateFromRawMarkdown(e.target.value);
  }, []);

  const handleScrollbarScroll = useCallback((newScrollY: number) => {
    editorManager.handleScrollbarScroll(newScrollY);
  }, []);

  return (
    <div className="app-layout">
      <div className="editor-wrapper">
        <div className="editor-container" ref={containerRef}>
          <canvas ref={staticCanvasRef} className="editor-canvas static-canvas" />
          <canvas ref={selectionCanvasRef} className="editor-canvas selection-canvas" />
          <Scrollbar
            scrollY={scrollState.scrollY}
            contentHeight={scrollState.contentHeight}
            viewportHeight={scrollState.viewportHeight}
            onScroll={handleScrollbarScroll}
          />
        </div>
      </div>
      <div className="raw-editor-container">
        <div className="raw-editor-header">Markdown 源码</div>
        <textarea
          className="raw-editor"
          value={rawMarkdown}
          onChange={handleRawMarkdownChange}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

export default App;
