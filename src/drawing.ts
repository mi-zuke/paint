import Color from 'colorjs.io';
import type { Point } from './types';
import { currentTool, currentColor, setCurrentColor, currentSize, setCurrentSize, setCurrentTool, isDrawing, anchorPoint, lastInputPoint, lastRenderPos, lazyRadius, setAnchorPoint, setLastInputPoint, setLastRenderPos, setLastInputTime, setLazyRadius, layers, activeLayerId, canvasLogicalW, canvasLogicalH, viewScale, viewOffsetX, viewOffsetY, viewRotation, penWaveAmp, penWavePeriod, setPenWaveAmp, setPenWavePeriod, isLayerMoveMode, setIsLayerMoveMode, minPointDistance, setMinPointDistance, strokeCanvas, strokeCtx } from './state';
import { colorPreview, colorInput, sizeSlider, sizeValEl, stabSlider, stabValEl, btnToggleTool, container, penWaveAmpSlider, penWaveAmpValEl, penWavePeriodSlider, penWavePeriodValEl, lazyRadiusCursorEl, minDistSlider, minDistValEl } from './dom';
import { compositeAndDisplay, compositeFast, clearStrokeCanvas, setLayerCacheDirty } from './canvas';
import { saveUndoState, showToast } from './undo';
import { updateLayerMoveBtnUI } from './layers';
import { addDrawnPointsCount } from './debug_graph';

// ===================================================================
// Color helpers
// ===================================================================
const oklchColorCache: { [key: number]: string } = {};
export function getMaxChromaColor(h: number): string {
  if (oklchColorCache[h] !== undefined) {
    return oklchColorCache[h];
  }
  let maxC = 0;
  let bestL = 0.7;
  for (let l = 0; l <= 1.0; l += 0.05) { // broad scan range 0 to 1
    let low = 0;
    let high = 0.4;
    let fitC = 0;
    for (let step = 0; step < 10; step++) {
      const mid = (low + high) / 2;
      const col = new Color('oklch', [l, mid, h]);
      if (col.inGamut('srgb')) {
        fitC = mid;
        low = mid;
      } else {
        high = mid;
      }
    }
    if (fitC > maxC) {
      maxC = fitC;
      bestL = l;
    }
  }
  const finalCol = new Color('oklch', [bestL, maxC, h]);
  const hex = finalCol.to('srgb').toString({ format: 'hex' });
  oklchColorCache[h] = hex;
  return hex;
}

export function updateColorDisplay(c: InstanceType<typeof Color>) {
  setCurrentColor(c.toString({ format: "hex" }));
  colorInput.value = currentColor;
  colorPreview.style.backgroundColor = currentColor;
}


// ===================================================================
// Tool state
// ===================================================================
export function resetToolToPen() {
  setCurrentTool('pen');
  btnToggleTool.innerHTML = '<i data-lucide="pen-tool"></i>';
  btnToggleTool.title = 'Pen';
  if ((window as any).lucide) {
    (window as any).lucide.createIcons({ root: btnToggleTool });
  }
}

export function fillLayerColor(layerId: number, colorHex: string) {
  const layer = layers.find(l => l.id === layerId);
  if (!layer) return;
  
  saveUndoState(layerId);
  
  const ctx = layer.ctx;
  const prevComposite = ctx.globalCompositeOperation;
  
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = colorHex;
  ctx.fillRect(0, 0, canvasLogicalW, canvasLogicalH);
  
  ctx.globalCompositeOperation = prevComposite;
  
  compositeAndDisplay();
  showToast('Layer color changed');
}

// ===================================================================
// Drawing: render a line segment on the active layer
// ===================================================================
function getActiveLayer() {
  return layers.find(l => l.id === activeLayerId);
}

// Stroke-level dynamic wave state
let strokeDistance = 0;
let waveFreq1 = 0;
let waveFreq2 = 0;
let waveFreq3 = 0;
let wavePhase1 = 0;
let wavePhase2 = 0;
let wavePhase3 = 0;

function getWaveFactor(d: number): number {
  if (penWaveAmp <= 0) return 1.0;
  const w = 0.5 * Math.sin(waveFreq1 * d + wavePhase1)
          + 0.35 * Math.sin(waveFreq2 * d + wavePhase2)
          + 0.25 * Math.sin(waveFreq3 * d + wavePhase3);
  return Math.max(0.15, 1.0 + penWaveAmp * w);
}

let needComposite = false;
export function setNeedComposite(val = true) { needComposite = val; }
export function flushComposite() {
  if (needComposite) {
    compositeFast();
    needComposite = false;
  }
}

let currentStrokePoints: Point[] = [];

