import { generateNewCanvasId, loadCanvas, getAllLocalCanvasIds, deleteLocalCanvas } from './storage';
import { isGDriveConnected, getGDriveUserInfo, initAndLoginGDrive, logoutGDrive, tryRestoreToken, saveToDrive, findDriveFileId, downloadDriveFile, listDriveFiles, deleteDriveFile } from './gdrive';
import { showToast } from './undo';
import { setIsGDriveWriting } from './state';
import { btnValidateFiles } from './dom';

// ===================================================================
// GDrive State & Index
// ===================================================================
let gdriveIndex: any[] | null = null;

export async function getGDriveIndex(): Promise<any[]> {
  if (gdriveIndex) return gdriveIndex;
  try {
    const fileId = await findDriveFileId('canvas_index.json');
    if (fileId) {
      const content = await downloadDriveFile(fileId);
      gdriveIndex = JSON.parse(content);
    } else {
      gdriveIndex = [];
    }
  } catch (err) {
    console.error('Failed to get GDrive index', err);
    gdriveIndex = [];
  }
  return gdriveIndex!;
}

export async function saveGDriveIndex(index: any[]) {
  gdriveIndex = index;
  await saveToDrive('canvas_index.json', JSON.stringify(index));
}

export async function generateNewCanvasIdAsync(): Promise<string> {
  if (isGDriveConnected()) {
    const index = await getGDriveIndex();
    let maxIndex = -1;
    for (const meta of index) {
      if (meta.id.startsWith('paint_canvas_')) {
        const idxStr = meta.id.replace('paint_canvas_', '');
        const idx = parseInt(idxStr, 10);
        if (!isNaN(idx) && idx > maxIndex) {
          maxIndex = idx;
        }
      }
    }
    return `paint_canvas_${maxIndex + 1}`;
  } else {
    return generateNewCanvasId();
  }
}

export async function migrateLocalDataToDrive() {
  const localIds = getAllLocalCanvasIds();
  if (localIds.length === 0) return;
  
  const confirmMigrate = confirm(`ローカルに ${localIds.length} 件のデータがあります。Googleドライブへアップロード（同期）しますか？`);
  if (!confirmMigrate) return;
  
  setIsGDriveWriting(true);
  try {
    const index = await getGDriveIndex();
    const gdriveStatusEl = document.getElementById('gdrive-status');
    if (gdriveStatusEl) gdriveStatusEl.textContent = 'マイグレーション中...';
    
    for (const id of localIds) {
      const saveData = loadCanvas(id);
      if (!saveData) continue;
      
      let targetId = id;
      const exists = index.some(m => m.id === id);
      if (exists) {
        let maxIndex = -1;
        for (const meta of index) {
          if (meta.id.startsWith('paint_canvas_')) {
            const idxStr = meta.id.replace('paint_canvas_', '');
            const idx = parseInt(idxStr, 10);
            if (!isNaN(idx) && idx > maxIndex) {
              maxIndex = idx;
            }
          }
        }
        targetId = `paint_canvas_${maxIndex + 1}`;
        saveData.id = targetId;
      }
      
      const fileId = await saveToDrive(`${targetId}.json`, JSON.stringify(saveData));
      
      let thumbnail = saveData.thumbnail || '';
      if (!thumbnail && saveData.layers && saveData.layers.length > 0) {
        thumbnail = saveData.layers[0].data;
      }
      
      const existingIdx = index.findIndex(m => m.id === targetId);
      const meta: any = {
        id: targetId,
        name: saveData.name || '無題のキャンバス',
        updatedAt: saveData.updatedAt || new Date().toISOString(),
        thumbnail,
        gdriveFileId: fileId
      };
      
      if (existingIdx >= 0) {
        index[existingIdx] = meta;
      } else {
        index.push(meta);
      }
    }
    
    await saveGDriveIndex(index);
    localIds.forEach(id => deleteLocalCanvas(id));
    
    showToast('マイグレーション完了');
    if (gdriveStatusEl) gdriveStatusEl.textContent = '同期完了しました';
    setTimeout(updateGDriveStatusUI, 2000);
  } finally {
    setIsGDriveWriting(false);
  }
}

