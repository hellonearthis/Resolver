import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { analyzeBeats, analyzeOnsets, analyzeLoudness, type BeatAlgorithm, initEssentia } from '../services/essentiaService';

import DropZone from '../components/DropZone';
import ProjectsPanel from '../components/ProjectsPanel';
import { checkComfyConnection, queuePrompt, uploadFileToComfyUI } from '../services/comfyService';
import workflowJsonTemplate from '../../comfyui_workflows/video_ltx2_i2v.json';
import { getValidLtxFrameCount } from '../utils/timelineUtils';
import type { BeatProject, ProjectMarker } from '../hooks/useProjectStorage';
import ProjectTimelineTable from '../components/ProjectTimelineTable';
import CollapsibleCard from '../components/CollapsibleCard';
import LtxTestModule from './LtxTestModule';
import './MusicVideoAssemblerModule.css';

/**
 * Props required to initialize the MusicVideoAssemblerModule.
 * Receives global project data and callbacks to interact with the broader application state.
 */
interface MusicVideoAssemblerModuleProps {
    projects: BeatProject[];
    activeProject?: BeatProject;
    onSelectProject: (id: string) => void;
    onCreateProject: (file: File, preferredOutputDir?: string) => BeatProject;
    onUpdateProject: (id: string, updates: Partial<BeatProject>) => void;
    onDeleteProject: (id: string) => void;
    onStatusChange?: (msg: string) => void;
}

import type { VideoClip, SelectionState, AudioMarker, StemData } from '../types/assembler';
import {
    MARKER_COLORS,
    STEM_COLORS,
    DEFAULT_STEM_COLOR,
    hexToRgba,
    adjustColorBrightness,
    formatTime,
    getStemTheme
} from '../utils/timelineUtils';

/**
 * The core module for assembling music videos.
 * Handles the display of the master track waveform and all associated instrument stems.
 * Features a multi-track playback audit mode, beat snapping for precise trim selections,
 * and integration with ComfyUI to queue image-to-video generation tasks.
 */
