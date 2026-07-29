import type { Layer } from './types';
import { layers, activeLayerId, setActiveLayerId, nextLayerId, setNextLayerId, currentColor, isLayerMoveMode, setIsLayerMoveMode } from './state';
import { layerListEl, layerPanelEl, btnActiveClip, btnActiveDelete, btnLayerBlendToggle, btnLayerMove } from './dom';
import { createLayerCanvas, compositeAndDisplay } from './canvas';
import { pushUndo, setRenderLayerList } from './undo';
import { getMaxChromaColor, fillLayerColor } from './drawing';

export function getActiveLayer(): Layer | undefined {
  return layers.find(l => l.id === activeLayerId);
}

// Internal: add layer without recording undo (used by init and undo/redo restore)
export function addLayerInternal(name?: string, targetIndex?: number): Layer {
  const { canvas, ctx } = createLayerCanvas();
  const layer: Layer = {
    id: nextLayerId,
    name: name || `Layer ${layers.length + 1}`,
    visible: true,
    canvas,
    ctx,
    clipped: false,
  };
  setNextLayerId(nextLayerId + 1);

  let idx = typeof targetIndex === 'number' ? targetIndex : -1;
  if (idx === -1) {
    const currentIdx = layers.findIndex(l => l.id === activeLayerId);
    idx = currentIdx !== -1 ? currentIdx + 1 : layers.length;
  }
  idx = Math.max(0, Math.min(idx, layers.length));
  layers.splice(idx, 0, layer);

  setActiveLayerId(layer.id);
  renderLayerList();
  compositeAndDisplay();
  return layer;
}

// Public: add layer with undo recording
export function addLayer(name?: string): Layer {
  const prevActiveId = activeLayerId;
  const layer = addLayerInternal(name);
  const index = layers.findIndex(l => l.id === layer.id);
  pushUndo({
    type: 'addLayer',
    layerId: layer.id,
    layerIndex: index,
    layerName: layer.name,
    imageData: null,
    prevActiveLayerId: prevActiveId,
  });
  return layer;
}

// Internal: delete layer without recording undo
export function deleteLayerInternal(id: number): { layer: Layer; index: number } | null {
  if (layers.length <= 1) return null;
  const index = layers.findIndex(l => l.id === id);
  if (index === -1) return null;
  const layer = layers[index];
  layers.splice(index, 1);
  if (activeLayerId === id) {
    setActiveLayerId(layers[Math.min(index, layers.length - 1)].id);
  }
  renderLayerList();
  compositeAndDisplay();
  return { layer, index };
}

// Public: delete layer with undo recording
export function deleteLayer(id: number) {
  if (layers.length <= 1) return;
  const layerToDelete = layers.find(l => l.id === id);
  if (!layerToDelete) return;

  const imageData = layerToDelete.ctx.getImageData(0, 0, layerToDelete.canvas.width, layerToDelete.canvas.height);
  const prevActiveId = activeLayerId;
  const result = deleteLayerInternal(id);
  if (!result) return;

  pushUndo({
    type: 'deleteLayer',
    layerId: result.layer.id,
    layerIndex: result.index,
    layerName: result.layer.name,
    imageData,
    prevActiveLayerId: prevActiveId,
    clipped: layerToDelete.clipped
  });
}

export function moveLayerByDelta(id: number, delta: number) {
  const index = layers.findIndex(l => l.id === id);
  if (index === -1) return;
  const newIndex = index + delta;
  if (newIndex < 0 || newIndex >= layers.length) return;
  const temp = layers[index];
  layers[index] = layers[newIndex];
  layers[newIndex] = temp;
  renderLayerList();
  compositeAndDisplay();
}

function finalizeReorder() {
  const draggingItem = layerListEl.querySelector('.layer-item.dragging') as HTMLDivElement;
  if (draggingItem) {
    draggingItem.classList.remove('dragging');
  }
  
  const children = Array.from(layerListEl.children);
  const newOrderIds = children.map(child => parseInt(child.getAttribute('data-id')!, 10));
  newOrderIds.reverse();
  
  const currentOrderIds = layers.map(l => l.id);
  const orderChanged = newOrderIds.some((id, idx) => id !== currentOrderIds[idx]);
  
  if (orderChanged) {
    const prevOrder = [...currentOrderIds];
    const prevClippedStates: { [layerId: number]: boolean } = {};
    layers.forEach(l => {
      prevClippedStates[l.id] = l.clipped;
    });

    layers.sort((a, b) => newOrderIds.indexOf(a.id) - newOrderIds.indexOf(b.id));
    
    // Bottom-most layer cannot be clipped
    if (layers.length > 0 && layers[0].clipped) {
      layers[0].clipped = false;
      if (layers[0].blendMode === 'multiply') {
        layers[0].blendMode = 'source-over';
      }
    }
    
    const clippedStates: { [layerId: number]: boolean } = {};
    layers.forEach(l => {
      clippedStates[l.id] = l.clipped;
    });

    pushUndo({
      type: 'reorderLayers',
      layersOrder: [...newOrderIds],
      prevLayersOrder: prevOrder,
      clippedStates,
      prevClippedStates
    });
    
    compositeAndDisplay();
  }
  
  renderLayerList();
}

