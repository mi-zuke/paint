import { activeTouchPointers, drawingPointerId, setDrawingPointerId, isDrawing, setIsDrawing, viewScale, viewOffsetX, viewOffsetY, viewRotation, setViewScale, setViewOffsetX, setViewOffsetY, setViewRotation, initialPinchDistance, initialPinchAngle, initialViewScale, initialViewRotation, initialPinchCenter, initialViewOffset, setInitialPinchDistance, setInitialPinchAngle, setInitialViewScale, setInitialViewRotation, setInitialPinchCenter, setInitialViewOffset, tapRecords, setTapRecords, TAP_MAX_DURATION, TAP_MAX_DISTANCE, isLayerMoveMode, lazyRadius } from './state';
import { container, lazyRadiusCursorEl } from './dom';
import { getCanvasPoint, smootherReset, processResampledPoints, flushComposite, commitStrokeToLayer } from './drawing';
import { saveUndoState, performUndo, performRedo, pushUndo } from './undo';
import { updateViewTransform, compositeAndDisplay, compositeFast, getCanvasDPR } from './canvas';
import { getActiveLayer } from './layers';
import { addReceivedPointsCount } from './debug_graph';

// ===================================================================
// Tap Detection (2-finger undo, 3-finger redo)
// ===================================================================
function addTapRecord(e: PointerEvent) {
  if (drawingPointerId !== null) return;
  tapRecords.push({
    pointerId: e.pointerId,
    startTime: performance.now(),
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
  });
}

function updateTapRecord(e: PointerEvent) {
  const rec = tapRecords.find(r => r.pointerId === e.pointerId);
  if (!rec) return;
  const dx = e.clientX - rec.startX;
  const dy = e.clientY - rec.startY;
  if (dx * dx + dy * dy > TAP_MAX_DISTANCE * TAP_MAX_DISTANCE) {
    rec.moved = true;
  }
}

function checkTapOnAllUp(): number | null {
  const now = performance.now();
  const count = tapRecords.length;
  if (count < 2) { setTapRecords([]); return null; }

  const allQuick = tapRecords.every(r => (now - r.startTime) < TAP_MAX_DURATION);
  const noneMoved = tapRecords.every(r => !r.moved);

  setTapRecords([]);

  if (allQuick && noneMoved) {
    return count;
  }
  return null;
}

// ===================================================================
// Gestures (Pan / Zoom)
// ===================================================================
function getPointers() {
  return Array.from(activeTouchPointers.values());
}

function initGesture() {
  const pts = getPointers();
  if (pts.length < 2) return;

  const p1 = pts[0];
  const p2 = pts[1];

  const dx = p2.clientX - p1.clientX;
  const dy = p2.clientY - p1.clientY;
  setInitialPinchDistance(Math.hypot(dx, dy));
  setInitialPinchAngle(Math.atan2(dy, dx));
  setInitialViewScale(viewScale);
  setInitialViewRotation(viewRotation);

  const rect = container.getBoundingClientRect();
  setInitialPinchCenter({
    x: (p1.clientX + p2.clientX) / 2 - rect.left,
    y: (p1.clientY + p2.clientY) / 2 - rect.top,
  });

  setInitialViewOffset({ x: viewOffsetX, y: viewOffsetY });
}

function handleGesture() {
  const pts = getPointers();
  if (pts.length < 2 || !initialPinchDistance || !initialPinchCenter || !initialViewOffset || initialPinchAngle === null) return;

  const p1 = pts[0];
  const p2 = pts[1];

  const dx = p2.clientX - p1.clientX;
  const dy = p2.clientY - p1.clientY;
  const currentDistance = Math.hypot(dx, dy);
  const currentAngle = Math.atan2(dy, dx);

  let newScale = initialViewScale * (currentDistance / initialPinchDistance);
  newScale = Math.max(0.1, Math.min(newScale, 10));

  let newRotation = initialViewRotation + (currentAngle - initialPinchAngle);

  const rect = container.getBoundingClientRect();
  const currentCenter = {
    x: (p1.clientX + p2.clientX) / 2 - rect.left,
    y: (p1.clientY + p2.clientY) / 2 - rect.top,
  };

  const vX = initialPinchCenter.x - initialViewOffset.x;
  const vY = initialPinchCenter.y - initialViewOffset.y;

  const deltaAngle = newRotation - initialViewRotation;
  const cos = Math.cos(deltaAngle);
  const sin = Math.sin(deltaAngle);

  const rotatedVX = vX * cos - vY * sin;
  const rotatedVY = vX * sin + vY * cos;

  const scaleRatio = newScale / initialViewScale;
  const scaledVX = rotatedVX * scaleRatio;
  const scaledVY = rotatedVY * scaleRatio;

  setViewOffsetX(currentCenter.x - scaledVX);
  setViewOffsetY(currentCenter.y - scaledVY);
  setViewScale(newScale);
  setViewRotation(newRotation);

  updateViewTransform();
}

