import type { Block, BlockType } from './types';

interface ShortcutResult {
  matched: boolean;
  newType?: BlockType;
  prefixLength?: number;
  checked?: boolean;
}

/** 块级快捷键映射表，按匹配优先级排列 */
const BLOCK_SHORTCUTS: Array<{ prefix: string; type: BlockType }> = [
  { prefix: '```', type: 'code-block' },
  { prefix: '---', type: 'hr' },
  { prefix: '###### ', type: 'heading-6' },
  { prefix: '##### ', type: 'heading-5' },
  { prefix: '#### ', type: 'heading-4' },
  { prefix: '### ', type: 'heading-3' },
  { prefix: '## ', type: 'heading-2' },
  { prefix: '# ', type: 'heading-1' },
  { prefix: '> ', type: 'blockquote' },
  { prefix: '- [x] ', type: 'task-list' },
  { prefix: '- [ ] ', type: 'task-list' },
  { prefix: '- ', type: 'bullet-list' },
  { prefix: '* ', type: 'bullet-list' },
];

/**
 * 检测段落文本是否匹配块级 Markdown 语法前缀
 * - hr 和 code-block 要求精确匹配（rawText === prefix），其他只匹配前缀
 * - 有序列表使用正则匹配 `数字. `
 */
export function checkBlockShortcut(block: Block): ShortcutResult {
  /* bullet-list 中输入 [ ] 或 [x] 可升级为 task-list（因为 `- ` 已先触发了 bullet-list） */
  if (block.type === 'bullet-list') {
    if (block.rawText.startsWith('[x] ') || block.rawText.startsWith('[X] ')) {
      return { matched: true, newType: 'task-list', prefixLength: 4, checked: true };
    }
    if (block.rawText.startsWith('[ ] ')) {
      return { matched: true, newType: 'task-list', prefixLength: 4, checked: false };
    }
    return { matched: false };
  }

  if (block.type !== 'paragraph') return { matched: false };

  for (const shortcut of BLOCK_SHORTCUTS) {
    if (shortcut.type === 'hr' || shortcut.type === 'code-block') {
      if (block.rawText === shortcut.prefix) {
        return { matched: true, newType: shortcut.type, prefixLength: shortcut.prefix.length };
      }
    } else if (shortcut.type === 'task-list') {
      if (block.rawText.startsWith(shortcut.prefix)) {
        return {
          matched: true,
          newType: shortcut.type,
          prefixLength: shortcut.prefix.length,
          checked: shortcut.prefix.includes('[x]'),
        };
      }
    } else if (block.rawText.startsWith(shortcut.prefix)) {
      return {
        matched: true,
        newType: shortcut.type,
        prefixLength: shortcut.prefix.length,
      };
    }
  }

  const orderedMatch = block.rawText.match(/^(\d+\.\s)/);
  if (orderedMatch) {
    return {
      matched: true,
      newType: 'ordered-list',
      prefixLength: orderedMatch[1].length,
    };
  }

  return { matched: false };
}

/** 应用匹配结果：修改块类型并去掉前缀；hr 特殊清空 rawText；task-list 设置 checked */
export function applyBlockShortcut(block: Block, result: ShortcutResult) {
  if (!result.matched || !result.newType || result.prefixLength === undefined) return;

  block.type = result.newType;
  if (result.newType === 'hr') {
    block.rawText = '';
  } else {
    block.rawText = block.rawText.substring(result.prefixLength);
  }
  if (result.newType === 'task-list') {
    block.checked = result.checked ?? false;
  }
}