export async function validateAndRepairFiles() {
  if (isGDriveConnected()) {
    showToast('Google ドライブの整合性をチェック中...');
    setIsGDriveWriting(true);
    try {
      const driveFiles = await listDriveFiles();
      const driveFileMap = new Map<string, string>();
      driveFiles.forEach(f => driveFileMap.set(f.name, f.id));

      const index = await getGDriveIndex();
      const newIndex: any[] = [];
      const invalidIndexEntries: string[] = [];

      for (const meta of index) {
        const fileName = `${meta.id}.json`;
        if (driveFileMap.has(fileName)) {
          newIndex.push(meta);
        } else {
          invalidIndexEntries.push(meta.name);
        }
      }

      const indexIds = new Set(newIndex.map(m => m.id));
      const orphanedFiles: { id: string; name: string }[] = [];
      for (const file of driveFiles) {
        if (file.name === 'canvas_index.json') continue;
        const id = file.name.replace('.json', '');
        if (!indexIds.has(id)) {
          orphanedFiles.push(file);
        }
      }

      const hasIssue = invalidIndexEntries.length > 0 || orphanedFiles.length > 0;
      if (!hasIssue) {
        alert('Google ドライブ上のデータ整合性は正常です。壊れたファイルは見つかりませんでした。');
        return;
      }

      let confirmMsg = '以下の整合性エラーが見つかりました：\n\n';
      if (invalidIndexEntries.length > 0) {
        confirmMsg += `■ 実体のないインデックス項目 (自動削除されます): ${invalidIndexEntries.length} 件\n`;
        invalidIndexEntries.forEach(name => confirmMsg += `  - ${name}\n`);
      }
      if (orphanedFiles.length > 0) {
        confirmMsg += `■ インデックス未登録の不要な実ファイル (自動削除されます): ${orphanedFiles.length} 件\n`;
        orphanedFiles.forEach(f => confirmMsg += `  - ${f.name}\n`);
      }
      confirmMsg += '\nこれらのエラーを修復（該当データの削除）しますか？';

      const proceed = confirm(confirmMsg);
      if (proceed) {
        showToast('修復作業を実行中...');
        await saveGDriveIndex(newIndex);
        for (const file of orphanedFiles) {
          await deleteDriveFile(file.id);
        }
        showToast('修復が完了しました');
        _renderStartScreen();
      }
    } catch (err: any) {
      console.error('GDrive validation failed', err);
      alert(`整合性チェック中にエラーが発生しました: ${err.message}`);
    } finally {
      setIsGDriveWriting(false);
    }
  } else {
    showToast('ローカルストレージをチェック中...');
    const localIds = getAllLocalCanvasIds();
    const corruptedIds: string[] = [];

    for (const id of localIds) {
      const dataStr = localStorage.getItem(id);
      if (!dataStr) {
        corruptedIds.push(id);
        continue;
      }
      try {
        const parsed = JSON.parse(dataStr);
        if (!parsed.id || !parsed.canvas || !parsed.layers) {
          corruptedIds.push(id);
        }
      } catch (e) {
        corruptedIds.push(id);
      }
    }

    if (corruptedIds.length === 0) {
      alert('ローカルストレージのデータ整合性は正常です。壊れたファイルは見つかりませんでした。');
      return;
    }

    const proceed = confirm(`破損したローカルデータが ${corruptedIds.length} 件見つかりました。\nこれらを削除しますか？\n削除対象ID: ${corruptedIds.join(', ')}`);
    if (proceed) {
      corruptedIds.forEach(id => deleteLocalCanvas(id));
      showToast('破損データを削除しました');
      _renderStartScreen();
    }
  }
}

export function updateGDriveStatusUI(errorMessage?: string) {
  const gdriveStatusEl = document.getElementById('gdrive-status');
  const btnGDriveConnect = document.getElementById('btn-gdrive-connect') as HTMLButtonElement;
  if (!gdriveStatusEl || !btnGDriveConnect) return;
  
  if (isGDriveConnected()) {
    const user = getGDriveUserInfo();
    gdriveStatusEl.textContent = `接続中 (${user?.email || 'Unknown'})`;
    gdriveStatusEl.style.color = '#34A853';
    btnGDriveConnect.textContent = '接続解除';
    btnGDriveConnect.disabled = false;
    btnGDriveConnect.style.background = 'var(--destructive)';
    btnGDriveConnect.style.color = 'var(--destructive-foreground)';
  } else {
    gdriveStatusEl.textContent = errorMessage || '未接続';
    gdriveStatusEl.style.color = errorMessage ? 'var(--destructive)' : 'var(--muted-foreground)';
    btnGDriveConnect.textContent = 'ドライブと接続';
    btnGDriveConnect.disabled = false;
    btnGDriveConnect.style.background = '#4285F4';
    btnGDriveConnect.style.color = 'white';
  }
}