// ===================================================================
// Layer Move Mode
// ===================================================================
let isMovingActiveLayer = false;
let moveStartX = 0;
let moveStartY = 0;
let movingLayerOriginalData: ImageData | null = null;
let moveOffscreenCanvas: HTMLCanvasElement | null = null;

function startLayerMove(clientX: number, clientY: number) {
  const layer = getActiveLayer();
  if (!layer) return;
  isMovingActiveLayer = true;
  const pt = getCanvasPoint(clientX, clientY);
  moveStartX = pt.x;
  moveStartY = pt.y;
  movingLayerOriginalData = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
  moveOffscreenCanvas = document.createElement('canvas');
  moveOffscreenCanvas.width = layer.canvas.width;
  moveOffscreenCanvas.height = layer.canvas.height;
  moveOffscreenCanvas.getContext('2d')!.putImageData(movingLayerOriginalData, 0, 0);
}

function processLayerMove(clientX: number, clientY: number) {
  if (!isMovingActiveLayer || !moveOffscreenCanvas) return;
  const layer = getActiveLayer();
  if (!layer) return;
  const dpr = getCanvasDPR();
  const pt = getCanvasPoint(clientX, clientY);
  const physDx = Math.round((pt.x - moveStartX) * dpr);
  const physDy = Math.round((pt.y - moveStartY) * dpr);
  layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
  layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  const prevSmoothing = layer.ctx.imageSmoothingEnabled;
  layer.ctx.imageSmoothingEnabled = false;
  layer.ctx.drawImage(moveOffscreenCanvas, physDx, physDy);
  layer.ctx.imageSmoothingEnabled = prevSmoothing;
  layer.ctx.scale(dpr, dpr);
  compositeFast();
}

function endLayerMove(clientX: number, clientY: number) {
  if (!isMovingActiveLayer || !movingLayerOriginalData) return;
  isMovingActiveLayer = false;
  const layer = getActiveLayer();
  if (!layer) return;
  const pt = getCanvasPoint(clientX, clientY);
  const dx = Math.round(pt.x - moveStartX);
  const dy = Math.round(pt.y - moveStartY);
  if (dx !== 0 || dy !== 0) {
    pushUndo({
      type: 'stroke',
      layerId: layer.id,
      imageData: movingLayerOriginalData
    });
  }
  movingLayerOriginalData = null;
  moveOffscreenCanvas = null;
}

function cancelLayerMove() {
  if (!isMovingActiveLayer || !movingLayerOriginalData) return;
  isMovingActiveLayer = false;
  const layer = getActiveLayer();
  if (layer && moveOffscreenCanvas) {
    const dpr = getCanvasDPR();
    layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
    layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    const prevSmoothing = layer.ctx.imageSmoothingEnabled;
    layer.ctx.imageSmoothingEnabled = false;
    layer.ctx.drawImage(moveOffscreenCanvas, 0, 0);
    layer.ctx.imageSmoothingEnabled = prevSmoothing;
    layer.ctx.scale(dpr, dpr);
    compositeAndDisplay();
  }
  movingLayerOriginalData = null;
  moveOffscreenCanvas = null;
}

