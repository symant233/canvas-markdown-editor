import type { Block } from './types';

/** 将 Block 数组序列化回 Markdown 文本 */
export function blocksToMarkdown(blocks: readonly Block[]): string {
  let orderedCounter = 0; // 追踪连续有序列表的计数器，非有序列表时重置
  return blocks.map(block => {
    if (block.type === 'ordered-list') {
      orderedCounter++;
    } else {
      orderedCounter = 0;
    }

    switch (block.type) {
      case 'heading-1': return `# ${block.rawText}`;
      case 'heading-2': return `## ${block.rawText}`;
      case 'heading-3': return `### ${block.rawText}`;
      case 'bullet-list': return `- ${block.rawText}`;
      case 'ordered-list': return `${orderedCounter}. ${block.rawText}`;
      case 'blockquote': return `> ${block.rawText}`;
      case 'code-block': return `\`\`\`\n${block.rawText}\n\`\`\``;
      case 'hr': return '---';
      default: return block.rawText;
    }
  }).join('\n');
}
