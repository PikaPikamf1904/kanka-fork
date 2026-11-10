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

export async function prepareImage(file: File, max = MAX_ARTICLE_IMAGE, quality = 0.82): Promise<PreparedImage> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    throw new Error('Use a PNG, JPEG, WebP or GIF image.');
  }
  const bitmap = await createImageBitmap(file);
  const size = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot process images.');
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
  if (!blob) throw new Error('Could not convert the image.');
  return { blob, ...size };
}
