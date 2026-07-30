import './style.css';

// HTML Template
const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <div id="start-screen" class="start-screen">
    <div class="start-content">
      <h1>Paint</h1>
      
      <div style="display: flex; gap: 12px; margin-bottom: 24px; width: 100%;">
        <button id="btn-new-canvas" class="start-button" style="flex: 2;">
          <i data-lucide="plus"></i> 新規作成
        </button>
        <button id="btn-start-settings" class="start-button secondary" style="flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 16px;">
          <i data-lucide="settings"></i> 設定
        </button>
      </div>

      <div id="storage-info" class="storage-info" style="margin-top: 20px;"></div>
      <div id="saved-canvases-list" class="saved-canvases-list" style="margin-top: 12px;"></div>
    </div>

    <!-- Settings Modal -->
    <div id="start-settings-modal" class="start-modal">
      <div class="start-modal-content">
        <button id="btn-close-start-settings" class="start-modal-close">
          <i data-lucide="x" style="width: 20px; height: 20px;"></i>
        </button>
        
        <h2 style="margin-top: 0; margin-bottom: 20px; font-size: 18px; font-weight: bold; border-bottom: 1px solid var(--border); padding-bottom: 10px;">設定</h2>
        
        <div class="start-settings-panel" style="margin-bottom: 20px;">
          <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 14px; font-weight: bold;">新規キャンバスサイズ</h3>
          <div class="start-settings-row">
            <label>キャンバスの幅 (px)</label>
            <input type="number" id="start-canvas-w" value="1024" min="100" max="4096" />
          </div>
          <div class="start-settings-row">
            <label>キャンバスの高さ (px)</label>
            <input type="number" id="start-canvas-h" value="768" min="100" max="4096" />
          </div>
        </div>

        <div class="gdrive-settings" style="background: var(--secondary); padding: 16px; border-radius: 8px;">
          <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 14px; font-weight: bold; display: flex; align-items: center; gap: 6px;">
            <i data-lucide="cloud"></i> Google ドライブ連携
          </h3>
          <div class="start-settings-row">
            <label>クライアントID</label>
            <input type="text" id="gdrive-client-id" placeholder="OAuth Client ID" style="font-size: 12px;" />
          </div>
          <div class="button-row" style="margin-top: 12px; display: flex; gap: 8px;">
            <button id="btn-save-gdrive-creds" class="start-button secondary" style="flex: 1; height: 32px; font-size: 12px;">保存</button>
            <button id="btn-gdrive-connect" class="start-button" style="flex: 1; height: 32px; font-size: 12px; background: #4285F4; color: white;">接続</button>
          </div>
          <div id="gdrive-status" style="margin-top: 8px; font-size: 12px; color: var(--muted-foreground);">未接続</div>
        </div>

        <div class="maintenance-settings" style="background: var(--secondary); padding: 16px; border-radius: 8px; margin-top: 12px;">
          <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 14px; font-weight: bold; display: flex; align-items: center; gap: 6px;">
            <i data-lucide="shield-alert"></i> データメンテナンス
          </h3>
          <p style="font-size: 11px; color: var(--muted-foreground); margin-top: 0; margin-bottom: 12px; line-height: 1.4; text-align: left;">
            インデックスと実際のキャンバスファイルの不整合や、破損したデータをスキャンして削除・修復します。
          </p>
          <button id="btn-validate-files" class="start-button secondary" style="height: 32px; font-size: 12px; width: 100%;">
            整合性をチェック & 修復
          </button>
          <button id="btn-clear-storage" class="start-button secondary" style="height: 32px; font-size: 12px; width: 100%; margin-top: 8px; color: var(--destructive); border-color: var(--destructive); display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i> すべてのデータを削除 (Clear All)
          </button>
        </div>
      </div>
    </div>
  </div>

  <div id="paint-app" class="paint-app" style="display: none;">
    <button id="btn-back-to-start" class="back-to-start-btn" title="スタート画面に戻る">
      <i data-lucide="arrow-left"></i>
    </button>
    <div id="canvas-container">
      <div id="canvas-wrapper">
        <canvas id="display-canvas"></canvas>
      </div>
      <div id="lazy-radius-cursor" style="position: fixed; pointer-events: none; border: 1.5px dashed rgba(255, 60, 60, 0.85); background: rgba(255, 60, 60, 0.05); border-radius: 50%; display: none; z-index: 10000; transform: translate(-50%, -50%); box-shadow: 0 0 4px rgba(0,0,0,0.25); transition: width 0.05s ease, height 0.05s ease;"></div>
    </div>



    <div class="layer-panel panel-card" id="layer-panel">
      <div class="layer-panel-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span>Layers</span>
          <button id="btn-add-layer" title="Add layer" class="icon-btn sm"><i data-lucide="plus"></i></button>
        </div>
      </div>
      <div class="layer-actions-row">
        <button id="btn-active-clip" title="Toggle clipping mask" class="icon-btn sm"><i data-lucide="corner-down-right"></i></button>
        <button id="btn-active-fill" title="Fill layer elements with current color" class="icon-btn sm"><i data-lucide="palette"></i></button>
        <button id="btn-active-delete" title="Delete selected layer" class="icon-btn sm"><i data-lucide="trash-2"></i></button>
      </div>
      <div class="layer-list" id="layer-list"></div>
      <div class="layer-footer-row">
        <button id="btn-layer-blend-toggle" class="layer-blend-toggle-btn normal-mode" title="合成モード: 通常 (クリックで乗算に切り替え)">
          <i data-lucide="layers"></i>
        </button>
        <button id="btn-layer-move" class="layer-move-btn" title="レイヤー移動（キャンバス上における移動）">
          <i data-lucide="move"></i>
        </button>
      </div>
    </div>

    <div class="toolbar panel-card">
      <div class="tool-group" style="position: relative; gap: 16px;">
        <button id="btn-toggle-tool" class="icon-btn" title="Pen"><i data-lucide="pen-tool"></i></button>
        <button id="btn-pen-settings" class="icon-btn" title="ペンの詳細設定"><i data-lucide="sliders"></i></button>
        <div id="pen-settings-dropdown" class="settings-dropdown panel-card" style="left: 0; right: auto; min-width: 220px; padding: 14px; gap: 14px;">
          <div style="font-size: 13px; font-weight: bold; border-bottom: 1px solid var(--border); padding-bottom: 6px; color: var(--foreground);">ペンの詳細設定</div>
          
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--foreground);">
              <span>強弱の幅 (強度)</span>
              <span><span id="pen-wave-amp-val">0</span>%</span>
            </div>
            <input type="range" id="pen-wave-amp-slider" min="0" max="100" value="0" style="width: 100%; cursor: pointer;" />
          </div>

          <div style="display: flex; flex-direction: column; gap: 10px;">
            <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--foreground);">
              <span>ゆらぎの周期</span>
              <span><span id="pen-wave-period-val">150</span>px</span>
            </div>
            <input type="range" id="pen-wave-period-slider" min="50" max="400" value="150" style="width: 100%; cursor: pointer;" />
          </div>
        </div>
      </div>

      <div class="tool-group slider-group">
        <label>Size: <span id="size-val">5</span>px</label>
        <input type="range" id="size-slider" min="0" max="100" value="35" />
      </div>

      <div class="tool-group color-picker-group">
        <div class="color-picker-wrapper">
          <div class="color-preview" id="color-preview"></div>
          <input type="color" id="color-input" value="#000000" />
        </div>
      </div>

      <div class="tool-group slider-group">
        <label>Stabilize: <span id="stab-val">30</span></label>
        <input type="range" id="stab-slider" min="0" max="100" value="30" />
      </div>

      <div class="tool-group" style="position: relative;">
        <button id="btn-settings" class="icon-btn" title="Settings"><i data-lucide="settings"></i></button>
        <div id="settings-dropdown" class="settings-dropdown panel-card">
          <button id="btn-save" class="start-button" style="height: 36px; padding: 0 12px; width: 100%; white-space: nowrap;">
            <i data-lucide="save"></i> 保存
          </button>
          <button id="btn-download" class="start-button" style="height: 36px; padding: 0 12px; width: 100%; white-space: nowrap; background-color: var(--secondary); color: var(--secondary-foreground);">
            <i data-lucide="download"></i> PNG 保存
          </button>
        </div>
      </div>
    </div>

    <div class="undo-toast" id="undo-toast"></div>
  </div>

  <div id="gdrive-sync-indicator" class="gdrive-sync-indicator">
    <div class="spinner"></div>
    <span>Google ドライブ同期中...</span>
  </div>