const MusicVideoAssemblerModule: React.FC<MusicVideoAssemblerModuleProps> = ({
    projects,
    activeProject,
    onSelectProject,
    onCreateProject,
    onDeleteProject,
    onUpdateProject,
    onStatusChange
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurfer = useRef<WaveSurfer | null>(null);
    const wsRegions = useRef<any>(null);
    const [audioFile, setAudioFile] = useState<{ name: string; path: string } | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [mainMarkers, setMainMarkers] = useState<AudioMarker[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [clips, setClips] = useState<VideoClip[]>([]);
    const [workflow, setWorkflow] = useState<any | null>(null);
    const [stems, setStems] = useState<StemData[]>([]);
    const stemSurfers = useRef<WaveSurfer[]>([]);
    const stemRegionsRefs = useRef<Map<number, any>>(new Map());
    const [duration, setDuration] = useState(0);
    const [activeSelection, setActiveSelection] = useState<SelectionState | null>(null);

    // Stem Separation State
    const [comfyConnected, setComfyConnected] = useState<boolean>(false);
    const [comfyOutputDir, setComfyOutputDir] = useState<string>('C:\\ComfyUI_windows_portable\\ComfyUI\\output');
    const [outputDir, setOutputDir] = useState<string | null>(null);
    const [defaultOutputDir, setDefaultOutputDir] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState<boolean>(false);

    // Essentia Detection State
    const [algorithm, setAlgorithm] = useState<BeatAlgorithm>('multifeature');
    const [enableOnsets, setEnableOnsets] = useState<boolean>(true);
    const [enableLoudness, setEnableLoudness] = useState<boolean>(false);
    const [detectionStatus, setDetectionStatus] = useState<string>('');

    // Tooltip State
    const [tooltipState, setTooltipState] = useState<{
        visible: boolean;
        x: number;
        y: number;
        content: React.ReactNode;
    }>({ visible: false, x: 0, y: 0, content: null });

    // Zoom & Beat Source Controls
    const [zoomLevel, setZoomLevel] = useState(50); // minPxPerSec
    const [minZoom, setMinZoom] = useState(1);
    const [mainBeatSource, setMainBeatSource] = useState<'main' | number>('main'); // 'main' or index of stem

    useEffect(() => {
        checkConnection();
        loadWorkflow();
        loadConfig();
        initEssentia();
    }, []);

    const checkConnection = async () => {
        const connected = await checkComfyConnection();
        setComfyConnected(connected);
    };

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
                    setOutputDir((prev) => prev || res.config.projectOutputDir);
                }
            }
        } catch (e) {
            console.error("Failed to load config", e);
        }
    };

    const loadWorkflow = async () => {
        try {
            // @ts-ignore
            const ipcRenderer = window.require ? window.require('electron').ipcRenderer : window.ipcRenderer;
            const result = await ipcRenderer.invoke('load-default-workflow');
            if (result.success) {
                setWorkflow(result.workflow);
            }
        } catch (e) {
            console.error("Failed to load stem separation workflow", e);
        }
    };

    // Load Project Audio when activeProject changes
    useEffect(() => {
        if (activeProject && activeProject.audioPath) {
            loadProjectAudio(activeProject);
            // Auto defaults for older projects without frameRate
            if (!activeProject.frameRate) {
                onUpdateProject(activeProject.id, { frameRate: 20 });
            }
        }
    }, [activeProject]);

    const analyzeAudio = async (blob: Blob) => {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const result = await analyzeBeats(audioBuffer);
        return result.beats;
    };

    const handleAudioDrop = (files: File[]) => {
        if (files.length > 0) {
            const file = files[0];
            const pathStr = (file as any).path;

            if (!pathStr) {
                if (onStatusChange) onStatusChange("Error: Could not read file path.");
                return;
            }

            // Use default output dir if set, otherwise relative Stems folder
            let finalOutputDir = defaultOutputDir;
            if (defaultOutputDir) {
                setOutputDir(defaultOutputDir);
            } else {
                try {
                    // @ts-ignore
                    const pathModule = window.require ? window.require('path') : null;
                    if (pathModule) {
                        const audioDir = pathModule.dirname(pathStr);
                        setOutputDir(audioDir);
                        finalOutputDir = audioDir;
                    }
                } catch (e) {
                    console.error("Failed to auto-set output dir", e);
                }
            }

            if (!activeProject || activeProject.audioPath !== pathStr) {
                onCreateProject(file, finalOutputDir || undefined);
                if (onStatusChange) onStatusChange(`Project created for ${file.name}`);
            }
        }
    };

    // --- Core Logic: Run & Poll ---
    const handleRunSeparation = async () => {
        if (!comfyConnected || !workflow || !audioFile?.path || !outputDir) {
            if (onStatusChange) onStatusChange('Missing setup (Audio, Workflow, or Output Folder)');
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

        setIsProcessing(true);
        if (onStatusChange) onStatusChange('Preparing workflow...');
        const startTime = Date.now(); // Capture start time to find new files

        try {
            const prompt = JSON.parse(JSON.stringify(workflow));

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
            prompt[loadNodeKey].inputs.audio = audioFile.path;

            const runId = Date.now().toString();
            const prefix = `stem_${runId}`;

            for (const node of Object.values(prompt)) {
                // @ts-ignore
                if (node.class_type.includes('Save') && node.inputs) {
                    // @ts-ignore
                    const currentPrefix = node.inputs.filename_prefix || '';
                    // @ts-ignore
                    node.inputs.filename_prefix = `${prefix}_${currentPrefix}`;
                }
            }

            const result = await queuePrompt(prompt);

            if (!result || !result.prompt_id) {
                throw new Error('Failed to queue prompt');
            }

            if (onStatusChange) onStatusChange(`Processing... (ID: ${result.prompt_id})`);
            await waitForGeneration(result.prompt_id);

            if (onStatusChange) onStatusChange('Moving files...');

            const movedFiles = await moveFilesToProject(outputDir, startTime, prefix);

            // Re-wrap files matching the StemData interface required by MusicVideoAssemblerModule
            const newStems: StemData[] = movedFiles.map((f, i) => ({
                id: `stem-${i}-${Date.now()}`,
                type: f.type,
                path: f.path,
                url: `file://${f.path.replace(/\\/g, '/')}`,
                color: STEM_COLORS[f.type.toLowerCase()] || Object.values(STEM_COLORS)[i % Object.values(STEM_COLORS).length] || DEFAULT_STEM_COLOR,
                markers: [],
                beats: []
            }));

            // If we're updating stems we should just wipe existing old stems from the array.
            setStems(newStems);

            if (activeProject) {
                // We need to omit 'url' when saving to `ProjectStorage` since it isn't tracked in project data
                const projectStemsToSave = newStems.map(s => ({
                    type: s.type,
                    path: s.path,
                    color: s.color,
                    markers: [] as ProjectMarker[],
                    beats: [] as number[]
                }));

                onUpdateProject(activeProject.id, {
                    stems: projectStemsToSave,
                    outputDir: outputDir || undefined
                });
            }

            if (onStatusChange) onStatusChange(newStems.length > 0 ? 'Separation Complete!' : 'Warning: No output files found.');

        } catch (err: any) {
            console.error(err);
            if (onStatusChange) onStatusChange(`Error: ${err.message}`);
        } finally {
            setIsProcessing(false);
        }
    };

    const waitForGeneration = async (promptId: string): Promise<any> => {
        return new Promise((resolve, reject) => {
            const interval = setInterval(async () => {
                try {
                    // @ts-ignore
                    const { ipcRenderer } = window.require('electron');
                    const queueRes = await ipcRenderer.invoke('comfy-fetch', 'http://127.0.0.1:8188/queue');
                    if (queueRes.success) {
                        const queue = queueRes.data;
                        const isPending = queue.queue_pending && queue.queue_pending.some((i: any) => i[1] === promptId);
                        const isRunning = queue.queue_running && queue.queue_running.some((i: any) => i[1] === promptId);

                        if (isPending) {
                            if (onStatusChange) onStatusChange(`Queued... (Position: ${queue.queue_pending.findIndex((i: any) => i[1] === promptId) + 1})`);
                            return;
                        }
                        if (isRunning) {
                            if (onStatusChange) onStatusChange('Processing... (Running in ComfyUI)');
                        }
                    }

                    const res = await ipcRenderer.invoke('comfy-fetch', 'http://127.0.0.1:8188/history');
                    if (!res.success) return;

                    const history = res.data;
                    if (history[promptId]) {
                        clearInterval(interval);
                        if (history[promptId].status && history[promptId].status.status_str === 'error') {
                            const errorDetails = history[promptId].status.messages;
                            let errorMsg = "ComfyUI reported an error";
                            if (errorDetails) {
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

    const moveFilesToProject = async (targetDir: string, _startTime: number, runPrefix: string) => {
        // @ts-ignore
        const fs = window.require('fs');
        // @ts-ignore
        const path = window.require('path');

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const movedStems: { type: string; path: string }[] = [];
        const stemTypes = ['Vocals', 'Bass', 'Drums', 'Other'];
        const baseName = audioFile?.path ? path.parse(audioFile.path).name : 'stem';

        try {
            const files = fs.readdirSync(comfyOutputDir);
            for (const type of stemTypes) {
                const regex = new RegExp(`^${runPrefix}_.*${type}.*\\.(mp3|flac|wav)$`, 'i');
                const matches = files.filter((f: string) => regex.test(f))
                    .map((f: string) => {
                        const fullPath = path.join(comfyOutputDir, f);
                        const stats = fs.statSync(fullPath);
                        return { file: f, path: fullPath, time: stats.mtimeMs as number };
                    })
                    .sort((a: any, b: any) => b.time - a.time);

                if (matches.length > 0) {
                    const latest = matches[0];
                    const ext = path.extname(latest.file);
                    const destFilename = `${baseName}_${type}${ext}`;
                    const destPath = path.join(targetDir, destFilename);

                    fs.copyFileSync(latest.path, destPath);
                    console.log(`Found & Moved: ${latest.path} -> ${destPath}`);
                    movedStems.push({ type, path: destPath });
                } else {
                    console.warn(`No new ${type} file found in ${comfyOutputDir} matching ${runPrefix}`);
                }
            }
        } catch (e) {
            console.error("Error moving files:", e);
        }

        return movedStems;
    };


    const runBeatAnalysis = async (audioPath: string, stemType: string) => {
        setIsProcessing(true);
        if (onStatusChange) onStatusChange(`Analyzing beats for ${stemType} (${algorithm})…`);
        setDetectionStatus(`Analyzing ${stemType}...`);

        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        try {
            // @ts-ignore
            const fs = window.require('fs');
            const buffer = fs.readFileSync(audioPath);
            const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            setDetectionStatus('Analyzing beats...');
            const beatResult = await analyzeBeats(audioBuffer, algorithm);
            console.log('[Essentia] BPM:', beatResult.bpm, 'beats:', beatResult.beats.length);

            const allMarkers: AudioMarker[] = [];
            const stemMapping = getStemTheme(stemType); // getStemTheme should be guaranteed imported, but wait we didn't import it!
            const frameRate = activeProject?.frameRate || 24;

            beatResult.beats.forEach((time: number) => {
                allMarkers.push({
                    time: time,
                    color: stemMapping.base,
                    type: 'beat',
                    isDownbeat: false // Standard tracking doesn't distinguish out of box without secondary check
                });
            });

            if (enableOnsets) {
                setDetectionStatus('Analyzing onsets...');
                const onsetResult = await analyzeOnsets(audioBuffer);
                onsetResult.onsets.forEach((time: number) => {
                    allMarkers.push({
                        time: time,
                        color: stemMapping.light,
                        type: 'onset'
                    });
                });
            }

            if (enableLoudness) {
                setDetectionStatus('Analyzing loudness...');
                const loudResult = await analyzeLoudness(audioBuffer);
                loudResult.regions.forEach((region: any) => {
                    allMarkers.push({
                        time: region.start,
                        color: stemMapping.light,
                        type: 'loudness'
                    });
                });
            }

            const beatsOnly = allMarkers.filter((m: AudioMarker) => m.type === 'beat').map((m: AudioMarker) => m.time);

            // Update markers on the specific stem object inside `stems` array
            const updatedStems = stems.map(stem => {
                if (stem.type === stemType) {
                    return { ...stem, markers: allMarkers, beats: beatsOnly };
                }
                return stem;
            });
            setStems(updatedStems);

            // Save to project
            if (activeProject && onUpdateProject) {
                // Wipe older markers for this stem note
                const otherMarkers = (activeProject.markers || []).filter((m: ProjectMarker) => m.note !== stemType);

                // Convert AudioMarkers to ProjectMarkers before saving
                const projectMarkersToSave: ProjectMarker[] = allMarkers.map(m => {
                    const mappedType = (m.type === 'beat' || m.type === 'onset' || m.type === 'loudness')
                        ? m.type
                        : 'beat';

                    return {
                        timestamp: m.time,
                        frame: Math.round(m.time * frameRate),
                        color: m.color || stemMapping.base,
                        note: stemType,
                        type: mappedType as "beat" | "onset" | "loudness",
                        duration_sec: m.type === 'beat' ? 1 / frameRate : m.type === 'onset' ? 0.05 : 0.1
                    };
                });

                // Omit URL for project stems
                const projectStemsToSave = updatedStems.map(s => ({
                    type: s.type,
                    path: s.path,
                    color: s.color,
                    markers: [] as ProjectMarker[]
                }));

                onUpdateProject(activeProject.id, {
                    stems: projectStemsToSave,
                    markers: [...otherMarkers, ...projectMarkersToSave],
                    outputDir: outputDir || undefined
                });
            }

            setDetectionStatus(`Complete: ${beatsOnly.length} beats @${Math.round(beatResult.bpm)} BPM`);
            if (onStatusChange) onStatusChange(`Analysis for ${stemType} complete!`);

        } catch (err: any) {
            console.error('Analysis failed:', err);
            setDetectionStatus(`Analysis failed for ${stemType}.`);
            if (onStatusChange) onStatusChange(`Error analyzing stem: ${err.message}`);
        } finally {
            setIsProcessing(false);
            audioContext.close().catch(() => { });

            setTimeout(() => {
                setDetectionStatus('');
                if (onStatusChange) onStatusChange('');
            }, 4000);
        }
    };

    const handleAnalyzeLocal = async (path: string, type: string) => {
        await runBeatAnalysis(path, type);
    };

    const loadProjectAudio = async (project: BeatProject) => {
        if (onStatusChange) onStatusChange(`Loading project audio: ${project.audioFileName}`);
        setIsAnalyzing(true);
        setDuration(0);
        setClips([]);
        setStems([]);
        setMainMarkers([]);

        // Track updates needed for the project
        let stemsUpdated = false;
        let newStems = project.stems ? [...project.stems] : [];

        console.log("[loadProjectAudio] Loading project:", project.name, project.id);
        if (newStems.length > 0) {
            console.log("[loadProjectAudio] Stems found:", newStems.length);
            newStems.forEach((s, i) => {
                console.log(`[loadProjectAudio] Stem ${i} (${s.type}): details`, s); // Check entire object
                console.log(`[loadProjectAudio] Stem ${i} (${s.type}): beats length = ${s.beats ? s.beats.length : 'undefined'}`);
            });
        } else {
            console.log("[loadProjectAudio] No stems in project.");
        }

        try {
            // @ts-ignore
            const fs = window.require('fs');

            // 1. Read file to blob (using Electron fs)
            const buffer = fs.readFileSync(project.audioPath);
            const blob = new Blob([buffer], { type: 'audio/mpeg' });
            const url = URL.createObjectURL(blob);

            setAudioUrl(url);
            setAudioFile({ name: project.audioFileName, path: project.audioPath });

            // 2. Load Stems & Analyze their beats
            let loadedStems: StemData[] = [];
            if (newStems.length > 0) {
                for (let i = 0; i < newStems.length; i++) {
                    const stem = newStems[i];
                    try {
                        const sBuffer = fs.readFileSync(stem.path);
                        const sBlob = new Blob([sBuffer], { type: 'audio/mpeg' });

                        let stemMarkers = stem.markers;
                        const stemColor = stem.color || STEM_COLORS[stem.type.toLowerCase()] || DEFAULT_STEM_COLOR;

                        let finalAudioMarkers: AudioMarker[] = [];

                        // 1. Try modern ProjectMarkers array
                        if (stemMarkers && stemMarkers.length > 0) {
                            let beatIndex = 0;
                            finalAudioMarkers = stemMarkers.map(m => {
                                let isDownbeat = false;
                                if (m.type === 'beat') {
                                    isDownbeat = beatIndex % 4 === 0;
                                    beatIndex++;
                                }
                                return {
                                    time: m.timestamp,
                                    type: m.type as any,
                                    isDownbeat,
                                    color: m.color
                                };
                            });
                        }
                        // 2. Fallback to legacy flat beats array
                        else if (stem.beats && stem.beats.length > 0) {
                            finalAudioMarkers = stem.beats.map((t, index) => ({
                                time: t,
                                type: 'beat',
                                isDownbeat: index % 4 === 0,
                                color: undefined
                            }));
                        }

                        // 3. Removed auto-fallback so stems don't analyze immediately on load

                        loadedStems.push({
                            type: stem.type,
                            url: URL.createObjectURL(sBlob),
                            path: stem.path,
                            color: stemColor,
                            markers: finalAudioMarkers
                        });
                    } catch (err) {
                        console.error(`Failed to load stem ${stem.path}`, err);
                    }
                }
                setStems(loadedStems);
            } else {
                setStems([]);
            }

            // 3. Load Main Markers
            if (project.markers && project.markers.length > 0) {
                // Determine downbeats if strictly beats
                // For now, map all project markers
                const audioMarkers: AudioMarker[] = project.markers.map(m => {
                    // Refine isDownbeat logic if not present
                    // Try to deduce isDownbeat if we have a sequence of beats?
                    // ProjectMarker doesn't strictly have isDownbeat, but we can infer or pass it.
                    // For now, simplify: if type is beat, we might need to re-analyze or just treat as plain beats.
                    return {
                        time: m.timestamp,
                        type: m.type,
                        isDownbeat: false, // Default, updated if we detect strict 4/4
                        color: m.color
                    };
                });
                setMainMarkers(audioMarkers);
            } else {
                // Do not auto-analyze beats anymore. Just prepare an empty list.
                setMainMarkers([]);
            }

            if (onStatusChange) onStatusChange("Ready.");
            // 4. Load Clips
            if (project.clips) {
                setClips(project.clips);
            } else {
                setClips([]);
            }

            if (onStatusChange) onStatusChange("Ready.");

            // Save updates if any analysis happened
            if (stemsUpdated) {
                console.log("[loadProjectAudio] Stems updated during load. Saving to project...");
                console.log("[loadProjectAudio] New stems payload:", newStems);
                onUpdateProject(project.id, { stems: newStems });
            } else {
                console.log("[loadProjectAudio] No stem updates needed.");
            }

        } catch (e) {
            console.error("Failed to load project audio", e);
            if (onStatusChange) onStatusChange(`Error loading project: ${e}`);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleRunMainBeatAnalysis = async () => {
        if (!activeProject || !audioFile?.path) {
            if (onStatusChange) onStatusChange("No active project or audio file.");
            return;
        }

        setIsProcessing(true);
        if (onStatusChange) onStatusChange("Analyzing main track beats...");
        setDetectionStatus("Analyzing main track...");

        try {
            // @ts-ignore
            const fs = window.require('fs');
            const buffer = fs.readFileSync(audioFile.path);
            const blob = new Blob([buffer], { type: 'audio/mpeg' });

            const rawBeats = await analyzeAudio(blob);
            const audioMarkers: AudioMarker[] = rawBeats.map((t, i) => ({
                time: t,
                type: 'beat',
                isDownbeat: i % 4 === 0
            }));

            setMainMarkers(audioMarkers);
            setDetectionStatus(`Complete: ${rawBeats.length} beats.`);
            if (onStatusChange) onStatusChange("Main track beat analysis complete!");

            // Save to project explicitly so it persists
            onUpdateProject(activeProject.id, {
                markers: audioMarkers.map(m => ({
                    timestamp: m.time,
                    frame: Math.round(m.time * (activeProject.frameRate || 20)),
                    color: m.color || (m.isDownbeat ? '#ff3e3e' : '#ffffff'),
                    note: '',
                    type: m.type as any,
                    duration_sec: 0
                }))
            });

        } catch (err: any) {
            console.error("Main track analysis failed:", err);
            setDetectionStatus("Analysis failed.");
            if (onStatusChange) onStatusChange(`Error analyzing main track: ${err.message}`);
        } finally {
            setIsProcessing(false);
            setTimeout(() => {
                setDetectionStatus('');
                if (onStatusChange) onStatusChange('');
            }, 4000);
        }
    };

    // ------------------------------------------------------------------------------------------------
    // Timeline Generation Logic
    // ------------------------------------------------------------------------------------------------

    const handleGenerateTimelineClip = async (clipId: string) => {
        const clipToUpdate = clips.find(c => c.id === clipId);
        if (!clipToUpdate) {
            if (onStatusChange) onStatusChange("Clip not found.");
            return;
        }

        if (!comfyConnected) {
            if (onStatusChange) onStatusChange('Cannot generate: ComfyUI is not connected.');
            return;
        }

        if (!activeProject) {
            if (onStatusChange) onStatusChange("No active project.");
            return;
        }

        try {
            // Fast state update to Generating
            setClips(prev => prev.map(c => c.id === clipId ? { ...c, status: 'generating' } : c));
            const frameRate = activeProject.frameRate || 20;

            if (onStatusChange) onStatusChange(`Uploading Image & Audio for clip "${clipToUpdate.label}"...`);

            // 1. Upload Start Image
            let finalImageName = "";
            if (clipToUpdate.startImagePath) {
                const uploadResult = await uploadFileToComfyUI(clipToUpdate.startImagePath);
                if (uploadResult && uploadResult.name) {
                    finalImageName = uploadResult.name;
                } else {
                    throw new Error("Failed to upload start image to ComfyUI.");
                }
            } else {
                throw new Error("Start image missing. Aborting generation.");
            }

            // 2. Upload Audio File
            let finalAudioName = "audio.wav";
            let sourceAudioPath = activeProject.audioPath;

            // If the clip is from a stem, upload that stem instead
            if (clipToUpdate.source === 'stem' && clipToUpdate.stemName) {
                const targetStem = stems.find(s => s.type === clipToUpdate.stemName);
                if (targetStem) {
                    sourceAudioPath = targetStem.path;
                }
            }

            if (sourceAudioPath) {
                const uploadResult = await uploadFileToComfyUI(sourceAudioPath);
                if (uploadResult && uploadResult.name) {
                    finalAudioName = uploadResult.name;
                } else {
                    throw new Error("Failed to upload audio to ComfyUI.");
                }
            }

            if (onStatusChange) onStatusChange(`Queuing generation for "${clipToUpdate.label}"...`);

            // 3. Clone and Inject Workflow
            const workflow = JSON.parse(JSON.stringify(workflowJsonTemplate));
            const frames = getValidLtxFrameCount(clipToUpdate.duration, frameRate);

            // a. Start Image
            if (workflow["98"] && workflow["98"].inputs) {
                workflow["98"].inputs.image = finalImageName;
            }

            // b. Prompt (Use clip promptText, fallback to label)
            if (workflow["92:3"] && workflow["92:3"].inputs) {
                const promptVal = (clipToUpdate.promptText && clipToUpdate.promptText.trim() !== '')
                    ? clipToUpdate.promptText
                    : clipToUpdate.label;
                workflow["92:3"].inputs.text = promptVal;
            }

            // c. Seed
            const rng_seed = Math.floor(Math.random() * 1000000000000000);
            if (workflow["92:11"] && workflow["92:11"].inputs) {
                workflow["92:11"].inputs.noise_seed = rng_seed;
            }
            if (workflow["92:67"] && workflow["92:67"].inputs) {
                workflow["92:67"].inputs.noise_seed = rng_seed;
            }

            // d. Node 62 (Frame Count)
            if (workflow["92:62"] && workflow["92:62"].inputs) {
                workflow["92:62"].inputs.value = frames;
            }

            // e. Node 97 (FPS)
            if (workflow["92:97"] && workflow["92:97"].inputs) {
                workflow["92:97"].inputs.fps = frameRate;
            }
            if (workflow["92:22"] && workflow["92:22"].inputs) {
                workflow["92:22"].inputs.frame_rate = frameRate;
            }

            // f. Node 115 (Audio Trimming)
            if (workflow["92:115"] && workflow["92:115"].inputs) {
                workflow["92:115"].inputs.start_index = clipToUpdate.startTime;
                workflow["92:115"].inputs.duration = clipToUpdate.duration;
            }

            // g. Node 113 (Audio Upload Source)
            if (workflow["92:113"] && workflow["92:113"].inputs) {
                workflow["92:113"].inputs.audio = finalAudioName;
            }

            // 4. Queue the prompt
            const result = await queuePrompt(workflow);
            if (!result || !result.prompt_id) {
                throw new Error('Failed to queue prompt');
            }

            if (onStatusChange) onStatusChange(`Generating Video (ID: ${result.prompt_id})...`);

            // 5. Poll for completion
            await waitForGeneration(result.prompt_id);

            // 6. Move output and update state
            const targetDir = activeProject.outputDir || outputDir;
            if (!targetDir) {
                throw new Error("No output directory set for the project.");
            }

            const prefix = "video/LTX_2.0_i2v";
            const movedFiles = await moveFilesToProject(targetDir, Date.now() - 3600000 /* 1h buffer */, prefix);

            let finalVideoPath = "";
            let generatedMp4 = movedFiles.find(f => f.type === 'Other' || f.path.endsWith('.mp4'));

            if (generatedMp4) {
                finalVideoPath = generatedMp4.path;
            } else {
                // Try to locate it directly from ComfyUI output
                const fs = window.require('fs');
                const path = window.require('path');
                const outFiles = fs.readdirSync(comfyOutputDir).filter((f: string) => f.includes('LTX_2.0_i2v') && f.endsWith('.mp4'));
                if (outFiles.length > 0) {
                    // Get latest
                    const latest = outFiles.sort((a: string, b: string) => fs.statSync(path.join(comfyOutputDir, b)).mtimeMs - fs.statSync(path.join(comfyOutputDir, a)).mtimeMs)[0];
                    const destPath = path.join(targetDir, latest);
                    fs.copyFileSync(path.join(comfyOutputDir, latest), destPath);
                    finalVideoPath = destPath;
                }
            }

            if (!finalVideoPath) {
                throw new Error("Generated video file not found after completion.");
            }

            // Success Update
            setClips(prev => prev.map(c => {
                if (c.id === clipId) {
                    const existingVids = c.generatedVideos || [];
                    return {
                        ...c,
                        status: 'done',
                        videoPath: finalVideoPath,
                        generatedVideos: [...existingVids, finalVideoPath]
                    };
                }
                return c;
            }));

            if (onStatusChange) onStatusChange(`Successfully generated video for "${clipToUpdate.label}"`);

            // Save state
            setTimeout(() => {
                handleSaveToProject();
            }, 500);

        } catch (err: any) {
            console.error('Generation Error:', err);
            if (onStatusChange) onStatusChange(`Error generating clip: ${err.message}`);
            setClips(prev => prev.map(c => c.id === clipId ? { ...c, status: 'error' } : c));
        }
    };


    // Helper: inject beat markers into a WaveSurfer's internal wrapper
    const renderBeatMarkers = (ws: WaveSurfer, markers: AudioMarker[], markerDuration: number) => {
        try {
            const wrapper = ws.getWrapper();
            if (!wrapper) return;
            // Remove existing markers
            wrapper.querySelectorAll('.beat-marker').forEach(el => el.remove());
            if (markerDuration <= 0) return;

            markers.forEach((marker) => {
                const left = (marker.time / markerDuration) * 100;
                if (left > 100) return;

                let color = MARKER_COLORS.default;

                if (marker.color) {
                    color = marker.color;
                } else {
                    switch (marker.type) {
                        case 'beat':
                            color = marker.isDownbeat ? MARKER_COLORS.downbeat : MARKER_COLORS.offbeat;
                            break;
                        case 'onset':
                            color = MARKER_COLORS.onset;
                            break;
                        case 'loudness':
                            color = MARKER_COLORS.loudness;
                            break;
                        default:
                            color = MARKER_COLORS.default;
                    }
                }

                // Visual style tweaks based on type
                const isDownbeat = marker.type === 'beat' && marker.isDownbeat;
                const width = isDownbeat ? '2px' : '1px';
                const opacity = marker.type === 'onset' ? '0.7' : '1';

                const div = document.createElement('div');
                div.className = 'beat-marker';
                div.style.cssText = `
                    position: absolute;
                    left: ${left}%;
                    top: 0;
                    bottom: 0;
                    width: ${width};
                    background-color: ${color};
                    opacity: ${opacity};
                    pointer-events: none;
                    z-index: 10;
                `;
                wrapper.appendChild(div);
            });
        } catch (e) {
            console.error('renderBeatMarkers error:', e);
        }
    };

    // Zoom Effect — only run when audio is loaded (duration > 0)
    useEffect(() => {
        if (duration <= 0) return; // Audio not ready yet

        if (wavesurfer.current) {
            try {
                wavesurfer.current.zoom(zoomLevel);
            } catch (e) {
                // Silently ignore — audio may still be decoding
            }
            const currentMarkers = mainBeatSource === 'main' ? mainMarkers : (typeof mainBeatSource === 'number' && stems[mainBeatSource] ? stems[mainBeatSource].markers : []);
            renderBeatMarkers(wavesurfer.current, currentMarkers, duration);
        }
        stemSurfers.current.forEach((ws, idx) => {
            try {
                ws.zoom(zoomLevel);
            } catch (e) {
                // Silently ignore
            }
            if (stems[idx] && stems[idx].markers) {
                renderBeatMarkers(ws, stems[idx].markers, duration);
            }
        });
    }, [zoomLevel, mainMarkers, stems, mainBeatSource, duration]);

    // Initialize WaveSurfer
    useEffect(() => {
        if (!containerRef.current || !audioUrl) return;

        if (wavesurfer.current) {
            wavesurfer.current.destroy();
        }

        const ws = WaveSurfer.create({
            container: containerRef.current,
            waveColor: '#4f46e5',
            progressColor: '#818cf8',
            height: 128,
            minPxPerSec: zoomLevel,
            url: audioUrl,
        });

        ws.on('error', (e: any) => {
            const msg = e instanceof Error ? e.message : String(e);
            if (e?.name !== 'AbortError' && !msg.toLowerCase().includes('abort') && !msg.toLowerCase().includes('destroy')) {
                console.error("Wavesurfer error:", e);
            }
        });

        ws.on('ready', () => {
            const dur = ws.getDuration();
            setDuration(dur);

            // Calculate Min Zoom to prevent horizontal scrolling
            if (containerRef.current) {
                const width = containerRef.current.clientWidth;
                // e.g. if duration is 10s and width is 1000px, minPxPerSec = 100
                // If duration is 0, default to 1
                const calculatedMin = dur > 0 ? width / dur : 1;
                // Round down slightly to ensure fit? Or up? WaveSurfer sometimes adds padding.
                // Let's floor it.
                setMinZoom(calculatedMin);
            }

            try {
                ws.zoom(zoomLevel);
            } catch (e) {
                console.warn("WaveSurfer initial zoom failed", e);
            }
            // Render beat markers inside WaveSurfer wrapper
            const currentMarkers = mainBeatSource === 'main' ? mainMarkers : (typeof mainBeatSource === 'number' && stems[mainBeatSource] ? stems[mainBeatSource].markers : []);
            renderBeatMarkers(ws, currentMarkers, dur);
        });

        // Register Regions Plugin
        const regions = ws.registerPlugin(RegionsPlugin.create());
        wsRegions.current = regions;

        // Helper: clear only interactive (drag) regions, keep saved ones
        const clearInteractiveRegions = (regPlugin: any) => {
            const allRegions = regPlugin.getRegions();
            allRegions.forEach((r: any) => {
                if (!r.id || !r.id.startsWith('saved-')) {
                    r.remove();
                }
            });
        };

        regions.enableDragSelection({
            color: 'rgba(255, 0, 0, 0.2)',
        });

        // Snap to Beat Logic
        regions.on('region-updated', (region) => {
            const currentMarkers = mainBeatSource === 'main' ? mainMarkers : (typeof mainBeatSource === 'number' && stems[mainBeatSource] ? stems[mainBeatSource].markers : []);

            if (currentMarkers.length === 0) return;

            const snapToBeat = (time: number) => {
                // Include 0 and track end as valid snap points
                const snapPoints = [
                    { time: 0 },
                    ...currentMarkers,
                    { time: ws.getDuration() }
                ];
                const closest = snapPoints.reduce((prev, curr) =>
                    Math.abs(curr.time - time) < Math.abs(prev.time - time) ? curr : prev
                );
                return closest.time;
            };

            const snappedStart = snapToBeat(region.start);
            const snappedEnd = snapToBeat(region.end);

            // Calculate current zoom level snap distance in seconds (e.g., 10 pixels)
            const SNAP_THRESHOLD_PX = 10;
            const snapThresholdSecs = SNAP_THRESHOLD_PX / zoomLevel;

            let newStart = region.start;
            let newEnd = region.end;

            if (Math.abs(region.start - snappedStart) <= snapThresholdSecs) {
                newStart = snappedStart;
            }
            if (Math.abs(region.end - snappedEnd) <= snapThresholdSecs) {
                newEnd = snappedEnd;
            }

            if (newStart !== region.start || newEnd !== region.end) {
                region.setOptions({
                    start: newStart,
                    end: Math.max(newEnd, newStart + 0.1)
                });
            }

            setActiveSelection({
                source: 'main',
                start: region.start,
                end: region.end
            });
            stemRegionsRefs.current.forEach(r => clearInteractiveRegions(r));
        });

        regions.on('region-created', (region) => {
            // Skip saved regions being re-added
            if (region.id && region.id.startsWith('saved-')) return;
            setActiveSelection({
                source: 'main',
                start: region.start,
                end: region.end
            });
            stemRegionsRefs.current.forEach(r => clearInteractiveRegions(r));
        });

        // Sync Stems on Interaction
        const syncStems = () => {
            const time = ws.getCurrentTime();
            stemSurfers.current.forEach(s => {
                if (Math.abs(s.getCurrentTime() - time) > 0.1) {
                    s.setTime(time);
                }
            });
        };

        ws.on('interaction', syncStems);
        ws.on('play', () => {
            if (isStemPlaying) stemSurfers.current.forEach(s => s.play());
        });
        ws.on('pause', () => {
            if (isStemPlaying) stemSurfers.current.forEach(s => s.pause());
        });

        wavesurfer.current = ws;

        return () => {
            try {
                ws.destroy();
            } catch (e) {
                // Ignore destroy errors
            }
        };
    }, [audioUrl]);

    // Initialize WaveSurfers (Stems)
    useEffect(() => {
        // Cleanup function for stems
        const cleanupStems = () => {
            stemSurfers.current.forEach(ws => {
                try {
                    ws.destroy();
                } catch (e) {
                    // Ignore
                }
            });
            stemSurfers.current = [];
        };

        // Initial cleanup
        cleanupStems();

        if (stems.length === 0) return;

        // Use requestAnimationFrame to ensure the DOM has updated and containers are available
        requestAnimationFrame(() => {
            stems.forEach((stem, index) => {
                const containerId = `stem-waveform-${index}`;
                const container = document.getElementById(containerId);
                if (container) {
                    const ws = WaveSurfer.create({
                        container,
                        waveColor: stem.color,
                        progressColor: adjustColorBrightness(stem.color, 20),
                        height: 64,
                        minPxPerSec: zoomLevel,
                        url: stem.url,
                        interact: true,
                        cursorWidth: 1,
                    });

                    // Add Regions
                    const stemRegions = ws.registerPlugin(RegionsPlugin.create());
                    stemRegionsRefs.current.set(index, stemRegions);

                    stemRegions.enableDragSelection({
                        color: hexToRgba(stem.color, 0.2),
                    });

                    const handleStemRegionUpdate = (region: any) => {
                        // Skip saved regions
                        if (region.id && region.id.startsWith('saved-')) return;
                        setActiveSelection({
                            source: 'stem',
                            stemIndex: index,
                            start: region.start,
                            end: region.end
                        });

                        // Clear interactive regions on main track
                        if (wsRegions.current) {
                            const allRegions = wsRegions.current.getRegions();
                            allRegions.forEach((r: any) => {
                                if (!r.id || !r.id.startsWith('saved-')) r.remove();
                            });
                        }

                        // Clear interactive regions on other stems
                        stemRegionsRefs.current.forEach((val, key) => {
                            if (key !== index) {
                                const allRegions = val.getRegions();
                                allRegions.forEach((r: any) => {
                                    if (!r.id || !r.id.startsWith('saved-')) r.remove();
                                });
                            }
                        });

                        // Snap to Stem's OWN beats
                        const stemMarkers = stem.markers || [];
                        if (stemMarkers.length > 0) {
                            const snapToBeat = (time: number) => {
                                // Include 0 and track end as valid snap points
                                const snapPoints = [
                                    { time: 0 },
                                    ...stemMarkers,
                                    { time: wavesurfer.current?.getDuration() || 0 }
                                ];
                                const closest = snapPoints.reduce((prev, curr) =>
                                    Math.abs(curr.time - time) < Math.abs(prev.time - time) ? curr : prev
                                );
                                return closest.time;
                            };
                            const snappedStart = snapToBeat(region.start);
                            const snappedEnd = snapToBeat(region.end);

                            // Calculate current zoom level snap distance in seconds (e.g., 10 pixels)
                            const SNAP_THRESHOLD_PX = 10;
                            const snapThresholdSecs = SNAP_THRESHOLD_PX / zoomLevel;

                            let newStart = region.start;
                            let newEnd = region.end;

                            if (Math.abs(region.start - snappedStart) <= snapThresholdSecs) {
                                newStart = snappedStart;
                            }
                            if (Math.abs(region.end - snappedEnd) <= snapThresholdSecs) {
                                newEnd = snappedEnd;
                            }

                            if (newStart !== region.start || newEnd !== region.end) {
                                region.setOptions({
                                    start: newStart,
                                    end: Math.max(newEnd, newStart + 0.1)
                                });
                            }
                        }
                    };

                    stemRegions.on('region-created', handleStemRegionUpdate);
                    stemRegions.on('region-updated', handleStemRegionUpdate);

                    ws.on('ready', () => {
                        ws.zoom(zoomLevel);
                        if (stem.markers && stem.markers.length > 0) {
                            renderBeatMarkers(ws, stem.markers, wavesurfer.current?.getDuration() || 0);
                        }
                    });

                    stemSurfers.current.push(ws);
                } else {
                    console.error(`Container ${containerId} not found when initializing stem WaveSurfer.`);
                }
            });
        });


        return () => {
            cleanupStems();
        };
    }, [stems]);

    // Auto-select Bass as main beat source if available
    useEffect(() => {
        if (stems.length > 0) {
            const bassIndex = stems.findIndex(s => s.type.toLowerCase() === 'bass');
            if (bassIndex !== -1) {
                console.log("Auto-selecting Bass as main beat source");
                setMainBeatSource(bassIndex);
            } else {
                setMainBeatSource('main');
            }
        } else {
            setMainBeatSource('main');
        }
    }, [stems]);

    // NLE Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Disable if typing in an input or textarea
            if (
                document.activeElement?.tagName === 'INPUT' ||
                document.activeElement?.tagName === 'TEXTAREA' ||
                (document.activeElement as HTMLElement)?.isContentEditable
            ) {
                return;
            }

            const ws = wavesurfer.current;
            if (!ws) return;

            // Current time info
            const time = ws.getCurrentTime();
            const dur = ws.getDuration();

            switch (e.key.toLowerCase()) {
                case ' ':
                    e.preventDefault();
                    if (ws.isPlaying()) {
                        ws.pause();
                        stemSurfers.current.forEach(s => s.pause());
                    } else {
                        ws.play();
                        // Assume stems play if they exist for now, or use a ref if we need strict isStemPlaying sync
                        stemSurfers.current.forEach(s => s.play());
                    }
                    break;
                case 'k': // Pause
                    e.preventDefault();
                    ws.pause();
                    stemSurfers.current.forEach(s => s.pause());
                    break;
                case 'l': // Play / Fast Forward
                    e.preventDefault();
                    if (!ws.isPlaying()) {
                        ws.setPlaybackRate(1);
                        stemSurfers.current.forEach(s => s.setPlaybackRate(1));
                        ws.play();
                        stemSurfers.current.forEach(s => s.play());
                    } else {
                        // Increase speed up to 8x
                        const currentRate = ws.getPlaybackRate();
                        const nextRate = Math.min(8, currentRate * 2);
                        ws.setPlaybackRate(nextRate);
                        stemSurfers.current.forEach(s => s.setPlaybackRate(nextRate));
                    }
                    break;
                case 'j': // Rewind / Reverse / Normal Speed
                    e.preventDefault();
                    const currentRate = ws.getPlaybackRate();
                    if (ws.isPlaying() && currentRate > 1) {
                        // Slow down to normal first
                        ws.setPlaybackRate(1);
                        stemSurfers.current.forEach(s => s.setPlaybackRate(1));
                    } else {
                        // Wavesurfer negative playback rate isn't reliable, skip backwards
                        const newTime = Math.max(0, time - 5);
                        ws.setTime(newTime);
                        stemSurfers.current.forEach(s => s.setTime(newTime));
                    }
                    break;
                case 'i': // Mark In
                    e.preventDefault();
                    if (wsRegions.current) {
                        // Clear existing interactive region to reset it
                        const allRegions = wsRegions.current.getRegions();
                        let existingRegion = null;

                        allRegions.forEach((r: any) => {
                            if (!r.id || !r.id.startsWith('saved-')) {
                                existingRegion = r;
                            }
                        });

                        const markInTime = time;
                        let markOutTime = Math.min(dur, markInTime + 5); // Default to 5s loop if no 'O' is set

                        if (existingRegion) {
                            // @ts-ignore
                            markOutTime = existingRegion.end;
                            if (markInTime > markOutTime) markOutTime = Math.min(dur, markInTime + 5);
                            // @ts-ignore
                            existingRegion.setOptions({ start: markInTime, end: markOutTime });
                            setActiveSelection({ source: 'main', start: markInTime, end: markOutTime });
                        } else {
                            wsRegions.current.addRegion({
                                start: markInTime,
                                end: markOutTime,
                                color: 'rgba(255, 0, 0, 0.2)',
                            });
                            setActiveSelection({ source: 'main', start: markInTime, end: markOutTime });
                        }
                    }
                    break;
                case 'o': // Mark Out
                    e.preventDefault();
                    if (wsRegions.current) {
                        const allRegions = wsRegions.current.getRegions();
                        let existingRegion = null;

                        allRegions.forEach((r: any) => {
                            if (!r.id || !r.id.startsWith('saved-')) {
                                existingRegion = r;
                            }
                        });

                        const markOutTime = time;
                        let markInTime = Math.max(0, markOutTime - 5);

                        if (existingRegion) {
                            // @ts-ignore
                            markInTime = existingRegion.start;
                            if (markInTime > markOutTime) markInTime = Math.max(0, markOutTime - 5);
                            // @ts-ignore
                            existingRegion.setOptions({ start: markInTime, end: markOutTime });
                            setActiveSelection({ source: 'main', start: markInTime, end: markOutTime });
                        } else {
                            wsRegions.current.addRegion({
                                start: markInTime,
                                end: markOutTime,
                                color: 'rgba(255, 0, 0, 0.2)',
                            });
                            setActiveSelection({ source: 'main', start: markInTime, end: markOutTime });
                        }
                    }
                    break;
                case 'c': // Cut (Add Segment)
                    e.preventDefault();
                    // trigger visually clicking the Add Segment button requires either state changes or button ref.
                    // Better to just call a ref to our handleAddSegment function, but since it depends on state, we might hit stale closures if not careful.
                    // We'll dispatch a custom event and catch it.
                    document.dispatchEvent(new CustomEvent('NLE_ADD_SEGMENT'));
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [stems]);

    // Catch the custom NLE Cut event to ensure we have fresh activeSelection / clips state from the component body
    useEffect(() => {
        const handleCustomAdd = () => {
            handleAddSegment();
        };
        document.addEventListener('NLE_ADD_SEGMENT', handleCustomAdd);
        return () => document.removeEventListener('NLE_ADD_SEGMENT', handleCustomAdd);
    }, [activeSelection, clips, stems]);


    // Add the current selection as a segment to the timeline (no ComfyUI generation)
    const handleAddSegment = () => {
        if (!activeSelection) {
            if (onStatusChange) onStatusChange('Select a region on a waveform first.');
            return;
        }
        const { start, end, source, stemIndex } = activeSelection;
        const segDuration = end - start;
        const track = (clips.length % 2) + 1;

        const newClip: VideoClip = {
            id: Date.now().toString(),
            startTime: start,
            endTime: end,
            duration: segDuration,
            track,
            status: 'pending',
            source,
            stemName: source === 'stem' && stemIndex !== undefined ? stems[stemIndex]?.type : undefined,
            label: `clip_${clips.length}`,
        };

        setClips(prev => [...prev, newClip]);
        setActiveSelection(null);

        // Clear interactive drag regions so only saved ones remain
        if (wsRegions.current) wsRegions.current.clearRegions();
        stemRegionsRefs.current.forEach(r => r.clearRegions());

        if (onStatusChange) onStatusChange(`Segment added: ${formatTime(start)} – ${formatTime(end)}`);
    };

    // Remove a clip/segment from the timeline
    const handleRemoveClip = (clipId: string) => {
        setClips(prev => prev.filter(c => c.id !== clipId));
    };

    // Save clips to the active project
    const handleSaveToProject = async () => {
        if (!activeProject) {
            if (onStatusChange) onStatusChange('No project selected.');
            return;
        }
        try {
            // @ts-ignore
            const ipcRenderer = window.require ? window.require('electron').ipcRenderer : window.ipcRenderer;

            // If project has no outputDir, load it from config
            let baseOutputDir = activeProject.outputDir;
            if (!baseOutputDir && ipcRenderer) {
                const res = await ipcRenderer.invoke('get-config');
                if (res.success && res.config.projectOutputDir) {
                    baseOutputDir = res.config.projectOutputDir;
                }
            }

            if (!baseOutputDir) {
                if (onStatusChange) onStatusChange('No output folder configured. Set one in Settings → Defaults.');
                return;
            }

            // Update project with clips and ensure outputDir is set
            onUpdateProject(activeProject.id, {
                clips: clips,
                outputDir: baseOutputDir,
            });
            if (onStatusChange) onStatusChange(`Project saved ✓  →  ${baseOutputDir}`);
        } catch (e) {
            console.error('Save failed:', e);
            if (onStatusChange) onStatusChange('Error saving project.');
        }
    };

    // Image picker for start/end images
    const handlePickImage = (clipId: string, field: 'startImagePath' | 'endImagePath') => {
        if (!activeProject?.outputDir) {
            if (onStatusChange) onStatusChange('No project folder available. Save the project first.');
            return;
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e: any) => {
            const file = e.target.files?.[0];
            if (file) {
                const filePath = file.path || file.name;
                setClips(prev => prev.map(c => c.id === clipId ? { ...c, [field]: filePath } : c));
            }
        };
        input.click();
    };

    const handleUpdateClipLabel = (clipId: string, newLabel: string) => {
        setClips(prev => prev.map(c => c.id === clipId ? { ...c, label: newLabel } : c));
    };

    // Render saved clip regions on the appropriate waveform whenever clips change
    useEffect(() => {
        // Clear all existing pinned regions first
        const renderSavedRegions = () => {
            // Render main-track clips
            if (wsRegions.current) {
                wsRegions.current.clearRegions();
                clips.filter(c => c.source === 'main').forEach(c => {
                    const region = wsRegions.current.addRegion({
                        id: `saved-${c.id}`,
                        start: c.startTime,
                        end: c.endTime,
                        color: 'rgba(34, 197, 94, 0.18)',
                        drag: false,
                        resize: false,
                    });
                    // Push behind waveform
                    if (region.element) region.element.style.zIndex = '0';
                });
            }

            // Render stem clips
            stemRegionsRefs.current.forEach((reg, stemIdx) => {
                reg.clearRegions();
                const stemType = stems[stemIdx]?.type;
                if (!stemType) return;
                clips.filter(c => c.source === 'stem' && c.stemName === stemType).forEach(c => {
                    const region = reg.addRegion({
                        id: `saved-${c.id}`,
                        start: c.startTime,
                        end: c.endTime,
                        color: 'rgba(34, 197, 94, 0.18)',
                        drag: false,
                        resize: false,
                    });
                    // Push behind waveform
                    if (region.element) region.element.style.zIndex = '0';
                });
            });
        };

        // Small delay to let WaveSurfer finish any pending updates
        const timer = setTimeout(renderSavedRegions, 100);
        return () => clearTimeout(timer);
    }, [clips, stems, duration]);

    const handleGenerateClipFromRegion = async () => {
        if (!activeSelection) {
            if (onStatusChange) onStatusChange("Please select a region on the waveform first.");
            return;
        }

        const { start: startTime, end: endTime, source, stemIndex } = activeSelection;
        const duration = endTime - startTime;

        // Constraint Math
        // Frame Count: (n * 8) + 1
        const fps = activeProject?.frameRate || 24;
        const rawFrames = duration * fps;
        // Round to nearest multiple of 8, then add 1
        const targetFrames = Math.round(rawFrames / 8) * 8 + 1;

        // Dimensions: (n * 32) + 1
        // Default to a reasonable resolution, can be configurable
        const width = 512 + 1; // 513
        const height = 512 + 1; // 513

        // Checkerboard Track Logic
        const newIndex = clips.length;
        const track = (newIndex % 2) + 1;

        const newClip: VideoClip = {
            id: Date.now().toString(),
            startTime,
            endTime,
            duration,
            track,
            status: 'pending',
            promptText: "A cool music video scene, dynamic lighting, 4k", // Default prompt
            source: source,
            stemName: source === 'stem' && stemIndex !== undefined ? stems[stemIndex]?.type : undefined,
            label: `clip_${clips.length}`
        };

        setClips((prev) => [...prev, newClip]);

        // Determine Audio Path
        let targetAudioPath = (audioFile as any).path;

        if (source === 'stem' && stemIndex !== undefined && stems[stemIndex]) {
            targetAudioPath = stems[stemIndex].path;
            console.log(`Generating using Stem: ${stems[stemIndex].type}`);
        }

        // Trigger ComfyUI Generation
        await generateClipInComfy(newClip, targetFrames, width, height, targetAudioPath);
    };

    const generateClipInComfy = async (clip: VideoClip, frames: number, width: number, height: number, audioPath: string) => {
        if (!workflowJsonTemplate || !audioPath) {
            if (onStatusChange) onStatusChange("Workflow or Audio not loaded.");
            return;
        }

        // Update status
        setClips(prev => prev.map(c => c.id === clip.id ? { ...c, status: 'generating' } : c));

        try {
            const prompt = JSON.parse(JSON.stringify(workflowJsonTemplate));

            // 1. Inject Audio Path
            // Using passed audioPath

            // Find Nodes
            let loadAudioKey: string | null = null;
            let audioTrimKey: string | null = null;
            let videoGenKey: string | null = null; // KSampler or specific LTX/Video node
            let ksamplerKey: string | null = null; // Standard KSampler logic

            for (const [key, node] of Object.entries(prompt)) {
                // @ts-ignore
                const type = node.class_type;
                if (type === 'LoadAudio' || type === 'LoadAudioPath') loadAudioKey = key;
                if (type === 'Audio Trim' || type === 'AudioTrim') audioTrimKey = key; // Hypothetical node name, check user's workflow

                if (type === 'KSampler' || type === 'KSamplerAdvanced') ksamplerKey = key;
                if (type === 'EmptyLatentVideo' || type === 'EmptyLatentImage') videoGenKey = key; // Usually sets dimensions/frames
            }

            // Inject Audio
            if (loadAudioKey) {
                // @ts-ignore
                prompt[loadAudioKey].inputs.audio = audioPath;
            }

            // Inject Trim
            // If "Audio Trim" node exists, use it.
            // If not, we might need to rely on the prompt to specify start/duration? No, ComfyUI needs explicit logic.
            // *Assumption*: The user verifies their workflow has a node accepting start/duration.
            // We will look for ANY node that has "start_time" and "duration" inputs and try to set them if they look like audio nodes.
            // Or better, we notify the user if we can't find it.

            // For now, let's assume standard "Audio Trim" behavior or similar.
            if (audioTrimKey) {
                // @ts-ignore
                prompt[audioTrimKey].inputs.start_time = clip.startTime;
                // @ts-ignore
                prompt[audioTrimKey].inputs.duration = clip.duration;
            }

            // Inject Frames & Dimensions
            if (videoGenKey) {
                // @ts-ignore
                prompt[videoGenKey].inputs.frame_count = frames;
                // @ts-ignore
                prompt[videoGenKey].inputs.width = width;
                // @ts-ignore
                prompt[videoGenKey].inputs.height = height;
            } else if (ksamplerKey) {
                // Determine if KSampler drives frames? Usually EmptyLatent does.
            }

            // Queue Prompt
            const result = await queuePrompt(prompt);

            if (result && result.prompt_id) {
                // Poll for completion (similar to StemSeparation logic)
                // For brevity/robustness, we'll reuse the polling logic or import it.
                // Ideally, we wait for the file to appear in output.
                if (onStatusChange) onStatusChange(`Started generation for Clip ${clip.id}`);
            }

        } catch (e) {
            console.error("Generation failed", e);
            setClips(prev => prev.map(c => c.id === clip.id ? { ...c, status: 'error' } : c));
        }
    };

    const handleExportManifest = async () => {
        // Generate JSON
        const manifest = {
            project_fps: activeProject?.frameRate || 24,
            clips: clips.map(c => ({
                path: c.videoPath || `C:/VJ_Project/clips/clip_${c.id}.mp4`, // Placeholder if not done
                start_seconds: c.startTime,
                track: c.track
            }))
        };

        // Save via IPC
        // @ts-ignore
        const ipcRenderer = window.require ? window.require('electron').ipcRenderer : window.ipcRenderer;
        const result = await ipcRenderer.invoke('save-manifest', manifest);
        if (result.success) {
            if (onStatusChange) onStatusChange(`Manifest saved to ${result.path}`);
        } else {
            if (onStatusChange) onStatusChange(`Error saving manifest: ${result.error}`);
        }
    };


    const [isStemPlaying, setIsStemPlaying] = useState(false);

    const handlePlayStems = () => {
        // Play all stems from the start — does NOT affect the main track
        stemSurfers.current.forEach(s => {
            s.setVolume(1);
            s.setTime(0);
            s.play();
        });
        setIsStemPlaying(true);
    };

    const handlePauseAll = () => {
        // Pause all stems — does NOT affect the main track
        stemSurfers.current.forEach(s => s.pause());
        setIsStemPlaying(false);
    };

    const handlePlayMain = () => {
        if (wavesurfer.current) {
            wavesurfer.current.setVolume(1);
            wavesurfer.current.setMuted(false);
            setIsStemPlaying(false);
            wavesurfer.current.play();
        }
    };

    const handlePauseMain = () => {
        if (wavesurfer.current) {
            wavesurfer.current.pause();
        }
    };

    const handlePlayStem = (index: number) => {
        const ws = stemSurfers.current[index];
        if (ws) {
            ws.play();
        }
    };

    const handlePauseStem = (index: number) => {
        const ws = stemSurfers.current[index];
        if (ws) {
            ws.pause();
        }
    };

    return (
        <div className="video-assembler-container">
            {/* ... header ... */}
            <div className="module-header">
                <h2 className="module-title">🎬 Video Assembler</h2>
            </div>

            {/* Project Selection / Creation */}
            <CollapsibleCard title="Load Audio Source" className="mt-4" defaultOpen={!activeProject}>
                <DropZone
                    onFilesDropped={handleAudioDrop}
                    accept="audio/*"
                    label="Drop Audio File Here: Selected File"
                    defaultAudioPath={audioFile?.path || undefined}
                />
            </CollapsibleCard>

            <CollapsibleCard title="Select Project" className="mt-4" defaultOpen={!activeProject}>
                <ProjectsPanel
                    projects={projects}
                    onLoad={(p) => onSelectProject(p.id)}
                    onDelete={onDeleteProject}
                    currentProjectId={activeProject?.id}
                />
            </CollapsibleCard>

            {/* Stem Separation Configuration & Action */}
            <div className="grid-2 mt-4">
                <CollapsibleCard
                    title="Stem Generation"
                    defaultOpen={false}
                    headerRight={
                        <div className="flex gap-2">
                            <span className={`status-badge ${comfyConnected ? 'success' : 'error'}`}>
                                {comfyConnected ? 'Connected' : 'Disconnected'}
                            </span>
                            <span className={`status-badge ${workflow ? 'success' : 'warning'}`}>
                                {workflow ? 'Ready' : 'No Workflow'}
                            </span>
                        </div>
                    }
                >

                    <div className="flex flex-col gap-4">

                        <button
                            onClick={handleRunSeparation}
                            disabled={isProcessing || !comfyConnected || !audioFile?.path || !workflow}
                            className={`btn w-full mt-2 ${isProcessing || !comfyConnected || !audioFile?.path || !workflow ? 'btn-secondary opacity-50 cursor-not-allowed' : 'btn-primary'}`}
                        >
                            {isProcessing ? (
                                <>Processing Music File...</>
                            ) : (
                                <>Start Stem Separation</>
                            )}
                        </button>
                        <button
                            onClick={handleRunMainBeatAnalysis}
                            disabled={isProcessing || !activeProject || !audioFile?.path}
                            className={`btn w-full mt-2 ${isProcessing || !activeProject || !audioFile?.path ? 'btn-secondary opacity-50 cursor-not-allowed' : 'btn-primary'}`}
                        >
                            {isProcessing && detectionStatus.includes("main") ? <>Analyzing Main Track...</> : <>Run Main Track Beat Analysis</>}
                        </button>
                    </div>
                </CollapsibleCard>

                <CollapsibleCard title="Beat & Onset Analysis configuration" defaultOpen={false}>
                    <div className="flex flex-col gap-4">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Beat Tracking Algorithm</label>
                            <select
                                value={algorithm}
                                onChange={(e) => setAlgorithm(e.target.value as BeatAlgorithm)}
                                className="w-full bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded p-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                            >
                                <option value="degara">Degara (Complex rhythm)</option>
                                <option value="multifeature">Multi-feature (Electronic/Dance)</option>
                            </select>
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                <input
                                    type="checkbox"
                                    checked={enableOnsets}
                                    onChange={(e) => setEnableOnsets(e.target.checked)}
                                    className="accent-[var(--accent-primary)]"
                                />
                                Extract Onsets (Granular events)
                            </label>
                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                <input
                                    type="checkbox"
                                    checked={enableLoudness}
                                    onChange={(e) => setEnableLoudness(e.target.checked)}
                                    className="accent-[var(--accent-primary)]"
                                />
                                Extract Loudness Envelopes
                            </label>
                        </div>
                        {stems.length > 0 && (
                            <div className="flex flex-col mt-2 pt-4 border-t border-[var(--border-color)]" style={{ gap: '3px' }}>
                                <label className="block text-sm text-gray-400 mb-1">Run Analysis on Generated Stems</label>
                                <button
                                    className="btn w-full btn-primary justify-center"
                                    style={{ border: '1px solid #818cf8', marginBottom: '3px' }}
                                    onClick={async () => {
                                        for (const s of stems) {
                                            await handleAnalyzeLocal(s.path, s.type);
                                        }
                                    }}
                                    disabled={isProcessing}
                                    title="Analyze All Stems"
                                >
                                    {isProcessing ? 'Analyzing...' : 'Analyze All Stems'}
                                </button>
                                <div className="flex flex-col w-full" style={{ gap: '3px' }}>
                                    {stems.map((stem, index) => (
                                        <button
                                            key={index}
                                            className="btn w-full btn-primary flex justify-center items-center gap-2"
                                            style={{ border: '1px solid #818cf8' }}
                                            onClick={() => handleAnalyzeLocal(stem.path, stem.type)}
                                            disabled={isProcessing}
                                            title={`Run Analysis on ${stem.type}`}
                                        >
                                            <span style={{ color: stem.color, fontSize: '10px' }}>⬤</span>
                                            {isProcessing ? 'Analyzing...' : `Analyze ${stem.type}`}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                        {detectionStatus && (
                            <div className="text-xs text-[var(--text-secondary)] bg-[var(--bg-elevated)] p-2 rounded">
                                Status: <span className="text-[var(--accent-primary)]">{detectionStatus}</span>
                            </div>
                        )}
                    </div>
                </CollapsibleCard>
            </div>




            {/* Controls Bar */}
            <div className="controls-bar mt-4 flex items-center gap-4 bg-[var(--bg-tertiary)] p-3 rounded border border-gray-700">
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 font-semibold uppercase">Zoom</label>
                    <div className="flex items-center gap-2">
                        <input
                            type="range"
                            min={Math.floor(minZoom)}
                            max="200"
                            value={zoomLevel}
                            onChange={(e) => setZoomLevel(Number(e.target.value))}
                            className="w-32 accent-indigo-500"
                        />
                        <button
                            className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-gray-300"
                            onClick={() => setZoomLevel(minZoom)}
                            title="Fit to Screen"
                        >
                            Fit
                        </button>
                    </div>
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 font-semibold uppercase">Main Beat Source</label>
                    <select
                        value={mainBeatSource}
                        onChange={(e) => {
                            const val = e.target.value;
                            setMainBeatSource(val === 'main' ? 'main' : Number(val));
                        }}
                        className="bg-gray-800 text-white text-sm rounded border border-gray-600 px-2 py-1 outline-none focus:border-indigo-500"
                    >
                        <option value="main">Main Track Analysis</option>
                        {stems.map((s, i) => (
                            <option key={i} value={i}>Stem: {s.type}</option>
                        ))}
                    </select>
                </div>

                <div className="flex flex-col gap-1 ml-auto">
                    <label className="text-xs text-gray-400 font-semibold uppercase text-right" title="Frames Per Second for Video Generation">Project FPS</label>
                    <input
                        type="number"
                        min="1"
                        max="60"
                        value={activeProject?.frameRate || 20}
                        onChange={(e) => {
                            if (activeProject) {
                                onUpdateProject(activeProject.id, { frameRate: Number(e.target.value) });
                            }
                        }}
                        className="bg-gray-800 text-white text-sm rounded border border-gray-600 px-2 py-1 w-20 outline-none focus:border-indigo-500 text-right"
                    />
                </div>

                <div className="text-xs text-gray-500 ml-4 flex items-end pb-1 border-l border-gray-700 pl-4 h-full">
                    {duration > 0 && `Duration: ${duration.toFixed(2)}s`}
                </div>
            </div>



            {/* Main Track Header with Play/Stop */}
            <div className="flex justify-between items-center bg-gray-900/50 p-3 rounded mt-4">
                <h4 className="text-sm font-semibold text-gray-400">Main Track</h4>
                <div className="flex gap-2 w-1/3">
                    <button
                        className="btn w-full mt-2 btn-primary flex items-center justify-center gap-1"
                        onClick={handlePlayMain}
                        disabled={!audioUrl}
                    >
                        <span className="text-lg">▶</span> Play
                    </button>
                    <button
                        className="btn w-full mt-2 btn-secondary flex items-center justify-center gap-1"
                        onClick={handlePauseMain}
                        disabled={!audioUrl}
                    >
                        <span className="text-lg">⏸</span> Pause
                    </button>
                </div>
            </div>

            <div
                className={`waveform-container mt-2 ${isStemPlaying ? 'opacity-30 grayscale' : ''}`}
                ref={containerRef}
                style={{ position: 'relative', transition: 'all 0.3s ease', minHeight: '128px' }}
            >
                {isAnalyzing && (
                    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gray-900/80 rounded backdrop-blur-sm pointer-events-none">
                        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                        <span className="text-xl font-bold text-white shadow-sm">Analyzing Audio</span>
                        <span className="text-sm font-semibold text-indigo-300 mt-2">{detectionStatus}</span>
                    </div>
                )}

                {/* Beat markers are now rendered inside WaveSurfer's wrapper via renderBeatMarkers */}
            </div>

            {/* Calculate tooltips for legend based on marker data */}
            {
                (() => {
                    const getCountData = (filterFn: (m: AudioMarker) => boolean) => {
                        const data = [
                            { label: 'Main Track', count: mainMarkers.filter(filterFn).length, color: '#fff' }
                        ];
                        stems.forEach(stem => {
                            data.push({
                                label: stem.type,
                                count: (stem.markers || []).filter(filterFn).length,
                                color: stem.color || '#fff'
                            });
                        });
                        return data;
                    };

                    const downbeatData = getCountData(m => m.type === 'beat' && !!m.isDownbeat);
                    const offbeatData = getCountData(m => m.type === 'beat' && !m.isDownbeat);
                    const onsetData = getCountData(m => m.type === 'onset');
                    const loudnessData = getCountData(m => m.type === 'loudness');

                    const renderTooltipContent = (title: string, data: { label: string, count: number, color: string }[]) => (
                        <div className="flex flex-col gap-1 p-2 border border-gray-600 rounded shadow-2xl text-xs min-w-[120px] z-[9999]" style={{ backgroundColor: '#000000', opacity: 1 }}>
                            <div className="font-bold text-gray-300 border-b border-gray-700 pb-1 mb-1">{title}</div>
                            {data.map((item, i) => (
                                <div key={i} className="flex justify-between items-center gap-4">
                                    <span className="font-bold uppercase" style={{ color: item.color }}>{item.label}</span>
                                    <span className="text-gray-300 font-mono">{item.count}</span>
                                </div>
                            ))}
                        </div>
                    );

                    const handleMouseEnter = (e: React.MouseEvent, title: string, data: any) => {
                        setTooltipState({
                            visible: true,
                            // Offset left by 128px and slightly up to prevent cursor blocking
                            x: e.clientX - 128,
                            y: e.clientY - 20,
                            content: renderTooltipContent(title, data)
                        });
                    };

                    const handleMouseMove = (e: React.MouseEvent) => {
                        if (tooltipState.visible) {
                            setTooltipState(prev => ({ ...prev, x: e.clientX - 128, y: e.clientY - 20 }));
                        }
                    };

                    const handleMouseLeave = () => setTooltipState(prev => ({ ...prev, visible: false }));

                    return stems.length > 0 && (
                        <div className="stems-list mt-8 flex flex-col gap-8">
                            {/* Marker Legend */}
                            <div style={{ display: 'flex', gap: '16px', marginBottom: '8px', padding: '6px 8px', fontSize: '12px', color: '#9ca3af', alignItems: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                                <span style={{ fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Markers:</span>
                                <div
                                    onMouseEnter={(e) => handleMouseEnter(e, "Downbeats", downbeatData)}
                                    onMouseMove={handleMouseMove}
                                    onMouseLeave={handleMouseLeave}
                                    style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'help' }}
                                >
                                    <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: MARKER_COLORS.downbeat, flexShrink: 0 }}></span>
                                    <span>Downbeat</span>
                                </div>
                                <div
                                    onMouseEnter={(e) => handleMouseEnter(e, "Offbeats", offbeatData)}
                                    onMouseMove={handleMouseMove}
                                    onMouseLeave={handleMouseLeave}
                                    style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'help' }}
                                >
                                    <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: MARKER_COLORS.offbeat, border: '1px solid #4b5563', flexShrink: 0 }}></span>
                                    <span>Offbeat</span>
                                </div>
                                <div
                                    onMouseEnter={(e) => handleMouseEnter(e, "Onsets", onsetData)}
                                    onMouseMove={handleMouseMove}
                                    onMouseLeave={handleMouseLeave}
                                    style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'help' }}
                                >
                                    <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: MARKER_COLORS.onset, flexShrink: 0 }}></span>
                                    <span>Onset</span>
                                </div>
                                <div
                                    onMouseEnter={(e) => handleMouseEnter(e, "Loudness", loudnessData)}
                                    onMouseMove={handleMouseMove}
                                    onMouseLeave={handleMouseLeave}
                                    style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'help' }}
                                >
                                    <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: MARKER_COLORS.loudness, flexShrink: 0 }}></span>
                                    <span>Loudness</span>
                                </div>
                            </div>

                            <div className="flex justify-between items-center bg-gray-900/50 p-3 rounded">
                                <h4 className="text-sm font-semibold text-gray-400">Project Stems</h4>
                                <div className="flex gap-4 w-1/2">
                                    <button
                                        className="btn w-full mt-2 btn-primary flex items-center justify-center gap-2"
                                        onClick={handlePlayStems}
                                        disabled={!audioUrl}
                                    >
                                        <span className="text-lg">▶</span> Play Stems
                                    </button>

                                    <button
                                        className="btn w-full mt-2 btn-secondary flex items-center justify-center gap-2"
                                        onClick={handlePauseAll}
                                        disabled={!audioUrl}
                                    >
                                        <span className="text-lg">⏸</span> Pause
                                    </button>
                                </div>
                            </div>

                            {stems.map((stem, index) => (
                                <div key={index} className="stem-item bg-[var(--bg-tertiary)] p-6 rounded border border-gray-800 pb-8">
                                    <div className="flex justify-between items-center mb-1">
                                        <div className="flex items-center gap-2">
                                            <div className="text-xs font-bold uppercase" style={{ color: stem.color }}>{stem.type}</div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                className="text-xs bg-indigo-600 hover:bg-indigo-500 px-2 py-0.5 rounded text-white font-bold flex items-center gap-1"
                                                onClick={() => handlePlayStem(index)}
                                                title={`Play ${stem.type}`}
                                            >
                                                ▶ Play
                                            </button>
                                            <button
                                                className="text-xs bg-yellow-600 hover:bg-yellow-500 px-2 py-0.5 rounded text-white font-bold flex items-center gap-1"
                                                onClick={() => handlePauseStem(index)}
                                                title={`Pause ${stem.type}`}
                                            >
                                                ⏸ Pause
                                            </button>
                                        </div>
                                    </div>
                                    <div
                                        id={`stem-waveform-${index}`}
                                        className="relative"
                                        style={{ width: '100%', minHeight: '90px' }}
                                    >
                                        {/* Beat markers are now rendered inside WaveSurfer's wrapper via renderBeatMarkers */}
                                    </div>
                                </div>
                            ))}
                        </div>
                    );
                })()
            }

            <div className="controls-container flex gap-4 mt-6">
                <button className="btn btn-primary" onClick={handleGenerateClipFromRegion} disabled={!activeSelection || isAnalyzing}>
                    Generate Clip from Selection
                </button>
                <button className="btn btn-secondary" onClick={handleExportManifest} disabled={clips.length === 0}>
                    Export Manifest for Resolve
                </button>
                <button
                    className="btn btn-primary bg-emerald-600 hover:bg-emerald-500 border-none text-white rounded font-bold text-sm"
                    onClick={handleSaveToProject}
                    disabled={!activeProject || clips.length === 0}
                >
                    💾 Save to Project
                </button>
            </div>

            {/* Project Timeline Table */}
            <div className="mt-8">
                {/* Selection Status — positioned just above the table */}
                {activeSelection && (
                    <div className="selection-status mb-3 p-2 bg-indigo-900/30 border border-indigo-500/50 rounded flex justify-between items-center text-sm">
                        <div>
                            <span className="text-gray-400 uppercase text-xs font-bold mr-2">Selection Source:</span>
                            <span className="text-white font-semibold">
                                {activeSelection.source === 'main' ? 'MAIN TRACK' : `STEM: ${stems[activeSelection.stemIndex!]?.type.toUpperCase()}`}
                            </span>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-gray-400 text-xs mr-2">Range:</span>
                            <span className="text-indigo-300 font-mono">
                                {activeSelection.start.toFixed(2)}s - {activeSelection.end.toFixed(2)}s
                                <span className="ml-2 text-white">({(activeSelection.end - activeSelection.start).toFixed(2)}s)</span>
                            </span>
                            <button
                                className="ml-3 bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded text-xs font-bold uppercase tracking-wide"
                                onClick={handleAddSegment}
                            >
                                + Add Segment
                            </button>
                        </div>
                    </div>
                )}
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">📋 Project Timeline</h3>
                <ProjectTimelineTable
                    clips={clips}
                    duration={duration}
                    onUpdateClipLabel={handleUpdateClipLabel}
                    onRemoveClip={handleRemoveClip}
                    onPickImage={handlePickImage}
                    onGenerateClip={handleGenerateTimelineClip}
                    onError={(msg) => onStatusChange && onStatusChange(`Table Error: ${msg}`)}
                />
            </div>

            {/* Custom Floating Tooltip */}
            {
                tooltipState.visible && tooltipState.content && (
                    <div
                        style={{
                            position: 'fixed',
                            left: tooltipState.x,
                            top: tooltipState.y,
                            zIndex: 9999,
                            pointerEvents: 'none'
                        }}
                    >
                        {tooltipState.content}
                    </div>
                )
            }

            {/* LTX Test Module Integration */}
            <div className="mt-8">
                <CollapsibleCard title="🧪 LTX-Video 2.0 Generator Test" defaultOpen={false}>
                    <LtxTestModule />
                </CollapsibleCard>
            </div>

        </div >
    );
};

export default MusicVideoAssemblerModule;