export function renderLayerList() {
  layerListEl.innerHTML = '';
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const item = document.createElement('div');
    item.className = 'layer-item' + (layer.id === activeLayerId ? ' selected' : '') + (layer.clipped ? ' clipped' : '');
    item.setAttribute('data-id', layer.id.toString());

    const vis = document.createElement('span');
    vis.className = 'layer-visibility icon-btn sm';
    vis.innerHTML = layer.visible ? '<i data-lucide="eye"></i>' : '<i data-lucide="eye-off"></i>';
    vis.addEventListener('click', (e) => {
      e.stopPropagation();
      layer.visible = !layer.visible;
      renderLayerList();
      compositeAndDisplay();
    });

    const spacer = document.createElement('div');
    spacer.style.flex = '1';

    const grip = document.createElement('span');
    grip.className = 'layer-grip icon-btn sm';
    grip.innerHTML = '<i data-lucide="grip-vertical"></i>';
    grip.title = 'Drag to reorder';
    
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      grip.setPointerCapture(e.pointerId);
      
      const rect = item.getBoundingClientRect();
      const startY = e.clientY;
      const startTop = rect.top;
      
      const placeholder = document.createElement('div');
      placeholder.className = 'layer-item placeholder';
      placeholder.style.height = `${rect.height}px`;
      placeholder.style.background = 'var(--muted)';
      placeholder.style.border = '1px dashed var(--border)';
      placeholder.style.opacity = '0.5';
      placeholder.style.borderRadius = 'calc(var(--radius) - 2px)';
      placeholder.style.boxSizing = 'border-box';
      
      layerListEl.insertBefore(placeholder, item);
      
      item.classList.add('dragging');
      item.style.position = 'fixed';
      item.style.top = `${startTop}px`;
      item.style.left = `${rect.left}px`;
      item.style.width = `${rect.width}px`;
      item.style.height = `${rect.height}px`;
      item.style.zIndex = '9999';
      item.style.boxSizing = 'border-box';
      item.style.margin = '0';
      
      const onMove = (ev: PointerEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        const deltaY = ev.clientY - startY;
        item.style.transform = `translateY(${deltaY}px)`;
        
        item.style.visibility = 'hidden';
        const elementUnder = document.elementFromPoint(ev.clientX, ev.clientY);
        item.style.visibility = '';
        
        const targetItem = elementUnder?.closest('.layer-item:not(.dragging)') as HTMLDivElement;
        if (targetItem && targetItem !== placeholder) {
          const children = Array.from(layerListEl.children).filter(c => c !== item);
          const pIdx = children.indexOf(placeholder);
          const tIdx = children.indexOf(targetItem);
          if (pIdx < tIdx) {
            layerListEl.insertBefore(placeholder, targetItem.nextSibling);
          } else {
            layerListEl.insertBefore(placeholder, targetItem);
          }
        }
      };
      
      const onUp = (ev: PointerEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        grip.removeEventListener('pointermove', onMove);
        grip.removeEventListener('pointerup', onUp);
        grip.removeEventListener('pointercancel', onUp);
        try { grip.releasePointerCapture(ev.pointerId); } catch(err){}
        
        layerListEl.insertBefore(item, placeholder);
        placeholder.remove();
        
        item.style.position = '';
        item.style.top = '';
        item.style.left = '';
        item.style.width = '';
        item.style.height = '';
        item.style.zIndex = '';
        item.style.margin = '';
        item.style.transform = '';
        
        finalizeReorder();
      };
      
      grip.addEventListener('pointermove', onMove);
      grip.addEventListener('pointerup', onUp);
      grip.addEventListener('pointercancel', onUp);
    });

    const colorCircle = document.createElement('span');
    colorCircle.className = 'layer-color-circle';
    const H = (layer.id % 8) * 45;
    colorCircle.style.backgroundColor = getMaxChromaColor(H);

    item.appendChild(vis);

    // Clipping mask L-arrow indicator
    if (layer.clipped) {
      const clipIndicator = document.createElement('span');
      clipIndicator.className = 'layer-clip-indicator';
      clipIndicator.innerHTML = '<i data-lucide="corner-down-right"></i>';
      item.appendChild(clipIndicator);
    }

    item.appendChild(colorCircle);
    item.appendChild(spacer);
    item.appendChild(grip);

    item.addEventListener('click', () => {
      setActiveLayerId(layer.id);
      renderLayerList();
    });

    layerListEl.appendChild(item);
  }

  // Update selected layer actions row state
  const activeLayer = getActiveLayer();
  if (activeLayer) {
    const activeIdx = layers.indexOf(activeLayer);
    
    // Clipping mask toggle button
    btnActiveClip.disabled = (activeIdx === 0);
    if (activeLayer.clipped) {
      btnActiveClip.classList.add('active');
    } else {
      btnActiveClip.classList.remove('active');
    }

    // Delete button
    btnActiveDelete.disabled = (layers.length <= 1);
  } else {
    btnActiveClip.disabled = true;
    btnActiveClip.classList.remove('active');
    btnActiveDelete.disabled = true;
  }

  updateLayerBlendToggleUI();

  if ((window as any).lucide) {
    (window as any).lucide.createIcons({
      root: layerPanelEl
    });
  }
}

