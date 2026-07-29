import { canvasLogicalW, canvasLogicalH, setCanvasLogicalW, setCanvasLogicalH, layers, groupCanvas, groupCtx, setGroupCanvas, setGroupCtx, viewOffsetX, viewOffsetY, viewScale, viewRotation, activeLayerId } from './state';
import { displayCanvas, displayCtx, canvasWrapper } from './dom';

export function generateThumbnail(sourceCanvas: HTMLCanvasElement, maxDim: number = 160): string {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  let newW = w;
  let newH = h;
  
  if (w > maxDim || h > maxDim) {
    if (w > h) {
      newW = maxDim;
      newH = Math.round((h / w) * maxDim);
    } else {
      newH = maxDim;
      newW = Math.round((w / h) * maxDim);
    }
  }

  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = newW;
  thumbCanvas.height = newH;
  const ctx = thumbCanvas.getContext('2d');
  if (!ctx) return '';
  
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, newW, newH);
  ctx.drawImage(sourceCanvas, 0, 0, newW, newH);
  
  return thumbCanvas.toDataURL('image/jpeg', 0.8);
}

export let lowerCacheCanvas: HTMLCanvasElement | null = null;
export let lowerCacheCtx: CanvasRenderingContext2D | null = null;
export let upperCacheCanvas: HTMLCanvasElement | null = null;
export let upperCacheCtx: CanvasRenderingContext2D | null = null;
export let isLayerCacheDirty = true;

export function setLayerCacheDirty(dirty: boolean = true) {
  isLayerCacheDirty = dirty;
}

export function initCanvasSize(w: number, h: number) {
  setCanvasLogicalW(w);
  setCanvasLogicalH(h);
  const dpr = window.devicePixelRatio || 1;

  displayCanvas.width = w * dpr;
  displayCanvas.height = h * dpr;
  displayCanvas.style.width = `${w}px`;
  displayCanvas.style.height = `${h}px`;
  canvasWrapper.style.width = `${w}px`;
  canvasWrapper.style.height = `${h}px`;

  let gc = groupCanvas;
  if (!gc) {
    gc = document.createElement('canvas');
    setGroupCanvas(gc);
  }
  gc.width = w * dpr;
  gc.height = h * dpr;
  setGroupCtx(gc.getContext('2d')!);

  if (!lowerCacheCanvas) {
    lowerCacheCanvas = document.createElement('canvas');
    lowerCacheCtx = lowerCacheCanvas.getContext('2d')!;
  }
  lowerCacheCanvas.width = w * dpr;
  lowerCacheCanvas.height = h * dpr;

  if (!upperCacheCanvas) {
    upperCacheCanvas = document.createElement('canvas');
    upperCacheCtx = upperCacheCanvas.getContext('2d')!;
  }
  upperCacheCanvas.width = w * dpr;
  upperCacheCanvas.height = h * dpr;

  displayCtx.scale(dpr, dpr);
  isLayerCacheDirty = true;
}

export function getActiveGroupRange(): [number, number] {
  if (layers.length === 0) return [0, -1];
  const activeIdx = layers.findIndex(l => l.id === activeLayerId);
  const idx = activeIdx >= 0 ? activeIdx : layers.length - 1;

  let baseIdx = idx;
  while (baseIdx > 0 && layers[baseIdx].clipped) {
    baseIdx--;
  }

  let endIdx = baseIdx;
  while (endIdx + 1 < layers.length && layers[endIdx + 1].clipped) {
    endIdx++;
  }

  return [baseIdx, endIdx];
}

function compositeLayerRange(targetCtx: CanvasRenderingContext2D, startIdx: number, endIdx: number) {
  const gc = groupCanvas;
  const gctx = groupCtx;
  if (!gc || !gctx || startIdx > endIdx || startIdx < 0 || endIdx >= layers.length) return;

  let groupBlendMode: GlobalCompositeOperation = 'source-over';
  let clipBaseCanvas: HTMLCanvasElement | null = null;

  for (let i = startIdx; i <= endIdx; i++) {
    const layer = layers[i];
    const isClipped = layer.clipped;
    const nextIsClipped = (i + 1 <= endIdx) && (i + 1 < layers.length) && layers[i + 1].clipped;

    if (isClipped) {
      if (layer.visible) {
        gctx.globalCompositeOperation = layer.blendMode || 'source-over';
        gctx.drawImage(layer.canvas, 0, 0);
      }
      if (!nextIsClipped) {
        if (clipBaseCanvas) {
          gctx.globalCompositeOperation = 'destination-in';
          gctx.drawImage(clipBaseCanvas, 0, 0);
        }
        targetCtx.globalCompositeOperation = groupBlendMode;
        targetCtx.drawImage(gc, 0, 0);
        targetCtx.globalCompositeOperation = 'source-over';
      }
    } else {
      if (nextIsClipped) {
        groupBlendMode = layer.blendMode || 'source-over';
        clipBaseCanvas = layer.canvas;
        gctx.clearRect(0, 0, gc.width, gc.height);
        if (layer.visible) {
          gctx.globalCompositeOperation = 'source-over';
          gctx.drawImage(layer.canvas, 0, 0);
        }
      } else {
        if (layer.visible) {
          targetCtx.globalCompositeOperation = layer.blendMode || 'source-over';
          targetCtx.drawImage(layer.canvas, 0, 0);
          targetCtx.globalCompositeOperation = 'source-over';
        }
      }
    }
  }
}

