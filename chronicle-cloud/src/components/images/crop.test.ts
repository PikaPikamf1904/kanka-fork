import { describe, expect, it } from 'vitest';
import { ASPECTS, cropFractions, cropFromView, viewFromCrop } from './crop.ts';

describe('crop round trip', () => {
  it('a saved crop reopens as the same view, for wide and tall pictures', () => {
    for (const [iw, ih] of [[2000, 1500], [1200, 1800]] as const) {
      for (const aspect of ['portrait', 'landscape', 'square', 'banner'] as const) {
        const ratio = ASPECTS[aspect].ratio;
        const view = { zoom: 1.7, cx: 0.4, cy: 0.55 };
        const rect = cropFromView(view, iw, ih, ratio);
        const back = cropFromView(viewFromCrop(cropFractions(rect, iw, ih), iw, ih, ratio), iw, ih, ratio);
        for (const k of ['x', 'y', 'width', 'height'] as const) expect(back[k]).toBeCloseTo(rect[k], 6);
      }
    }
  });
});
