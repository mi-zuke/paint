

export interface Point { x: number; y: number; }

export interface Layer {
  id: number;
  name: string;
  visible: boolean;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  clipped: boolean;
  blendMode?: 'source-over' | 'multiply';
}

export interface StrokeUndoEntry {
  type: 'stroke';
  layerId: number;
  imageData: ImageData;
}

export interface AddLayerUndoEntry {
  type: 'addLayer';
  layerId: number;
  layerIndex: number;
  layerName: string;
  imageData: ImageData | null;
  prevActiveLayerId: number;
  clipped?: boolean;
}

export interface DeleteLayerUndoEntry {
  type: 'deleteLayer';
  layerId: number;
  layerIndex: number;
  layerName: string;
  imageData: ImageData;
  prevActiveLayerId: number;
  clipped?: boolean;
}

export interface ReorderLayersUndoEntry {
  type: 'reorderLayers';
  layersOrder: number[];
  prevLayersOrder: number[];
  clippedStates?: { [layerId: number]: boolean };
  prevClippedStates?: { [layerId: number]: boolean };
}

export interface ToggleClipUndoEntry {
  type: 'toggleClip';
  layerId: number;
  clipped: boolean;
  blendMode?: 'source-over' | 'multiply';
}

export type UndoEntry = StrokeUndoEntry | AddLayerUndoEntry | DeleteLayerUndoEntry | ReorderLayersUndoEntry | ToggleClipUndoEntry;

export interface TapRecord {
  pointerId: number;
  startTime: number;
  startX: number;
  startY: number;
  moved: boolean;
}
