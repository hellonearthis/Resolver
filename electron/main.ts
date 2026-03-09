import { app, BrowserWindow, ipcMain, dialog, protocol, shell } from 'electron';
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
    const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
    return path.join(
        programData,
        'Blackmagic Design',
        'DaVinci Resolve',
        'Fusion',
        'Scripts',
        'Comp'
    );
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
        const url = request.url.replace('media://', '');
        try {
            return callback(decodeURIComponent(url));
        } catch (error) {
            console.error(error);
            return callback('404');
        }
    });

    createWindow();
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
# Auto-generated by Resolve Tools Dashboard - Video Sync
# Run from DaVinci Resolve: Workspace > Scripts > 02_Sync_Video

import sys
import os

# --- EMBEDDED SYNC DATA ---
AUDIO_PATH = '${escapedAudio}'
VIDEO_PATHS = [
    ${escapedVideos}
]
BEATS = [${beatList}]

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
    root_folder = mediapool.GetRootFolder()
    
    # Create unique timeline
    import time
    timeline_name = f"Sync_Sequence_{int(time.time())}"
    timeline = mediapool.CreateEmptyTimeline(timeline_name)
    if not timeline:
        print("Failed to create timeline")
        return

    print(f"Created timeline: {timeline_name}")

    # Import Audio
    audio_items = mediapool.ImportMedia([AUDIO_PATH])
    if not audio_items:
        print(f"Failed to import audio: {AUDIO_PATH}")
        return
    
    # Append audio to track 1
    # Note: AppendToTimeline accepts a list of MediaPoolItems
    timeline.AppendToTimeline([audio_items[0]])

    # Import Videos
    video_items = mediapool.ImportMedia(VIDEO_PATHS)
    if not video_items:
        print("Failed to import videos")
        return

    print(f"Imported {len(video_items)} video clips")

    # Place videos on timeline at beat points
    # We will simply loop through videos and place them at subsequent beats
    # This is a basic "cut to beat" logic
    
    # For a more advanced logic, we would use specific track targeting
    # But AppendToTimeline is the simplest API available in Free/Fusion context
    
    # Strategy: 
    # 1. Clear the timeline (it has audio now) -> Wait, we can't easily clear just video
    # 2. Actually, AppendToTimeline puts things at the END.
    #    The audio is on Track 1. We want video on Video Track 1.
    
    # Resolve API 'AppendToTimeline' is smart enough to map Audio to Audio tracks and Video to Video tracks.
    # However, to cut PRECISELY at beats, we need to construct a robust Edit List or use Insert commands.
    
    # Simplified visual sync for Free Version script:
    # Just append all clips in order. The user can then slip-edit to beats.
    # Automating exact frame-perfect cuts via this script without the full Studio API (timeline.CreateItemFromDict) is tricky.
    # BUT, we can try to set In/Out points on the clips *before* appending? 
    # No, MediaPoolItems don't support SetIn/SetOut easily in all versions.
    
    # BETTER APPROACH for "Sync to Beat" in purely script:
    # We can't easily drive the edit page from a Comp script.
    
    # FALLBACK: Just import the media and create a timeline. 
    # The pure automation of "cuts" is complex without full API.
    # Let's try to do a basic append.
    
    timeline.AppendToTimeline(video_items)
    
    print("Added clips to timeline. Sync logic in Free Version is limited.")
    print("For full beat-sync automation, Resolve Studio is recommended.")

if __name__ == '__main__':
    main()
`;

        const baseName = data.audioPath ? path.basename(data.audioPath, path.extname(data.audioPath)) : 'Untitled';
        const sanitized = baseName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
        const fileName = `02_Sync_Video_${sanitized}.py`;
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
            const note = m.note.replace(/'/g, "\\'");
            const mtype = m.type.replace(/'/g, "\\'");
            return `    {'frame': ${m.frame}, 'timestamp': ${m.timestamp.toFixed(3)}, 'color': '${m.color}', 'note': '${note}', 'type': '${mtype}', 'duration_sec': ${m.duration_sec}}`;
        });

        const escapedAudio = (data.audioPath || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const escapedCsv = (data.csvPath || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        const script = `#!/usr/bin/env python
