import type { Layer, UndoEntry } from './types';
import { layers, activeLayerId, setActiveLayerId, nextLayerId, setNextLayerId, undoStack, redoStack, MAX_UNDO, setHasUnsavedChanges } from './state';
import { undoToastEl } from './dom';
import { createLayerCanvas, compositeAndDisplay } from './canvas';

// Forward declaration - will be set by layers.ts to avoid circular dependency
let _renderLayerList: () => void = () => {};
export function setRenderLayerList(fn: () => void) { _renderLayerList = fn; }

export function pushUndo(entry: UndoEntry) {
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  setHasUnsavedChanges(true);
}

export function saveUndoState(layerId: number) {
  const layer = layers.find(l => l.id === layerId);
  if (!layer) return;
  const imageData = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
  pushUndo({ type: 'stroke', layerId, imageData });
}

export function performUndo() {
  const entry = undoStack.pop();
  if (!entry) return;
  setHasUnsavedChanges(true);

  switch (entry.type) {
    case 'stroke': {
      const layer = layers.find(l => l.id === entry.layerId);
      if (!layer) return;
      const currentData = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
      redoStack.push({ type: 'stroke', layerId: entry.layerId, imageData: currentData });
      layer.ctx.putImageData(entry.imageData, 0, 0);
      break;
    }
    case 'addLayer': {
      const layer = layers.find(l => l.id === entry.layerId);
      const imageData = layer
        ? layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
        : null;
      const index = layers.findIndex(l => l.id === entry.layerId);
      if (index !== -1) layers.splice(index, 1);
      setActiveLayerId(entry.prevActiveLayerId);
      if (!layers.find(l => l.id === activeLayerId) && layers.length > 0) {
        setActiveLayerId(layers[layers.length - 1].id);
      }
      redoStack.push({
        type: 'addLayer',
        layerId: entry.layerId,
        layerIndex: index !== -1 ? index : entry.layerIndex,
        layerName: entry.layerName,
        imageData,
        prevActiveLayerId: activeLayerId,
        clipped: entry.clipped || false
      });
      _renderLayerList();
      break;
    }
    case 'deleteLayer': {
      const { canvas, ctx } = createLayerCanvas();
      const restoredLayer: Layer = {
        id: entry.layerId,
        name: entry.layerName,
        visible: true,
        canvas,
        ctx,
        clipped: entry.clipped || false,
      };
      restoredLayer.ctx.putImageData(entry.imageData, 0, 0);
      if (entry.layerId >= nextLayerId) setNextLayerId(entry.layerId + 1);
      layers.splice(entry.layerIndex, 0, restoredLayer);
      setActiveLayerId(entry.prevActiveLayerId);
      if (!layers.find(l => l.id === activeLayerId) && layers.length > 0) {
        setActiveLayerId(layers[layers.length - 1].id);
      }
      redoStack.push({
        type: 'deleteLayer',
        layerId: entry.layerId,
        layerIndex: entry.layerIndex,
        layerName: entry.layerName,
        imageData: entry.imageData,
        prevActiveLayerId: activeLayerId,
      });
      _renderLayerList();
      break;
    }
    case 'reorderLayers': {
      const order = entry.prevLayersOrder;
      layers.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      if (entry.prevClippedStates) {
        layers.forEach(l => {
          if (entry.prevClippedStates![l.id] !== undefined) {
            l.clipped = entry.prevClippedStates![l.id];
          }
        });
      }
      redoStack.push({
        type: 'reorderLayers',
        layersOrder: entry.layersOrder,
        prevLayersOrder: entry.prevLayersOrder,
        clippedStates: entry.clippedStates,
        prevClippedStates: entry.prevClippedStates
      });
      _renderLayerList();
      break;
    }
    case 'toggleClip': {
      const layer = layers.find(l => l.id === entry.layerId);
      if (layer) {
        redoStack.push({
          type: 'toggleClip',
          layerId: entry.layerId,
          clipped: layer.clipped
        });
        layer.clipped = entry.clipped;
        _renderLayerList();
      }
      break;
    }
  }

  compositeAndDisplay();
  showToast('Undo');
}

export function performRedo() {
  const entry = redoStack.pop();
  if (!entry) return;
  setHasUnsavedChanges(true);

  switch (entry.type) {
    case 'stroke': {
      const layer = layers.find(l => l.id === entry.layerId);
      if (!layer) return;
      const currentData = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
      undoStack.push({ type: 'stroke', layerId: entry.layerId, imageData: currentData });
      layer.ctx.putImageData(entry.imageData, 0, 0);
      break;
    }
    case 'addLayer': {
      const { canvas, ctx } = createLayerCanvas();
      const restoredLayer: Layer = {
        id: entry.layerId,
        name: entry.layerName,
        visible: true,
        canvas,
        ctx,
        clipped: entry.clipped || false,
      };
      if (entry.imageData) {
        restoredLayer.ctx.putImageData(entry.imageData, 0, 0);
      }
      if (entry.layerId >= nextLayerId) setNextLayerId(entry.layerId + 1);
      layers.splice(entry.layerIndex, 0, restoredLayer);
      const prevActive = activeLayerId;
      setActiveLayerId(entry.layerId);
      undoStack.push({
        type: 'addLayer',
        layerId: entry.layerId,
        layerIndex: entry.layerIndex,
        layerName: entry.layerName,
        imageData: entry.imageData,
        prevActiveLayerId: prevActive,
      });
      _renderLayerList();
      break;
    }
    case 'deleteLayer': {
      const layer = layers.find(l => l.id === entry.layerId);
      const imageData = layer
         ? layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
         : entry.imageData;
      const index = layers.findIndex(l => l.id === entry.layerId);
      if (index !== -1) layers.splice(index, 1);
      const prevActive = activeLayerId;
      if (activeLayerId === entry.layerId && layers.length > 0) {
        setActiveLayerId(layers[Math.min(index, layers.length - 1)].id);
      }
      undoStack.push({
        type: 'deleteLayer',
        layerId: entry.layerId,
        layerIndex: index !== -1 ? index : entry.layerIndex,
        layerName: entry.layerName,
        imageData,
        prevActiveLayerId: prevActive,
        clipped: entry.clipped || false
      });
      _renderLayerList();
      break;
    }
    case 'reorderLayers': {
      const order = entry.layersOrder;
      layers.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      if (entry.clippedStates) {
        layers.forEach(l => {
          if (entry.clippedStates![l.id] !== undefined) {
            l.clipped = entry.clippedStates![l.id];
          }
        });
      }
      undoStack.push({
        type: 'reorderLayers',
        layersOrder: entry.layersOrder,
        prevLayersOrder: entry.prevLayersOrder,
        clippedStates: entry.clippedStates,
        prevClippedStates: entry.prevClippedStates
      });
      _renderLayerList();
      break;
    }
    case 'toggleClip': {
      const layer = layers.find(l => l.id === entry.layerId);
      if (layer) {
        undoStack.push({
          type: 'toggleClip',
          layerId: entry.layerId,
          clipped: layer.clipped
        });
        layer.clipped = entry.clipped;
        _renderLayerList();
      }
      break;
    }
  }

  compositeAndDisplay();
  showToast('Redo');
}

let toastTimeout: ReturnType<typeof setTimeout> | null = null;
export function showToast(text: string) {
  undoToastEl.textContent = text;
  undoToastEl.classList.add('show');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    undoToastEl.classList.remove('show');
  }, 1000);
}
