import type { Block, CursorPosition, InlineStyle, LineLayout } from './types';
import { TextMeasurer } from './TextMeasurer';
import { BlockStore } from './BlockStore';

/**
 * 将 Canvas 上的点击坐标映射为 source 空间的 CursorPosition（blockId + offset）。
 */
export class HitTester {
  private textMeasurer: TextMeasurer;
  private blockStore: BlockStore;
  constructor(textMeasurer: TextMeasurer, blockStore: BlockStore) {
    this.textMeasurer = textMeasurer;
    this.blockStore = blockStore;
  }

  private static readonly CHECKBOX_INDENT = 24;
  private static readonly CHECKBOX_SIZE = 14;
  private static readonly CHECKBOX_PAD = 4;

  /** 检测点击是否命中 task-list 的 checkbox 区域，返回对应 block 或 null */
  hitCheckbox(sceneX: number, sceneY: number, blocks: readonly Block[]): Block | null {
    const { CHECKBOX_INDENT: INDENT, CHECKBOX_SIZE: SIZE, CHECKBOX_PAD: PAD } = HitTester;
    for (const block of blocks) {
      if (block.type !== 'task-list' || !block.layout || block.layout.lines.length === 0) continue;
      const firstLine = block.layout.lines[0];
      const cx = block.layout.x - INDENT / 2 - SIZE / 2;
      const textCenter = this.textMeasurer.getTextVisualCenter(block.type);
      const cy = firstLine.y + textCenter - SIZE / 2;
      if (sceneX >= cx - PAD && sceneX <= cx + SIZE + PAD &&
          sceneY >= cy - PAD && sceneY <= cy + SIZE + PAD) {
        return block;
      }
    }
    return null;
  }

  /** 找到 sceneY 所在的块；若不在任何块内则取最近的块 */
  hitBlock(sceneY: number, blocks: readonly Block[]): Block | null {
    if (blocks.length === 0) return null;

    for (let i = 0; i < blocks.length; i++) {
      const layout = blocks[i].layout;
      if (!layout) continue;

      if (sceneY >= layout.y && sceneY < layout.y + layout.height) {
        return blocks[i];
      }
    }

    let closestBlock: Block | null = null;
    let closestDist = Infinity;

    for (const block of blocks) {
      if (!block.layout) continue;
      const blockTop = block.layout.y;
      const blockBottom = block.layout.y + block.layout.height;

      let dist: number;
      if (sceneY < blockTop) {
        dist = blockTop - sceneY;
      } else {
        dist = sceneY - blockBottom;
      }

      if (dist < closestDist) {
        closestDist = dist;
        closestBlock = block;
      }
    }

    return closestBlock;
  }

  /** 先定位块，再定位行，最后定位行内字符位置 */
  hitPosition(sceneX: number, sceneY: number, blocks: readonly Block[]): CursorPosition | null {
    const block = this.hitBlock(sceneY, blocks);
    if (!block?.layout) return null;

    if (block.type === 'table' && block.layout.tableCells && block.tableData) {
      return this.hitTableCell(sceneX, sceneY, block);
    }

    const line = this.findLine(sceneY, block);
    if (!line) {
      if (sceneY < block.layout.y) {
        const firstLine = block.layout.lines[0];
        if (!firstLine) return { blockId: block.id, offset: 0 };
        return this.hitPositionInLine(sceneX, firstLine, block);
      } else {
        const lastLine = block.layout.lines[block.layout.lines.length - 1];
        if (!lastLine) return { blockId: block.id, offset: 0 };
        return this.hitPositionInLine(sceneX, lastLine, block);
      }
    }

    return this.hitPositionInLine(sceneX, line, block);
  }