export function drawSegment(from: Point, to: Point) {
  const layer = getActiveLayer();
  if (!layer) return;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const segmentDist = Math.sqrt(dx * dx + dy * dy);
  if (segmentDist < 0.01) return;

  strokeDistance += segmentDist;

  // 通常ペンの場合：線分の継ぎ目で端点が重なって濃くなる現象を防ぐため、点列を単一パスとしてストロークバッファへ一括描画する
  if (currentTool === 'pen' && penWaveAmp <= 0 && strokeCtx && strokeCanvas) {
    if (currentStrokePoints.length === 0) {
      currentStrokePoints.push(from);
    }
    currentStrokePoints.push(to);

    clearStrokeCanvas();
    strokeCtx.beginPath();
    strokeCtx.moveTo(currentStrokePoints[0].x, currentStrokePoints[0].y);
    for (let i = 1; i < currentStrokePoints.length; i++) {
      strokeCtx.lineTo(currentStrokePoints[i].x, currentStrokePoints[i].y);
    }
    strokeCtx.lineCap = 'round';
    strokeCtx.lineJoin = 'round';
    strokeCtx.strokeStyle = currentColor;
    strokeCtx.lineWidth = currentSize;
    strokeCtx.stroke();

    needComposite = true;
    return;
  }

  const ctx = layer.ctx;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);

  if (currentTool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = currentSize * 2;
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentSize * getWaveFactor(strokeDistance);
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.globalCompositeOperation = 'source-over';
  needComposite = true;
}

export function commitStrokeToLayer() {
  if (currentStrokePoints.length === 0 || currentTool !== 'pen' || penWaveAmp > 0) {
    return;
  }
  const layer = getActiveLayer();
  if (!layer || !strokeCanvas) return;
  layer.ctx.save();
  layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
  layer.ctx.globalCompositeOperation = 'source-over';
  layer.ctx.drawImage(strokeCanvas, 0, 0);
  layer.ctx.restore();
  currentStrokePoints = [];
  clearStrokeCanvas();
  setLayerCacheDirty(true);
}

// ===================================================================
// Coordinate math
// ===================================================================
export function getCanvasPoint(clientX: number, clientY: number): Point {
  const rect = container.getBoundingClientRect();
  const screenX = clientX - rect.left;
  const screenY = clientY - rect.top;

  const dx = screenX - viewOffsetX;
  const dy = screenY - viewOffsetY;

  const cos = Math.cos(viewRotation);
  const sin = Math.sin(viewRotation);

  const rx = dx * cos + dy * sin;
  const ry = -dx * sin + dy * cos;

  return { x: rx / viewScale, y: ry / viewScale };
}

// ===================================================================
// StrokeSmoother
// ===================================================================
// 点同士の距離が定数 X ピクセル以下になるようにたどる基準距離 (px)
export const MAX_POINT_DISTANCE_X = 4.0;
let lastProcessedTimestamp = -1;

export function smootherReset() {
  setAnchorPoint(null);
  setLastInputPoint(null);
  setLastRenderPos(null);
  setLastInputTime(0);
  lastProcessedTimestamp = -1;

  strokeDistance = 0;
  const baseFreq = (2 * Math.PI) / (penWavePeriod || 150);
  waveFreq1 = baseFreq * (0.8 + 0.4 * Math.random());
  waveFreq2 = baseFreq * (1.7 + 0.6 * Math.random());
  waveFreq3 = baseFreq * (0.4 + 0.3 * Math.random());
  wavePhase1 = Math.random() * Math.PI * 2;
  wavePhase2 = Math.random() * Math.PI * 2;
  wavePhase3 = Math.random() * Math.PI * 2;
  currentStrokePoints = [];
  clearStrokeCanvas();
}

export function processResampledPoints(nextP: Point, timeStamp?: number) {
  if (timeStamp !== undefined) {
    // タイムスタンプ逆転の排除 (iPad Safari / Apple Pencil 対策)
    if (lastProcessedTimestamp !== -1 && timeStamp < lastProcessedTimestamp) {
      return;
    }
    lastProcessedTimestamp = timeStamp;
  }

  // 同一・ノイズ的重複座標の排除 (線が枝分かれ・がたがたになる原因を除去)
  if (lastInputPoint) {
    const dx = nextP.x - lastInputPoint.x;
    const dy = nextP.y - lastInputPoint.y;
    if (dx * dx + dy * dy < minPointDistance * minPointDistance) {
      return;
    }
  }

  smootherProcessPoint(nextP);
  smootherTick();
  addDrawnPointsCount(1);
}

export function smootherProcessPoint(p: Point) {
  setLastInputTime(performance.now());
  if (!anchorPoint) {
    setAnchorPoint({ x: p.x, y: p.y });
    setLastInputPoint({ x: p.x, y: p.y });
    setLastRenderPos({ x: p.x, y: p.y });
    return;
  }
  setLastInputPoint({ x: p.x, y: p.y });
}