function updateLowerCache(endIdx: number) {
  if (!lowerCacheCanvas || !lowerCacheCtx) return;
  lowerCacheCtx.setTransform(1, 0, 0, 1, 0, 0);
  lowerCacheCtx.fillStyle = '#ffffff';
  lowerCacheCtx.fillRect(0, 0, lowerCacheCanvas.width, lowerCacheCanvas.height);
  if (endIdx >= 0) {
    compositeLayerRange(lowerCacheCtx, 0, endIdx);
  }
}

function updateUpperCache(startIdx: number) {
  if (!upperCacheCanvas || !upperCacheCtx) return;
  upperCacheCtx.setTransform(1, 0, 0, 1, 0, 0);
  upperCacheCtx.clearRect(0, 0, upperCacheCanvas.width, upperCacheCanvas.height);
  if (startIdx < layers.length) {
    compositeLayerRange(upperCacheCtx, startIdx, layers.length - 1);
  }
}

export function compositeAndDisplay() {
  isLayerCacheDirty = true;
  compositeFast();
}

export function compositeFast() {
  const dpr = window.devicePixelRatio || 1;
  const gc = groupCanvas;
  const gctx = groupCtx;
  if (!gc || !gctx) {
    return;
  }

  if (!lowerCacheCanvas || !upperCacheCanvas) {
    const w = canvasLogicalW;
    const h = canvasLogicalH;
    if (!lowerCacheCanvas) {
      lowerCacheCanvas = document.createElement('canvas');
      lowerCacheCtx = lowerCacheCanvas.getContext('2d')!;
      lowerCacheCanvas.width = w * dpr;
      lowerCacheCanvas.height = h * dpr;
    }
    if (!upperCacheCanvas) {
      upperCacheCanvas = document.createElement('canvas');
      upperCacheCtx = upperCacheCanvas.getContext('2d')!;
      upperCacheCanvas.width = w * dpr;
      upperCacheCanvas.height = h * dpr;
    }
    isLayerCacheDirty = true;
  }

  const [startIdx, endIdx] = getActiveGroupRange();

  if (isLayerCacheDirty) {
    updateLowerCache(startIdx - 1);
    updateUpperCache(endIdx + 1);
    isLayerCacheDirty = false;
  }

  displayCtx.setTransform(1, 0, 0, 1, 0, 0);
  displayCtx.globalCompositeOperation = 'source-over';

  if (lowerCacheCanvas) {
    displayCtx.drawImage(lowerCacheCanvas, 0, 0);
  } else {
    displayCtx.fillStyle = '#ffffff';
    displayCtx.fillRect(0, 0, displayCanvas.width, displayCanvas.height);
  }

  if (startIdx <= endIdx) {
    compositeLayerRange(displayCtx, startIdx, endIdx);
  }

  if (upperCacheCanvas && endIdx + 1 < layers.length) {
    displayCtx.drawImage(upperCacheCanvas, 0, 0);
  }

  displayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function updateViewTransform() {
  canvasWrapper.style.transform = `translate(${viewOffsetX}px, ${viewOffsetY}px) scale(${viewScale}) rotate(${viewRotation}rad)`;
}

export function createLayerCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  c.width = canvasLogicalW * dpr;
  c.height = canvasLogicalH * dpr;
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return { canvas: c, ctx };
}

export function exportCompositeCanvas(): HTMLCanvasElement {
  const dpr = window.devicePixelRatio || 1;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = canvasLogicalW * dpr;
  outCanvas.height = canvasLogicalH * dpr;
  const outCtx = outCanvas.getContext('2d')!;

  outCtx.setTransform(1, 0, 0, 1, 0, 0);
  outCtx.fillStyle = '#ffffff';
  outCtx.fillRect(0, 0, outCanvas.width, outCanvas.height);

  if (layers.length > 0) {
    compositeLayerRange(outCtx, 0, layers.length - 1);
  }

  return outCanvas;
}
