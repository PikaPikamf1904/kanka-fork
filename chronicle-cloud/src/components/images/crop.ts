import type { CropRect } from '../../lib/image.ts';

/** Where the picture sits in its frame: zoom (1 = fills the frame) and the crop's centre as fractions. */
export interface View {
  zoom: number;
  cx: number;
  cy: number;
}

export const MAX_ZOOM = 4;
export const CENTRED: View = { zoom: 1, cx: 0.5, cy: 0.5 };

export type AspectKey = 'portrait' | 'landscape' | 'banner' | 'square' | 'original';
export const ASPECTS: Record<AspectKey, { label: string; ratio: number | null }> = {
  portrait: { label: 'Portrait 3:4', ratio: 3 / 4 },
  landscape: { label: 'Landscape 3:2', ratio: 3 / 2 },
  banner: { label: 'Banner', ratio: 16 / 5 },
  square: { label: 'Square', ratio: 1 },
  original: { label: 'Whole picture', ratio: null },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** The part of the source picture (in source pixels) a view shows. Independent of screen size. */
export function cropFromView(v: View, iw: number, ih: number, ratio: number | null): CropRect {
  const r = ratio ?? iw / ih;
  let w: number;
  let h: number;
  if (iw / ih >= r) {
    h = ih / v.zoom;
    w = h * r;
  } else {
    w = iw / v.zoom;
    h = w / r;
  }
  return { x: clamp(v.cx * iw - w / 2, 0, iw - w), y: clamp(v.cy * ih - h / 2, 0, ih - h), width: w, height: h };
}

/** Keeps the view inside the picture. */
export function clampView(v: View, iw: number, ih: number, ratio: number | null): View {
  const zoom = clamp(v.zoom, 1, MAX_ZOOM);
  const c = cropFromView({ ...v, zoom }, iw, ih, ratio);
  return { zoom, cx: (c.x + c.width / 2) / iw, cy: (c.y + c.height / 2) / ih };
}

export function isWholePicture(v: View, ratio: number | null) {
  return ratio === null && v.zoom === 1;
}

/** A crop as fractions of the picture (what the database keeps), from a crop in pixels. */
export function cropFractions(rect: CropRect, iw: number, ih: number) {
  return { x: rect.x / iw, y: rect.y / ih, w: rect.width / iw, h: rect.height / ih };
}

/** The view that shows a saved crop again, so "Adjust" starts where the DM left it. */
export function viewFromCrop(c: { x: number; y: number; w: number; h: number }, iw: number, ih: number, ratio: number | null): View {
  const r = ratio ?? iw / ih;
  const zoom = iw / ih >= r ? 1 / Math.max(c.h, 1e-6) : 1 / Math.max(c.w, 1e-6);
  return clampView({ zoom, cx: c.x + c.w / 2, cy: c.y + c.h / 2 }, iw, ih, ratio);
}