// renderStartScreen callback - set by ui.ts to avoid circular dependency
let _renderStartScreen: () => Promise<void> = async () => {};
export function setRenderStartScreenCallback(fn: () => Promise<void>) { _renderStartScreen = fn; }

export function initGDriveListeners() {
  const gdriveClientIdInput = document.getElementById('gdrive-client-id') as HTMLInputElement;
  const btnSaveGDriveCreds = document.getElementById('btn-save-gdrive-creds') as HTMLButtonElement;
  const btnGDriveConnect = document.getElementById('btn-gdrive-connect') as HTMLButtonElement;
  const gdriveStatusEl = document.getElementById('gdrive-status') as HTMLDivElement;

  if (gdriveClientIdInput) {
    gdriveClientIdInput.value = localStorage.getItem('gdrive_client_id') || '';
  }

  if (btnSaveGDriveCreds) {
    btnSaveGDriveCreds.addEventListener('click', () => {
      localStorage.setItem('gdrive_client_id', gdriveClientIdInput.value.trim());
      showToast('クライアントIDを保存しました');
    });
  }

  if (btnGDriveConnect) {
    btnGDriveConnect.addEventListener('click', async () => {
      if (isGDriveConnected()) {
        logoutGDrive();
        localStorage.removeItem('gdrive_connected');
        updateGDriveStatusUI();
        showToast('Google ドライブの接続を解除しました');
        _renderStartScreen();
        return;
      }

      const clientId = gdriveClientIdInput.value.trim();
      if (!clientId) {
        alert('クライアントIDを入力してください');
        return;
      }
      localStorage.setItem('gdrive_client_id', clientId);
      
      if (gdriveStatusEl) gdriveStatusEl.textContent = '接続中...';
      try {
        await initAndLoginGDrive(clientId, false);
        localStorage.setItem('gdrive_connected', 'true');
        updateGDriveStatusUI();
        showToast('Google ドライブに接続しました');
        
        await migrateLocalDataToDrive();
        
        _renderStartScreen();
      } catch (err: any) {
        if (gdriveStatusEl) {
          gdriveStatusEl.textContent = `エラー: ${err.message}`;
          gdriveStatusEl.style.color = 'red';
        }
      }
    });
  }
  updateGDriveStatusUI();

  // Settings Modal
  const btnStartSettings = document.getElementById('btn-start-settings') as HTMLButtonElement;
  const btnCloseStartSettings = document.getElementById('btn-close-start-settings') as HTMLButtonElement;
  const startSettingsModal = document.getElementById('start-settings-modal') as HTMLDivElement;

  if (btnStartSettings && startSettingsModal) {
    btnStartSettings.addEventListener('click', () => {
      startSettingsModal.classList.add('show');
    });
  }

  if (btnCloseStartSettings && startSettingsModal) {
    btnCloseStartSettings.addEventListener('click', () => {
      startSettingsModal.classList.remove('show');
    });
  }

  if (startSettingsModal) {
    startSettingsModal.addEventListener('click', (e) => {
      if (e.target === startSettingsModal) {
        startSettingsModal.classList.remove('show');
      }
    });
  }

  // Attempt silent login if previously connected
  const savedClientId = localStorage.getItem('gdrive_client_id') || '';
  const wasConnected = localStorage.getItem('gdrive_connected') === 'true';
  if (savedClientId && wasConnected) {
    if (gdriveStatusEl) gdriveStatusEl.textContent = '自動接続中...';
    const checkAndSilentLogin = async () => {
      try {
        const restored = await tryRestoreToken();
        if (restored) {
          updateGDriveStatusUI();
          showToast('Google ドライブのセッションを復元しました');
          await _renderStartScreen();
          return;
        }
        
        await initAndLoginGDrive(savedClientId, true);
        localStorage.setItem('gdrive_connected', 'true');
        updateGDriveStatusUI();
        showToast('Google ドライブに自動接続しました');
        await _renderStartScreen();
      } catch (err) {
        console.log('Silent login failed (interaction required or offline):', err);
        updateGDriveStatusUI('自動同期に失敗しました（要サインイン）');
      }
    };
    
    if ((window as any).google && (window as any).google.accounts) {
      checkAndSilentLogin();
    } else {
      const timer = setInterval(() => {
        if ((window as any).google && (window as any).google.accounts) {
          clearInterval(timer);
          checkAndSilentLogin();
        }
      }, 100);
      setTimeout(() => clearInterval(timer), 5000);
    }
  }

  if (btnValidateFiles) {
    btnValidateFiles.addEventListener('click', () => {
      validateAndRepairFiles();
    });
  }
}

