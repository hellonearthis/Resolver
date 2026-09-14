"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const child_process_1 = require("child_process");
const resolveBridge_1 = require("./resolveBridge");
const mcpBridge_1 = require("./mcpBridge");
const llamaServerClient_1 = require("./llamaServerClient");
// @ts-expect-error No type declarations available for electron-squirrel-startup
const electron_squirrel_startup_1 = __importDefault(require("electron-squirrel-startup"));
// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (electron_squirrel_startup_1.default) {
    electron_1.app.quit();
}
// Register custom protocol as privileged to support Fetch API
electron_1.protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);
// WHAT: Discovers DaVinci Resolve's active script directory on Windows.
// WHY: Blackmagic Design puts scripts in either ProgramData (shared across users) or AppData (current user).
// We check ProgramData first because Resolve prioritizes system-wide scripts.
const getResolveScriptsDir = () => {
    // 1. Check ProgramData (All Users) - Resolve often prioritizes this
    const program_data_directory = process.env.PROGRAMDATA || 'C:\\ProgramData';
    const system_shared_scripts_path = path_1.default.join(program_data_directory, 'Blackmagic Design', 'DaVinci Resolve', 'Fusion', 'Scripts', 'Comp');
    // 2. Check AppData (Current User)
    const user_roaming_appdata = process.env.APPDATA || path_1.default.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    const user_specific_scripts_path = path_1.default.join(user_roaming_appdata, 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Fusion', 'Scripts', 'Comp');
    // Prefer ProgramData if it exists and has Resolve folders, otherwise fallback to AppData
    if (fs_1.default.existsSync(path_1.default.dirname(system_shared_scripts_path))) {
        return system_shared_scripts_path;
    }
    return user_specific_scripts_path;
};
// WHAT: Creates and displays the main Electron browser window with full desktop integration.
// WHY: Hosts the React application and provides nodeIntegration for direct filesystem operations.
const createWindow = () => {
    const main_application_window = new electron_1.BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            nodeIntegration: true, // For simplicity in this local desktop creative suite
            contextIsolation: false, // Strictly local desktop application
        },
    });
    if (process.env.VITE_DEV_SERVER_URL) {
        main_application_window.loadURL(process.env.VITE_DEV_SERVER_URL);
    }
    else {
        main_application_window.loadFile(path_1.default.join(__dirname, '../dist/index.html'));
    }
    main_application_window.maximize();
    main_application_window.webContents.openDevTools();
};
electron_1.app.whenReady().then(() => {
    // WHAT: Custom file protocol handler for local media assets (`media://`).
    // WHY: Bypasses standard browser web-security restrictions on accessing raw disk files from file:/// URLs
    // while maintaining fast streaming, range requests, and audio/video decoding.
    electron_1.protocol.registerFileProtocol('media', (incoming_protocol_request, protocol_response_callback) => {
        let media_file_relative_url = incoming_protocol_request.url.replace('media://', '').split('?')[0];
        // URL parsing strips the colon from Windows drive letters (e.g. "C:/path" becomes "c/path").
        if (/^[a-zA-Z]\//.test(media_file_relative_url)) {
            media_file_relative_url = media_file_relative_url[0] + ':' + media_file_relative_url.substring(1);
        }
        try {
            return protocol_response_callback(decodeURIComponent(media_file_relative_url));
        }
        catch (error_instance) {
            console.error('Failed to decode media URL:', error_instance);
            return protocol_response_callback('404');
        }
    });
    createWindow();
    // WHAT: Modifies outgoing HTTP and WebSocket request headers destined for local ComfyUI.
    // WHY: ComfyUI enforces origin checking and returns 403 Forbidden to foreign browser origins. Spoofing
    // the Origin header satisfies ComfyUI's internal security gate when connecting via desktop Electron.
    electron_1.session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['http://127.0.0.1:8188/*', 'ws://127.0.0.1:8188/*'] }, (request_details, response_callback) => {
        request_details.requestHeaders['Origin'] = 'http://127.0.0.1:8188';
        response_callback({ requestHeaders: request_details.requestHeaders });
    });
});
// WHAT: Asynchronously synchronizes project data with DaVinci Resolve via an external Python bridge child process.
// WHY: Provides backward compatibility for setups where Python runs as an out-of-process CLI runner.
electron_1.ipcMain.on('sync-to-resolve', (event_emitter, sync_payload_data) => {
    console.log('Received sync request:', sync_payload_data);
    // Serialize data to pass to Python via temp file
    const temporary_sync_data_file_path = path_1.default.join(electron_1.app.getPath('userData'), 'sync_data.json');
    fs_1.default.writeFileSync(temporary_sync_data_file_path, JSON.stringify(sync_payload_data));
    console.log('Data written to:', temporary_sync_data_file_path);
    // Spawn Python script
    const python_script_file_path = path_1.default.resolve(__dirname, '../scripts/resolve_sync.py');
    console.log('Spawning python script at:', python_script_file_path);
    const python_child_process = (0, child_process_1.spawn)('python', [python_script_file_path, temporary_sync_data_file_path]);
    python_child_process.stdout.on('data', (standard_output_buffer) => {
        console.log(`Python Output: ${standard_output_buffer}`);
    });
    python_child_process.stderr.on('data', (standard_error_buffer) => {
        console.error(`Python Error: ${standard_error_buffer}`);
    });
    python_child_process.on('close', (process_exit_code) => {
        console.log(`Python process exited with code ${process_exit_code}`);
        if (process_exit_code === 0) {
            event_emitter.reply('sync-complete', 'Sync completed successfully!');
        }
        else {
            event_emitter.reply('sync-error', `Python script failed with code ${process_exit_code}`);
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
electron_1.ipcMain.handle('open-audio-dialog', async (_event, defaultPath) => {
    const dialogOptions = {
        title: 'Select Audio File',
        filters: [
            { name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a'] },
            { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
    };
    if (defaultPath) {
        // Navigate to the directory containing the stored file
        const dir = path_1.default.dirname(defaultPath);
        if (fs_1.default.existsSync(dir)) {
            dialogOptions.defaultPath = defaultPath;
        }
    }
    const result = await electron_1.dialog.showOpenDialog(dialogOptions);
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
electron_1.ipcMain.handle('open-image-dialog', async (_event, defaultPath) => {
    const dialogOptions = {
        title: 'Select Image File',
        filters: [
            { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
            { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
    };
    if (defaultPath && fs_1.default.existsSync(defaultPath)) {
        dialogOptions.defaultPath = defaultPath;
    }
    const result = await electron_1.dialog.showOpenDialog(dialogOptions);
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
// WHAT: Opens the host OS file explorer (Windows Explorer) highlighting the target file or folder.
// WHY: Allows the user to jump directly to project bundles, exported audio, or generated video files.
electron_1.ipcMain.handle('open-folder', async (_event, target_folder_path) => {
    if (fs_1.default.existsSync(target_folder_path)) {
        electron_1.shell.showItemInFolder(target_folder_path);
        return true;
    }
    return false;
});
// WHAT: Generates an automated Python script for DaVinci Resolve (Free/Studio) to import audio and video to the Media Pool.
// WHY: Fallback workflow for users who prefer executing file imports via Resolve's Workspace > Scripts menu.
electron_1.ipcMain.handle('stage-video-sync', async (_event, incoming_sync_data) => {
    try {
        const resolve_scripts_directory = getResolveScriptsDir();
        if (!fs_1.default.existsSync(resolve_scripts_directory)) {
            fs_1.default.mkdirSync(resolve_scripts_directory, { recursive: true });
        }
        const escaped_audio_file_path = (incoming_sync_data.audioPath || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const escaped_video_file_paths = incoming_sync_data.videoPaths
            .map(video_path => `'${video_path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
            .join(',\n    ');
        const script_content = `#!/usr/bin/env python
# Auto-generated by Resolve Tools Dashboard - Load Media
# Run from DaVinci Resolve: Workspace > Scripts > 01_Load_Media_Script

import sys
import os

# --- EMBEDDED MEDIA DATA ---
AUDIO_PATH = '${escaped_audio_file_path}'
VIDEO_PATHS = [
    ${escaped_video_file_paths}
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
        const project_base_name = incoming_sync_data.projectName || (incoming_sync_data.audioPath ? path_1.default.basename(incoming_sync_data.audioPath, path_1.default.extname(incoming_sync_data.audioPath)) : 'Untitled');
        const sanitized_script_name = project_base_name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
        const script_file_name = `01_Load_Media_Script_${sanitized_script_name}.py`;
        const script_target_path = path_1.default.join(resolve_scripts_directory, script_file_name);
        fs_1.default.writeFileSync(script_target_path, script_content, 'utf8');
        return { success: true, scriptPath: script_target_path };
    }
    catch (error_instance) {
        const error_message = error_instance instanceof Error ? error_instance.message : String(error_instance);
        return { success: false, error: error_message };
    }
});
electron_1.ipcMain.handle('stage-for-resolve', async (_event, data) => {
    try {
        const resolveScriptsDir = getResolveScriptsDir();
        // Ensure the directory exists
        if (!fs_1.default.existsSync(resolveScriptsDir)) {
            fs_1.default.mkdirSync(resolveScriptsDir, { recursive: true });
        }
        // Build the Python marker list literal
        const markerLines = data.markers.map(m => {
            const note = (m.note || '').replace(/'/g, "\\'");
            const mtype = (m.type || '').replace(/'/g, "\\'");
            // Map hex/rgba to Resolve color names
            let rColor = 'Blue';
            const c = m.color.toLowerCase();
            if (c.includes('red') || c.includes('#ff0000'))
                rColor = 'Red';
            else if (c.includes('yellow') || c.includes('#ffff00'))
                rColor = 'Yellow';
            else if (c.includes('green') || c.includes('#00ff00'))
                rColor = 'Green';
            else if (c.includes('cyan') || c.includes('#00ffff') || c.includes('6, 182, 212'))
                rColor = 'Cyan';
            else if (c.includes('magenta') || c.includes('fuchsia') || c.includes('#ff00ff'))
                rColor = 'Fuchsia';
            else if (c.includes('orange') || c.includes('245, 158, 11'))
                rColor = 'Sand';
            else if (c.includes('purple') || c.includes('139, 92, 246'))
                rColor = 'Purple';
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
        const baseName = data.projectName || (data.audioPath ? path_1.default.basename(data.audioPath, path_1.default.extname(data.audioPath)) : 'Untitled');
        const sanitized = baseName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
        const fileName = `03_Set_Beat_Markers_Script_${sanitized}.py`;
        const fullPath = path_1.default.join(resolveScriptsDir, fileName);
        fs_1.default.writeFileSync(fullPath, script, 'utf8');
        return { success: true, scriptPath: fullPath };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('stage-for-resolve error:', message);
        return { success: false, error: message };
    }
});
// ---------------------------------------------------------------------------
// Rename a script
// ---------------------------------------------------------------------------
electron_1.ipcMain.handle('rename-resolve-script', async (_event, data) => {
    try {
        if (!fs_1.default.existsSync(data.oldPath)) {
            return { success: false, error: 'File not found' };
        }
        const dir = path_1.default.dirname(data.oldPath);
        // Ensure new name ends with .py
        const safeName = data.newName.endsWith('.py') ? data.newName : `${data.newName}.py`;
        // Sanitize new name slightly (allow standard chars)
        const sanitized = safeName.replace(/[<>:"/\\|?*]/g, '_');
        const newPath = path_1.default.join(dir, sanitized);
        if (fs_1.default.existsSync(newPath)) {
            return { success: false, error: 'Filename already exists' };
        }
        fs_1.default.renameSync(data.oldPath, newPath);
        return { success: true };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
});
// ---------------------------------------------------------------------------
// Edit a script (open in Notepad)
// ---------------------------------------------------------------------------
electron_1.ipcMain.handle('edit-resolve-script', async (_event, scriptPath) => {
    try {
        if (!fs_1.default.existsSync(scriptPath)) {
            return { success: false, error: 'File not found' };
        }
        (0, child_process_1.spawn)('notepad.exe', [scriptPath], { detached: true, stdio: 'ignore' }).unref();
        return { success: true };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
});
// ---------------------------------------------------------------------------
// List all scripts in the Resolve Scripts/Comp folder
// ---------------------------------------------------------------------------
electron_1.ipcMain.handle('list-resolve-scripts', async () => {
    try {
        // Scan both locations
        const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
        const commonDir = path_1.default.join(programData, 'Blackmagic Design', 'DaVinci Resolve', 'Fusion', 'Scripts', 'Comp');
        const appData = process.env.APPDATA || path_1.default.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
        const userDir = path_1.default.join(appData, 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Fusion', 'Scripts', 'Comp');
        const scriptFiles = [];
        const seenNames = new Set();
        const scanDir = (dir) => {
            if (fs_1.default.existsSync(dir)) {
                fs_1.default.readdirSync(dir).filter(f => f.endsWith('.py')).forEach(f => {
                    const fullPath = path_1.default.join(dir, f);
                    const stats = fs_1.default.statSync(fullPath);
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
    }
    catch (err) {
        console.error('list-resolve-scripts error:', err);
        return [];
    }
});
// ---------------------------------------------------------------------------
// Delete a specific script
// ---------------------------------------------------------------------------
electron_1.ipcMain.handle('delete-resolve-script', async (_event, scriptPath) => {
    try {
        if (fs_1.default.existsSync(scriptPath)) {
            fs_1.default.unlinkSync(scriptPath);
            return { success: true };
        }
        return { success: false, error: 'File not found' };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
});
// ---------------------------------------------------------------------------
// DaVinci Resolve HTTP Loopback Bridge (Free + Studio)
// ---------------------------------------------------------------------------
// WHAT: Checks whether the bridge is online, what project is open, and if script is installed.
// WHY: Gives the UI real-time connection telemetry (e.g. "Resolve Connected • Project: MyTrack").
electron_1.ipcMain.handle('resolve-bridge-status', async () => {
    const resolve_bridge_client = new resolveBridge_1.ResolveBridgeClient();
    return await resolve_bridge_client.checkConnectionStatus();
});
// WHAT: Copies scripts/resolve_bridge.py into Resolve's Utility scripts folder.
// WHY: One-click installation so users don't have to manually browse to ProgramData/Fusion.
electron_1.ipcMain.handle('resolve-bridge-install', async () => {
    return (0, resolveBridge_1.installBridgeScript)();
});
// WHAT: Pushes beat, onset, and loudness markers directly to Resolve's active timeline over HTTP.
// WHY: Instant live synchronization without generating or manually executing Python scripts.
electron_1.ipcMain.handle('resolve-bridge-push-markers', async (_event, incoming_payload) => {
    const resolve_bridge_client = new resolveBridge_1.ResolveBridgeClient();
    return await resolve_bridge_client.pushMarkersToActiveTimeline(incoming_payload.markers || []);
});
// WHAT: Directly imports audio and video files into DaVinci Resolve's active Media Pool.
// WHY: Eliminates manual file import steps and executes in sub-100ms.
electron_1.ipcMain.handle('resolve-bridge-import-media', async (_event, incoming_payload) => {
    const resolve_bridge_client = new resolveBridge_1.ResolveBridgeClient();
    return await resolve_bridge_client.importMediaIntoMediaPool(incoming_payload.audioPath || '', incoming_payload.videoPaths || []);
});
// WHAT: Reconstructs the video assembler timeline in DaVinci Resolve with clips positioned at exact timestamps.
// WHY: One-click direct assembly on the active or generated Resolve timeline.
electron_1.ipcMain.handle('resolve-bridge-reconstruct-timeline', async (_event, incoming_payload) => {
    const resolve_bridge_client = new resolveBridge_1.ResolveBridgeClient();
    return await resolve_bridge_client.reconstructTimeline(incoming_payload.projectName || '', incoming_payload.audioPath || '', incoming_payload.frameRate || 24, incoming_payload.clips || []);
});
// ---------------------------------------------------------------------------
// Model Context Protocol (MCP) Bridge & Telemetry
// ---------------------------------------------------------------------------
// WHAT: Retrieves MCP server operational status, script location, and tools count.
// WHY: Informs the MCP Control UI module of live server health and bridge readiness.
electron_1.ipcMain.handle('mcp-get-status', async () => {
    return await (0, mcpBridge_1.getMcpServerStatus)();
});
// WHAT: Returns the complete list of registered MCP tools and their JSON schemas.
// WHY: Powers the interactive tool explorer and inspection views in the frontend.
electron_1.ipcMain.handle('mcp-get-tools', async () => {
    return mcpBridge_1.REGISTERED_MCP_TOOLS_DEFINITIONS;
});
// WHAT: Generates copyable MCP config snippets for Claude Desktop, Antigravity, and Cursor.
// WHY: Gives users instantaneous 1-click configuration without manual JSON editing.
electron_1.ipcMain.handle('mcp-get-client-config', async () => {
    return (0, mcpBridge_1.generateMcpClientConfigurations)();
});
// WHAT: Directly executes an MCP tool within the Electron process and broadcasts activity.
// WHY: Allows manual interactive testing from the Resolver UI with live execution logging.
electron_1.ipcMain.handle('mcp-execute-tool', async (_event, incoming_payload) => {
    return await (0, mcpBridge_1.executeMcpToolDirectly)(incoming_payload.tool_name, incoming_payload.tool_arguments || {});
});
// ---------------------------------------------------------------------------
// ComfyUI Integration
// ---------------------------------------------------------------------------
electron_1.ipcMain.handle('load-default-workflow', async () => {
    try {
        const potentialPaths = [
            path_1.default.join(electron_1.app.isPackaged ? process.resourcesPath : electron_1.app.getAppPath(), 'comfyui_workflows/Extract_Stems.json'),
            path_1.default.join(__dirname, '../comfyui_workflows/Extract_Stems.json'),
            path_1.default.join(process.cwd(), 'comfyui_workflows/Extract_Stems.json'),
            path_1.default.resolve(__dirname, '../../comfyui_workflows/Extract_Stems.json')
        ];
        let workflowPath = '';
        for (const p of potentialPaths) {
            console.log('Checking workflow path:', p);
            if (fs_1.default.existsSync(p)) {
                workflowPath = p;
                break;
            }
        }
        if (!workflowPath) {
            console.error('Workflow file not found in any location:', potentialPaths);
            return { success: false, error: 'Workflow file not found' };
        }
        const content = fs_1.default.readFileSync(workflowPath, 'utf8');
        return { success: true, workflow: JSON.parse(content) };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Error loading workflow:', message);
        return { success: false, error: message };
    }
});
electron_1.ipcMain.handle('select-folder', async () => {
    const result = await electron_1.dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    if (result.canceled)
        return null;
    return result.filePaths[0];
});
electron_1.ipcMain.handle('open-external-path', async (_event, pathStr) => {
    if (!pathStr)
        return { success: false, error: 'No path provided' };
    try {
        await electron_1.shell.openPath(pathStr);
        return { success: true };
    }
    catch (e) {
        console.error('Failed to open path:', e);
        return { success: false, error: String(e) };
    }
});
// Proxy ComfyUI requests to avoid CORS
electron_1.ipcMain.handle('comfy-fetch', async (_event, url, options) => {
    console.log(`Proxying request to: ${url}`);
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            console.error(`ComfyUI Fetch Error: ${response.status} ${response.statusText}`);
            return { success: false, status: response.status, error: response.statusText };
        }
        const data = await response.json();
        return { success: true, data };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('ComfyUI Proxy Error:', message);
        return { success: false, error: message };
    }
});
// Proxy ComfyUI file uploads (multipart/form-data)
electron_1.ipcMain.handle('comfy-upload-file', async (_event, api_url, filePath, type, overwrite) => {
    console.log(`Uploading file to ComfyUI: ${filePath}`);
    try {
        if (!fs_1.default.existsSync(filePath)) {
            return { success: false, error: "File does not exist locally" };
        }
        const formData = new FormData();
        const fileContent = fs_1.default.readFileSync(filePath);
        const fileName = path_1.default.basename(filePath);
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
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('ComfyUI Upload Error:', message);
        return { success: false, error: message };
    }
});
// Extract audio from a user-selected video and save to a user-selected location
electron_1.ipcMain.handle('extract-audio-from-video', async () => {
    try {
        const inResult = await electron_1.dialog.showOpenDialog({
            title: 'Select Video File',
            filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }],
            properties: ['openFile'],
        });
        if (inResult.canceled || inResult.filePaths.length === 0)
            return { success: false, canceled: true };
        const inputPath = inResult.filePaths[0];
        const outResult = await electron_1.dialog.showSaveDialog({
            title: 'Save Extracted Audio As',
            filters: [
                { name: 'WAV Audio', extensions: ['wav'] },
                { name: 'MP3 Audio', extensions: ['mp3'] }
            ],
            defaultPath: path_1.default.join(path_1.default.dirname(inputPath), `${path_1.default.basename(inputPath, path_1.default.extname(inputPath))}_extracted.wav`),
        });
        if (outResult.canceled || !outResult.filePath)
            return { success: false, canceled: true };
        const outPath = outResult.filePath;
        return new Promise((resolve) => {
            const ext = path_1.default.extname(outPath).toLowerCase();
            const args = ['-y', '-i', inputPath, '-vn'];
            if (ext === '.mp3') {
                args.push('-q:a', '0');
            }
            else {
                args.push('-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2');
            }
            args.push(outPath);
            const ffmpeg = (0, child_process_1.spawn)('ffmpeg', args);
            let stderr = '';
            ffmpeg.stderr.on('data', (d) => { stderr += d.toString(); });
            ffmpeg.on('close', (code) => {
                if (code === 0 && fs_1.default.existsSync(outPath)) {
                    resolve({ success: true, path: outPath });
                }
                else {
                    resolve({ success: false, error: `ffmpeg failed (code ${code}): ${stderr.slice(-300)}` });
                }
            });
            ffmpeg.on('error', (err) => resolve({ success: false, error: err.message }));
        });
    }
    catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
});
// Convert any audio file to a clean WAV before sending to ComfyUI
// Uses ffmpeg if available; returns the path of the temp WAV file
electron_1.ipcMain.handle('convert-audio-to-wav', async (_event, inputPath) => {
    const tmpDir = electron_1.app.getPath('temp');
    const baseName = path_1.default.basename(inputPath, path_1.default.extname(inputPath));
    const outPath = path_1.default.join(tmpDir, `${baseName}_comfy_${Date.now()}.wav`);
    return new Promise((resolve) => {
        // Try ffmpeg first (most reliable)
        const ffmpeg = (0, child_process_1.spawn)('ffmpeg', [
            '-y', // overwrite
            '-i', inputPath,
            '-ar', '44100', // standard sample rate
            '-ac', '2', // stereo
            '-sample_fmt', 's16',
            outPath
        ]);
        let stderr = '';
        ffmpeg.stderr.on('data', (d) => { stderr += d.toString(); });
        ffmpeg.on('close', (code) => {
            if (code === 0 && fs_1.default.existsSync(outPath)) {
                console.log(`[convert-audio-to-wav] Success: ${outPath}`);
                resolve({ success: true, path: outPath });
            }
            else {
                console.error(`[convert-audio-to-wav] ffmpeg exited ${code}: ${stderr.slice(-300)}`);
                resolve({ success: false, error: `ffmpeg failed (code ${code}). Is ffmpeg installed and on PATH?` });
            }
        });
        ffmpeg.on('error', (err) => {
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
electron_1.ipcMain.handle('get-video-info', async (_event, filePath) => {
    return new Promise((resolve) => {
        const args = [
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            filePath
        ];
        const proc = (0, child_process_1.spawn)('ffprobe', args);
        let output = '';
        proc.stdout.on('data', (d) => { output += d.toString(); });
        proc.stderr.on('data', (d) => { console.log('ffprobe stderr:', d.toString()); });
        proc.on('close', (code) => {
            if (code === 0) {
                try {
                    const data = JSON.parse(output);
                    const videoStream = data.streams?.find((stream_candidate) => stream_candidate.codec_type === 'video');
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
                }
                catch (err) {
                    resolve({ success: false, error: `Failed to parse ffprobe output: ${err}` });
                }
            }
            else {
                resolve({ success: false, error: `ffprobe exited with code ${code}` });
            }
        });
        proc.on('error', (err) => {
            resolve({ success: false, error: `ffprobe not found: ${err.message}` });
        });
    });
});
/**
 * IPC: extract-video-thumbnails
 * Extracts thumbnail frames from a video at a configurable FPS rate.
 * Saves small-scale JPGs (160px wide) to a thumbnails/ subfolder in the project dir.
 */
electron_1.ipcMain.handle('extract-video-thumbnails', async (_event, data) => {
    return new Promise((resolve) => {
        const fps = data.fps || 3;
        const thumbDir = path_1.default.join(data.outputDir, 'thumbnails');
        if (!fs_1.default.existsSync(thumbDir)) {
            fs_1.default.mkdirSync(thumbDir, { recursive: true });
        }
        const outputPattern = path_1.default.join(thumbDir, 'thumb_%04d.jpg');
        const args = [
            '-i', data.filePath,
            '-vf', `fps=${fps},scale=160:-1`,
            '-q:v', '6',
            '-an',
            '-f', 'image2',
            outputPattern
        ];
        console.log('[extract-video-thumbnails] Running ffmpeg:', args.join(' '));
        const proc = (0, child_process_1.spawn)('ffmpeg', args);
        proc.stderr.on('data', (d) => {
            console.log('ffmpeg thumb:', d.toString().slice(0, 200));
        });
        proc.on('close', (code) => {
            if (code === 0) {
                const files = fs_1.default.readdirSync(thumbDir)
                    .filter((f) => f.startsWith('thumb_') && f.endsWith('.jpg'))
                    .sort();
                const thumbnails = files.map((f, i) => ({
                    path: path_1.default.join(thumbDir, f),
                    time: i / fps
                }));
                console.log(`[extract-video-thumbnails] Extracted ${thumbnails.length} thumbnails`);
                resolve({ success: true, thumbnails });
            }
            else {
                resolve({ success: false, error: `ffmpeg exited with code ${code}` });
            }
        });
        proc.on('error', (err) => {
            resolve({ success: false, error: `ffmpeg not found: ${err.message}` });
        });
    });
});
/**
 * IPC: save-video-frame
 * Extracts a single frame at full video resolution from a specific timestamp.
 * Saves to the images/ subfolder in the project dir.
 */
electron_1.ipcMain.handle('save-video-frame', async (_event, data) => {
    return new Promise((resolve) => {
        const imagesDir = path_1.default.join(data.outputDir, 'images');
        if (!fs_1.default.existsSync(imagesDir)) {
            fs_1.default.mkdirSync(imagesDir, { recursive: true });
        }
        const filename = data.filename || `frame_${data.time.toFixed(3).replace('.', '_')}s.png`;
        const outputPath = path_1.default.join(imagesDir, filename);
        const args = [
            '-ss', data.time.toString(),
            '-i', data.filePath,
            '-vframes', '1',
            '-q:v', '1',
            outputPath
        ];
        console.log('[save-video-frame] Running ffmpeg:', args.join(' '));
        const proc = (0, child_process_1.spawn)('ffmpeg', args);
        proc.stderr.on('data', (d) => {
            console.log('ffmpeg frame:', d.toString().slice(0, 200));
        });
        proc.on('close', (code) => {
            if (code === 0 && fs_1.default.existsSync(outputPath)) {
                console.log(`[save-video-frame] Saved frame: ${outputPath}`);
                resolve({ success: true, framePath: outputPath });
            }
            else {
                resolve({ success: false, error: `ffmpeg exited with code ${code}` });
            }
        });
        proc.on('error', (err) => {
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
const CONFIG_PATH = path_1.default.join(electron_1.app.getPath('userData'), 'config.json');
electron_1.ipcMain.handle('get-config', async () => {
    try {
        const defaultConfig = {
            comfyOutputDir: '',
            projectOutputDir: '',
            llmProvider: 'llama-server',
            llamaServerUrl: 'http://localhost:8080',
            llmMaxTokens: 128,
            llmTemperature: 0.7,
            llmTopP: 0.9,
            llmTopK: 50,
            llmRepetitionPenalty: 1.5
        };
        if (fs_1.default.existsSync(CONFIG_PATH)) {
            const data = fs_1.default.readFileSync(CONFIG_PATH, 'utf8');
            const userConfig = JSON.parse(data);
            // WHAT: Safely migrate legacy LM Studio provider settings to llama-server.
            // WHY: Ensures existing user installations seamlessly adopt llama-server on port 8080
            // without requiring manual config deletion or UI re-selection.
            if (userConfig.llmProvider === 'lmstudio') {
                userConfig.llmProvider = 'llama-server';
            }
            if (userConfig.lmStudioUrl && !userConfig.llamaServerUrl) {
                userConfig.llamaServerUrl = 'http://localhost:8080';
            }
            return { success: true, config: { ...defaultConfig, ...userConfig } };
        }
        return { success: true, config: defaultConfig };
    }
    catch (err) {
        console.error('Error reading config:', err);
        return { success: false, error: String(err) };
    }
});
// WHAT: IPC handler to test connection and discover active model metadata on llama-server.
// WHY: Gives the Settings UI real-time diagnostic reporting (status pill, active model, vision support).
electron_1.ipcMain.handle('llm-test-connection', async (_event, custom_llama_server_endpoint_url) => {
    try {
        let active_target_url = typeof custom_llama_server_endpoint_url === 'string' && custom_llama_server_endpoint_url.trim().length > 0
            ? custom_llama_server_endpoint_url.trim()
            : undefined;
        if (!active_target_url && fs_1.default.existsSync(CONFIG_PATH)) {
            const persisted_configuration_record = JSON.parse(fs_1.default.readFileSync(CONFIG_PATH, 'utf8'));
            if (typeof persisted_configuration_record.llamaServerUrl === 'string') {
                active_target_url = persisted_configuration_record.llamaServerUrl;
            }
        }
        const llama_server_client_instance = new llamaServerClient_1.LlamaServerClient(active_target_url);
        const diagnostic_test_result = await llama_server_client_instance.testLlamaServerConnection();
        return { success: true, diagnostic: diagnostic_test_result };
    }
    catch (connection_testing_error) {
        const error_message_text = connection_testing_error instanceof Error ? connection_testing_error.message : String(connection_testing_error);
        return {
            success: false,
            diagnostic: {
                connection_status: 'offline',
                resolved_endpoint_url: null,
                discovered_model_metadata: null,
                multimodal_vision_supported: false,
                diagnostic_message: `Connection test failed: ${error_message_text}`
            }
        };
    }
});
electron_1.ipcMain.handle('save-config', async (_event, newConfig) => {
    try {
        let currentConfig = {};
        if (fs_1.default.existsSync(CONFIG_PATH)) {
            currentConfig = JSON.parse(fs_1.default.readFileSync(CONFIG_PATH, 'utf8'));
        }
        const updatedConfig = { ...currentConfig, ...newConfig };
        fs_1.default.writeFileSync(CONFIG_PATH, JSON.stringify(updatedConfig, null, 2));
        return { success: true, config: updatedConfig };
    }
    catch (err) {
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
electron_1.ipcMain.handle('stage-timeline-to-resolve', async (_event, data) => {
    try {
        const resolveScriptsDir = getResolveScriptsDir();
        if (!fs_1.default.existsSync(resolveScriptsDir)) {
            fs_1.default.mkdirSync(resolveScriptsDir, { recursive: true });
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
        const fullPath = path_1.default.join(resolveScriptsDir, fileName);
        fs_1.default.writeFileSync(fullPath, script, 'utf8');
        return { success: true, scriptPath: fullPath };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
});
// ---------------------------------------------------------------------------
// Music Video Assembler - Save Manifest
// ---------------------------------------------------------------------------
electron_1.ipcMain.handle('save-manifest', async (_event, manifest) => {
    try {
        const { filePath } = await electron_1.dialog.showSaveDialog({
            title: 'Save Music Video Manifest',
            defaultPath: 'music_video_manifest.json',
            filters: [{ name: 'JSON', extensions: ['json'] }]
        });
        if (filePath) {
            fs_1.default.writeFileSync(filePath, JSON.stringify(manifest, null, 2));
            return { success: true, path: filePath };
        }
        return { success: false, error: 'Cancelled' };
    }
    catch (err) {
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
electron_1.ipcMain.handle('scan-projects-folder', async (_event, folderPath) => {
    try {
        if (!fs_1.default.existsSync(folderPath)) {
            return { success: false, error: 'Folder does not exist' };
        }
        const projects = [];
        // Only scan top-level items in the output folder for PRJ_ directories
        const items = fs_1.default.readdirSync(folderPath);
        for (const item of items) {
            const itemPath = path_1.default.join(folderPath, item);
            if (fs_1.default.statSync(itemPath).isDirectory() && item.startsWith('PRJ_')) {
                const projectJsonPath = path_1.default.join(itemPath, 'project.json');
                try {
                    if (fs_1.default.existsSync(projectJsonPath)) {
                        const content = fs_1.default.readFileSync(projectJsonPath, 'utf8');
                        const data = JSON.parse(content);
                        if (data.id && data.name) {
                            // Enforce dynamic outputDir based on the actual folder path
                            // This guarantees project bundles stay portable if moved to another drive/PC
                            data.outputDir = itemPath;
                            projects.push(data);
                        }
                    }
                }
                catch (e) {
                    console.error(`Error reading project file in ${itemPath}:`, e);
                }
            }
        }
        // Sort by updatedAt descending
        projects.sort((earlier_project, later_project) => {
            return new Date(later_project.updatedAt || 0).getTime() - new Date(earlier_project.updatedAt || 0).getTime();
        });
        return { success: true, projects };
    }
    catch (err) {
        console.error('Error scanning projects folder:', err);
        return { success: false, error: String(err) };
    }
});
let vinoPipeline = null;
// WHAT: Auto-launches or ensures llama-server.exe is running on port 8080 with the configured model.
// WHY: Enables on-demand LLM booting when an expansion or vision task is requested after being unloaded for ComfyUI.
async function ensureLlamaServerRunning(port = 8080) {
    const llama_client = new llamaServerClient_1.LlamaServerClient(`http://127.0.0.1:${port}`);
    const is_already_online = await llama_client.discoverActiveLlamaServerModel();
    if (is_already_online) {
        return { success: true };
    }
    let loaded_config = {};
    if (fs_1.default.existsSync(CONFIG_PATH)) {
        try {
            loaded_config = JSON.parse(fs_1.default.readFileSync(CONFIG_PATH, 'utf8'));
        }
        catch { /* ignore */ }
    }
    let model_path = typeof loaded_config.selectedLlamaModelPath === 'string'
        ? loaded_config.selectedLlamaModelPath
        : '';
    if (!model_path || !fs_1.default.existsSync(model_path)) {
        const models_dir = typeof loaded_config.llamaModelsDir === 'string'
            ? loaded_config.llamaModelsDir
            : path_1.default.join(process.env.USERPROFILE || '', '.cache', 'lm-studio', 'models');
        const discovered = (0, llamaServerClient_1.scanLocalGgufModels)(models_dir);
        const qwen_match = discovered.find(m => m.model_name.toLowerCase().includes('qwen3.5-9b')) || discovered[0];
        if (qwen_match) {
            model_path = qwen_match.file_path;
        }
        else {
            return { success: false, error: 'No GGUF model found on disk to auto-launch.' };
        }
    }
    let mmproj_path = typeof loaded_config.selectedLlamaMmprojPath === 'string'
        ? loaded_config.selectedLlamaMmprojPath
        : null;
    if (!mmproj_path || !fs_1.default.existsSync(mmproj_path)) {
        const model_folder = path_1.default.dirname(model_path);
        try {
            const files_in_dir = fs_1.default.readdirSync(model_folder);
            const mmproj_file = files_in_dir.find(f => f.toLowerCase().startsWith('mmproj-') && f.toLowerCase().endsWith('.gguf'));
            if (mmproj_file) {
                mmproj_path = path_1.default.join(model_folder, mmproj_file);
            }
        }
        catch { /* ignore */ }
    }
    const llama_binary_path = (0, llamaServerClient_1.findLlamaServerBinaryPath)() || 'llama-server.exe';
    // Terminate any stale zombie processes
    try {
        (0, child_process_1.execSync)('taskkill /IM llama-server.exe /F', { stdio: 'ignore' });
    }
    catch { /* ignore */ }
    await new Promise(resolve => setTimeout(resolve, 500));
    const context_size = typeof loaded_config.llamaContextSize === 'number'
        ? loaded_config.llamaContextSize
        : 8192;
    const gpu_layers = typeof loaded_config.llamaGpuLayers === 'number'
        ? loaded_config.llamaGpuLayers
        : 99;
    const launch_arguments = [
        '-m', model_path,
        '--host', '127.0.0.1',
        '--port', String(port),
        '-c', String(context_size),
        '-ngl', String(gpu_layers),
        '--flash-attn', 'on',
        '--alias', 'default'
    ];
    if (mmproj_path && fs_1.default.existsSync(mmproj_path)) {
        launch_arguments.push('--mmproj', mmproj_path);
    }
    console.log('[LLM] On-demand auto-launching llama-server:', launch_arguments);
    const spawned_process = (0, child_process_1.spawn)(llama_binary_path, launch_arguments, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
    });
    spawned_process.unref();
    for (let poll_attempt = 0; poll_attempt < 30; poll_attempt++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        const ready = await llama_client.discoverActiveLlamaServerModel();
        if (ready)
            return { success: true };
    }
    return { success: false, error: 'llama-server auto-launch timed out after 15 seconds.' };
}
electron_1.ipcMain.handle('llm-ensure-server', async () => ensureLlamaServerRunning());
let llmRequestQueue = Promise.resolve();
electron_1.ipcMain.handle('llm-generate', (_event, data) => {
    // Wrap everything in a serial queue to prevent NPU concurrency crashes
    llmRequestQueue = llmRequestQueue.then(async () => {
        try {
            // Load latest config
            let config = {};
            if (fs_1.default.existsSync(CONFIG_PATH)) {
                config = JSON.parse(fs_1.default.readFileSync(CONFIG_PATH, 'utf8'));
            }
            const provider = String(config.llmProvider || 'llama-server');
            const params = {
                max_new_tokens: Number(config.llmMaxTokens) || 500,
                do_sample: true,
                temperature: Number(config.llmTemperature) || 0.7,
                top_p: Number(config.llmTopP) || 0.9,
                top_k: Number(config.llmTopK) || 50,
                repetition_penalty: Number(config.llmRepetitionPenalty) || 1.5,
            };
            if (provider === 'vino') {
                console.log('[LLM] Using Intel OpenVINO Backend');
                // Lazy load OpenVINO native module to prevent startup crashes if not installed
                let VLMPipeline;
                try {
                    const openvino_module = (await Promise.resolve().then(() => __importStar(require('openvino-genai-node'))));
                    // VLM for Gemma 3, LLM fallback if types are weird
                    VLMPipeline = openvino_module.VLMPipeline || openvino_module.LLMPipeline;
                }
                catch {
                    return { success: false, error: "OpenVino library not found. Have you run 'npm install'?" };
                }
                if (!VLMPipeline) {
                    return { success: false, error: "OpenVINO pipeline constructor unavailable" };
                }
                // Initialize singleton pipeline
                if (!vinoPipeline) {
                    const modelPath = path_1.default.join(process.cwd(), 'vino', 'gemma-3-openvino');
                    const cacheDir = path_1.default.join(process.cwd(), 'vino', 'ov_cache', 'gemma-3-openvino');
                    if (!fs_1.default.existsSync(modelPath)) {
                        return { success: false, error: `Model not found at: ${modelPath}. Please install Gemma 3 into the vino/ folder.` };
                    }
                    if (!fs_1.default.existsSync(cacheDir))
                        fs_1.default.mkdirSync(cacheDir, { recursive: true });
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
                    }
                    catch (npu_error) {
                        const npu_message = npu_error instanceof Error ? npu_error.message : String(npu_error);
                        console.warn(`[LLM] NPU Initialization Failed: ${npu_message}. Falling back to CPU...`);
                        try {
                            // Fallback to CPU if NPU driver/compilation fails
                            vinoPipeline = await VLMPipeline(modelPath, "CPU", { CACHE_DIR: cacheDir });
                        }
                        catch (cpu_error) {
                            const cpu_message = cpu_error instanceof Error ? cpu_error.message : String(cpu_error);
                            return { success: false, error: `Critical: AI Load failed on both NPU and CPU: ${cpu_message}` };
                        }
                    }
                    console.log(`[LLM] AI Pipeline Ready on ${vinoPipeline ? 'Hardware' : 'Error State'}.`);
                }
                // Chat Template for Gemma 3
                const fullPrompt = `<start_of_turn>user\n${data.systemPrompt}\n\nInput Scene: ${data.userPrompt}<end_of_turn>\n<start_of_turn>model\n`;
                console.log('[LLM] NPU Inference starting...');
                const startTime = Date.now();
                const result = await vinoPipeline.generate(fullPrompt, [], params);
                console.log(`[LLM] NPU Inference complete in ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
                // Explicitly cast to String to handle specialized OpenVINO return objects
                return { success: true, text: String(result) };
            }
            else {
                // WHAT: Dynamic model discovery and OpenAI-compatible completions for pure llama-server.
                // WHY: Automatically discovers the running model and ports, sending requests without hardcoding.
                console.log('[LLM] Using llama-server Backend');
                const custom_configured_llama_server_url = typeof config.llamaServerUrl === 'string'
                    ? config.llamaServerUrl
                    : undefined;
                const llama_server_client_instance = new llamaServerClient_1.LlamaServerClient(custom_configured_llama_server_url);
                let server_discovery_success = await llama_server_client_instance.discoverActiveLlamaServerModel();
                if (!server_discovery_success) {
                    console.log('[LLM] llama-server is offline. Auto-launching on demand...');
                    const ensure_result = await ensureLlamaServerRunning();
                    if (ensure_result.success) {
                        server_discovery_success = await llama_server_client_instance.discoverActiveLlamaServerModel();
                    }
                }
                if (!server_discovery_success) {
                    return {
                        success: false,
                        error: 'llama-server is offline and could not be auto-started. Please check model path in Settings.'
                    };
                }
                const chat_completions_endpoint_url = llama_server_client_instance.getChatCompletionsUrl();
                if (!chat_completions_endpoint_url) {
                    return {
                        success: false,
                        error: 'Unable to resolve llama-server chat completions endpoint.'
                    };
                }
                const active_model_identifier_string = llama_server_client_instance.getActiveModelIdentifier();
                const request_body_payload = {
                    model: active_model_identifier_string,
                    messages: [
                        { role: 'system', content: data.systemPrompt },
                        { role: 'user', content: data.userPrompt }
                    ],
                    temperature: params.temperature,
                    top_p: params.top_p,
                    max_tokens: params.max_new_tokens,
                    frequency_penalty: params.repetition_penalty - 1.0
                };
                if (typeof data.grammar === 'string' && data.grammar.trim().length > 0) {
                    request_body_payload.grammar = data.grammar.trim();
                }
                if (data.response_format) {
                    request_body_payload.response_format = data.response_format;
                }
                const completion_http_response = await fetch(chat_completions_endpoint_url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(request_body_payload)
                });
                if (!completion_http_response.ok) {
                    const response_error_text_content = await completion_http_response.text();
                    return {
                        success: false,
                        error: `llama-server HTTP Error: ${completion_http_response.status} - ${response_error_text_content}`
                    };
                }
                const completion_response_json = (await completion_http_response.json());
                const generated_output_text = completion_response_json.choices?.[0]?.message?.content || '';
                return { success: true, text: generated_output_text };
            }
        }
        catch (err) {
            console.error('[LLM] Generation Error:', err);
            return { success: false, error: String(err) };
        }
    });
    return llmRequestQueue;
});
// WHAT: Multimodal image description handler using local llama-server (e.g. Qwen 3.5 9B with mmproj).
// WHY: Enables fast, high-fidelity scene analysis directly without relying on ComfyUI or loading VLM nodes there.
electron_1.ipcMain.handle('llm-describe-image', async (_event, payload) => {
    try {
        const { imagePath, prompt, maxTokens = 1024 } = payload;
        if (!imagePath || !fs_1.default.existsSync(imagePath)) {
            return { success: false, error: `Image file does not exist at path: ${imagePath}` };
        }
        // Determine MIME type based on file extension
        const lower_case_extension = path_1.default.extname(imagePath).toLowerCase();
        let image_mime_type_string = 'image/jpeg';
        if (lower_case_extension === '.png')
            image_mime_type_string = 'image/png';
        else if (lower_case_extension === '.webp')
            image_mime_type_string = 'image/webp';
        else if (lower_case_extension === '.gif')
            image_mime_type_string = 'image/gif';
        const image_file_buffer = fs_1.default.readFileSync(imagePath);
        const image_base64_content_string = image_file_buffer.toString('base64');
        const formatted_image_data_uri_string = `data:${image_mime_type_string};base64,${image_base64_content_string}`;
        let loaded_application_configuration = {};
        if (fs_1.default.existsSync(CONFIG_PATH)) {
            loaded_application_configuration = JSON.parse(fs_1.default.readFileSync(CONFIG_PATH, 'utf8'));
        }
        const custom_configured_llama_server_url = typeof loaded_application_configuration.llamaServerUrl === 'string'
            ? loaded_application_configuration.llamaServerUrl
            : undefined;
        const llama_server_client_instance = new llamaServerClient_1.LlamaServerClient(custom_configured_llama_server_url);
        let server_discovery_success = await llama_server_client_instance.discoverActiveLlamaServerModel();
        if (!server_discovery_success) {
            console.log('[LLM] llama-server is offline for vision. Auto-launching on demand...');
            const ensure_result = await ensureLlamaServerRunning();
            if (ensure_result.success) {
                server_discovery_success = await llama_server_client_instance.discoverActiveLlamaServerModel();
            }
        }
        if (!server_discovery_success) {
            return {
                success: false,
                error: 'llama-server is offline and could not be auto-started. Please check model path in Settings.'
            };
        }
        return await llama_server_client_instance.generateMultimodalVisionDescription(formatted_image_data_uri_string, prompt, maxTokens);
    }
    catch (unexpected_processing_error) {
        console.error('[LLM] Multimodal vision analysis error:', unexpected_processing_error);
        const formatted_error_message = unexpected_processing_error instanceof Error
            ? unexpected_processing_error.message
            : String(unexpected_processing_error);
        return { success: false, error: formatted_error_message };
    }
});
// WHAT: IPC handler to scan disk for available .gguf models.
// WHY: Feeds the Settings module with a list of downloadable/installed models.
electron_1.ipcMain.handle('llm-scan-models', async (_event, custom_scan_path) => {
    try {
        let target_scan_path = custom_scan_path && custom_scan_path.trim().length > 0
            ? custom_scan_path.trim()
            : null;
        if (!target_scan_path) {
            let loaded_config = {};
            if (fs_1.default.existsSync(CONFIG_PATH)) {
                try {
                    loaded_config = JSON.parse(fs_1.default.readFileSync(CONFIG_PATH, 'utf8'));
                }
                catch { /* ignore */ }
            }
            if (typeof loaded_config.llamaModelsDir === 'string' && loaded_config.llamaModelsDir.trim().length > 0) {
                target_scan_path = loaded_config.llamaModelsDir.trim();
            }
        }
        if (!target_scan_path) {
            target_scan_path = path_1.default.join(process.env.USERPROFILE || '', '.cache', 'lm-studio', 'models');
        }
        const discovered_models_list = (0, llamaServerClient_1.scanLocalGgufModels)(target_scan_path);
        return {
            success: true,
            models: discovered_models_list,
            scanPath: target_scan_path
        };
    }
    catch (scan_error) {
        console.error('[LLM] Failed to scan models:', scan_error);
        return {
            success: false,
            error: scan_error instanceof Error ? scan_error.message : String(scan_error),
            models: []
        };
    }
});
// WHAT: IPC handler to terminate running llama-server and launch a new model instance.
// WHY: Gives user 1-click model switching from Settings without leaving Resolver.
electron_1.ipcMain.handle('llm-switch-model', async (_event, payload) => {
    try {
        const { modelPath, mmprojPath, port = 8080, contextSize = 8192, gpuLayers = 99 } = payload;
        if (!modelPath || !fs_1.default.existsSync(modelPath)) {
            return { success: false, error: `Model file not found at path: ${modelPath}` };
        }
        const llama_binary_path = (0, llamaServerClient_1.findLlamaServerBinaryPath)() || 'llama-server.exe';
        // 1. Terminate any currently running llama-server process
        try {
            (0, child_process_1.execSync)('taskkill /IM llama-server.exe /F', { stdio: 'ignore' });
            console.log('[LLM] Terminated existing llama-server.exe processes.');
        }
        catch {
            // Process was not running, safe to continue
        }
        // Brief delay to release socket
        await new Promise(resolve => setTimeout(resolve, 500));
        // 2. Assemble launch arguments
        const launch_arguments = [
            '-m', modelPath,
            '--host', '127.0.0.1',
            '--port', String(port),
            '-c', String(contextSize),
            '-ngl', String(gpuLayers),
            '--flash-attn', 'on',
            '--alias', 'default'
        ];
        if (mmprojPath && fs_1.default.existsSync(mmprojPath)) {
            launch_arguments.push('--mmproj', mmprojPath);
        }
        console.log(`[LLM] Spawning: ${llama_binary_path} with args:`, launch_arguments);
        const spawned_server_process = (0, child_process_1.spawn)(llama_binary_path, launch_arguments, {
            detached: true,
            stdio: 'ignore',
            windowsHide: false
        });
        spawned_server_process.unref();
        // 3. Persist chosen model path, context size, and GPU layers in config
        let loaded_config = {};
        if (fs_1.default.existsSync(CONFIG_PATH)) {
            try {
                loaded_config = JSON.parse(fs_1.default.readFileSync(CONFIG_PATH, 'utf8'));
            }
            catch { /* ignore */ }
        }
        loaded_config.selectedLlamaModelPath = modelPath;
        if (mmprojPath)
            loaded_config.selectedLlamaMmprojPath = mmprojPath;
        loaded_config.llamaContextSize = contextSize;
        loaded_config.llamaGpuLayers = gpuLayers;
        fs_1.default.writeFileSync(CONFIG_PATH, JSON.stringify(loaded_config, null, 2));
        // 4. Poll /v1/models until responsive (up to 15 seconds)
        const llama_client = new llamaServerClient_1.LlamaServerClient(`http://127.0.0.1:${port}`);
        let is_server_ready = false;
        for (let poll_attempt = 0; poll_attempt < 30; poll_attempt++) {
            await new Promise(resolve => setTimeout(resolve, 500));
            is_server_ready = await llama_client.discoverActiveLlamaServerModel();
            if (is_server_ready)
                break;
        }
        if (!is_server_ready) {
            return {
                success: false,
                error: `llama-server process spawned, but endpoint http://127.0.0.1:${port}/v1/models did not become responsive within 15 seconds.`
            };
        }
        const diagnostic_report = await llama_client.testLlamaServerConnection();
        return {
            success: true,
            diagnostic: diagnostic_report
        };
    }
    catch (switch_error) {
        console.error('[LLM] Failed to switch model:', switch_error);
        return {
            success: false,
            error: switch_error instanceof Error ? switch_error.message : String(switch_error)
        };
    }
});
// WHAT: IPC handler to terminate running llama-server.exe.
// WHY: Allows stopping local AI inference to free GPU memory when needed.
electron_1.ipcMain.handle('llm-stop-server', async () => {
    try {
        (0, child_process_1.execSync)('taskkill /IM llama-server.exe /F', { stdio: 'ignore' });
        return { success: true, message: 'llama-server stopped successfully.' };
    }
    catch {
        return { success: true, message: 'No llama-server process was running.' };
    }
});
// WHAT: Standardized prompt expansion benchmark on the active llama-server model.
// WHY: Allows the user to directly compare speed, token rate, and quality between models (e.g. Qwen 3.5 9B vs Qwen 3.8 27B).
electron_1.ipcMain.handle('llm-benchmark', async () => {
    try {
        let loaded_config = {};
        if (fs_1.default.existsSync(CONFIG_PATH)) {
            try {
                loaded_config = JSON.parse(fs_1.default.readFileSync(CONFIG_PATH, 'utf8'));
            }
            catch { /* ignore */ }
        }
        const port = Number(loaded_config.llamaServerPort) || 8080;
        const llama_client = new llamaServerClient_1.LlamaServerClient(`http://127.0.0.1:${port}`);
        let is_ready = await llama_client.discoverActiveLlamaServerModel();
        if (!is_ready) {
            const auto_start = await ensureLlamaServerRunning(port);
            if (!auto_start.success) {
                return { success: false, error: auto_start.error || 'llama-server is offline and could not be auto-started.' };
            }
            await llama_client.discoverActiveLlamaServerModel();
        }
        const active_model = llama_client.getActiveModelIdentifier() || 'Unknown';
        const test_prompt = "A cinematic medium shot of an astronaut gazing at an alien neon megalopolis from a rain-slicked balcony, moody anamorphic lighting, cyberpunk style, hyper-detailed 4k.";
        const system_prompt = "You are an elite cinematic prompt engineer for high-end AI video models. Expand the user's scene into a vivid, visually dense video prompt.";
        const start_time = Date.now();
        const chat_url = llama_client.getChatCompletionsUrl();
        if (!chat_url)
            return { success: false, error: 'Chat completions endpoint not available.' };
        const completion_response = await fetch(chat_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: active_model,
                messages: [
                    { role: 'system', content: system_prompt },
                    { role: 'user', content: test_prompt }
                ],
                max_tokens: 180,
                temperature: 0.7
            })
        });
        const elapsed_ms = Date.now() - start_time;
        if (!completion_response.ok) {
            return { success: false, error: `Benchmark HTTP error: ${completion_response.status} ${await completion_response.text()}` };
        }
        const completion_data = (await completion_response.json());
        const generated_text = completion_data.choices?.[0]?.message?.content || '';
        const tokens_generated = completion_data.usage?.completion_tokens || generated_text.split(/\s+/).length;
        const tokens_per_second = elapsed_ms > 0 ? ((tokens_generated / (elapsed_ms / 1000))).toFixed(1) : 'N/A';
        return {
            success: true,
            model_name: active_model,
            duration_ms: elapsed_ms,
            duration_seconds: (elapsed_ms / 1000).toFixed(2),
            tokens_generated,
            tokens_per_second,
            context_size: loaded_config.llamaContextSize || 8192,
            gpu_layers: loaded_config.llamaGpuLayers !== undefined ? loaded_config.llamaGpuLayers : 99,
            generated_text
        };
    }
    catch (bench_error) {
        console.error('[LLM] Benchmark failed:', bench_error);
        return { success: false, error: bench_error instanceof Error ? bench_error.message : String(bench_error) };
    }
});
