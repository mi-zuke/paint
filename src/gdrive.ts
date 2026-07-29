let gdriveAccessToken: string | null = null;
let gdriveUserInfo: { name: string; email: string } | null = null;

export function getGDriveToken() {
  return gdriveAccessToken;
}

export function getGDriveUserInfo() {
  return gdriveUserInfo;
}

export function isGDriveConnected() {
  return gdriveAccessToken !== null;
}

let gdriveFolderId: string | null = null;

export async function getOrCreateFolderId(): Promise<string> {
  if (gdriveFolderId) return gdriveFolderId;
  
  // Search for the folder 'PaintApp'
  const query = encodeURIComponent("name='PaintApp' and mimeType='application/vnd.google-apps.folder' and trashed=false");
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`;
  const res = await driveFetch(url);
  const data = await res.json();
  
  if (data.files && data.files.length > 0) {
    gdriveFolderId = data.files[0].id;
  } else {
    // Create folder 'PaintApp'
    const createUrl = 'https://www.googleapis.com/drive/v3/files';
    const createRes = await driveFetch(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'PaintApp',
        mimeType: 'application/vnd.google-apps.folder'
      })
    });
    const createData = await createRes.json();
    gdriveFolderId = createData.id;
  }
  return gdriveFolderId!;
}

export async function tryRestoreToken(): Promise<boolean> {
  const token = localStorage.getItem('gdrive_access_token');
  const expiresAt = localStorage.getItem('gdrive_token_expires_at');
  if (token && expiresAt && Date.now() < parseInt(expiresAt, 10)) {
    gdriveAccessToken = token;
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { 'Authorization': `Bearer ${gdriveAccessToken}` }
      });
      if (res.ok) {
        gdriveUserInfo = await res.json();
      } else {
        gdriveUserInfo = { name: 'User', email: 'Connected (Restored)' };
      }
      return true;
    } catch (e) {
      gdriveAccessToken = null;
      return false;
    }
  }
  return false;
}

export function logoutGDrive() {
  const token = gdriveAccessToken;
  gdriveAccessToken = null;
  gdriveUserInfo = null;
  gdriveFolderId = null;
  localStorage.removeItem('gdrive_access_token');
  localStorage.removeItem('gdrive_token_expires_at');
  localStorage.removeItem('gdrive_user_email');
  localStorage.removeItem('gdrive_connected');
  if (token) {
    try {
      const google = (window as any).google;
      if (google && google.accounts && google.accounts.oauth2) {
        google.accounts.oauth2.revokeToken(token, () => {
          console.log('Access token revoked');
        });
      }
    } catch (e) {
      console.warn('Failed to revoke token', e);
    }
  }
}

export function initAndLoginGDrive(clientId: string, silent: boolean = false): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const google = (window as any).google;
      if (!google || !google.accounts) {
        return reject(new Error('Google Identity Services script not loaded.'));
      }

      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email',
        callback: async (tokenResponse: any) => {
          if (tokenResponse && tokenResponse.access_token) {
            gdriveAccessToken = tokenResponse.access_token;
            
            // Save to localStorage (expires_in is usually 3599 seconds)
            const expiresIn = tokenResponse.expires_in || 3599;
            localStorage.setItem('gdrive_access_token', gdriveAccessToken!);
            // Subtract 1 minute (60000ms) for safety margin
            localStorage.setItem('gdrive_token_expires_at', (Date.now() + (expiresIn * 1000) - 60000).toString());

            try {
              // Fetch user info to confirm
              const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: {
                  'Authorization': `Bearer ${gdriveAccessToken}`
                }
              });
              if (res.ok) {
                gdriveUserInfo = await res.json();
                if (gdriveUserInfo?.email) {
                  localStorage.setItem('gdrive_user_email', gdriveUserInfo.email);
                }
              } else {
                console.warn('Failed to fetch user info, using placeholder');
                gdriveUserInfo = { name: 'User', email: 'Connected' };
              }
              resolve();
            } catch (err) {
              reject(err);
            }
          } else {
            reject(new Error('Failed to get access token'));
          }
        },
        error_callback: (err: any) => {
          reject(err);
        }
      });
      
      const savedEmail = localStorage.getItem('gdrive_user_email');
      if (silent) {
        client.requestAccessToken({ prompt: 'none', hint: savedEmail || undefined });
      } else {
        client.requestAccessToken(savedEmail ? { hint: savedEmail } : undefined);
      }
    } catch (e) {
      reject(e);
    }
  });
}

// Helper to make API calls to Drive
async function driveFetch(url: string, options: RequestInit = {}) {
  if (!gdriveAccessToken) throw new Error('Not connected to Google Drive');
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${gdriveAccessToken}`);
  
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    throw new Error(`Drive API error: ${res.status} ${res.statusText}`);
  }
  return res;
}

// Find a file by name inside 'PaintApp' folder (returns the file ID, or null if not found)
export async function findDriveFileId(name: string): Promise<string | null> {
  const folderId = await getOrCreateFolderId();
  const query = encodeURIComponent(`name='${name}' and '${folderId}' in parents and trashed=false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`;
  const res = await driveFetch(url);
  const data = await res.json();
  if (data.files && data.files.length > 0) {
    return data.files[0].id; // Return the first matching file
  }
  return null;
}

// Upload a file (creates if fileId is null, updates if fileId is provided)
export async function uploadDriveFile(name: string, content: string, fileId: string | null = null): Promise<string> {
  const folderId = await getOrCreateFolderId();
  const metadata: any = { name, mimeType: 'application/json' };
  if (!fileId) {
    metadata.parents = [folderId];
  }

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;
  
  const multipartRequestBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    content +
    closeDelim;

  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    
  const method = fileId ? 'PATCH' : 'POST';

  const res = await driveFetch(url, {
    method,
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: multipartRequestBody
  });
  const data = await res.json();
  return data.id; // Returns the file ID
}

// Download a file's content as text
export async function downloadDriveFile(fileId: string): Promise<string> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await driveFetch(url);
  return await res.text();
}

// Delete a file from Google Drive
export async function deleteDriveFile(fileId: string): Promise<void> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}`;
  await driveFetch(url, { method: 'DELETE' });
}

// High-level: save by name (auto finds and updates, or creates)
export async function saveToDrive(name: string, content: string): Promise<string> {
  const existingId = await findDriveFileId(name);
  return await uploadDriveFile(name, content, existingId);
}

// List all files in the 'PaintApp' folder (returns an array of { id: string, name: string })
export async function listDriveFiles(): Promise<{ id: string; name: string }[]> {
  const folderId = await getOrCreateFolderId();
  const query = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`;
  const res = await driveFetch(url);
  const data = await res.json();
  return data.files || [];
}

