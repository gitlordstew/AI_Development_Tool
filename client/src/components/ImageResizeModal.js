import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cropAndResizeToSquareDataUrl, getImageDimensionsFromDataUrl, isProbablyLargeImage, readFileAsDataUrl } from '../utils/imageUtils';
import './ImageResizeModal.css';

function ImageResizeModal({
  file,
  open,
  onCancel,
  onApply,
  maxSize = 512
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sourceDataUrl, setSourceDataUrl] = useState('');
  const [sourceDims, setSourceDims] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [panPx, setPanPx] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const previewRef = useRef(null);
  const dragRef = useRef({ active: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 });

  const fileSizeBytes = file?.size || 0;

  const requiresResize = useMemo(() => {
    if (!sourceDims) return false;
    return isProbablyLargeImage({ fileSizeBytes, width: sourceDims.width, height: sourceDims.height });
  }, [fileSizeBytes, sourceDims]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!open || !file) return;
      setError('');
      setLoading(true);
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const dims = await getImageDimensionsFromDataUrl(dataUrl);
        if (!mounted) return;
        setSourceDataUrl(dataUrl);
        setSourceDims(dims);
        setZoom(1);
        setPanPx({ x: 0, y: 0 });
      } catch (e) {
        if (!mounted) return;
        setError(e?.message || 'Failed to load image');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [open, file]);

  const getPreviewSize = () => {
    const el = previewRef.current;
    const fallback = 220;
    if (!el) return fallback;
    const w = el.clientWidth || fallback;
    const h = el.clientHeight || fallback;
    return Math.max(1, Math.min(w, h));
  };

  const getCoverScale = () => {
    if (!sourceDims) return 1;
    const size = getPreviewSize();
    const sx = size / sourceDims.width;
    const sy = size / sourceDims.height;
    return Math.max(sx, sy);
  };

  const clampPanPx = (nextPanPx, nextZoom = zoom) => {
    if (!sourceDims) return { x: 0, y: 0 };
    const size = getPreviewSize();
    const coverScale = getCoverScale();
    const displayedW = sourceDims.width * coverScale * Math.max(1, Number(nextZoom) || 1);
    const displayedH = sourceDims.height * coverScale * Math.max(1, Number(nextZoom) || 1);
    const maxX = Math.max(0, (displayedW - size) / 2);
    const maxY = Math.max(0, (displayedH - size) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, nextPanPx.x)),
      y: Math.max(-maxY, Math.min(maxY, nextPanPx.y))
    };
  };

  // Clamp pan whenever zoom changes.
  useEffect(() => {
    setPanPx(prev => clampPanPx(prev, zoom));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, sourceDims?.width, sourceDims?.height, open]);

  const handleApply = async () => {
    if (!sourceDataUrl) return;
    setLoading(true);
    setError('');
    try {
      const coverScale = getCoverScale();
      const safeZoom = Math.max(1, Number(zoom) || 1);
      // Convert pan in PREVIEW pixels -> SOURCE pixels.
      const panSourceX = panPx.x / (coverScale * safeZoom);
      const panSourceY = panPx.y / (coverScale * safeZoom);

      const resized = await cropAndResizeToSquareDataUrl({
        dataUrl: sourceDataUrl,
        maxSize,
        zoom,
        panX: panSourceX,
        panY: panSourceY,
        outputType: 'image/jpeg',
        quality: 0.86
      });
      onApply?.(resized);
    } catch (e) {
      setError(e?.message || 'Failed to resize image');
    } finally {
      setLoading(false);
    }
  };

  const startDrag = (clientX, clientY) => {
    dragRef.current = {
      active: true,
      startX: clientX,
      startY: clientY,
      startPanX: panPx.x,
      startPanY: panPx.y
    };
    setIsDragging(true);
  };

  const updateDrag = (clientX, clientY) => {
    if (!dragRef.current.active) return;
    const dx = clientX - dragRef.current.startX;
    const dy = clientY - dragRef.current.startY;
    const next = { x: dragRef.current.startPanX + dx, y: dragRef.current.startPanY + dy };
    setPanPx(clampPanPx(next, zoom));
  };

  const endDrag = () => {
    dragRef.current.active = false;
    setIsDragging(false);
  };

  useEffect(() => {
    if (!open) return;

    const onMouseMove = (e) => updateDrag(e.clientX, e.clientY);
    const onMouseUp = () => endDrag();
    const onTouchMove = (e) => {
      if (!dragRef.current.active) return;
      try { e.preventDefault(); } catch { /* ignore */ }
      const t = e.touches?.[0];
      if (!t) return;
      updateDrag(t.clientX, t.clientY);
    };
    const onTouchEnd = () => endDrag();

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, zoom, sourceDims?.width, sourceDims?.height]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content card image-resize-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Adjust profile picture</h2>
        <p className="image-resize-modal__sub">
          We’ll crop it to a square and resize it so it fits nicely.
        </p>

        {error ? <div className="image-resize-modal__error">{error}</div> : null}

        {loading ? (
          <div className="image-resize-modal__loading">Loading…</div>
        ) : (
          <>
            {sourceDataUrl ? (
              <div
                ref={previewRef}
                className={`image-resize-modal__preview ${isDragging ? 'is-dragging' : ''}`}
                title="Drag to reposition"
                onMouseDown={(e) => {
                  e.preventDefault();
                  startDrag(e.clientX, e.clientY);
                }}
                onTouchStart={(e) => {
                  const t = e.touches?.[0];
                  if (!t) return;
                  startDrag(t.clientX, t.clientY);
                }}
              >
                <img
                  src={sourceDataUrl}
                  alt="Preview"
                  style={{
                    transform: `translate(${panPx.x}px, ${panPx.y}px) scale(${zoom})`
                  }}
                  draggable={false}
                />
              </div>
            ) : null}

            <div className="image-resize-modal__meta">
              {sourceDims ? (
                <span>
                  Source: {sourceDims.width}×{sourceDims.height}px
                  {requiresResize ? ' (will be resized)' : ''}
                </span>
              ) : null}
              <span>Output: {maxSize}×{maxSize}px</span>
            </div>

            <div className="image-resize-modal__control">
              <label>
                Zoom
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                />
              </label>
              <div className="image-resize-modal__controlValue">{zoom.toFixed(2)}×</div>
            </div>

            <div className="image-resize-modal__actionsRow">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setPanPx({ x: 0, y: 0 });
                  setZoom(1);
                }}
                disabled={loading}
              >
                Center
              </button>
              <div className="image-resize-modal__hint">Tip: drag the image to reposition.</div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={loading}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={handleApply} disabled={loading || !sourceDataUrl}>
                Apply
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ImageResizeModal;
