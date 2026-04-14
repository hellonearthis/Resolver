import { app, BrowserWindow, ipcMain, dialog, protocol, shell, session } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
    app.quit();
}

// Register custom protocol as privileged to support Fetch API
protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

const getResolveScriptsDir = () => {
    // 1. Check ProgramData (All Users) - Resolve often prioritizes this
    const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
    const commonPath = path.join(
        programData,
        'Blackmagic Design',
        'DaVinci Resolve',
        'Fusion',
        'Scripts',
        'Comp'
    );

    // 2. Check AppData (Current User)
    const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    const userPath = path.join(
        appData,
        'Blackmagic Design',
        'DaVinci Resolve',
        'Support',
        'Fusion',
        'Scripts',
        'Comp'
    );

    // Prefer ProgramData if it exists and has Resolve folders, otherwise fallback to AppData
    if (fs.existsSync(path.dirname(commonPath))) {
        return commonPath;
    }
    return userPath;
};

const createWindow = () => {
    // Create the browser window.
    const mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true, // For simplicity in this local app
            contextIsolation: false, // For simplicity in this local app - strictly local use
        },
    });

    // and load the index.html of the app.
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    mainWindow.maximize();

    // Open the DevTools.
    mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
// Custom Protocol for Local Media
app.whenReady().then(() => {
    // Custom Protocol for Local Media
    protocol.registerFileProtocol('media', (request: any, callback: any) => {
        // Remove media:// protocol and strip any query parameters (like ?t=...)
        let url = request.url.replace('media://', '').split('?')[0];
        // URL parsing strips the colon from Windows drive letters (e.g. "C:/path" becomes "c/path").
        // Detect a single-letter prefix followed by "/" and restore the colon.
        if (/^[a-zA-Z]\//.test(url)) {
            url = url[0] + ':' + url.substring(1);
        }
        try {
            return callback(decodeURIComponent(url));
        } catch (error) {
            console.error(error);
            return callback('404');
        }
    });

    createWindow();

    // Fix ComfyUI WebSocket 403 Forbidden error by spoofing the Origin header
    // This is required because ComfyUI checks the Origin for security and rejects browser origins
    session.defaultSession.webRequest.onBeforeSendHeaders(
        { urls: ['http://127.0.0.1:8188/*', 'ws://127.0.0.1:8188/*'] },
        (details, callback) => {
            details.requestHeaders['Origin'] = 'http://127.0.0.1:8188';
            callback({ requestHeaders: details.requestHeaders });
        }
    );
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

ipcMain.on('sync-to-resolve', (event, data) => {
    console.log('Received sync request:', data);
    const { audioPath, videoPaths, beats } = data;

    // Serialize data to pass to Python via temp file
    const tempPath = path.join(app.getPath('userData'), 'sync_data.json');
    fs.writeFileSync(tempPath, JSON.stringify(data));
    console.log('Data written to:', tempPath);

    // Spawn Python script
    const pythonScript = path.resolve(__dirname, '../scripts/resolve_sync.py');

    console.log('Spawning python script at:', pythonScript);

    const pythonProcess = spawn('python', [pythonScript, tempPath]);

    pythonProcess.stdout.on('data', (data) => {
        console.log(`Python Output: ${data}`);
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`Python Error: ${data}`);
    });

    pythonProcess.on('close', (code) => {
        console.log(`Python process exited with code ${code}`);
        if (code === 0) {
            event.reply('sync-complete', 'Sync completed successfully!');
        } else {
            event.reply('sync-error', `Python script failed with code ${code}`);
        }
    });
});

/**
 * ---------------------------------------------------------------------------
 * IPC: open-audio-dialog
 * Opens a native file dialog to select an audio file.
 * Returns the absolute path of the selected file, or null if canceled.
 * ---------------------------------------------------------------------------
 */
ipcMain.handle('open-audio-dialog', async (_event, defaultPath?: string) => {
    let dialogOptions: Electron.OpenDialogOptions = {
        title: 'Select Audio File',
        filters: [
            { name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a'] },
            { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
    };

    if (defaultPath) {
        // Navigate to the directory containing the stored file
        const dir = path.dirname(defaultPath);
        if (fs.existsSync(dir)) {
            dialogOptions.defaultPath = defaultPath;
        }
    }

    const result = await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }
    return result.filePaths[0];
});

/**
 * ---------------------------------------------------------------------------
 * IPC: open-image-dialog
 * Opens a native file dialog to select an image file.
 * Returns the absolute path of the selected file, or null if canceled.
 * ---------------------------------------------------------------------------
 */
ipcMain.handle('open-image-dialog', async (_event, defaultPath?: string) => {
    let dialogOptions: Electron.OpenDialogOptions = {
        title: 'Select Image File',
        filters: [
            { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
            { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
    };

    if (defaultPath && fs.existsSync(defaultPath)) {
        dialogOptions.defaultPath = defaultPath;
    }

    const result = await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }
    return result.filePaths[0];
});

/**
 * ---------------------------------------------------------------------------
 * IPC: open-folder
 * Opens the system file explorer to the specified path.
 * ---------------------------------------------------------------------------
 */
ipcMain.handle('open-folder', async (_event, folderPath: string) => {
    if (fs.existsSync(folderPath)) {
        require('electron').shell.showItemInFolder(folderPath);
        return true;
    }
    return false;
});



/**
 * ---------------------------------------------------------------------------
 * IPC: stage-video-sync
 * Generates a Python script that can be executed inside DaVinci Resolve (Free)
 * to automatically import an audio track and a set of video clips onto a timeline.
 * ---------------------------------------------------------------------------
 */
ipcMain.handle('stage-video-sync', async (_event, data: {
    projectName: string;
    audioPath: string;
    videoPaths: string[];
    beats: number[];
}) => {
    try {
        const resolveScriptsDir = getResolveScriptsDir();

        if (!fs.existsSync(resolveScriptsDir)) {
            fs.mkdirSync(resolveScriptsDir, { recursive: true });
        }

        const escapedAudio = (data.audioPath || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const escapedVideos = data.videoPaths.map(v => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`).join(',\n    ');
        const beatList = data.beats.join(', ');

        const script = `#!/usr/bin/env python
# Auto-generated by Resolve Tools Dashboard - Load Media
# Run from DaVinci Resolve: Workspace > Scripts > 01_Load_Media_Script

import sys
import os

# --- EMBEDDED MEDIA DATA ---
AUDIO_PATH = '${escapedAudio}'
VIDEO_PATHS = [
    ${escapedVideos}
]

def main():
    _resolve = None
    try:
        _resolve = resolve  # noqa: F821
    except NameError:
        try:
            _resolve = fusion.GetResolve()  # noqa: F821
        except (NameError, AttributeError):
            try:
                import DaVinciResolveScript as dvr_script
                _resolve = dvr_script.scriptapp('Resolve')
            except ImportError:
                pass

    if not _resolve:
        print('ERROR: Could not connect to Resolve.')
        return

    pm = _resolve.GetProjectManager()
    project = pm.GetCurrentProject()
    if not project:
        print('ERROR: No project open.')
        return

    mediapool = project.GetMediaPool()
    
    print("Starting Media Import...")
    
    # Import Audio
    if AUDIO_PATH and os.path.exists(AUDIO_PATH):
        audio_items = mediapool.ImportMedia([AUDIO_PATH])
        if audio_items:
            print(f"  [OK] Audio imported: {os.path.basename(AUDIO_PATH)}")
        else:
            print(f"  [FAIL] Resolve rejected audio: {AUDIO_PATH}")
    
    # Import Videos
    if VIDEO_PATHS:
        valid_videos = [v for v in VIDEO_PATHS if os.path.exists(v)]
        if valid_videos:
            print(f"  Importing {len(valid_videos)} video clips...")
            video_items = mediapool.ImportMedia(valid_videos)
            if video_items:
                print(f"  [OK] Imported {len(video_items)} clips to Media Pool.")
            else:
                print("  [FAIL] Resolve rejected all video imports.")
        else:
            print("  [SKIP] No valid video paths found on disk.")

    print("\\nMedia Import Complete! You can now run Step 02 to build the timeline.")

if __name__ == '__main__':
    main()
`;

        const baseName = data.projectName || (data.audioPath ? path.basename(data.audioPath, path.extname(data.audioPath)) : 'Untitled');
        const sanitized = baseName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
        const fileName = `01_Load_Media_Script_${sanitized}.py`;
        const fullPath = path.join(resolveScriptsDir, fileName);

        fs.writeFileSync(fullPath, script, 'utf8');

        return { success: true, scriptPath: fullPath };

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
});

/**
 * ---------------------------------------------------------------------------
 * IPC: stage-for-resolve
 * Generates a standalone Python script to be run from Resolve's Scripts menu.
 * Embeds marker data directly to avoid needing an external CSV at runtime.
 * ---------------------------------------------------------------------------
 */
interface MarkerEntry {
    frame: number;
    timestamp: number;
    color: string;
    note: string;
    type: string;
    duration_sec: number;
}

ipcMain.handle('stage-for-resolve', async (_event, data: {
    projectName: string;
    audioPath: string;
    csvPath: string;
    markers: MarkerEntry[];
}) => {
    try {
        const resolveScriptsDir = getResolveScriptsDir();

        // Ensure the directory exists
        if (!fs.existsSync(resolveScriptsDir)) {
            fs.mkdirSync(resolveScriptsDir, { recursive: true });
        }

        // Build the Python marker list literal
        const markerLines = data.markers.map(m => {
            const note = (m.note || '').replace(/'/g, "\\'");
            const mtype = (m.type || '').replace(/'/g, "\\'");
            // Map hex/rgba to Resolve color names
            let rColor = 'Blue';
            const c = m.color.toLowerCase();
            if (c.includes('red') || c.includes('#ff0000')) rColor = 'Red';
            else if (c.includes('yellow') || c.includes('#ffff00')) rColor = 'Yellow';
            else if (c.includes('green') || c.includes('#00ff00')) rColor = 'Green';
            else if (c.includes('cyan') || c.includes('#00ffff') || c.includes('6, 182, 212')) rColor = 'Cyan';
            else if (c.includes('magenta') || c.includes('fuchsia') || c.includes('#ff00ff')) rColor = 'Fuchsia';
            else if (c.includes('orange') || c.includes('245, 158, 11')) rColor = 'Sand';
            else if (c.includes('purple') || c.includes('139, 92, 246')) rColor = 'Purple';

            return `    {'frame': ${m.frame}, 'timestamp': ${m.timestamp.toFixed(3)}, 'color': '${rColor}', 'note': '${note}', 'type': '${mtype}', 'duration_sec': ${m.duration_sec}}`;
        });

        const escapedAudio = (data.audioPath || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const escapedCsv = (data.csvPath || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        const script = `#!/usr/bin/env python
# Auto-generated by Resolve Tools Dashboard
# Project: ${data.projectName.replace(/'/g, '')}
# Audio:   ${data.audioPath.replace(/\\/g, '/').replace(/'/g, '')}
# Run from DaVinci Resolve: Workspace > Scripts > 03_Set_Beat_Markers_Script

import sys
import os

# --- EMBEDDED MARKER DATA (no external CSV needed) ---
AUDIO_PATH = '${escapedAudio}'
CSV_PATH = '${escapedCsv}'
MARKERS = [
${markerLines.join(',\n')}
]


def main():
    # --- Connect to Resolve ---
    _resolve = None
    try:
        _resolve = resolve  # noqa: F821
    except NameError:
        try:
            _resolve = fusion.GetResolve()  # noqa: F821
        except (NameError, AttributeError):
            try:
                import DaVinciResolveScript as dvr_script
                _resolve = dvr_script.scriptapp('Resolve')
            except ImportError:
                pass

    if not _resolve:
        print('ERROR: Could not connect to Resolve.')
        return

    pm = _resolve.GetProjectManager()
    project = pm.GetCurrentProject()
    if not project:
        print('ERROR: No project open in Resolve.')
        return

    timeline = project.GetCurrentTimeline()
    if not timeline:
        print('ERROR: No timeline selected.')
        return

    fps = float(timeline.GetSetting('timelineFrameRate'))
    start_frame_offset = timeline.GetStartFrame()
    print(f'Timeline: {timeline.GetName()} ({fps} fps) StartFrame: {start_frame_offset}')
    print(f'Loading {len(MARKERS)} markers...')

    # Find audio clip on Track 1 for onset clip-markers
    audio_item = None
    audio_track_count = int(timeline.GetTrackCount('audio'))
    if audio_track_count > 0:
        items = timeline.GetItemListInTrack('audio', 1)
        if items and len(items) > 0:
            audio_item = items[0]

    stats = {'beat': 0, 'onset': 0, 'loudness': 0, 'other': 0}

    for m in MARKERS:
        # Resolve markers must account for timeline StartFrame offset
        frame = m['frame'] + start_frame_offset
        color = m['color']
        note = m['note']
        mtype = m['type']
        dur = m['duration_sec']
        dur_frames = max(1, round(dur * fps)) if dur > 0 else 1

        try:
            if mtype == 'onset' and audio_item:
                audio_item.AddMarker(frame, color, note, note, dur_frames)
                stats['onset'] += 1
            elif mtype in ('beat', 'loudness', 'section'):
                timeline.AddMarker(frame, color, note, note, dur_frames)
                stats[mtype] = stats.get(mtype, 0) + 1
            else:
                timeline.AddMarker(frame, color, note, note, dur_frames)
                stats['other'] += 1
        except Exception as e:
            print(f"  [FAIL] Could not add marker at frame {frame}: {e}")

    print('')
    print('--- Marker Import Complete ---')
    total = sum(stats.values())
    for mtype, count in stats.items():
        if count > 0:
            print(f'  {mtype}: {count}')
    print(f'  Total: {total} markers')


if __name__ == '__main__':
    main()
`;

        const baseName = data.projectName || (data.audioPath ? path.basename(data.audioPath, path.extname(data.audioPath)) : 'Untitled');
        const sanitized = baseName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
        const fileName = `03_Set_Beat_Markers_Script_${sanitized}.py`;
        const fullPath = path.join(resolveScriptsDir, fileName);

        fs.writeFileSync(fullPath, script, 'utf8');

        return { success: true, scriptPath: fullPath };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('stage-for-resolve error:', message);
        return { success: false, error: message };
    }
});

// ---------------------------------------------------------------------------
// Rename a script
// ---------------------------------------------------------------------------
ipcMain.handle('rename-resolve-script', async (_event, data: { oldPath: string; newName: string }) => {
    try {
        if (!fs.existsSync(data.oldPath)) {
            return { success: false, error: 'File not found' };
        }

        const dir = path.dirname(data.oldPath);
        // Ensure new name ends with .py
        const safeName = data.newName.endsWith('.py') ? data.newName : `${data.newName}.py`;
        // Sanitize new name slightly (allow standard chars)
        const sanitized = safeName.replace(/[<>:"/\\|?*]/g, '_');
        const newPath = path.join(dir, sanitized);

        if (fs.existsSync(newPath)) {
            return { success: false, error: 'Filename already exists' };
        }

        fs.renameSync(data.oldPath, newPath);
        return { success: true };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
});

// ---------------------------------------------------------------------------
// Edit a script (open in Notepad)
// ---------------------------------------------------------------------------
ipcMain.handle('edit-resolve-script', async (_event, scriptPath: string) => {
    try {
        if (!fs.existsSync(scriptPath)) {
            return { success: false, error: 'File not found' };
        }

        spawn('notepad.exe', [scriptPath], { detached: true, stdio: 'ignore' }).unref();
        return { success: true };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
});

// ---------------------------------------------------------------------------
// List all scripts in the Resolve Scripts/Comp folder
// ---------------------------------------------------------------------------
ipcMain.handle('list-resolve-scripts', async () => {
    try {
        // Scan both locations
        const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
        const commonDir = path.join(programData, 'Blackmagic Design', 'DaVinci Resolve', 'Fusion', 'Scripts', 'Comp');
        
        const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
        const userDir = path.join(appData, 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Fusion', 'Scripts', 'Comp');

        const scriptFiles: any[] = [];
        const seenNames = new Set<string>();

        const scanDir = (dir: string) => {
            if (fs.existsSync(dir)) {
                fs.readdirSync(dir).filter(f => f.endsWith('.py')).forEach(f => {
                    const fullPath = path.join(dir, f);
                    const stats = fs.statSync(fullPath);
                    if (!seenNames.has(f)) {
                        scriptFiles.push({
                            name: f,
                            path: fullPath,
                            size: stats.size,
                            mtime: stats.mtime,
                        });
                        seenNames.add(f);
                    }
                });
            }
        };

        scanDir(commonDir);
        scanDir(userDir);

        return scriptFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    } catch (err) {
        console.error('list-resolve-scripts error:', err);
        return [];
    }
});

// ---------------------------------------------------------------------------
// Delete a specific script
// ---------------------------------------------------------------------------
ipcMain.handle('delete-resolve-script', async (_event, scriptPath: string) => {
    try {
        if (fs.existsSync(scriptPath)) {
            fs.unlinkSync(scriptPath);
            return { success: true };
        }
        return { success: false, error: 'File not found' };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
});

// ---------------------------------------------------------------------------
// ComfyUI Integration
// ---------------------------------------------------------------------------

ipcMain.handle('load-default-workflow', async () => {
    try {
        const potentialPaths = [
            path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'comfyui_workflows/Extract_Stems.json'),
            path.join(__dirname, '../comfyui_workflows/Extract_Stems.json'),
            path.join(process.cwd(), 'comfyui_workflows/Extract_Stems.json'),
            path.resolve(__dirname, '../../comfyui_workflows/Extract_Stems.json')
        ];

        let workflowPath = '';
        for (const p of potentialPaths) {
            console.log('Checking workflow path:', p);
            if (fs.existsSync(p)) {
                workflowPath = p;
                break;
            }
        }

        if (!workflowPath) {
            console.error('Workflow file not found in any location:', potentialPaths);
            return { success: false, error: 'Workflow file not found' };
        }

        const content = fs.readFileSync(workflowPath, 'utf8');
        return { success: true, workflow: JSON.parse(content) };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Error loading workflow:', message);
        return { success: false, error: message };
    }
});

ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    if (result.canceled) return null;
    return result.filePaths[0];
});

ipcMain.handle('open-external-path', async (_event, pathStr) => {
    if (!pathStr) return { success: false, error: 'No path provided' };
    try {
        await shell.openPath(pathStr);
        return { success: true };
    } catch (e) {
        console.error('Failed to open path:', e);
        return { success: false, error: String(e) };
    }
});

// Proxy ComfyUI requests to avoid CORS
ipcMain.handle('comfy-fetch', async (_event, url, options) => {
    console.log(`Proxying request to: ${url}`);
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            console.error(`ComfyUI Fetch Error: ${response.status} ${response.statusText}`);
            return { success: false, status: response.status, error: response.statusText };
        }
        const data = await response.json();
        return { success: true, data };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('ComfyUI Proxy Error:', message);
        return { success: false, error: message };
    }
});

// Proxy ComfyUI file uploads (multipart/form-data)
ipcMain.handle('comfy-upload-file', async (_event, api_url, filePath, type, overwrite) => {
    console.log(`Uploading file to ComfyUI: ${filePath}`);
    try {
        if (!fs.existsSync(filePath)) {
            return { success: false, error: "File does not exist locally" };
        }

        const formData = new FormData();
        const fileContent = fs.readFileSync(filePath);
        const fileName = path.basename(filePath);

        const blob = new Blob([fileContent]);

        formData.append('image', blob, fileName);
        formData.append('type', type);
        formData.append('overwrite', overwrite.toString());

        const response = await fetch(`${api_url}/upload/image`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            console.error(`ComfyUI Upload Error: ${response.status} ${response.statusText}`);
            return { success: false, status: response.status, error: response.statusText };
        }

        const data = await response.json();
        return { success: true, data };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('ComfyUI Upload Error:', message);
        return { success: false, error: message };
    }
});

// Convert any audio file to a clean WAV before sending to ComfyUI
// Uses ffmpeg if available; returns the path of the temp WAV file
ipcMain.handle('convert-audio-to-wav', async (_event, inputPath: string) => {
    const tmpDir = app.getPath('temp');
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const outPath = path.join(tmpDir, `${baseName}_comfy_${Date.now()}.wav`);

    return new Promise<{ success: boolean; path?: string; error?: string }>((resolve) => {
        // Try ffmpeg first (most reliable)
        const ffmpeg = spawn('ffmpeg', [
            '-y',           // overwrite
            '-i', inputPath,
            '-ar', '44100', // standard sample rate
            '-ac', '2',     // stereo
            '-sample_fmt', 's16',
            outPath
        ]);

        let stderr = '';
        ffmpeg.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

        ffmpeg.on('close', (code: number) => {
            if (code === 0 && fs.existsSync(outPath)) {
                console.log(`[convert-audio-to-wav] Success: ${outPath}`);
                resolve({ success: true, path: outPath });
            } else {
                console.error(`[convert-audio-to-wav] ffmpeg exited ${code}: ${stderr.slice(-300)}`);
                resolve({ success: false, error: `ffmpeg failed (code ${code}). Is ffmpeg installed and on PATH?` });
            }
        });

        ffmpeg.on('error', (err: Error) => {
            console.error('[convert-audio-to-wav] spawn error:', err.message);
            resolve({ success: false, error: `ffmpeg not found: ${err.message}` });
        });
    });
});

/**
 * ---------------------------------------------------------------------------
 * Video Processing IPC Handlers
 * ---------------------------------------------------------------------------
 */

/**
 * IPC: get-video-info
 * Uses ffprobe to extract video metadata (duration, fps, resolution, codec, bitrate).
 */
ipcMain.handle('get-video-info', async (_event, filePath: string) => {
    return new Promise<{ success: boolean; info?: any; error?: string }>((resolve) => {
        const args = [
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            filePath
        ];

        const proc = spawn('ffprobe', args);
        let output = '';

        proc.stdout.on('data', (d: Buffer) => { output += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { console.log('ffprobe stderr:', d.toString()); });

        proc.on('close', (code: number) => {
            if (code === 0) {
                try {
                    const data = JSON.parse(output);
                    const videoStream = data.streams?.find((s: any) => s.codec_type === 'video');

                    if (!videoStream) {
                        resolve({ success: false, error: 'No video stream found' });
                        return;
                    }

                    let fps = 0;
                    if (videoStream.r_frame_rate) {
                        const [num, den] = videoStream.r_frame_rate.split('/');
                        fps = parseInt(num) / parseInt(den || '1');
                    }

                    const duration = parseFloat(data.format?.duration || '0');

                    resolve({
                        success: true,
                        info: {
                            duration,
                            fps: Math.round(fps * 100) / 100,
                            width: videoStream.width || 0,
                            height: videoStream.height || 0,
                            codec: videoStream.codec_name || 'unknown',
                            totalFrames: Math.round(duration * fps),
                            bitrate: Math.round((parseInt(data.format?.bit_rate || '0') / 1000))
                        }
                    });
                } catch (err) {
                    resolve({ success: false, error: `Failed to parse ffprobe output: ${err}` });
                }
            } else {
                resolve({ success: false, error: `ffprobe exited with code ${code}` });
            }
        });

        proc.on('error', (err: Error) => {
            resolve({ success: false, error: `ffprobe not found: ${err.message}` });
        });
    });
});

/**
 * IPC: extract-video-thumbnails
 * Extracts thumbnail frames from a video at a configurable FPS rate.
 * Saves small-scale JPGs (160px wide) to a thumbnails/ subfolder in the project dir.
 */
ipcMain.handle('extract-video-thumbnails', async (_event, data: {
    filePath: string;
    outputDir: string;
    fps?: number;
}) => {
    return new Promise<{ success: boolean; thumbnails?: { path: string; time: number }[]; error?: string }>((resolve) => {
        const fps = data.fps || 3;
        const thumbDir = path.join(data.outputDir, 'thumbnails');

        if (!fs.existsSync(thumbDir)) {
            fs.mkdirSync(thumbDir, { recursive: true });
        }

        const outputPattern = path.join(thumbDir, 'thumb_%04d.jpg');
        const args = [
            '-i', data.filePath,
            '-vf', `fps=${fps},scale=160:-1`,
            '-q:v', '6',
            '-an',
            '-f', 'image2',
            outputPattern
        ];

        console.log('[extract-video-thumbnails] Running ffmpeg:', args.join(' '));
        const proc = spawn('ffmpeg', args);

        proc.stderr.on('data', (d: Buffer) => {
            console.log('ffmpeg thumb:', d.toString().slice(0, 200));
        });

        proc.on('close', (code: number) => {
            if (code === 0) {
                const files = fs.readdirSync(thumbDir)
                    .filter((f: string) => f.startsWith('thumb_') && f.endsWith('.jpg'))
                    .sort();

                const thumbnails = files.map((f: string, i: number) => ({
                    path: path.join(thumbDir, f),
                    time: i / fps
                }));

                console.log(`[extract-video-thumbnails] Extracted ${thumbnails.length} thumbnails`);
                resolve({ success: true, thumbnails });
            } else {
                resolve({ success: false, error: `ffmpeg exited with code ${code}` });
            }
        });

        proc.on('error', (err: Error) => {
            resolve({ success: false, error: `ffmpeg not found: ${err.message}` });
        });
    });
});

/**
 * IPC: save-video-frame
 * Extracts a single frame at full video resolution from a specific timestamp.
 * Saves to the images/ subfolder in the project dir.
 */
ipcMain.handle('save-video-frame', async (_event, data: {
    filePath: string;
    time: number;
    outputDir: string;
    filename?: string;
}) => {
    return new Promise<{ success: boolean; framePath?: string; error?: string }>((resolve) => {
        const imagesDir = path.join(data.outputDir, 'images');
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }

        const filename = data.filename || `frame_${data.time.toFixed(3).replace('.', '_')}s.png`;
        const outputPath = path.join(imagesDir, filename);

        const args = [
            '-ss', data.time.toString(),
            '-i', data.filePath,
            '-vframes', '1',
            '-q:v', '1',
            outputPath
        ];

        console.log('[save-video-frame] Running ffmpeg:', args.join(' '));
        const proc = spawn('ffmpeg', args);

        proc.stderr.on('data', (d: Buffer) => {
            console.log('ffmpeg frame:', d.toString().slice(0, 200));
        });

        proc.on('close', (code: number) => {
            if (code === 0 && fs.existsSync(outputPath)) {
                console.log(`[save-video-frame] Saved frame: ${outputPath}`);
                resolve({ success: true, framePath: outputPath });
            } else {
                resolve({ success: false, error: `ffmpeg exited with code ${code}` });
            }
        });

        proc.on('error', (err: Error) => {
            resolve({ success: false, error: `ffmpeg not found: ${err.message}` });
        });
    });
});

/**
 * ---------------------------------------------------------------------------
 * IPC: get-config / save-config
 * Handles persistent configuration settings for the app.
 * ---------------------------------------------------------------------------
 */
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

ipcMain.handle('get-config', async () => {
    try {
        const defaultConfig = {
            comfyOutputDir: '',
            projectOutputDir: '',
            llmProvider: 'lmstudio',
            lmStudioUrl: 'http://localhost:1234',
            llmMaxTokens: 128,
            llmTemperature: 0.7,
            llmTopP: 0.9,
            llmTopK: 50,
            llmRepetitionPenalty: 1.5
        };

        if (fs.existsSync(CONFIG_PATH)) {
            const data = fs.readFileSync(CONFIG_PATH, 'utf8');
            const userConfig = JSON.parse(data);
            return { success: true, config: { ...defaultConfig, ...userConfig } };
        }
        return { success: true, config: defaultConfig };
    } catch (err) {
        console.error('Error reading config:', err);
        return { success: false, error: String(err) };
    }
});

ipcMain.handle('save-config', async (_event, newConfig) => {
    try {
        let currentConfig = {};
        if (fs.existsSync(CONFIG_PATH)) {
            currentConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        }
        const updatedConfig = { ...currentConfig, ...newConfig };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(updatedConfig, null, 2));
        return { success: true, config: updatedConfig };
    } catch (err) {
        console.error('Error saving config:', err);
        return { success: false, error: String(err) };
    }
});

/**
 * ---------------------------------------------------------------------------
 * IPC: stage-timeline-to-resolve
 * Generates a Python script for DaVinci Resolve that reconstructs the 
 * project timeline by importing media and placing clips at exact timestamps.
 * ---------------------------------------------------------------------------
 */
ipcMain.handle('stage-timeline-to-resolve', async (_event, data: {
    projectName: string;
    audioPath: string;
    frameRate: number;
    clips: any[];
}) => {
    try {
        const resolveScriptsDir = getResolveScriptsDir();
        if (!fs.existsSync(resolveScriptsDir)) {
            fs.mkdirSync(resolveScriptsDir, { recursive: true });
        }

        const fps = data.frameRate || 24;
        const escapedAudio = (data.audioPath || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        // Escape clip paths and build a list for Python
        const clipEntries = data.clips.map(c => {
            const vPath = (c.videoPath || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            return `    {'path': '${vPath}', 'start': ${c.startTime}, 'end': ${c.endTime}, 'track': ${c.track}, 'label': '${c.label.replace(/'/g, "\\'")}'}`;
        });

        const script = `#!/usr/bin/env python
# Project: ${data.projectName.replace(/'/g, '')}
# Run from DaVinci Resolve: Workspace > Scripts > 02_Place_Media_On_Timeline_Script

import sys
import os
import time

# --- PROJECT DATA ---
AUDIO_PATH = '${escapedAudio}'
FPS = ${fps}
CLIPS = [
${clipEntries.join(',\n')}
]

def main():
    _resolve = None
    try:
        _resolve = resolve  # noqa: F821
    except NameError:
        try:
            _resolve = fusion.GetResolve()  # noqa: F821
        except (NameError, AttributeError):
            try:
                import DaVinciResolveScript as dvr_script
                _resolve = dvr_script.scriptapp('Resolve')
            except ImportError:
                pass

    if not _resolve:
        print('ERROR: Could not connect to Resolve.')
        return

    pm = _resolve.GetProjectManager()
    project = pm.GetCurrentProject()
    if not project:
        print('ERROR: No project open.')
        return

    mediapool = project.GetMediaPool()
    
    # Try to use current timeline, or create new one if none exists
    timeline = project.GetCurrentTimeline()
    if not timeline:
        timeline_name = f"Reconstructed_Timeline_{int(time.time())}"
        timeline = mediapool.CreateEmptyTimeline(timeline_name)
        if not timeline:
            print("Failed to create timeline")
            return
        print(f"Created new timeline: {timeline_name}")
    else:
        print(f"Using active timeline: {timeline.GetName()}")
    
    # Ensure this timeline is active for AppendToTimeline calls
    project.SetCurrentTimeline(timeline)

    # Set timeline frame rate if possible (Studio only sometimes, but good to try)
    timeline.SetSetting('timelineFrameRate', str(FPS))
    
    # Resolve timeline frames often start at 01:00:00:00 (frame 86400 at 24fps)
    # We must add this offset to our desired record frame.
    start_frame_offset = timeline.GetStartFrame()
    print(f"Timeline starts at frame: {start_frame_offset} (@ {FPS}fps)")

    # Ensure we have enough tracks (Resolve timelines start with 1 by default)
    # We'll check the max track requested and add tracks if needed
    max_track = 1
    for c in CLIPS:
        if c['track'] > max_track: max_track = c['track']
    
    current_tracks = int(timeline.GetTrackCount('video'))
    if current_tracks < max_track:
        print(f"Adding {max_track - current_tracks} video tracks...")
        # Note: AddTrack is sometimes restricted in older Fusion versions, 
        # but modern Resolve API supports it.
        for i in range(current_tracks + 1, max_track + 1):
            # Attempt to add track. If it fails, clips will just overlay on Track 1.
            try: timeline.AddTrack('video')
            except: pass

    # Initial path check
    missing_files = []
    for c in CLIPS:
        if not c['path'] or not os.path.exists(c['path']):
            missing_files.append(c['path'] or "None")
    
    if missing_files:
        print(f"WARNING: {len(missing_files)} media paths were not found on disk:")
        for f in set(missing_files):
            print(f"  ? {f}")
    
    # Import and Place Audio
    if AUDIO_PATH:
        if os.path.exists(AUDIO_PATH):
            audio_items = mediapool.ImportMedia([AUDIO_PATH])
            if audio_items:
                audio_info = {
                    'mediaPoolItem': audio_items[0],
                    'recordFrame': start_frame_offset,
                    'mediaType': 2 # Audio
                }
                mediapool.AppendToTimeline([audio_info])
                print(f"Imported/Placed audio: {os.path.basename(AUDIO_PATH)}")
            else:
                print(f"FAIL: MediaPool rejected audio import: {AUDIO_PATH}")
        else:
            print(f"SKIP: Audio path not found: {AUDIO_PATH}")

    # Import and Place Clips
    unique_paths = list(set([c['path'] for c in CLIPS if c['path'] and os.path.exists(c['path'])]))
    imported_media = {}
    if unique_paths:
        print(f"Importing {len(unique_paths)} unique video files...")
        media_items = mediapool.ImportMedia(unique_paths)
        if not media_items:
            print("ERROR: MediaPool imported 0 items. Check Resolve permissions or file formats.")
        else:
            for i, item in enumerate(media_items):
                # Map the MediaPoolItem to the path
                # Note: mediapool.ImportMedia returns items in the same order as the path list
                imported_media[unique_paths[i]] = item

    print(f"Placing {len(CLIPS)} clips on timeline...")
    success_count = 0
    for c in CLIPS:
        media_item = imported_media.get(c['path'])
        if not media_item:
            print(f"  [SKIP] {c['label']} - MediaItem not available (file missing or import failed)")
            continue
        
        # Calculate target frame on timeline from project seconds
        record_frame = int(round(c['start'] * FPS)) + start_frame_offset
        duration_frames = int(round((c['end'] - c['start']) * FPS))
        
        # Resolve AppendToTimeline with ClipInfo dictionary
        clip_info = {
            "mediaPoolItem": media_item,
            "startFrame": 0,
            "endFrame": duration_frames - 1,
            "recordFrame": record_frame,
            "trackIndex": c['track'],
            "mediaType": 1 # Video
        }
        
        try:
            success = mediapool.AppendToTimeline([clip_info])
            if success:
                print(f"  [OK] {c['label']} -> Track {c['track']} @ {c['start']:.2f}s")
                success_count += 1
            else:
                print(f"  [FAIL] Resolve rejected placement for {c['label']}")
        except Exception as e:
            print(f"  [FAIL] Error appending {c['label']}: {e}")

    print(f"\\nTimeline Reconstruction Complete! ({success_count}/{len(CLIPS)} clips placed)")

if __name__ == '__main__':
    main()
`;

        const baseName = data.projectName || 'Untitled';
        const sanitized = baseName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
        const fileName = `02_Place_Media_On_Timeline_Script_${sanitized}.py`;
        const fullPath = path.join(resolveScriptsDir, fileName);

        fs.writeFileSync(fullPath, script, 'utf8');
        return { success: true, scriptPath: fullPath };

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
});

// ---------------------------------------------------------------------------
// Music Video Assembler - Save Manifest
// ---------------------------------------------------------------------------
ipcMain.handle('save-manifest', async (_event, manifest: any) => {
    try {
        const { filePath } = await dialog.showSaveDialog({
            title: 'Save Music Video Manifest',
            defaultPath: 'music_video_manifest.json',
            filters: [{ name: 'JSON', extensions: ['json'] }]
        });

        if (filePath) {
            fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2));
            return { success: true, path: filePath };
        }
        return { success: false, error: 'Cancelled' };
    } catch (err) {
        console.error('Error saving manifest:', err);
        return { success: false, error: String(err) };
    }
});

/**
 * ---------------------------------------------------------------------------
 * IPC: scan-projects-folder
 * Scans a given folder path for directories starting with 'PRJ_'.
 * Reads inside each for a project.json and surfaces the data to the UI.
 * ---------------------------------------------------------------------------
 */
ipcMain.handle('scan-projects-folder', async (_event, folderPath: string) => {
    try {
        if (!fs.existsSync(folderPath)) {
            return { success: false, error: 'Folder does not exist' };
        }

        const projects: any[] = [];
        // Only scan top-level items in the output folder for PRJ_ directories
        const items = fs.readdirSync(folderPath);

        for (const item of items) {
            const itemPath = path.join(folderPath, item);
            const stat = fs.statSync(itemPath);

            if (stat.isDirectory() && item.startsWith('PRJ_')) {
                // Look for the project.json file inside the project folder
                try {
                    const dataPath = path.join(itemPath, 'project.json');
                    if (fs.existsSync(dataPath)) {
                        const content = fs.readFileSync(dataPath, 'utf8');
                        const project = JSON.parse(content);
                        if (project.id && project.name) {
                            // Enforce dynamic outputDir based on the actual folder path
                            // This guarantees project bundles stay portable if moved to another drive/PC
                            project.outputDir = itemPath;
                            projects.push(project);
                        }
                    }
                } catch (e) {
                    console.error(`Error reading project file in ${itemPath}:`, e);
                }
            }
        }

        // Sort by updatedAt descending
        projects.sort((a, b) => {
            return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
        });

        return { success: true, projects };
    } catch (err) {
        console.error('Error scanning projects folder:', err);
        return { success: false, error: String(err) };
    }
});
// ---------------------------------------------------------------------------
// LLM Prompt Expansion (Vino & LM Studio)
// ---------------------------------------------------------------------------

let vinoPipeline: any = null;

ipcMain.handle('llm-generate', async (_event, data: {
    systemPrompt: string;
    userPrompt: string;
}) => {
    try {
        // Load latest config
        let config: any = {};
        if (fs.existsSync(CONFIG_PATH)) {
            config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        }

        const provider = config.llmProvider || 'lmstudio';
        const params = {
            max_new_tokens: config.llmMaxTokens || 128,
            do_sample: true,
            temperature: config.llmTemperature || 0.7,
            top_p: config.llmTopP || 0.9,
            top_k: config.llmTopK || 50,
            repetition_penalty: config.llmRepetitionPenalty || 1.5,
        };

        if (provider === 'vino') {
            console.log('[LLM] Using Intel OpenVINO Backend');
            
            // Lazy load OpenVINO native module to prevent startup crashes if not installed
            let VLMPipeline: any;
            try {
                // @ts-ignore
                const mod = await import('openvino-genai-node') as any;
                // VLM for Gemma 3, LLM fallback if types are weird
                VLMPipeline = mod.VLMPipeline || mod.LLMPipeline;
            } catch (e) {
                return { success: false, error: "OpenVino library not found. Have you run 'npm install'?" };
            }

            // Initialize singleton pipeline
            if (!vinoPipeline) {
                const modelPath = path.join(process.cwd(), 'vino', 'gemma-3-openvino');
                const cacheDir = path.join(process.cwd(), 'vino', 'ov_cache', 'gemma-3-openvino');
                
                if (!fs.existsSync(modelPath)) {
                    return { success: false, error: `Model not found at: ${modelPath}. Please install Gemma 3 into the vino/ folder.` };
                }

                if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

                console.log(`[LLM] Loading Gemma 3 from: ${modelPath}`);
                
                const pipeOptions = {
                    CACHE_DIR: cacheDir,
                    NPUW_LLM_PREFILL_HINT: "STATIC",
                    KV_CACHE_PRECISION: "u8",
                    NPU_COMPILATION_MODE_CONFIG: "USER_CONFIG",
                    NPU_MAX_NUM_THREADS: "8",
                };

                try {
                    console.log(`[LLM] Targeting NPU accelerated hardware...`);
                    vinoPipeline = await VLMPipeline(modelPath, "NPU", pipeOptions);
                } catch (npuError: any) {
                    console.warn(`[LLM] NPU Initialization Failed: ${npuError.message}. Falling back to CPU...`);
                    try {
                        // Fallback to CPU if NPU driver/compilation fails
                        vinoPipeline = await VLMPipeline(modelPath, "CPU", { CACHE_DIR: cacheDir });
                    } catch (cpuError: any) {
                        return { success: false, error: `Critical: AI Load failed on both NPU and CPU: ${cpuError.message}` };
                    }
                }
                console.log(`[LLM] AI Pipeline Ready on ${vinoPipeline ? 'Hardware' : 'Error State'}.`);
            }

            // Chat Template for Gemma 3
            const fullPrompt = `<start_of_turn>user\n${data.systemPrompt}\n\nInput Scene: ${data.userPrompt}<end_of_turn>\n<start_of_turn>model\n`;
            
            console.log('[LLM] NPU Inference starting...');
            const startTime = Date.now();
            const result = await vinoPipeline.generate(fullPrompt, [], params);
            console.log(`[LLM] NPU Inference complete in ${((Date.now() - startTime)/1000).toFixed(2)}s`);

            // Explicitly cast to String to handle specialized OpenVINO return objects
            return { success: true, text: String(result) };

        } else {
            console.log('[LLM] Using LM Studio Backend');
            const endpoint = `${config.lmStudioUrl || 'http://localhost:1234'}/v1/chat/completions`;
            
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        { role: 'system', content: data.systemPrompt },
                        { role: 'user', content: data.userPrompt }
                    ],
                    temperature: params.temperature,
                    top_p: params.top_p,
                    max_tokens: params.max_new_tokens,
                    frequency_penalty: params.repetition_penalty - 1.0 // Map repetition to frequency slightly
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                return { success: false, error: `LM Studio Error: ${response.status} - ${errText}` };
            }

            const json = await response.json();
            const text = json.choices?.[0]?.message?.content || '';
            return { success: true, text };
        }

    } catch (err: any) {
        console.error('[LLM] Generation Error:', err);
        return { success: false, error: String(err) };
    }
});