export function smootherTick() {
  if (!isDrawing || !anchorPoint || !lastInputPoint || !lastRenderPos) return;

  const ap = anchorPoint;
  const target = lastInputPoint;
  const effectiveLazyRadius = lazyRadius / (viewScale || 1);

  if (effectiveLazyRadius <= 0.1) {
    // 手ぶれ補正0: 座標オーバーシュートやワープによる線の枝分かれ・三角形化を完全に防ぎ、正確に目標点へ移動
    ap.x = target.x;
    ap.y = target.y;
  } else {
    // 手ぶれ補正あり: ワープ衝突による「がたがた」を防ぐ、滑らかで安定した指数平滑追尾
    // lazyRadius に応じて平滑化率を調整し、かつ目標との距離に応じて自然に引き寄せる
    const smoothingFactor = Math.max(0.1, Math.min(0.85, 1.0 - (effectiveLazyRadius / 75)));
    ap.x += (target.x - ap.x) * smoothingFactor;
    ap.y += (target.y - ap.y) * smoothingFactor;

    const dx = target.x - ap.x;
    const dy = target.y - ap.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > effectiveLazyRadius) {
      // 許容遅延半径を超えた分のみ穏やかに引き寄せる（ドカンとしたワープ段差を排除）
      const excess = dist - effectiveLazyRadius;
      const pull = excess / dist;
      ap.x += dx * pull;
      ap.y += dy * pull;
    }
  }

  const movedX = ap.x - lastRenderPos.x;
  const movedY = ap.y - lastRenderPos.y;
  if (movedX * movedX + movedY * movedY < 0.01) return;

  drawSegment(lastRenderPos, { x: ap.x, y: ap.y });
  setLastRenderPos({ x: ap.x, y: ap.y });
}

// ===================================================================
// Setup event listeners for color/size/tool controls
// ===================================================================
export function initDrawingListeners() {
  colorInput.addEventListener('input', (e) => {
    updateColorDisplay(new Color((e.target as HTMLInputElement).value));
  });

  btnToggleTool.addEventListener('click', () => {
    if (isLayerMoveMode) {
      setIsLayerMoveMode(false);
      updateLayerMoveBtnUI();
    }
    if (currentTool === 'pen') {
      setCurrentTool('eraser');
      btnToggleTool.innerHTML = '<i data-lucide="eraser"></i>';
      btnToggleTool.title = 'Eraser';
    } else {
      setCurrentTool('pen');
      btnToggleTool.innerHTML = '<i data-lucide="pen-tool"></i>';
      btnToggleTool.title = 'Pen';
    }
    if ((window as any).lucide) {
      (window as any).lucide.createIcons({ root: btnToggleTool });
    }
  });

  sizeSlider.addEventListener('input', (e) => {
    const sliderVal = parseFloat((e.target as HTMLInputElement).value);
    const size = Math.pow(10, sliderVal / 50);
    setCurrentSize(Math.max(1, Math.round(size)));
    sizeValEl.innerText = currentSize.toString();
  });

  stabSlider.addEventListener('input', (e) => {
    const sliderVal = parseFloat((e.target as HTMLInputElement).value);
    setLazyRadius(Math.round(12.5 * (Math.pow(3, sliderVal / 50) - 1)));
    stabValEl.innerText = lazyRadius.toString();
    if (lazyRadiusCursorEl) {
      const diameter = Math.max(6, lazyRadius * 2);
      lazyRadiusCursorEl.style.width = `${diameter}px`;
      lazyRadiusCursorEl.style.height = `${diameter}px`;
    }
  });

  minDistSlider.addEventListener('input', (e) => {
    const sliderVal = parseFloat((e.target as HTMLInputElement).value);
    const dist = sliderVal / 10;
    setMinPointDistance(dist);
    minDistValEl.innerText = dist.toFixed(1);
  });

  penWaveAmpSlider.addEventListener('input', (e) => {
    const sliderVal = parseFloat((e.target as HTMLInputElement).value);
    setPenWaveAmp(sliderVal / 100);
    penWaveAmpValEl.innerText = Math.round(sliderVal).toString();
  });

  penWavePeriodSlider.addEventListener('input', (e) => {
    const sliderVal = parseFloat((e.target as HTMLInputElement).value);
    setPenWavePeriod(Math.round(sliderVal));
    penWavePeriodValEl.innerText = Math.round(sliderVal).toString();
  });

  // Start animation loop
  function tick() {
    smootherTick();
    if (needComposite) {
      compositeFast();
      needComposite = false;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
