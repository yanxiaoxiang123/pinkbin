import { describe, it, expect } from 'vitest';
import { formatBytes, formatCount } from '../format';

describe('formatBytes', () => {
  it('returns em dash for NaN', () => {
    expect(formatBytes(NaN)).toBe('—');
  });

  it('returns em dash for Infinity', () => {
    expect(formatBytes(Infinity)).toBe('—');
  });

  it('returns em dash for negative values', () => {
    expect(formatBytes(-1)).toBe('—');
  });

  it('returns bytes for values under 1024', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('returns KB for values >= 1024', () => {
    expect(formatBytes(1024)).toBe('1.00 KB');
    expect(formatBytes(1536)).toBe('1.50 KB');
    expect(formatBytes(10 * 1024)).toBe('10.0 KB');
  });

  it('returns MB for values >= 1024^2', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB');
  });

  it('returns GB with one decimal place between 10-99', () => {
    expect(formatBytes(15.5 * 1024 * 1024 * 1024)).toBe('15.5 GB');
  });

  it('returns GB with zero decimal places at 100+', () => {
    expect(formatBytes(500 * 1024 * 1024 * 1024)).toBe('500 GB');
  });

  it('returns TB for terabyte values', () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024 * 1024)).toBe('2.00 TB');
  });

  it('caps at PB', () => {
    expect(formatBytes(999 * 1024 * 1024 * 1024 * 1024 * 1024)).toBe('999 PB');
    // Beyond PB still shows PB
    expect(formatBytes(2000 * 1024 * 1024 * 1024 * 1024 * 1024)).toBe('2000 PB');
  });
});

describe('formatCount', () => {
  it('returns em dash for NaN', () => {
    expect(formatCount(NaN)).toBe('—');
  });

  it('returns em dash for negative', () => {
    expect(formatCount(-5)).toBe('—');
  });

  it('returns raw number below 1000', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
  });

  it('returns k for thousands', () => {
    expect(formatCount(1000)).toBe('1.0k');
    expect(formatCount(1500)).toBe('1.5k');
    expect(formatCount(999_999)).toBe('1000.0k');
  });

  it('returns M for millions', () => {
    expect(formatCount(1_000_000)).toBe('1.0M');
    expect(formatCount(2_500_000)).toBe('2.5M');
  });
});