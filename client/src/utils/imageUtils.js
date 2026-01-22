export function getImageDimensionsFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

// Center-crop to a square, optionally zoom in (zoom >= 1), then scale down to maxSize.
export async function cropAndResizeToSquareDataUrl({
  dataUrl,
  maxSize = 512,
  zoom = 1,
  panX = 0,
  panY = 0,
  outputType = 'image/jpeg',
  quality = 0.86
}) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Failed to load image'));
    i.src = dataUrl;
  });

  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) throw new Error('Invalid image');

  const baseCropSize = Math.min(srcW, srcH);
  const safeZoom = Math.max(1, Number(zoom) || 1);
  const cropSize = Math.max(1, Math.floor(baseCropSize / safeZoom));

  // panX/panY are in SOURCE pixels. Positive pan moves the source center left/up (because the image is dragged right/down).
  const safePanX = Number.isFinite(Number(panX)) ? Number(panX) : 0;
  const safePanY = Number.isFinite(Number(panY)) ? Number(panY) : 0;

  const centerX = (srcW / 2) - safePanX;
  const centerY = (srcH / 2) - safePanY;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const maxSx = Math.max(0, srcW - cropSize);
  const maxSy = Math.max(0, srcH - cropSize);

  const sx = Math.floor(clamp(centerX - (cropSize / 2), 0, maxSx));
  const sy = Math.floor(clamp(centerY - (cropSize / 2), 0, maxSy));

  const outSize = Math.max(64, Math.min(maxSize, baseCropSize));
  const canvas = document.createElement('canvas');
  canvas.width = outSize;
  canvas.height = outSize;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, outSize, outSize);

  return canvas.toDataURL(outputType, quality);
}

export function isProbablyLargeImage({ fileSizeBytes, width, height }) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const bytes = Number(fileSizeBytes) || 0;

  // If the image is large in pixels OR file size, we enforce resize/crop.
  return bytes > 800 * 1024 || Math.max(w, h) > 1024;
}
