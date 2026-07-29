export interface LayerData {
  id: number;
  name: string;
  visible: boolean;
  data: string; // base64 encoded PNG
  clipped?: boolean;
  blendMode?: 'source-over' | 'multiply';
}

export interface SaveData {
  version: number;
  id: string; // 'paint_canvas_0', 'paint_canvas_1', etc.
  name: string;
  updatedAt: string;
  canvas: { w: number; h: number };
  activeLayerId: number;
  nextLayerId: number;
  layers: LayerData[];
  thumbnail?: string;
}

export interface CanvasMetadata {
  id: string;
  name: string;
  updatedAt: string;
  thumbnail?: string; // Optional: background layer as thumbnail
  gdriveFileId?: string; // If synced to Google Drive
}

export function getAllLocalCanvasIds(): string[] {
  const ids: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('paint_canvas_')) {
      ids.push(key);
    }
  }
  return ids;
}

export function deleteLocalCanvas(id: string): void {
  localStorage.removeItem(id);
}

const STORAGE_PREFIX = 'paint_canvas_';

export function getStorageUsage(): { usedKB: number; maxKB: number; percentage: number } {
  let totalBytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      // rough estimation of byte size in UTF-16
      totalBytes += (key.length + (localStorage.getItem(key)?.length || 0)) * 2;
    }
  }
  const usedKB = Math.round(totalBytes / 1024);
  const maxKB = 5 * 1024; // Typically 5MB limit per origin
  const percentage = Math.min(100, Math.round((usedKB / maxKB) * 100));
  return { usedKB, maxKB, percentage };
}

export function getSavedCanvasesMetadata(): CanvasMetadata[] {
  const metadataList: CanvasMetadata[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) {
      try {
        const item = localStorage.getItem(key);
        if (item) {
          const parsed = JSON.parse(item) as SaveData;
          // Extract a small thumbnail if possible
          let thumbnail = undefined;
          if (parsed.thumbnail) {
            thumbnail = parsed.thumbnail;
          } else if (parsed.layers && parsed.layers.length > 0 && parsed.layers[0].data) {
             thumbnail = parsed.layers[0].data; // use background as basic thumbnail fallback
          }

          metadataList.push({
            id: parsed.id,
            name: parsed.name || '無題のキャンバス',
            updatedAt: parsed.updatedAt,
            thumbnail
          });
        }
      } catch (e) {
        console.error('Failed to parse saved canvas metadata', e);
      }
    }
  }
  // Sort by updatedAt descending (newest first)
  return metadataList.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function generateNewCanvasId(): string {
  // Find highest index to append
  let maxIndex = -1;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) {
      const idxStr = key.replace(STORAGE_PREFIX, '');
      const idx = parseInt(idxStr, 10);
      if (!isNaN(idx) && idx > maxIndex) {
        maxIndex = idx;
      }
    }
  }
  return `${STORAGE_PREFIX}${maxIndex + 1}`;
}

export function saveCanvas(data: SaveData): boolean {
  try {
    const jsonStr = JSON.stringify(data);
    localStorage.setItem(data.id, jsonStr);
    return true;
  } catch (e) {
    console.error('Failed to save canvas (possibly QuotaExceededError)', e);
    return false;
  }
}

export function loadCanvas(id: string): SaveData | null {
  try {
    const jsonStr = localStorage.getItem(id);
    if (jsonStr) {
      return JSON.parse(jsonStr) as SaveData;
    }
  } catch (e) {
    console.error('Failed to load canvas', e);
  }
  return null;
}

export function clearAllCanvases(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
}
