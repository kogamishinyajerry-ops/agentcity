import { describe, expect, it } from 'vitest';
import { clipCols, colWidth } from './width.ts';

describe('colWidth', () => {
  it('counts CJK / fullwidth as 2 cols, latin as 1', () => {
    expect(colWidth('abc')).toBe(3);
    expect(colWidth('愿望')).toBe(4);
    expect(colWidth('UI界面')).toBe(2 + 4); // U,I = 1 each; 界,面 = 2 each
  });
});

describe('clipCols', () => {
  it('returns content that already fits unchanged', () => {
    expect(clipCols('hello', 10)).toBe('hello');
    expect(clipCols('愿望', 10)).toBe('愿望');
  });

  it('clips by display width (not char count) and appends an ellipsis', () => {
    const out = clipCols('一二三四五', 6); // 5 CJK = 10 cols, bound to 6
    expect(out.endsWith('…')).toBe(true);
    expect(colWidth(out)).toBeLessThanOrEqual(6);
  });

  it('collapses whitespace', () => {
    expect(clipCols('a   b', 10)).toBe('a b');
  });
});