function handlePointerUp(e: PointerEvent) {
  if (isLayerMoveMode) {
    if (isMovingActiveLayer && drawingPointerId === e.pointerId) {
      endLayerMove(e.clientX, e.clientY);
      try { container.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      setDrawingPointerId(null);
    }
    if (e.pointerType === 'touch') {
      activeTouchPointers.delete(e.pointerId);
      if (activeTouchPointers.size >= 2) {
        initGesture();
      }
    }
    return;
  }

  if (e.pointerType === 'touch') {
    activeTouchPointers.delete(e.pointerId);
    try { container.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }

    if (drawingPointerId === null) {
      if (activeTouchPointers.size >= 2) {
        initGesture();
      } else if (activeTouchPointers.size === 0) {
        const fingerCount = checkTapOnAllUp();
        if (fingerCount === 2) {
          performUndo();
        } else if (fingerCount !== null && fingerCount >= 3) {
          performRedo();
        }
      }
    }
  } else if (e.pointerType === 'pen' || e.pointerType === 'mouse') {
    if (drawingPointerId === e.pointerId) {
      try { container.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      setDrawingPointerId(null);
      setTapRecords([]);
      if (isDrawing) {
        setIsDrawing(false);
        commitStrokeToLayer();
        smootherReset();
        flushComposite();
      }
    }
  }
}

function updateLazyRadiusCursor(e: PointerEvent) {
  if (!lazyRadiusCursorEl) return;
  if (e.pointerType === 'pen' || e.pointerType === 'mouse') {
    const diameter = Math.max(6, lazyRadius * 2);
    lazyRadiusCursorEl.style.width = `${diameter}px`;
    lazyRadiusCursorEl.style.height = `${diameter}px`;
    lazyRadiusCursorEl.style.left = `${e.clientX}px`;
    lazyRadiusCursorEl.style.top = `${e.clientY}px`;
    lazyRadiusCursorEl.style.display = 'block';
  }
}

export function initInputListeners() {
  container.addEventListener('pointerdown', (e) => {
    updateLazyRadiusCursor(e);
    if (isLayerMoveMode) {
      if (e.pointerType === 'touch') {
        activeTouchPointers.set(e.pointerId, e);
        if (activeTouchPointers.size === 1) {
          setDrawingPointerId(e.pointerId);
          startLayerMove(e.clientX, e.clientY);
        } else if (activeTouchPointers.size >= 2) {
          cancelLayerMove();
          setDrawingPointerId(null);
          initGesture();
        }
      } else {
        setDrawingPointerId(e.pointerId);
        container.setPointerCapture(e.pointerId);
        startLayerMove(e.clientX, e.clientY);
      }
      return;
    }

    if (e.pointerType === 'touch') {
      activeTouchPointers.set(e.pointerId, e);
      addTapRecord(e);

      if (drawingPointerId === null) {
        if (activeTouchPointers.size >= 2) {
          initGesture();
        }
      }
    } else if (e.pointerType === 'pen' || e.pointerType === 'mouse') {
      if (drawingPointerId === null) {
        setDrawingPointerId(e.pointerId);
        container.setPointerCapture(e.pointerId);

        setTapRecords([]);

        const layer = getActiveLayer();
        if (layer) saveUndoState(layer.id);
        setIsDrawing(true);
        smootherReset();
        addReceivedPointsCount(1);
        processResampledPoints(getCanvasPoint(e.clientX, e.clientY), e.timeStamp, true);
      }
    }
  });

  container.addEventListener('pointerleave', () => {
    if (lazyRadiusCursorEl) lazyRadiusCursorEl.style.display = 'none';
  });

  container.addEventListener('pointermove', (e) => {
    updateLazyRadiusCursor(e);
    if (isLayerMoveMode) {
      if (e.pointerType === 'touch') {
        if (activeTouchPointers.has(e.pointerId)) {
          activeTouchPointers.set(e.pointerId, e);
        }
        if (activeTouchPointers.size >= 2) {
          handleGesture();
          return;
        }
      }
      if (isMovingActiveLayer && drawingPointerId === e.pointerId) {
        processLayerMove(e.clientX, e.clientY);
      }
      return;
    }

    if (e.pointerType === 'touch') {
      if (activeTouchPointers.has(e.pointerId)) {
        activeTouchPointers.set(e.pointerId, e);
      }
      updateTapRecord(e);

      if (drawingPointerId === null) {
        if (activeTouchPointers.size >= 2) {
          handleGesture();
        }
      }
    } else if (e.pointerType === 'pen' || e.pointerType === 'mouse') {
      if (drawingPointerId === e.pointerId && isDrawing) {
        const rawEvents = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
        const events = rawEvents.slice().sort((a, b) => a.timeStamp - b.timeStamp);
        addReceivedPointsCount(events.length);
        for (let i = 0; i < events.length; i++) {
          const ev = events[i];
          const isLast = (i === events.length - 1);
          processResampledPoints(getCanvasPoint(ev.clientX, ev.clientY), ev.timeStamp, isLast);
        }
      }
    }
  });

  container.addEventListener('pointerup', handlePointerUp);
  container.addEventListener('pointercancel', handlePointerUp);

  // Wheel support for desktop
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey) {
      const zoomSpeed = 0.01;
      const oldScale = viewScale;
      setViewScale(Math.max(0.1, Math.min(viewScale - e.deltaY * zoomSpeed, 10)));

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      setViewOffsetX(mouseX - (mouseX - viewOffsetX) * (viewScale / oldScale));
      setViewOffsetY(mouseY - (mouseY - viewOffsetY) * (viewScale / oldScale));
    } else {
      setViewOffsetX(viewOffsetX - e.deltaX);
      setViewOffsetY(viewOffsetY - e.deltaY);
    }
    updateViewTransform();
  }, { passive: false });

  // Keyboard undo/redo for desktop
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        performRedo();
      } else {
        performUndo();
      }
    }
  });
}
