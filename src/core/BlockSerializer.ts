import type { Block } from './types';

/** 将 Block 数组序列化回 Markdown 文本 */
export function blocksToMarkdown(blocks: readonly Block[]): string {
  let orderedCounter = 0;
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
      case 'heading-4': return `#### ${block.rawText}`;
      case 'heading-5': return `##### ${block.rawText}`;
      case 'heading-6': return `###### ${block.rawText}`;
      case 'bullet-list': return `- ${block.rawText}`;
      case 'ordered-list': return `${orderedCounter}. ${block.rawText}`;
      case 'task-list': return `- [${block.checked ? 'x' : ' '}] ${block.rawText}`;
      case 'blockquote': return `> ${block.rawText}`;
      case 'code-block': return `\`\`\`${block.language || ''}\n${block.rawText}\n\`\`\``;
      case 'table': return block.rawText;
      case 'hr': return '---';
      default: return block.rawText;
    }
  }).join('\n');
}