  /**
   * 命中单元格后按纵坐标在 cell.lines 中选行（含行间缝隙落在下一行的规则），再累加行前 visual 并用该格 visualToSource 得到 source offset。
   */
  private hitTableCell(sceneX: number, sceneY: number, block: Block): CursorPosition {
    const cells = block.layout!.tableCells!;
    const data = block.tableData!;

    for (let r = 0; r < cells.length; r++) {
      for (let c = 0; c < cells[r].length; c++) {
        const cell = cells[r][c];
        if (sceneX >= cell.x && sceneX < cell.x + cell.width &&
            sceneY >= cell.y && sceneY < cell.y + cell.height) {
          const tableRow = r === 0 ? -1 : r - 1;
          const cellData = r === 0 ? data.headers[c] : data.rows[r - 1]?.[c];
          if (!cellData || cell.lines.length === 0) {
            return { blockId: block.id, offset: 0, tableCell: { row: tableRow, col: c } };
          }

          let targetLine = cell.lines[0];
          for (const ln of cell.lines) {
            if (sceneY >= ln.y && sceneY < ln.y + ln.height) {
              targetLine = ln;
              break;
            }
            if (sceneY >= ln.y + ln.height) targetLine = ln;
          }

          let visualOffset = 0;
          for (const ln of cell.lines) {
            if (ln === targetLine) break;
            for (const seg of ln.segments) visualOffset += seg.text.length;
          }

          for (const seg of targetLine.segments) {
            if (sceneX < seg.x) {
              const sourceOffset = cellData.visualToSource[visualOffset] ?? 0;
              return { blockId: block.id, offset: sourceOffset, tableCell: { row: tableRow, col: c } };
            }
            if (sceneX <= seg.x + seg.width) {
              const charIdx = this.getCharIndexAtX(seg.text, seg.x, sceneX, 'table', seg.style);
              const sourceOffset = cellData.visualToSource[visualOffset + charIdx] ?? 0;
              return { blockId: block.id, offset: sourceOffset, tableCell: { row: tableRow, col: c } };
            }
            visualOffset += seg.text.length;
          }

          const sourceOffset = cellData.visualToSource[visualOffset] ?? cellData.rawText.length;
          return { blockId: block.id, offset: sourceOffset, tableCell: { row: tableRow, col: c } };
        }
      }
    }

    return { blockId: block.id, offset: 0, tableCell: { row: -1, col: 0 } };
  }

  /** 在块的布局行中找到 sceneY 所在行 */
  private findLine(sceneY: number, block: Block) {
    if (!block.layout) return null;

    for (const line of block.layout.lines) {
      if (sceneY >= line.y && sceneY < line.y + line.height) {
        return line;
      }
    }
    return null;
  }

  /**
   * 行内命中逻辑：先累加此行之前所有行的视觉字符数得到 visualOffset（含 newlineBefore 补偿），
   * 遍历行内各段判断 sceneX 落在哪个段的哪个字符上，最终通过 visualToSource 转回 source 偏移。
   */
  private hitPositionInLine(
    sceneX: number,
    line: LineLayout,
    block: Block,
  ): CursorPosition {
    let visualOffset = 0;

    for (let lineIdx = 0; lineIdx < block.layout!.lines.length; lineIdx++) {
      const l = block.layout!.lines[lineIdx];
      if (l === line) break;
      if (l.newlineBefore) visualOffset++;
      for (const seg of l.segments) {
        visualOffset += seg.text.length;
      }
    }
    if (line.newlineBefore) visualOffset++;

    for (const seg of line.segments) {
      if (sceneX < seg.x) {
        const sourceOffset = this.blockStore.visualToSource(block, visualOffset);
        return { blockId: block.id, offset: sourceOffset };
      }

      if (sceneX <= seg.x + seg.width) {
        const charIdx = this.getCharIndexAtX(seg.text, seg.x, sceneX, block.type, seg.style);
        const sourceOffset = this.blockStore.visualToSource(block, visualOffset + charIdx);
        return { blockId: block.id, offset: sourceOffset };
      }

      visualOffset += seg.text.length;
    }

    const sourceOffset = this.blockStore.visualToSource(block, visualOffset);
    return { blockId: block.id, offset: sourceOffset };
  }

  /** 遍历字符中心点，判断点击落在字符的左半还是右半 */
  private getCharIndexAtX(
    text: string,
    segX: number,
    targetX: number,
    blockType: Block['type'],
    style: InlineStyle,
  ): number {
    const charWidths = this.textMeasurer.measureCharWidths(text, blockType, style);
    let x = segX;

    for (let i = 0; i < charWidths.length; i++) {
      const charCenter = x + charWidths[i] / 2;
      if (targetX < charCenter) return i;
      x += charWidths[i];
    }

    return text.length;
  }
}