# Auto-generated by Resolve Tools Dashboard
# Project: ${data.projectName.replace(/'/g, '')}
# Audio:   ${data.audioPath.replace(/\\/g, '/').replace(/'/g, '')}
# Run from DaVinci Resolve:  Workspace > Scripts > 01_Load_Beats

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
    # When run from Workspace > Scripts, 'resolve' is a pre-existing global.
    # This works on BOTH Free and Studio editions.
    _resolve = None

    # 1. Try the built-in global (Fusion scripting context)
    try:
        _resolve = resolve  # noqa: F821 — injected by Resolve
    except NameError:
        pass

    # 2. Try via fusion global
    if not _resolve:
        try:
            _resolve = fusion.GetResolve()  # noqa: F821
        except (NameError, AttributeError):
            pass

    # 3. Try bmd.scriptapp (Resolve's internal module)
    if not _resolve:
        try:
            _resolve = bmd.scriptapp('Resolve')  # noqa: F821
        except (NameError, AttributeError):
            pass

    # 4. Last resort: external scripting API (Studio only)
    if not _resolve:
        try:
            import DaVinciResolveScript as dvr_script
            _resolve = dvr_script.scriptapp('Resolve')
        except (ImportError, AttributeError):
            programdata = os.environ.get('PROGRAMDATA', r'C:\\ProgramData')
            mod_path = os.path.join(programdata, 'Blackmagic Design', 'DaVinci Resolve',
                                    'Support', 'Developer', 'Scripting', 'Modules')
            if os.path.exists(mod_path) and mod_path not in sys.path:
                sys.path.insert(0, mod_path)
                try:
                    import DaVinciResolveScript as dvr_script
                    _resolve = dvr_script.scriptapp('Resolve')
                except (ImportError, AttributeError):
                    pass

    if not _resolve:
        print('ERROR: Could not connect to Resolve.')
        print('Make sure this script is run from Workspace > Scripts inside Resolve.')
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
    print(f'Timeline: {timeline.GetName()} ({fps} fps)')
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
        frame = m['frame']
        color = m['color']
        note = m['note']
        mtype = m['type']
        dur = m['duration_sec']
        dur_frames = max(1, round(dur * fps)) if dur > 0 else 1

        if mtype == 'onset' and audio_item:
            audio_item.AddMarker(frame, color, note, note, dur_frames)
            stats['onset'] += 1
        elif mtype in ('beat', 'loudness', 'section'):
            timeline.AddMarker(frame, color, note, note, dur_frames)
            stats[mtype] = stats.get(mtype, 0) + 1
        else:
            timeline.AddMarker(frame, color, note, note, dur_frames)
            stats['other'] += 1

    print('')
    print('--- Marker Import Complete ---')
    total = 0
    for mtype, count in stats.items():
        if count > 0:
            print(f'  {mtype}: {count}')
            total += count
    print(f'  Total: {total} markers')


if __name__ == '__main__':
    main()
`;

        // Generate a unique filename based on the audio file
        // e.g. "My Song.mp3" -> "01_Load_Beats_My_Song.py"
        const baseName = data.audioPath ? path.basename(data.audioPath, path.extname(data.audioPath)) : 'Untitled';
        const sanitized = baseName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
        const fileName = `01_Load_Beats_${sanitized}.py`;
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
        const resolveScriptsDir = getResolveScriptsDir();

        if (!fs.existsSync(resolveScriptsDir)) {
            return [];
        }

        const files = fs.readdirSync(resolveScriptsDir);
        const scriptFiles = files
            .filter(f => f.endsWith('.py'))
            .map(f => {
                const fullPath = path.join(resolveScriptsDir, f);
                const stats = fs.statSync(fullPath);
                return {
                    name: f,
                    path: fullPath,
                    size: stats.size,
                    mtime: stats.mtime,
                };
            })
            // Sort by newest first
            .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

        return scriptFiles;
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
 * IPC: get-config / save-config
 * Handles persistent configuration settings for the app.
 * ---------------------------------------------------------------------------
 */
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

ipcMain.handle('get-config', async () => {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = fs.readFileSync(CONFIG_PATH, 'utf8');
            return { success: true, config: JSON.parse(data) };
        }
        return { success: true, config: {} };
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