export function updateLayerBlendToggleUI() {
  const activeLayer = getActiveLayer();
  if (!activeLayer) {
    btnLayerBlendToggle.disabled = true;
    btnLayerMove.disabled = true;
    return;
  }
  btnLayerMove.disabled = false;

  if (!activeLayer.clipped) {
    if (activeLayer.blendMode === 'multiply') {
      activeLayer.blendMode = 'source-over';
    }
    btnLayerBlendToggle.disabled = true;
    btnLayerBlendToggle.className = 'layer-blend-toggle-btn normal-mode';
    btnLayerBlendToggle.innerHTML = `<i data-lucide="layers"></i>`;
    btnLayerBlendToggle.title = '現在の合成モード: 通常 (クリッピング中のみ乗算に変更可能)';
  } else {
    btnLayerBlendToggle.disabled = false;
    if (activeLayer.blendMode === 'multiply') {
      btnLayerBlendToggle.className = 'layer-blend-toggle-btn multiply-mode';
      btnLayerBlendToggle.innerHTML = `<i data-lucide="sparkles"></i>`;
      btnLayerBlendToggle.title = '現在の合成モード: 乗算 (クリックで通常に切り替え)';
    } else {
      btnLayerBlendToggle.className = 'layer-blend-toggle-btn normal-mode';
      btnLayerBlendToggle.innerHTML = `<i data-lucide="layers"></i>`;
      btnLayerBlendToggle.title = '現在の合成モード: 通常 (クリックで乗算に切り替え)';
    }
  }
  updateLayerMoveBtnUI();
}

export function updateLayerMoveBtnUI() {
  if (isLayerMoveMode) {
    btnLayerMove.classList.add('active');
  } else {
    btnLayerMove.classList.remove('active');
  }
}

// Register renderLayerList with undo module to break circular dependency
setRenderLayerList(renderLayerList);

export function initLayerListeners() {
  const btnAddLayer = document.getElementById('btn-add-layer') as HTMLButtonElement;
  const btnActiveFill = document.getElementById('btn-active-fill') as HTMLButtonElement;

  btnLayerMove.addEventListener('click', () => {
    setIsLayerMoveMode(!isLayerMoveMode);
    updateLayerMoveBtnUI();
  });

  btnLayerBlendToggle.addEventListener('click', () => {
    const activeLayer = getActiveLayer();
    if (!activeLayer || !activeLayer.clipped) return;
    activeLayer.blendMode = activeLayer.blendMode === 'multiply' ? 'source-over' : 'multiply';
    renderLayerList();
    compositeAndDisplay();
  });

  btnAddLayer.addEventListener('click', () => {
    addLayer();
    compositeAndDisplay();
  });

  btnActiveClip.addEventListener('click', () => {
    const activeLayer = getActiveLayer();
    if (!activeLayer) return;
    const idx = layers.indexOf(activeLayer);
    if (idx === 0) return;
    
    activeLayer.clipped = !activeLayer.clipped;
    if (!activeLayer.clipped && activeLayer.blendMode === 'multiply') {
      activeLayer.blendMode = 'source-over';
    }
    
    pushUndo({
      type: 'toggleClip',
      layerId: activeLayer.id,
      clipped: activeLayer.clipped
    });
    
    renderLayerList();
    compositeAndDisplay();
  });

  btnActiveFill.addEventListener('click', () => {
    const activeLayer = getActiveLayer();
    if (!activeLayer) return;
    fillLayerColor(activeLayer.id, currentColor);
  });

  btnActiveDelete.addEventListener('click', () => {
    const activeLayer = getActiveLayer();
    if (!activeLayer) return;
    deleteLayer(activeLayer.id);
  });
}