`;

// Initialize standard icons
if ((window as any).lucide) {
  (window as any).lucide.createIcons();
}

// DOM Elements
export const startScreen = document.getElementById('start-screen') as HTMLDivElement;
export const paintApp = document.getElementById('paint-app') as HTMLDivElement;
export const btnNewCanvas = document.getElementById('btn-new-canvas') as HTMLButtonElement;
export const storageInfoEl = document.getElementById('storage-info') as HTMLDivElement;
export const savedCanvasesListEl = document.getElementById('saved-canvases-list') as HTMLDivElement;

export const displayCanvas = document.getElementById('display-canvas') as HTMLCanvasElement;
export const canvasWrapper = document.getElementById('canvas-wrapper') as HTMLDivElement;
export const container = document.getElementById('canvas-container') as HTMLDivElement;
export const displayCtx = displayCanvas.getContext('2d')!;

export const btnToggleTool = document.getElementById('btn-toggle-tool') as HTMLButtonElement;
export const btnPenSettings = document.getElementById('btn-pen-settings') as HTMLButtonElement;
export const penSettingsDropdown = document.getElementById('pen-settings-dropdown') as HTMLDivElement;
export const penWaveAmpSlider = document.getElementById('pen-wave-amp-slider') as HTMLInputElement;
export const penWaveAmpValEl = document.getElementById('pen-wave-amp-val') as HTMLSpanElement;
export const penWavePeriodSlider = document.getElementById('pen-wave-period-slider') as HTMLInputElement;
export const penWavePeriodValEl = document.getElementById('pen-wave-period-val') as HTMLSpanElement;
export const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement;
export const settingsDropdown = document.getElementById('settings-dropdown') as HTMLDivElement;
export const btnSave = document.getElementById('btn-save') as HTMLButtonElement;
export const btnDownload = document.getElementById('btn-download') as HTMLButtonElement;
export const sizeSlider = document.getElementById('size-slider') as HTMLInputElement;
export const sizeValEl = document.getElementById('size-val') as HTMLSpanElement;

export const colorPreview = document.getElementById('color-preview') as HTMLDivElement;
export const colorInput = document.getElementById('color-input') as HTMLInputElement;

export const stabSlider = document.getElementById('stab-slider') as HTMLInputElement;
export const stabValEl = document.getElementById('stab-val') as HTMLSpanElement;

export const btnAddLayer = document.getElementById('btn-add-layer') as HTMLButtonElement;
export const btnActiveClip = document.getElementById('btn-active-clip') as HTMLButtonElement;
export const btnActiveFill = document.getElementById('btn-active-fill') as HTMLButtonElement;
export const btnActiveDelete = document.getElementById('btn-active-delete') as HTMLButtonElement;
export const layerListEl = document.getElementById('layer-list') as HTMLDivElement;
export const layerPanelEl = document.getElementById('layer-panel') as HTMLDivElement;
export const btnLayerBlendToggle = document.getElementById('btn-layer-blend-toggle') as HTMLButtonElement;
export const btnLayerMove = document.getElementById('btn-layer-move') as HTMLButtonElement;
export const undoToastEl = document.getElementById('undo-toast') as HTMLDivElement;
export const btnBackToStart = document.getElementById('btn-back-to-start') as HTMLButtonElement;
export const btnValidateFiles = document.getElementById('btn-validate-files') as HTMLButtonElement;
export const btnClearStorage = document.getElementById('btn-clear-storage') as HTMLButtonElement;
export const lazyRadiusCursorEl = document.getElementById('lazy-radius-cursor') as HTMLDivElement;
