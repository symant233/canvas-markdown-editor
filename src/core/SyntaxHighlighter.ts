import hljs from 'highlight.js';
import type { InlineSegment } from './types';
import { DEFAULT_INLINE_STYLE } from './types';

/** GitHub 风格配色（浅色主题） */
const TOKEN_COLORS: Record<string, string> = {
  'hljs-keyword':     '#d73a49',
  'hljs-built_in':    '#005cc5',
  'hljs-type':        '#005cc5',
  'hljs-literal':     '#005cc5',
  'hljs-number':      '#005cc5',
  'hljs-string':      '#032f62',
  'hljs-regexp':      '#032f62',
  'hljs-comment':     '#6a737d',
  'hljs-doctag':      '#6a737d',
  'hljs-title':       '#6f42c1',
  'hljs-function':    '#6f42c1',
  'hljs-class':       '#6f42c1',
  'hljs-variable':    '#e36209',
  'hljs-attr':        '#005cc5',
  'hljs-params':      '#24292e',
  'hljs-meta':        '#005cc5',
  'hljs-symbol':      '#005cc5',
  'hljs-selector-tag': '#22863a',
  'hljs-selector-class': '#6f42c1',
  'hljs-selector-id': '#005cc5',
  'hljs-tag':         '#22863a',
  'hljs-name':        '#22863a',
  'hljs-attribute':   '#005cc5',
  'hljs-property':    '#005cc5',
  'hljs-addition':    '#22863a',
  'hljs-deletion':    '#b31d28',
  'hljs-operator':    '#d73a49',
  'hljs-punctuation': '#24292e',
  'hljs-template-variable': '#e36209',
  'hljs-link':        '#032f62',
  'hljs-section':     '#005cc5',
  'hljs-subst':       '#24292e',
};

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
  '&#x2F;': '/',
};

function decodeHtmlEntities(text: string): string {
  return text.replace(/&[#\w]+;/g, m => HTML_ENTITIES[m] ?? m);
}

function resolveColor(classNames: string[]): string | undefined {
  for (const cls of classNames) {
    if (TOKEN_COLORS[cls]) return TOKEN_COLORS[cls];
  }
  return undefined;
}

/**
 * 解析 highlight.js 的 HTML 输出为 InlineSegment 数组。
 * 处理嵌套 <span>、HTML 实体和纯文本节点。
 */
function parseHljsHtml(html: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const classStack: string[][] = [];
  let pos = 0;

  while (pos < html.length) {
    if (html[pos] === '<') {
      const closeMatch = html.substring(pos).match(/^<\/span>/);
      if (closeMatch) {
        classStack.pop();
        pos += closeMatch[0].length;
        continue;
      }

      const openMatch = html.substring(pos).match(/^<span\s+class="([^"]*)">/);
      if (openMatch) {
        classStack.push(openMatch[1].split(/\s+/));
        pos += openMatch[0].length;
        continue;
      }

      // skip unrecognized tags
      const tagEnd = html.indexOf('>', pos);
      pos = tagEnd >= 0 ? tagEnd + 1 : html.length;
      continue;
    }

    let textEnd = html.indexOf('<', pos);
    if (textEnd === -1) textEnd = html.length;

    const raw = html.substring(pos, textEnd);
    const text = decodeHtmlEntities(raw);
    if (text.length > 0) {
      const allClasses = classStack.flat();
      const color = resolveColor(allClasses);
      segments.push({
        text,
        style: { ...DEFAULT_INLINE_STYLE, color },
      });
    }

    pos = textEnd;
  }

  return segments;
}

/** 对代码文本进行语法高亮，返回带颜色的 InlineSegment 数组 */
export function highlightCode(code: string, language?: string): InlineSegment[] {
  if (!code) return [{ text: '', style: { ...DEFAULT_INLINE_STYLE } }];

  try {
    const result = language && hljs.getLanguage(language)
      ? hljs.highlight(code, { language })
      : hljs.highlightAuto(code);

    return parseHljsHtml(result.value);
  } catch {
    return [{ text: code, style: { ...DEFAULT_INLINE_STYLE } }];
  }
}
