// Images are resized in the browser before upload: Supabase's free plan has no image
// transformations, 1 GB of storage and a 50 MB upload cap, so originals are never stored.

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

export const MAX_ARTICLE_IMAGE = 1600;
export const MAX_MAP_IMAGE = 4096;

export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= max && height <= max) return { width, height };
  const scale = max / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Phones hand over JPEG, PNG, WebP or HEIC; "image/*" lets the photo gallery and camera open.
export const IMAGE_TYPES = 'image/*';
export const MAX_SOURCE_IMAGE = 2560;

const READABLE = /^image\/(png|jpe?g|webp|gif|avif|heic|heif|bmp)$/;
const EXTENSION = /\.(png|jpe?g|webp|gif|avif|heic|heif|bmp)$/i;
const isHeic = (file: { type: string; name?: string }) => /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name ?? '');

/** Refuses files that are plainly not pictures (before trying to read them). */
export function checkImageType(file: Blob & { name?: string }) {
  if (file.type === 'image/svg+xml') throw new Error('SVG drawings cannot be used. Use a photo (JPEG, PNG, WebP or HEIC).');
  if (!READABLE.test(file.type) && !EXTENSION.test(file.name ?? '')) {
    throw new Error(`“${file.name ?? 'This file'}” is not a picture Chronicle can use. Choose a JPEG, PNG, WebP or HEIC photo.`);
  }
}

/** Opens a picture and returns its size, or a plain explanation of why it cannot be read here. */
export async function readImageSize(file: Blob & { name?: string }): Promise<{ width: number; height: number }> {
  checkImageType(file);
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    if (isHeic(file)) {
      throw new Error('This browser cannot open HEIC photos. On an iPhone choose the photo again from the Photos app (it is converted automatically), or set Camera › Formats to “Most Compatible”.');
    }
    throw new Error(`“${file.name ?? 'This file'}” could not be opened as a picture. It may be damaged.`);
  }
}

/**
 * Crops (optionally), resizes to fit within max px and converts to WebP. The source file is never
 * stored: only this smaller copy is uploaded. Animated GIFs keep their first frame.
 */
export async function renderImage(source: Blob, crop: CropRect | null, max = MAX_ARTICLE_IMAGE, quality = 0.82): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(source);
  try {
    const area = clampCrop(crop ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height }, bitmap.width, bitmap.height);
    const size = fitWithin(Math.round(area.width), Math.round(area.height), max);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot process images.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, area.x, area.y, area.width, area.height, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob) throw new Error('Could not convert the image.');
    return { blob, ...size };
  } finally {
    bitmap.close();
  }
}

/** Keeps a crop inside the picture and at least one pixel in size. */
export function clampCrop(c: CropRect, width: number, height: number): CropRect {
  const w = Math.min(Math.max(1, c.width), width);
  const h = Math.min(Math.max(1, c.height), height);
  return { x: Math.min(Math.max(0, c.x), width - w), y: Math.min(Math.max(0, c.y), height - h), width: w, height: h };
}

export async function prepareImage(file: File, max = MAX_ARTICLE_IMAGE, quality = 0.82): Promise<PreparedImage> {
  await readImageSize(file);
  return renderImage(file, null, max, quality);
}
