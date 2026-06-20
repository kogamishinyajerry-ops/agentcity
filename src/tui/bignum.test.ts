import { describe, expect, it } from 'vitest';
import { bigNumber } from './bignum.ts';

describe('bigNumber', () => {
  it('renders three equal-length rows of block art', () => {
    const rows = bigNumber('611');
    expect(rows).toHaveLength(3);
    expect(rows[0].length).toBe(rows[1].length);
    expect(rows[1].length).toBe(rows[2].length);
    expect(rows[0]).toContain('█');
  });

  it('grows wider with more digits', () => {
    expect(bigNumber('7')[0].length).toBeLessThan(bigNumber('7777')[0].length);
  });

  it('renders every digit without throwing', () => {
    const rows = bigNumber('0123456789');
    expect(rows.every((r) => r.length > 0)).toBe(true);
  });
});
