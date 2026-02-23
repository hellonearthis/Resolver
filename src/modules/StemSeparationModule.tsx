import React, { useState, useEffect } from 'react';
import DropZone from '../components/DropZone';
// import BeatVisualizer from '../components/BeatVisualizer'; // Unused
import { checkComfyConnection, queuePrompt, type ComfyWorkflow } from '../services/comfyService';
import type { BeatProject, ProjectMarker } from '../hooks/useProjectStorage';
import MultiTrackWaveform from '../components/MultiTrackWaveform';
import { analyzeBeats, analyzeOnsets, analyzeLoudness, type BeatAlgorithm, initEssentia } from '../services/essentiaService';
import { getStemTheme } from '../utils/timelineUtils';
import './StemSeparationModule.css';

// You might want to move this to a settings file/context
const DEFAULT_COMFY_OUTPUT_PATH = 'C:\\ComfyUI_windows_portable\\ComfyUI\\output';

interface StemSeparationModuleProps {
    activeProject?: BeatProject;
    onCreateProject: (file: File) => BeatProject;
    onUpdateProject: (id: string, updates: Partial<BeatProject>) => void;
    mockProcessDuration?: number;
    onExportAll?: () => Promise<{ success: number; failed: number }>;
}

const StemSeparationModule: React.FC<StemSeparationModuleProps> = ({
    activeProject,
    onCreateProject,
    onUpdateProject
}) => {
    const [comfyConnected, setComfyConnected] = useState<boolean>(false);
    const [workflow, setWorkflow] = useState<ComfyWorkflow | null>(null);
    const [audioPath, setAudioPath] = useState<string | null>(null);
    const [outputDir, setOutputDir] = useState<string | null>(null);
    const [comfyOutputDir, setComfyOutputDir] = useState<string>(DEFAULT_COMFY_OUTPUT_PATH);
    const [defaultOutputDir, setDefaultOutputDir] = useState<string | null>(null); // Store global default
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [statusMessage, setStatusMessage] = useState<string>('');
    const [generatedStems, setGeneratedStems] = useState<{ type: string; path: string }[]>([]);

    // Embedded Analysis removed

    // Beat Detection Options (Lifted State)
    const [algorithm, setAlgorithm] = useState<BeatAlgorithm>('multifeature');
    const [enableOnsets, setEnableOnsets] = useState<boolean>(true); // Default True as per request
    const [enableLoudness, setEnableLoudness] = useState<boolean>(false);
    const [detectionStatus, setDetectionStatus] = useState<string>('');

    // Store markers for visualization: stemType -> number[] (timestamps)
    const [stemMarkers, setStemMarkers] = useState<Record<string, number[]>>({});

    const getStemColorClass = (type: string) => {
        // Simple mapping to Tailwind classes or raw styles could be done here.
        // For now, we'll use inline styles or existing class logic.
        // Actually, let's use the mapping to set a style.
        return getStemTheme(type);
    };


    useEffect(() => {
        checkConnection();
        loadWorkflow();
        loadConfig(); // Moved loadConfig to initial mount
        initEssentia(); // Warm up WASM in background
    }, []);

    // Load markers and outputDir from active project into visualization state
    useEffect(() => {
        if (activeProject) {
            // Sync Output Dir
            if (activeProject.outputDir) {
                setOutputDir(activeProject.outputDir);
            }

            if (activeProject.markers) {
                const loadedMarkers: Record<string, number[]> = {};

                activeProject.markers.forEach(m => {
                    // We use the 'note' field to store the stem type (e.g. 'vocals', 'drums')
                    // Only care about beats for the waveform visualization usually
                    if (m.type === 'beat' && m.note) {
                        if (!loadedMarkers[m.note]) {
                            loadedMarkers[m.note] = [];
                        }
                        loadedMarkers[m.note].push(m.timestamp);
                    }
                });
                console.log('[StemSeparation] Loaded markers from project:', Object.keys(loadedMarkers));
                setStemMarkers(loadedMarkers);
            }
        }
    }, [activeProject]);

    // Load saved config
    const loadConfig = async () => {
        try {
            // @ts-ignore
            const ipcRenderer = window.require ? window.require('electron').ipcRenderer : window.ipcRenderer;
            if (!ipcRenderer) return;

            const res = await ipcRenderer.invoke('get-config');
            if (res.success) {
                if (res.config.comfyOutputDir) setComfyOutputDir(res.config.comfyOutputDir);
                if (res.config.projectOutputDir) {
                    setDefaultOutputDir(res.config.projectOutputDir);
                    // Set initial outputDir if not already set
                    setOutputDir((prev) => prev || res.config.projectOutputDir);
                }
            }
        } catch (e) {
            console.error("Failed to load config", e);
        }
    };

    useEffect(() => {
        if (activeProject) {
            setAudioPath(activeProject.audioPath);
            if (activeProject.stems && activeProject.stems.length > 0) {
                setGeneratedStems(activeProject.stems);
                // If stems exist, try to set outputDir to their directory
                try {
                    // @ts-ignore
                    const pathModule = window.require ? window.require('path') : null;
                    if (pathModule) {
                        const stemDir = pathModule.dirname(activeProject.stems[0].path);
                        setOutputDir(stemDir);
                    }
                } catch (e) { }
            } else {
                // No stems yet? Use default or fallback
                if (defaultOutputDir) {
                    setOutputDir(defaultOutputDir);
                } else {
                    try {
                        // @ts-ignore
                        const pathModule = window.require ? window.require('path') : null;
                        if (pathModule && activeProject.audioPath) {
                            const audioDir = pathModule.dirname(activeProject.audioPath);
                            setOutputDir(audioDir);
                        }
                    } catch (e) { }
                }
            }
        }
    }, [activeProject, defaultOutputDir]);

    const checkConnection = async () => {
        const connected = await checkComfyConnection();
        setComfyConnected(connected);
    };

    const loadWorkflow = async () => {
        try {
            // @ts-ignore
            const ipcRenderer = window.require ? window.require('electron').ipcRenderer : window.ipcRenderer;
            if (!ipcRenderer) return;

            const result = await ipcRenderer.invoke('load-default-workflow');
            if (result.success) {
                setWorkflow(result.workflow);
            }
        } catch (err) {
            console.error(err);
            setStatusMessage('Error loading workflow (IPC failed)');
        }
    };

    const handleAudioDrop = (files: File[]) => {
        if (files.length > 0) {
            const file = files[0];
            const pathStr = (file as any).path;

            if (!pathStr) {
                setStatusMessage("Error: Could not read file path.");
                return;
            }

            setAudioPath(pathStr);
            setGeneratedStems([]);

            // Use default output dir if set, otherwise relative Stems folder
            if (defaultOutputDir) {
                setOutputDir(defaultOutputDir);
            } else {
                try {
                    // @ts-ignore
                    const pathModule = window.require ? window.require('path') : null;
                    if (pathModule) {
                        const audioDir = pathModule.dirname(pathStr);
                        setOutputDir(audioDir);
                    }
                } catch (e) {
                    console.error("Failed to auto-set output dir", e);
                }
            }

            if (!activeProject || activeProject.audioPath !== pathStr) {
                onCreateProject(file);
                setStatusMessage(`Project created for ${file.name}`);
            }
        }
    };



    // --- Core Logic: Run & Poll ---

    const handleSelectOutput = async () => {
        try {
            // @ts-ignore
            const ipcRenderer = window.require ? window.require('electron').ipcRenderer : window.ipcRenderer;
            if (!ipcRenderer) return;
            const path = await ipcRenderer.invoke('select-folder');
            if (path) {
                setOutputDir(path);
                // Save new preference
                ipcRenderer.invoke('save-config', { projectOutputDir: path });
            }
        } catch (err) {
            console.error('Failed to select folder:', err);
        }
    };

    const handleRunSeparation = async () => {
        if (!comfyConnected || !workflow || !audioPath || !outputDir) {
            setStatusMessage('Missing setup (Audio, Workflow, or Output Folder)');
            return;
        }

        // Save config when running (just in case)
        try {
            // @ts-ignore
            const ipcRenderer = window.require ? window.require('electron').ipcRenderer : window.ipcRenderer;
            if (ipcRenderer) {
                ipcRenderer.invoke('save-config', { comfyOutputDir, projectOutputDir: outputDir });
            }
        } catch (e) { /* ignore */ }

        // -------------------------------------------------------------------
        // STEP 0: Preparation
        // -------------------------------------------------------------------
        setIsProcessing(true);
        setStatusMessage('Preparing workflow...');
        setGeneratedStems([]);
        const startTime = Date.now(); // Capture start time to find new files

        try {
            const prompt = JSON.parse(JSON.stringify(workflow));

            // -------------------------------------------------------------------
            // STEP 1: Inject Audio Path
            // -------------------------------------------------------------------
            let loadNodeKey: string | null = null;
            for (const [key, node] of Object.entries(prompt)) {
                // @ts-ignore
                if (node.class_type === 'LoadAudio' || node.class_type === 'LoadAudioPath') {
                    loadNodeKey = key;
                    break;
                }
            }

            if (!loadNodeKey) throw new Error('Could not find LoadAudio node');
            // @ts-ignore
            prompt[loadNodeKey].inputs.audio = audioPath;

            // -------------------------------------------------------------------
            // STEP 2: Set Filename Prefix (Unique ID for this run)
            // -------------------------------------------------------------------
            // Note: If user uses custom save node that ignores this, our file finder handles it.
            const runId = Date.now().toString();
            const prefix = `stem_${runId}`;

            for (const node of Object.values(prompt)) {
                // @ts-ignore
                if (node.class_type.includes('Save') && node.inputs) {
                    // Prepend our unique prefix to the EXISTING prefix (if any)
                    // This preserves 'Vocals', 'Drums' etc. if they are in the workflow
                    // @ts-ignore
                    const currentPrefix = node.inputs.filename_prefix || '';
                    // @ts-ignore
                    node.inputs.filename_prefix = `${prefix}_${currentPrefix}`;
                }
            }

            // -------------------------------------------------------------------
            // STEP 3: Queue Prompt & Poll for Completion
            // -------------------------------------------------------------------
            const result = await queuePrompt(prompt);

            if (!result || !result.prompt_id) {
                throw new Error('Failed to queue prompt');
            }

            setStatusMessage(`Processing... (ID: ${result.prompt_id})`);

            // We still wait for completion, even if we don't use the API output paths directly
            await waitForGeneration(result.prompt_id);

            setStatusMessage('Moving files...');

            // -------------------------------------------------------------------
            // STEP 4: Move Files & Update Project
            // -------------------------------------------------------------------
            // New Logic: Find latest by type created after start time
            const movedFiles = await moveFilesToProject(outputDir, startTime, prefix);

            setGeneratedStems(movedFiles);

            if (activeProject) {
                onUpdateProject(activeProject.id, {
                    stems: movedFiles,
                    outputDir: outputDir || undefined
                });
            }

            setStatusMessage(movedFiles.length > 0 ? 'Separation Complete!' : 'Warning: No output files found.');

        } catch (err) {
            console.error(err);
            // @ts-ignore
            setStatusMessage(`Error: ${err.message}`);
        } finally {
            setIsProcessing(false);
        }
    };

    // Poll ComfyUI History API
    const waitForGeneration = async (promptId: string): Promise<any> => {
        return new Promise((resolve, reject) => {
            const interval = setInterval(async () => {
                try {
                    // Use IPC to bypass CORS
                    // @ts-ignore
                    const { ipcRenderer } = window.require('electron');

                    // 1. Check Queue Status (Pending/Running)
                    const queueRes = await ipcRenderer.invoke('comfy-fetch', 'http://127.0.0.1:8188/queue');
                    if (queueRes.success) {
                        const queue = queueRes.data;
                        const isPending = queue.queue_pending && queue.queue_pending.some((i: any) => i[1] === promptId);
                        const isRunning = queue.queue_running && queue.queue_running.some((i: any) => i[1] === promptId);

                        if (isPending) {
                            setStatusMessage(`Queued... (Position: ${queue.queue_pending.findIndex((i: any) => i[1] === promptId) + 1})`);
                            return; // Still waiting
                        }
                        if (isRunning) {
                            setStatusMessage('Processing... (Running in ComfyUI)');
                            // Don't return, also check history in case it just finished
                        }
                    }

                    // 2. Check History (Finished)
                    const res = await ipcRenderer.invoke('comfy-fetch', 'http://127.0.0.1:8188/history');

                    if (!res.success) {
                        console.warn("ComfyUI history fetch failed:", res.error);
                        return; // Keep retrying
                    }

                    const history = res.data;

                    if (history[promptId]) {
                        clearInterval(interval);
                        // Check if successful
                        if (history[promptId].status && history[promptId].status.status_str === 'error') {
                            const errorDetails = history[promptId].status.messages;
                            let errorMsg = "ComfyUI reported an error";
                            if (errorDetails) {
                                // Try to extract specific error info
                                // Expected format: [ "execution_error", { "node_id": "...", "exception_message": "...", "node_type": "..." } ]
                                const errorData = errorDetails[1];
                                if (errorData && errorData.exception_message) {
                                    errorMsg = `ComfyUI Error (${errorData.node_type}): ${errorData.exception_message}`;
                                } else {
                                    errorMsg = `ComfyUI Error: ${JSON.stringify(errorDetails)}`;
                                }
                            }
                            reject(new Error(errorMsg));
                        } else {
                            resolve(history[promptId].outputs);
                        }
                    }
                } catch (e) {
                    console.error("Polling error", e);
                }
            }, 1000);
        });
    };

    // Move files from Comfy Output -> Project Output
    // New Logic: Find files matching Vocals_*.mp3 etc created AFTER startTime
    const moveFilesToProject = async (targetDir: string, _startTime: number, runPrefix: string) => {
        // @ts-ignore
        const fs = window.require('fs');
        // @ts-ignore
        const path = window.require('path');

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const stems: { type: string; path: string }[] = [];
        const stemTypes = ['Vocals', 'Bass', 'Drums', 'Other'];

        // If audioPath is set, use its basename for cleaner output names
        const baseName = audioPath ? path.parse(audioPath).name : 'stem';

        try {
            const files = fs.readdirSync(comfyOutputDir);

            for (const type of stemTypes) {
                // Regex to match:
                // 1. `stem_{id}_{type}_0001.mp3` (if we prepended)
                // 2. `stem_{id}_0001.mp3` (if type wasn't in original prefix, tricky)

                // We prepended `stem_{id}_` to the original prefix.
                // Assuming original prefix was just "{type}" -> `stem_{id}_{type}`
                // ComfyUI appends `_00001_.mp3`

                // Regex: Look for files starting with our runPrefix, containing the Type
                const regex = new RegExp(`^${runPrefix}_.*${type}.*\\.(mp3|flac|wav)$`, 'i');

                const matches = files.filter((f: string) => regex.test(f))
                    .map((f: string) => {
                        const fullPath = path.join(comfyOutputDir, f);
                        const stats = fs.statSync(fullPath);
                        return { file: f, path: fullPath, time: stats.mtimeMs };
                    })
                    // Filter by modification time > start time of this job
                    // Buffer by -2000ms just in case file system time drift or fast write
                    // .filter((f: any) => f.time > (startTime - 5000)) // Increased buffer slightly
                    .sort((a: any, b: any) => b.time - a.time); // Latest first

                if (matches.length > 0) {
                    const latest = matches[0];
                    const ext = path.extname(latest.file);
                    const destFilename = `${baseName}_${type}${ext}`;
                    const destPath = path.join(targetDir, destFilename);

                    // Copy
                    fs.copyFileSync(latest.path, destPath);
                    console.log(`Found & Moved: ${latest.path} -> ${destPath}`);
                    stems.push({ type, path: destPath });
                } else {
                    console.warn(`No new ${type} file found in ${comfyOutputDir} matching ${runPrefix}`);
                }
            }
        } catch (e) {
            console.error("Error moving files:", e);
        }

        return stems;
    };

    const runBeatAnalysis = async (audioPath: string, stemType: string) => {
        setIsProcessing(true);
        setStatusMessage(`Analyzing beats for ${stemType} (${algorithm})…`);
        setDetectionStatus(`Analyzing ${stemType}...`);

        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        try {
            // Read file
            // @ts-ignore
            const fs = window.require('fs');
            const buffer = fs.readFileSync(audioPath);
            const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            setDetectionStatus('Analyzing beats...');
            const beatResult = await analyzeBeats(audioBuffer, algorithm);
            console.log('[Essentia] BPM:', beatResult.bpm, 'beats:', beatResult.beats.length);

            const allMarkers: ProjectMarker[] = [];
            const stemMapping = getStemTheme(stemType);
            const frameRate = activeProject?.frameRate || 24;

            beatResult.beats.forEach((time: number) => {
                allMarkers.push({
                    timestamp: time,
                    frame: Math.round(time * frameRate),
                    color: stemMapping.base,
                    note: stemType,
                    type: 'beat',
                    duration_sec: 1 / frameRate
                });
            });

            if (enableOnsets) {
                setDetectionStatus('Analyzing onsets...');
                const onsetResult = await analyzeOnsets(audioBuffer);
                onsetResult.onsets.forEach((time: number) => {
                    allMarkers.push({
                        timestamp: time,
                        frame: Math.round(time * frameRate),
                        color: stemMapping.light,
                        note: 'Onset',
                        type: 'onset',
                        duration_sec: 0.05
                    });
                });
            }

            if (enableLoudness) {
                setDetectionStatus('Analyzing loudness...');
                const loudResult = await analyzeLoudness(audioBuffer);
                loudResult.regions.forEach((region: any) => {
                    allMarkers.push({
                        timestamp: region.start,
                        frame: Math.round(region.start * frameRate),
                        color: stemMapping.light,
                        note: 'Loud',
                        type: 'loudness',
                        duration_sec: region.end - region.start
                    });
                });
            }

            // Update local state
            const beatsOnly = allMarkers.filter((m: ProjectMarker) => m.type === 'beat').map((m: ProjectMarker) => m.timestamp);
            setStemMarkers((prev: Record<string, number[]>) => ({
                ...prev,
                [stemType]: beatsOnly
            }));

            // Save to project
            if (activeProject && onUpdateProject) {
                const otherMarkers = (activeProject.markers || []).filter((m: ProjectMarker) => m.note !== stemType);
                onUpdateProject(activeProject.id, {
                    markers: [...otherMarkers, ...allMarkers],
                    outputDir: outputDir || undefined
                });
            }

            setDetectionStatus(`Complete: ${beatsOnly.length} beats @${Math.round(beatResult.bpm)} BPM`);

        } catch (err) {
            console.error('Analysis failed:', err);
            setDetectionStatus(`Analysis failed for ${stemType}.`);
        } finally {
            setIsProcessing(false);
            audioContext.close().catch(() => { });

            // Clear status message after a few seconds
            setTimeout(() => {
                setDetectionStatus('');
                setStatusMessage('');
            }, 4000);
        }
    };

    // Internal handler directly triggers analysis
    const handleAnalyzeLocal = async (path: string, type: string) => {
        await runBeatAnalysis(path, type);
    };


    return (
        <div className="module-container">
            <div className="module-header">
                <h2 className="module-title">🎵 Stem Separation</h2>
                <p className="module-description">
                    Isolate vocals, drums, bass, and other instruments using ComfyUI workflows.
                </p>
            </div>

            <div className="grid-2">
                {/* Card 1: Configuration */}
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Configuration</h3>
                        <div className="flex gap-2">
                            <span className={`status-badge ${comfyConnected ? 'success' : 'error'}`}>
                                {comfyConnected ? 'Connected' : 'Disconnected'}
                            </span>
                            <span className={`status-badge ${workflow ? 'success' : 'warning'}`}>
                                {workflow ? 'Workflow Loaded' : 'No Workflow'}
                            </span>
                        </div>
                    </div>

                    <div className="flex flex-col gap-4">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">ComfyUI Source Folder</label>
                            <input
                                type="text"
                                value={comfyOutputDir}
                                onChange={(e) => setComfyOutputDir(e.target.value)}
                                className="w-full bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded p-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)] placeholder-gray-600"
                                placeholder="C:\ComfyUI\output"
                            />
                        </div>

                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Project Output Folder</label>
                            <button
                                onClick={handleSelectOutput}
                                className="btn btn-secondary w-full justify-between"
                            >
                                <span className="truncate">{outputDir || 'Select destination...'}</span>
                                <span>📂</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Card 2: Audio Input & Action */}
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Audio Source</h3>
                    </div>

                    <DropZone
                        onFilesDropped={handleAudioDrop}
                        accept="audio/*"
                        label="Drop Audio File Here"
                        defaultAudioPath={audioPath || undefined}
                    />

                    {audioPath && (
                        <div className="mt-4 p-3 bg-[var(--bg-tertiary)] rounded border border-[var(--border-color)]">
                            <div className="text-xs text-[var(--text-secondary)] uppercase font-bold mb-1">Selected File</div>
                            <div className="text-sm truncate" title={audioPath}>{audioPath}</div>
                        </div>
                    )}

                    <div className="mt-6">
                        <button
                            onClick={handleRunSeparation}
                            disabled={isProcessing || !comfyConnected || !audioPath}
                            className={`btn w-full ${isProcessing || !comfyConnected || !audioPath ? 'btn-secondary opacity-50 cursor-not-allowed' : 'btn-primary'}`}
                        >
                            {isProcessing ? (
                                <><span>⏳</span> Processing Music File...</>
                            ) : (
                                <><span>🚀</span> Start Separation</>
                            )}
                        </button>
                        {statusMessage && (
                            <div className="mt-3 text-center text-xs font-mono text-[var(--accent-primary)]">
                                {statusMessage}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Multi-Track Player */}
            {generatedStems.length > 0 && (
                <div className="card mt-6">
                    <div className="card-header">
                        <h3 className="card-title">Generated Stems</h3>
                    </div>
                    <MultiTrackWaveform
                        stems={generatedStems}
                        markers={stemMarkers}
                    />
                </div>
            )}

            {generatedStems.length > 0 && (
                <div className="card mt-6">
                    <div className="card-header">
                        <h3 className="card-title">Analysis & Actions</h3>
                    </div>

                    <div className="flex flex-col gap-6">
                        {/* Global Options - Full Width Top */}
                        <div className="bg-[var(--bg-tertiary)] p-4 rounded-lg border border-[var(--border-color)]">
                            <h4 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
                                Detection Settings
                            </h4>

                            <div className="flex flex-col gap-4">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-300">Algorithm</span>
                                    <div className="flex bg-[var(--bg-secondary)] rounded p-1">
                                        <button
                                            onClick={() => setAlgorithm('multifeature')}
                                            className={`px-3 py-1 text-xs rounded transition-colors ${algorithm === 'multifeature' ? 'bg-[var(--accent-primary)] text-white' : 'text-gray-400 hover:text-white'}`}
                                        >
                                            MultiFeature
                                        </button>
                                        <button
                                            onClick={() => setAlgorithm('degara')}
                                            className={`px-3 py-1 text-xs rounded transition-colors ${algorithm === 'degara' ? 'bg-[var(--accent-primary)] text-white' : 'text-gray-400 hover:text-white'}`}
                                        >
                                            Degara
                                        </button>
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-4">
                                    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300 hover:text-white select-none">
                                        <input
                                            type="checkbox"
                                            checked={enableOnsets}
                                            onChange={e => setEnableOnsets(e.target.checked)}
                                            className="rounded bg-gray-700 border-gray-600 text-indigo-500 focus:ring-indigo-500"
                                        />
                                        <span>Onsets</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300 hover:text-white select-none">
                                        <input
                                            type="checkbox"
                                            checked={enableLoudness}
                                            onChange={e => setEnableLoudness(e.target.checked)}
                                            className="rounded bg-gray-700 border-gray-600 text-indigo-500 focus:ring-indigo-500"
                                        />
                                        <span>Loudness</span>
                                    </label>
                                </div>
                            </div>

                            {detectionStatus && (
                                <div className="mt-2 text-xs text-[var(--accent-primary)] animate-pulse flex items-center gap-2 bg-[var(--bg-secondary)] p-2 rounded border border-[var(--accent-primary)]/30">
                                    <span>⏳</span> {detectionStatus}
                                </div>
                            )}
                        </div>

                        {/* Stem Selection - Below */}
                        <div>
                            <h4 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
                                Select Stem to Analyze
                            </h4>
                            <div className="flex flex-wrap gap-3">
                                {generatedStems.map((stem, idx) => {
                                    const colors = getStemColorClass(stem.type);
                                    return (
                                        <button
                                            key={idx}
                                            onClick={() => handleAnalyzeLocal(stem.path, stem.type)}
                                            className="btn flex-1 min-w-[140px] flex-col py-3 border-2 transition-all hover:scale-105"
                                            style={{
                                                borderColor: colors.base,
                                                backgroundColor: `var(--bg-tertiary)`,
                                                color: 'var(--text-primary)'
                                            }}
                                        >
                                            <span className="font-bold">{stem.type}</span>
                                            <span className="text-xs opacity-70" style={{ color: colors.light }}>
                                                Analyze Beats
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}



        </div >
    );
};

export default StemSeparationModule;
