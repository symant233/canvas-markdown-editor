/**
 * Mermaid 异步渲染器：将 mermaid 代码转为 SVG → Image，缓存结果供 Canvas 绘制。
 * 使用动态 import 实现按需加载，仅在遇到 mermaid 代码块时才下载 mermaid 库。
 */

import type { Block } from '../types';

type MermaidAPI = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
};

export interface MermaidCacheEntry {
  image: HTMLImageElement;
  width: number;
  height: number;
}

let mermaidApi: MermaidAPI | null = null;
let initPromise: Promise<void> | null = null;

const cache = new Map<string, MermaidCacheEntry>();
const pending = new Set<string>();
let readyCallback: (() => void) | null = null;
let idCounter = 0;

async function ensureInit(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = import('mermaid').then(mod => {
    mermaidApi = mod.default as unknown as MermaidAPI;
    mermaidApi.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      flowchart: { htmlLabels: false },
    });
  });
  return initPromise;
}

export function getMermaidImage(code: string): MermaidCacheEntry | null {
  return cache.get(code) ?? null;
}

export function requestMermaidRender(code: string): void {
  const trimmed = code.trim();
  if (!trimmed || cache.has(code) || pending.has(code)) return;
  pending.add(code);

  const id = `mermaid-svg-${idCounter++}`;

  ensureInit().then(async () => {
    try {
      const { svg } = await mermaidApi!.render(id, trimmed);

      let width = 400;
      let height = 200;

      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(svg, 'image/svg+xml');
      const svgEl = svgDoc.documentElement;

      const wAttr = svgEl.getAttribute('width');
      const hAttr = svgEl.getAttribute('height');
      if (wAttr && hAttr) {
        const w = parseFloat(wAttr);
        const h = parseFloat(hAttr);
        if (w > 0 && h > 0) {
          width = w;
          height = h;
        }
      } else {
        const vb = svgEl.getAttribute('viewBox');
        if (vb) {
          const parts = vb.split(/[\s,]+/).map(Number);
          if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
            width = parts[2];
            height = parts[3];
          }
        }
      }

      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();

      img.onload = () => {
        cache.set(code, { image: img, width, height });
        pending.delete(code);
        readyCallback?.();
      };

      img.onerror = () => {
        pending.delete(code);
        URL.revokeObjectURL(url);
      };

      img.src = url;
    } catch {
      pending.delete(code);
    } finally {
      document.getElementById(id)?.remove();
    }
  });
}

export function setMermaidReadyCallback(cb: () => void): void {
  readyCallback = cb;
}

/** 判断块是否为已渲染完成的 mermaid 图表（code-block + language=mermaid + 图片已就绪） */
export function isRenderedMermaid(block: Block): boolean {
  return block.type === 'code-block' && block.language === 'mermaid' && cache.has(block.rawText);
}
