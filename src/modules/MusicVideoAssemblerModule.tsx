const { ipcRenderer } = window.require('electron');
import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { analyzeBeats, analyzeOnsets, analyzeLoudness, type BeatAlgorithm, initEssentia } from '../services/essentiaService';

import DropZone from '../components/DropZone';
import ProjectsPanel from '../components/ProjectsPanel';
import { checkComfyConnection, queuePrompt, uploadFileToComfyUI, convertAudioForComfyUI, waitForPromptWebSocket } from '../services/comfyService';
import workflowJsonTemplate from '../../comfyui_workflows/video_ltx2_i2v.json';
import { getValidLtxFrameCount, getLtxAlignedDuration } from '../utils/timelineUtils';
import type { BeatProject, ProjectMarker } from '../hooks/useProjectStorage';
import ProjectTimelineTable from '../components/ProjectTimelineTable';
import CollapsibleCard from '../components/CollapsibleCard';
import VideoTimelineBar from '../components/VideoTimelineBar';

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
    onCreateBlankProject: (name?: string) => Promise<BeatProject>;
    onUpdateProject: (id: string, updates: Partial<BeatProject>) => void;
    onDeleteProject: (id: string) => void;
    onRefreshProjects: () => void;
    onStatusChange?: (msg: string) => void;
    panelVisibility?: {
        showMainTrack: boolean;
        showStems: boolean;
        showVideo: boolean;
        showVideoSource: boolean;
        showAudioSource: boolean;
        showProjectSelection: boolean;
        showAudioAnalysis: boolean;
    };
    onToggleVisibility?: (key: string) => void;
}

import type { VideoClip, SelectionState, AudioMarker, StemData, VideoInfo, VideoThumbnail } from '../types/assembler';
import {
    MARKER_COLORS,
    STEM_COLORS,
    DEFAULT_STEM_COLOR,
    hexToRgba,
    adjustColorBrightness,
    formatTime,
    getStemTheme,
    createSilentAudioBlob
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
    onCreateBlankProject,
    onDeleteProject,
    onUpdateProject,
    onRefreshProjects,
    onStatusChange,
    panelVisibility,
    onToggleVisibility
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
    const lastProjectIdRef = useRef<string | null>(null);
    const stemRafRef = useRef<number | null>(null);

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

    // Video Timeline State
    const [videoFile, setVideoFile] = useState<{ path: string; info: VideoInfo } | null>(null);
    const [videoThumbnails, setVideoThumbnails] = useState<VideoThumbnail[]>([]);

    // Zoom & Beat Source Controls
    const [zoomLevel, setZoomLevel] = useState(50); // minPxPerSec
    const [minZoom, setMinZoom] = useState(1);
    const [mainBeatSource, setMainBeatSource] = useState<'main' | number>('main'); // 'main' or index of stem
    const [waveSurfersReady, setWaveSurfersReady] = useState(0); // Trigger for re-rendering regions

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
        if (activeProject) {
            loadProjectAudio(activeProject);

            // Auto defaults for older projects without frameRate
            if (!activeProject.frameRate) {
                onUpdateProject(activeProject.id, { frameRate: 20 });
            }
        } else if (!activeProject) {
            lastProjectIdRef.current = null;
            setClips([]);
            setDuration(0);
            setAudioUrl(null);
            setStems([]);
        }
    }, [
        activeProject?.id,
        activeProject?.markers?.length,
        activeProject?.stems?.length,
        activeProject?.clips?.length
    ]);
    
    // REDRAW FIX: Force redraw when panels are expanded
    // Wait for the 300ms transition to complete before triggering redraw
    useEffect(() => {
        if (panelVisibility?.showMainTrack && wavesurfer.current) {
            setTimeout(() => {
                wavesurfer.current?.zoom(zoomLevel);
                // Also trigger a window resize event to force WaveSurfer to recalculate layout
                window.dispatchEvent(new Event('resize'));
            }, 400);
        }
    }, [panelVisibility?.showMainTrack, zoomLevel]);

    useEffect(() => {
        if (panelVisibility?.showStems && stemSurfers.current.length > 0) {
            setTimeout(() => {
                stemSurfers.current.forEach(s => s.zoom(zoomLevel));
                window.dispatchEvent(new Event('resize'));
            }, 400);
        }
    }, [panelVisibility?.showStems, zoomLevel]);


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

    // --- Video Drop Handler ---
    const handleVideoDrop = async (files: File[]) => {
        if (files.length === 0) return;
        const file = files[0];
        const pathStr = (file as any).path;

        if (!pathStr) {
            if (onStatusChange) onStatusChange('Error: Could not read video file path.');
            return;
        }

        if (onStatusChange) onStatusChange(`Loading video: ${file.name}...`);

        try {
            // Get video metadata via ffprobe
            const infoResult = await ipcRenderer.invoke('get-video-info', pathStr);
            if (!infoResult.success) {
                if (onStatusChange) onStatusChange(`Video info error: ${infoResult.error}`);
                return;
            }

            const info: VideoInfo = infoResult.info;
            setVideoFile({ path: pathStr, info });

            // Save video path to project
            if (activeProject) {
                onUpdateProject(activeProject.id, {
                    videoPath: pathStr,
                    videoDuration: info.duration,
                    videoFps: info.fps,
                });
            }

            if (onStatusChange) onStatusChange(`Video loaded: ${info.width}×${info.height}, ${info.duration.toFixed(1)}s, ${info.fps}fps`);

            // Extract thumbnails for filmstrip (3fps default)
            if (activeProject?.outputDir) {
                if (onStatusChange) onStatusChange('Extracting video thumbnails...');
                const thumbResult = await ipcRenderer.invoke('extract-video-thumbnails', {
                    filePath: pathStr,
                    outputDir: activeProject.outputDir,
                    fps: 3,
                });
                if (thumbResult.success && thumbResult.thumbnails) {
                    setVideoThumbnails(thumbResult.thumbnails);
                    if (onStatusChange) onStatusChange(`Video ready: ${thumbResult.thumbnails.length} thumbnails extracted`);
                } else {
                    if (onStatusChange) onStatusChange(`Thumbnail extraction failed: ${thumbResult.error}`);
                }
            }
        } catch (err: any) {
            console.error('Video drop error:', err);
            if (onStatusChange) onStatusChange(`Video error: ${err.message}`);
        }
    };

    // --- Save Full-Resolution Video Frame ---
    const handleSaveVideoFrame = async (time: number) => {
        if (!videoFile || !activeProject?.outputDir) {
            if (onStatusChange) onStatusChange('No video loaded or no project selected.');
            return;
        }

        if (onStatusChange) onStatusChange(`Saving frame at ${time.toFixed(3)}s...`);
        try {
            const result = await ipcRenderer.invoke('save-video-frame', {
                filePath: videoFile.path,
                time,
                outputDir: activeProject.outputDir,
            });
            if (result.success) {
                if (onStatusChange) onStatusChange(`Frame saved: ${result.framePath}`);
            } else {
                if (onStatusChange) onStatusChange(`Frame save error: ${result.error}`);
            }
        } catch (err: any) {
            if (onStatusChange) onStatusChange(`Frame save error: ${err.message}`);
        }
    };

    // --- Core Logic: Run & Poll ---
    const handleRunSeparation = async () => {
        if (!comfyConnected || !workflow || !audioFile?.path || !outputDir) {
            if (onStatusChange) onStatusChange('Missing setup (Audio, Workflow, or Output Folder)');
            return;
        }

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

            // Convert to WAV first so ComfyUI's PyAV decoder can read it reliably
            if (onStatusChange) onStatusChange('Converting audio to WAV...');
            const wavPath = await convertAudioForComfyUI(audioFile.path);
            const uploadPath = wavPath ?? audioFile.path;
            if (!wavPath) {
                if (onStatusChange) onStatusChange('ffmpeg not found — uploading original file (may fail)...');
            }

            // Upload the audio file to ComfyUI's input directory so LoadAudio can access it
            if (onStatusChange) onStatusChange('Uploading audio to ComfyUI...');
            const uploaded = await uploadFileToComfyUI(uploadPath);
            if (!uploaded) {
                throw new Error('Failed to upload audio file to ComfyUI. Check that ComfyUI is running and accessible.');
            }
            if (onStatusChange) onStatusChange(`Audio uploaded: ${uploaded.name}`);

            // @ts-ignore
            prompt[loadNodeKey].inputs.audio = uploaded.name;

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
                url: `media://${f.path.replace(/\\/g, '/')}`,
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
        return waitForPromptWebSocket(
            promptId,
            workflow,
            (status) => {
                if (onStatusChange) onStatusChange(status);
            }
        );
    };

    const moveFilesToProject = async (targetDir: string, _startTime: number, runPrefix: string) => {
        // @ts-ignore
        const fs = window.require('fs');
        // @ts-ignore
        const path = window.require('path');

        const stemsDir = path.join(targetDir, 'stems');
        if (!fs.existsSync(stemsDir)) {
            fs.mkdirSync(stemsDir, { recursive: true });
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
                    const destPath = path.join(stemsDir, destFilename);

                    fs.copyFileSync(latest.path, destPath);
                    console.log(`Found & Moved: ${latest.path} -> ${destPath}`);
                    movedStems.push({ type, path: `./stems/${destFilename}` });
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
        // Resolve relative paths (like ./stems/...) against project output directory
        let finalPath = path;
        try {
            // @ts-ignore
            const pathModule = window.require ? window.require('path') : null;
            if (pathModule && !pathModule.isAbsolute(path)) {
                // Determine best base directory
                const baseDir = activeProject?.outputDir || outputDir || '';
                if (baseDir) {
                    finalPath = pathModule.resolve(baseDir, path);
                    console.log(`[handleAnalyzeLocal] Resolved ${path} -> ${finalPath}`);
                }
            }
        } catch (e) {
            console.error("[handleAnalyzeLocal] Path resolution error:", e);
        }
        await runBeatAnalysis(finalPath, type);
    };

    const loadProjectAudio = async (project: BeatProject) => {
        console.log("[loadProjectAudio] Loading project:", project.name, project.id);

        // Track updates needed for the project
        let stemsUpdated = false;
        let newStems = project.stems ? [...project.stems] : [];

        // Determine if we need to reload the audio files (heavy operation)
        const isNewProject = lastProjectIdRef.current !== project.id;
        lastProjectIdRef.current = project.id;

        if (onStatusChange && isNewProject) onStatusChange(`Loading project audio: ${project.audioFileName}`);

        // Always sync basic metadata
        setClips(project.clips || []);

        try {
            // @ts-ignore
            const fs = window.require('fs');

            // 1. Audio Setup (Only if project changed)
            if (isNewProject) {
                setIsAnalyzing(true);
                setDuration(0);
                setStems([]);
                setMainMarkers([]);

                if (project.audioPath) {
                    // @ts-ignore
                    const pathModule = window.require('path');
                    const absoluteAudioPath = pathModule.resolve(project.outputDir || '', project.audioPath);

                    const buffer = fs.readFileSync(absoluteAudioPath);
                    const blob = new Blob([buffer], { type: 'audio/mpeg' });
                    const url = URL.createObjectURL(blob);

                    setAudioUrl(url);
                    setAudioFile({ name: project.audioFileName || 'Unknown', path: absoluteAudioPath }); // Keep absolute in state for FFmpeg
                } else {
                    // Generate a silent audio blob so WaveSurfer can initialize and allow timeline selection
                    const blankDuration = 60 * 5; // 5 minutes
                    const silentBlob = createSilentAudioBlob(blankDuration);
                    const url = URL.createObjectURL(silentBlob);

                    setAudioUrl(url);
                    setAudioFile(null);
                    setDuration(blankDuration);
                }

                if (project.outputDir) setOutputDir(project.outputDir);
            }

            // 2. Load Stems & Analyze their beats
            let loadedStems: StemData[] = [];
            if (newStems.length > 0) {
                // Deduplicate stems by path to prevent visual duplication on load
                const uniqueStems = newStems.filter((s, index, self) =>
                    index === self.findIndex((t) => t.path === s.path)
                );

                for (let i = 0; i < uniqueStems.length; i++) {
                    const stem = uniqueStems[i];

                    // Optimization: Reuse existing URL if available
                    const existingStem = stems.find(s => s.path === stem.path);
                    let finalUrl = existingStem?.url;

                    try {
                        if (!finalUrl) {
                            // @ts-ignore
                            const pathModule = window.require('path');
                            const absoluteStemPath = pathModule.resolve(project.outputDir || '', stem.path);
                            const sBuffer = fs.readFileSync(absoluteStemPath);
                            const sBlob = new Blob([sBuffer], { type: 'audio/mpeg' });
                            finalUrl = URL.createObjectURL(sBlob);
                        }

                        const projectMarkers = project.markers || [];
                        const stemProjectMarkers = projectMarkers.filter(m => m.note === stem.type);

                        // Fallback to stem.markers if the global filter finds nothing (backwards compatibility)
                        const markersToUse = stemProjectMarkers.length > 0 ? stemProjectMarkers : (stem.markers || []);
                        const stemColor = stem.color || STEM_COLORS[stem.type.toLowerCase()] || DEFAULT_STEM_COLOR;

                        let finalAudioMarkers: AudioMarker[] = [];

                        // 1. Try modern ProjectMarkers array
                        if (markersToUse && markersToUse.length > 0) {
                            let beatIndex = 0;
                            finalAudioMarkers = markersToUse.map(m => {
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
                            url: finalUrl as string,
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
            const projectMarkersForMain = project.markers || [];
            const mainProjectMarkers = projectMarkersForMain.filter(m => !m.note || m.note === '');

            if (mainProjectMarkers.length > 0) {
                const audioMarkers: AudioMarker[] = mainProjectMarkers.map(m => {
                    return {
                        time: m.timestamp,
                        type: m.type,
                        isDownbeat: m.color === MARKER_COLORS.downbeat,
                        color: m.color
                    };
                });
                setMainMarkers(audioMarkers);
            } else {
                setMainMarkers([]);
            }

            if (onStatusChange) onStatusChange("Ready.");
            // 4. Load Clips
            if (project.clips) {
                setClips(project.clips);
            } else {
                setClips([]);
            }

            // 5. Restore Video Timeline State
            if (project.videoPath && isNewProject) {
                try {
                    const infoResult = await ipcRenderer.invoke('get-video-info', project.videoPath);
                    if (infoResult.success) {
                        setVideoFile({ path: project.videoPath, info: infoResult.info });

                        // Check for existing thumbnails
                        if (project.outputDir) {
                            const pathModule = window.require('path');
                            const thumbDir = pathModule.join(project.outputDir, 'thumbnails');
                            if (fs.existsSync(thumbDir)) {
                                const files = fs.readdirSync(thumbDir)
                                    .filter((f: string) => f.startsWith('thumb_') && f.endsWith('.jpg'))
                                    .sort();
                                if (files.length > 0) {
                                    const thumbs: VideoThumbnail[] = files.map((f: string, i: number) => ({
                                        path: pathModule.join(thumbDir, f),
                                        time: i / 3, // Assumes 3fps extraction
                                    }));
                                    setVideoThumbnails(thumbs);
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn('[loadProjectAudio] Failed to restore video state:', e);
                }
            } else if (!project.videoPath && isNewProject) {
                setVideoFile(null);
                setVideoThumbnails([]);
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
                    color: m.color || (m.isDownbeat ? MARKER_COLORS.downbeat : MARKER_COLORS.offbeat),
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
                let absoluteImagePath = clipToUpdate.startImagePath;
                // Remove file:/// protocol if present
                absoluteImagePath = absoluteImagePath.replace(/^file:\/\/\/?/i, '');
                absoluteImagePath = decodeURI(absoluteImagePath);

                const path = window.require('path');
                const fs = window.require('fs');

                if (!path.isAbsolute(absoluteImagePath)) {
                    const targetDir = activeProject.outputDir || outputDir || '';
                    const possiblePathImages = path.resolve(targetDir, 'images', absoluteImagePath);
                    const possiblePathRoot = path.resolve(targetDir, absoluteImagePath);

                    if (targetDir && fs.existsSync(possiblePathImages)) {
                        absoluteImagePath = possiblePathImages;
                    } else if (targetDir && fs.existsSync(possiblePathRoot)) {
                        absoluteImagePath = possiblePathRoot;
                    } else if (targetDir) {
                        absoluteImagePath = possiblePathImages; // Default guess for error message
                    }
                }

                console.log(`[handleGenerateTimelineClip] Resolving start image to: ${absoluteImagePath}`);

                if (!fs.existsSync(absoluteImagePath)) {
                    throw new Error(`Start image not found at: ${absoluteImagePath}. Please select the image again.`);
                }

                const uploadResult = await uploadFileToComfyUI(absoluteImagePath);
                if (uploadResult && uploadResult.name) {
                    finalImageName = uploadResult.name;
                } else {
                    throw new Error(`Failed to upload start image from ${absoluteImagePath} to ComfyUI.`);
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
                let absoluteAudioPath = sourceAudioPath;
                // Remove file:/// protocol if present
                absoluteAudioPath = absoluteAudioPath.replace(/^file:\/\/\/?/i, '');
                absoluteAudioPath = decodeURI(absoluteAudioPath);

                const path = window.require('path');
                const fs = window.require('fs');

                if (!path.isAbsolute(absoluteAudioPath)) {
                    const targetDir = activeProject.outputDir || outputDir || '';
                    if (targetDir) {
                        absoluteAudioPath = path.resolve(targetDir, absoluteAudioPath);
                    }
                }

                console.log(`[handleGenerateTimelineClip] Resolving audio to: ${absoluteAudioPath}`);

                if (!fs.existsSync(absoluteAudioPath)) {
                    throw new Error(`Audio file not found at: ${absoluteAudioPath}.`);
                }

                const uploadResult = await uploadFileToComfyUI(absoluteAudioPath);
                if (uploadResult && uploadResult.name) {
                    finalAudioName = uploadResult.name;
                } else {
                    throw new Error(`Failed to upload audio from ${absoluteAudioPath} to ComfyUI.`);
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

            // b. Prompt (Use clip notes.action, fallback to label)
            if (workflow["92:3"] && workflow["92:3"].inputs) {
                const promptVal = (clipToUpdate.notes?.action && clipToUpdate.notes.action.trim() !== '')
                    ? clipToUpdate.notes.action
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

            const fs = window.require('fs');
            const path = window.require('path');

            let finalVideoPath = "";
            let latestSourcePath = "";

            // Check the video subdirectory first (where ComfyUI usually puts prefix video/LTX_2.0_i2v)
            const videoOutDir = path.join(comfyOutputDir, 'video');
            if (fs.existsSync(videoOutDir)) {
                const outFiles = fs.readdirSync(videoOutDir).filter((f: string) => f.includes('LTX_2.0_i2v') && f.endsWith('.mp4'));
                if (outFiles.length > 0) {
                    const latest = outFiles.sort((a: string, b: string) => fs.statSync(path.join(videoOutDir, b)).mtimeMs - fs.statSync(path.join(videoOutDir, a)).mtimeMs)[0];
                    latestSourcePath = path.join(videoOutDir, latest);
                }
            }

            // Fallback to the root output directory
            if (!latestSourcePath && fs.existsSync(comfyOutputDir)) {
                const outFiles = fs.readdirSync(comfyOutputDir).filter((f: string) => f.includes('LTX_2.0_i2v') && f.endsWith('.mp4'));
                if (outFiles.length > 0) {
                    const latest = outFiles.sort((a: string, b: string) => fs.statSync(path.join(comfyOutputDir, b)).mtimeMs - fs.statSync(path.join(comfyOutputDir, a)).mtimeMs)[0];
                    latestSourcePath = path.join(comfyOutputDir, latest);
                }
            }

            if (latestSourcePath) {
                // Determine destination directory
                const destVideosDir = path.join(targetDir, 'videos');
                if (!fs.existsSync(destVideosDir)) fs.mkdirSync(destVideosDir, { recursive: true });

                const existingTakes = clipToUpdate.generatedVideos ? clipToUpdate.generatedVideos.length : 0;
                const safeLabel = clipToUpdate.label.replace(/[^a-z0-9]/gi, '_');
                const destFilename = `${safeLabel}_take${existingTakes + 1}.mp4`;
                const destPath = path.join(destVideosDir, destFilename);

                fs.copyFileSync(latestSourcePath, destPath);
                finalVideoPath = destPath;
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
            
            // Sync duration to project storage if it has changed
            if (activeProject && activeProject.duration !== dur) {
                onUpdateProject(activeProject.id, { duration: dur });
            }

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

            // Trigger region render
            setWaveSurfersReady(prev => prev + 1);
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

            let newStart = region.start;
            
            // Stage 1: Snap START to the nearest beat marker (if within threshold)
            if (currentMarkers.length > 0) {
                const snapToBeat = (time: number) => {
                    const snapPoints = [{ time: 0 }, ...currentMarkers, { time: ws.getDuration() }];
                    const closest = snapPoints.reduce((prev, curr) =>
                        Math.abs(curr.time - time) < Math.abs(prev.time - time) ? curr : prev
                    );
                    return closest.time;
                };
                const snappedStart = snapToBeat(region.start);
                const SNAP_THRESHOLD_PX = 10;
                const snapThresholdSecs = SNAP_THRESHOLD_PX / zoomLevel;
                if (Math.abs(region.start - snappedStart) <= snapThresholdSecs) {
                    newStart = snappedStart;
                }
            }

            // Stage 2: Calculate LTX-aligned duration and set END relative to newStart
            const fps = activeProject?.frameRate || 24;
            const rawDuration = Math.max(0.1, region.end - newStart);
            const alignedDuration = getLtxAlignedDuration(rawDuration, fps);
            const newEnd = newStart + alignedDuration;

            if (newStart !== region.start || Math.abs(newEnd - region.end) > 0.001) {
                region.setOptions({
                    start: newStart,
                    end: newEnd
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
        let isActive = true;

        if (stemRafRef.current) {
            cancelAnimationFrame(stemRafRef.current);
            stemRafRef.current = null;
        }

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

        // We no longer clear all stems on every render.
        // Re-initialization only happens when paths actually change.

        if (stems.length === 0) return;

        // Use requestAnimationFrame to ensure the DOM has updated and containers are available
        stemRafRef.current = requestAnimationFrame(() => {
            if (!isActive) return;

            stems.forEach((stem, index) => {
                const containerId = `stem-waveform-${index}`;
                const container = document.getElementById(containerId);
                if (container) {
                    // Fix: shadowRoot is a property, not a selector. 
                    // Also check for the WaveSurfer-specific class to be sure.
                    if (container.shadowRoot || container.querySelector('shadow-root') || container.innerHTML.includes('wavesurfer')) {
                        console.warn(`Container ${containerId} already occupied, skipping init.`);
                        return;
                    }

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
                        
                        let newStart = region.start;
                        const stemMarkers = stem.markers || [];

                        // Stage 1: Snap START to Stem's OWN beats
                        if (stemMarkers.length > 0) {
                            const snapToBeat = (time: number) => {
                                const snapPoints = [{ time: 0 }, ...stemMarkers, { time: wavesurfer.current?.getDuration() || 0 }];
                                const closest = snapPoints.reduce((prev, curr) =>
                                    Math.abs(curr.time - time) < Math.abs(prev.time - time) ? curr : prev
                                );
                                return closest.time;
                            };
                            const snappedStart = snapToBeat(region.start);
                            const SNAP_THRESHOLD_PX = 10;
                            const snapThresholdSecs = SNAP_THRESHOLD_PX / zoomLevel;
                            if (Math.abs(region.start - snappedStart) <= snapThresholdSecs) {
                                newStart = snappedStart;
                            }
                        }

                        // Stage 2: Calculate LTX-aligned duration and set END relative to newStart
                        const fps = activeProject?.frameRate || 24;
                        const rawDuration = Math.max(0.1, region.end - newStart);
                        const alignedDuration = getLtxAlignedDuration(rawDuration, fps);
                        const newEnd = newStart + alignedDuration;

                        if (newStart !== region.start || Math.abs(newEnd - region.end) > 0.001) {
                            region.setOptions({
                                start: newStart,
                                end: newEnd
                            });
                        }

                        setActiveSelection({
                            source: 'stem',
                            stemIndex: index,
                            start: region.start,
                            end: region.end
                        });
                    };

                    stemRegions.on('region-created', handleStemRegionUpdate);
                    stemRegions.on('region-updated', handleStemRegionUpdate);

                    ws.on('ready', () => {
                        ws.zoom(zoomLevel);
                        const durToUse = duration || wavesurfer.current?.getDuration() || 0;
                        if (stem.markers && stem.markers.length > 0 && durToUse > 0) {
                            renderBeatMarkers(ws, stem.markers, durToUse);
                        }

                        // Trigger region render
                        setWaveSurfersReady(prev => prev + 1);
                    });

                    stemSurfers.current.push(ws);
                } else {
                    console.error(`Container ${containerId} not found when initializing stem WaveSurfer.`);
                }
            });
        });


        return () => {
            isActive = false;
            cleanupStems();
            if (stemRafRef.current) {
                cancelAnimationFrame(stemRafRef.current);
                stemRafRef.current = null;
            }
        };
    }, [stems.map(s => s.path + s.type).join(',')]);

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

        // Snap duration UP to the nearest valid LTX frame boundary
        const rawDuration = end - start;
        const fps = activeProject?.frameRate || 20;
        const alignedDuration = getLtxAlignedDuration(rawDuration, fps);
        const alignedEnd = start + alignedDuration;

        const track = (clips.length % 2) + 1;

        const newClip: VideoClip = {
            id: Date.now().toString(),
            startTime: start,
            endTime: alignedEnd,
            duration: alignedDuration,
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

        const frames = getValidLtxFrameCount(rawDuration, fps);
        if (onStatusChange) onStatusChange(`Segment added: ${formatTime(start)} – ${formatTime(alignedEnd)} (${frames} frames @ ${fps}fps, ${alignedDuration.toFixed(2)}s)`);
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

            // Build the full set of project stems (with current marker data) for saving
            const projectStemsToSave = stems.map(s => ({
                type: s.type,
                path: s.path,
                color: s.color,
                beats: s.markers
                    ? s.markers.filter(m => m.type === 'beat').map(m => m.time)
                    : [],
                markers: s.markers
                    ? s.markers.map(m => ({
                        timestamp: m.time,
                        frame: Math.round(m.time * (activeProject.frameRate || 20)),
                        color: m.color || '#ffffff',
                        note: s.type,
                        type: m.type as 'beat' | 'onset' | 'loudness',
                        duration_sec: 0
                    }))
                    : []
            }));

            // Build main markers from current mainMarkers state
            const mainMarkersToSave = mainMarkers.map(m => ({
                timestamp: m.time,
                frame: Math.round(m.time * (activeProject.frameRate || 20)),
                color: m.color || (m.isDownbeat ? MARKER_COLORS.downbeat : MARKER_COLORS.offbeat),
                note: '',
                type: m.type as 'beat' | 'onset' | 'loudness',
                duration_sec: 0
            }));

            // Update project with all available data
            const beatOnlyMarkers = mainMarkers.filter(m => m.type === 'beat');
            onUpdateProject(activeProject.id, {
                clips,
                outputDir: baseOutputDir,
                markers: mainMarkersToSave,
                stems: projectStemsToSave,
                frameRate: activeProject.frameRate || 20,
                algorithm: algorithm,
                beatCount: beatOnlyMarkers.length || undefined,
                bpm: beatOnlyMarkers.length > 1
                    ? Math.round(60 / ((beatOnlyMarkers[beatOnlyMarkers.length - 1].time - beatOnlyMarkers[0].time) / (beatOnlyMarkers.length - 1)))
                    : activeProject.bpm,
            });
            if (onStatusChange) onStatusChange(`Project saved ✓  →  ${baseOutputDir}`);
        } catch (e) {
            console.error('Save failed:', e);
            if (onStatusChange) onStatusChange('Error saving project.');
        }
    };

    // Image picker for start/end images
    const handlePickImage = async (clipId: string, field: 'startImagePath' | 'endImagePath') => {
        if (!activeProject?.outputDir) {
            if (onStatusChange) onStatusChange('No project folder available. Save the project first.');
            return;
        }

        const path = window.require('path');
        const imagesDir = path.join(activeProject.outputDir, 'images');

        const filePath = await ipcRenderer.invoke('open-image-dialog', imagesDir);

        if (filePath) {
            setClips(prev => prev.map(c => c.id === clipId ? { ...c, [field]: filePath } : c));
        }
    };

    const handleUpdateClipLabel = (clipId: string, newLabel: string) => {
        setClips(prev => prev.map(c => c.id === clipId ? { ...c, label: newLabel } : c));
    };

    const handleUpdateClipPrompt = (clipId: string, newPrompt: string) => {
        setClips(prev => prev.map(c => 
            c.id === clipId 
                ? { ...c, notes: { ...(c.notes || { action: '', dialogue: '', sound: '' }), action: newPrompt } } 
                : c
        ));
    };

    const handleUpdateClipStartTime = (clipId: string, newStartTime: number) => {
        setClips(prev => prev.map(c => {
            if (c.id === clipId) {
                // Moving start time shifts the whole clip (maintains current duration)
                const duration = c.duration || (c.endTime - c.startTime);
                return { 
                    ...c, 
                    startTime: newStartTime, 
                    endTime: newStartTime + duration,
                    duration: duration
                };
            }
            return c;
        }));
    };

    const handleUpdateClipEndTime = (clipId: string, newEndTime: number) => {
        const frameRate = activeProject?.frameRate || 20;
        setClips(prev => prev.map(c => {
            if (c.id === clipId) {
                // Moving end time changes duration - snap to LTX frame boundary
                if (newEndTime <= c.startTime) return c;
                const rawDuration = newEndTime - c.startTime;
                const alignedDuration = getLtxAlignedDuration(rawDuration, frameRate);
                
                return { 
                    ...c, 
                    endTime: c.startTime + alignedDuration, 
                    duration: alignedDuration 
                };
            }
            return c;
        }));
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
        const timer = setTimeout(renderSavedRegions, 250);
        return () => clearTimeout(timer);
    }, [clips, stems, duration, waveSurfersReady]);

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
            notes: {
                action: "A cool music video scene, dynamic lighting, 4k",
                dialogue: "",
                sound: ""
            },
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

    const handleExportMarkers = async () => {
        if (!activeProject) {
            if (onStatusChange) onStatusChange('No project selected.');
            return;
        }

        // Collect all markers: main track + all stems
        const allMarkers: any[] = [];

        // Main Track Markers
        mainMarkers.forEach(m => {
            allMarkers.push({
                time: m.time,
                timestamp: m.time, // stage-for-resolve expects timestamp
                frame: Math.round(m.time * (activeProject.frameRate || 24)),
                type: m.type,
                color: m.color || (m.isDownbeat ? '#ff0000' : '#ffff00'),
                note: m.isDownbeat ? 'DOWNBEAT' : 'BEAT',
                duration_sec: 0
            });
        });

        // Stem Markers
        stems.forEach(s => {
            if (s.markers) {
                s.markers.forEach(m => {
                    allMarkers.push({
                        time: m.time,
                        timestamp: m.time,
                        frame: Math.round(m.time * (activeProject.frameRate || 24)),
                        type: m.type,
                        color: s.color || '#00ff00',
                        note: `${s.type.toUpperCase()}: ${m.type}`,
                        duration_sec: 0
                    });
                });
            }
        });

        if (allMarkers.length === 0) {
            if (onStatusChange) onStatusChange('No markers found to export.');
            return;
        }

        // @ts-ignore
        const ipcRenderer = window.require ? window.require('electron').ipcRenderer : window.ipcRenderer;
        const path = window.require('path');

        // Resolve audio path to absolute
        let resolvedAudioPath = activeProject.audioPath || (audioFile as any)?.path;
        if (resolvedAudioPath && !path.isAbsolute(resolvedAudioPath) && activeProject.outputDir) {
            resolvedAudioPath = path.resolve(activeProject.outputDir, resolvedAudioPath);
        }

        const exportData = {
            projectName: activeProject.name || 'Untitled Project',
            audioPath: resolvedAudioPath,
            csvPath: '', // Embedded in script
            markers: allMarkers
        };

        if (onStatusChange) onStatusChange('Generating Resolve Markers script...');
        const result = await ipcRenderer.invoke('stage-for-resolve', exportData);

        if (result.success) {
            if (onStatusChange) onStatusChange(`Markers script generated: ${result.scriptPath}`);
        } else {
            if (onStatusChange) onStatusChange(`Marker export failed: ${result.error}`);
        }
    };

    const handleExportMediaOnly = async () => {
        if (!activeProject || !audioFile?.path) {
            if (onStatusChange) onStatusChange('No project or audio file selected.');
            return;
        }

        // @ts-ignore
        const ipcRenderer = window.require ? window.require('electron').ipcRenderer : window.ipcRenderer;
        const path = window.require('path');

        // Resolve paths to absolute
        let resolvedAudioPath = activeProject.audioPath || (audioFile as any)?.path;
        if (resolvedAudioPath && !path.isAbsolute(resolvedAudioPath) && activeProject.outputDir) {
            resolvedAudioPath = path.resolve(activeProject.outputDir, resolvedAudioPath);
        }

        const videoPaths = clips
            .filter(c => c.videoPath)
            .map(c => {
                let vp = c.videoPath!;
                if (!path.isAbsolute(vp) && activeProject.outputDir) {
                    vp = path.resolve(activeProject.outputDir, vp);
                }
                return vp;
            });

        const exportData = {
            projectName: activeProject.name,
            audioPath: resolvedAudioPath,
            videoPaths,
            beats: [] // No beats needed for pure import
        };

        if (onStatusChange) onStatusChange('Generating Resolve Load Media script...');
        const result = await ipcRenderer.invoke('stage-video-sync', exportData);

        if (result.success) {
            if (onStatusChange) onStatusChange(`Load Media script generated: ${result.scriptPath}`);
        } else {
            if (onStatusChange) onStatusChange(`Load Media export failed: ${result.error}`);
        }
    };

    const handleExportManifest = async () => {
        if (!activeProject) {
            if (onStatusChange) onStatusChange('No project selected.');
            return;
        }

        const projectClips = clips.filter(c => c.videoPath);
        if (projectClips.length === 0) {
            if (onStatusChange) onStatusChange('No generated clips found in the timeline.');
            return;
        }

        // @ts-ignore
        const ipcRenderer = window.require ? window.require('electron').ipcRenderer : window.ipcRenderer;
        const path = window.require('path');

        // Resolve paths to absolute
        let resolvedAudioPath = activeProject.audioPath || (audioFile as any)?.path;
        if (resolvedAudioPath && !path.isAbsolute(resolvedAudioPath) && activeProject.outputDir) {
            resolvedAudioPath = path.resolve(activeProject.outputDir, resolvedAudioPath);
        }

        const resolvedClips = projectClips.map(clip => {
            let vp = clip.videoPath!;
            if (!path.isAbsolute(vp) && activeProject.outputDir) {
                vp = path.resolve(activeProject.outputDir, vp);
            }
            return {
                ...clip,
                videoPath: vp,
                path: vp // Ensure both keys are consistent for the handler
            };
        });

        // Prepare data for reconstruction script
        const exportData = {
            projectName: activeProject.name || 'Untitled Project',
            audioPath: resolvedAudioPath,
            frameRate: activeProject.frameRate || 24,
            clips: resolvedClips
        };

        if (onStatusChange) onStatusChange('Generating Resolve export script...');

        const result = await ipcRenderer.invoke('stage-timeline-to-resolve', exportData);

        if (result.success) {
            if (onStatusChange) onStatusChange(`Resolve script generated: ${result.scriptPath}`);
            // Optionally open the folder
        } else {
            console.error('Export failed:', result.error);
            if (onStatusChange) onStatusChange(`Export failed: ${result.error}`);
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
            <CollapsibleCard
                title="Load Audio Source"
                className="mt-4"
                isOpen={panelVisibility?.showAudioSource}
                onToggle={() => onToggleVisibility?.('showAudioSource')}
            >
                <DropZone
                    onFilesDropped={handleAudioDrop}
                    accept="audio/*"
                    label="Drop Audio File Here: Selected File"
                    defaultAudioPath={audioFile?.path || undefined}
                />
            </CollapsibleCard>

            <CollapsibleCard
                title="Load Video Source"
                className="mt-4"
                isOpen={panelVisibility?.showVideoSource}
                onToggle={() => onToggleVisibility?.('showVideoSource')}
            >
                <DropZone
                    onFilesDropped={handleVideoDrop}
                    accept="video/*"
                    label="Drop Video File Here (MP4, MOV, AVI, MKV)"
                />
            </CollapsibleCard>

            <CollapsibleCard
                title="Select Project"
                className="mt-4"
                isOpen={panelVisibility?.showProjectSelection}
                onToggle={() => onToggleVisibility?.('showProjectSelection')}
            >
                <ProjectsPanel
                    projects={projects}
                    onLoad={(p) => onSelectProject(p.id)}
                    onDelete={onDeleteProject}
                    onRefresh={onRefreshProjects}
                    currentProjectId={activeProject?.id}
                    onCreateBlankProject={onCreateBlankProject}
                />
            </CollapsibleCard>

            {/* Consolidated Audio Analysis & Stem Generation */}
            <div className="mt-4">
                <CollapsibleCard
                    title="Audio Analysis & Stem Generation"
                    isOpen={panelVisibility?.showAudioAnalysis}
                    onToggle={() => onToggleVisibility?.('showAudioAnalysis')}
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
                    <div className="flex flex-row gap-0">
                        {/* Left column — Generation Actions */}
                        <div className="flex flex-col gap-6 flex-1" style={{ paddingRight: '8px' }}>
                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={handleRunSeparation}
                                    disabled={isProcessing || !comfyConnected || !audioFile?.path || !workflow}
                                    className={`btn w-full ${isProcessing || !comfyConnected || !audioFile?.path || !workflow ? 'btn-secondary opacity-50 cursor-not-allowed' : 'btn-primary'}`}
                                    style={{ marginBottom: '5px' }}
                                >
                                    {isProcessing && !detectionStatus.includes("main") ? (
                                        <>Processing Music File...</>
                                    ) : (
                                        <>Start Stem Separation</>
                                    )}
                                </button>
                                <button
                                    onClick={handleRunMainBeatAnalysis}
                                    disabled={isProcessing || !activeProject || !audioFile?.path}
                                    className={`btn w-full ${isProcessing || !activeProject || !audioFile?.path ? 'btn-secondary opacity-50 cursor-not-allowed' : 'btn-primary'}`}
                                    style={{ marginBottom: '5px' }}
                                >
                                    {isProcessing && detectionStatus.includes("main") ? <>Analyzing Main Track...</> : <>Run Main Track Beat Analysis</>}
                                </button>
                            </div>

                            {/* Individual Stem Analysis Section */}
                            {stems.length > 0 && (
                                <div className="border-t border-gray-700/50 pt-3">
                                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Stem Analysis</h4>
                                    <div className="flex flex-col gap-2">
                                        <button
                                            className="btn w-full btn-secondary justify-center border border-indigo-500/30 hover:border-indigo-500/80"
                                            onClick={async () => {
                                                for (const s of stems) {
                                                    await handleAnalyzeLocal(s.path, s.type);
                                                }
                                            }}
                                            disabled={isProcessing}
                                        >
                                            {isProcessing ? 'Analyzing...' : 'Analyze All Stems'}
                                        </button>
                                        <div className="grid grid-cols-2 gap-2">
                                            {stems.map((stem, index) => (
                                                <button
                                                    key={index}
                                                    className="btn btn-secondary text-xs py-1 px-2 border border-gray-700 hover:border-indigo-500/50 flex justify-center items-center gap-2"
                                                    onClick={() => handleAnalyzeLocal(stem.path, stem.type)}
                                                    disabled={isProcessing}
                                                    title={`Run Analysis on ${stem.type}`}
                                                >
                                                    <span style={{ color: stem.color, fontSize: '8px' }}>⬤</span>
                                                    {stem.type}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {detectionStatus && (
                                <div className="text-xs text-[var(--text-secondary)] bg-black/20 p-2 rounded border border-white/5">
                                    <span className="text-gray-500 uppercase font-bold mr-2">Status:</span>
                                    <span className="text-[var(--accent-primary)] font-mono">{detectionStatus}</span>
                                </div>
                            )}
                        </div>

                        {/* Right column — Analysis Configuration */}
                        <div className="flex-1 pl-6">
                            <h4 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-3">Analysis Configuration</h4>
                            <div className="flex flex-col gap-4">
                                {/* Algorithm Selection */}
                                <div>
                                    <label className="block text-xs text-gray-400 mb-2 uppercase">Beat Tracking Algorithm</label>
                                    <select
                                        value={algorithm}
                                        onChange={(e) => setAlgorithm(e.target.value as BeatAlgorithm)}
                                        className="w-full bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded py-3 px-3 text-base text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                    >
                                        <option value="degara">Degara (Complex rhythm)</option>
                                        <option value="multifeature">Multi-feature (Electronic/Dance)</option>
                                    </select>
                                </div>

                                {/* Feature Toggles */}
                                <div className="flex flex-col gap-3">
                                    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white transition-colors">
                                        <input
                                            type="checkbox"
                                            checked={enableOnsets}
                                            onChange={(e) => setEnableOnsets(e.target.checked)}
                                            className="accent-[var(--accent-primary)]"
                                        />
                                        Extract Onsets (Granular events)
                                    </label>
                                    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white transition-colors">
                                        <input
                                            type="checkbox"
                                            checked={enableLoudness}
                                            onChange={(e) => setEnableLoudness(e.target.checked)}
                                            className="accent-[var(--accent-primary)]"
                                        />
                                        Extract Loudness Envelopes
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                </CollapsibleCard>
            </div>






            {/* Video Timeline — shown when video is loaded */}
            {videoFile && (
                <CollapsibleCard
                    title={`🎥 Video Timeline — ${videoFile.info.width}×${videoFile.info.height}`}
                    className="mt-4"
                    isOpen={panelVisibility?.showVideo}
                    onToggle={() => onToggleVisibility?.('showVideo')}
                >
                    <VideoTimelineBar
                        videoPath={videoFile.path}
                        videoInfo={videoFile.info}
                        thumbnails={videoThumbnails}
                        clips={clips}
                        onSelectionChange={(sel) => setActiveSelection(sel)}
                        onSaveFrame={handleSaveVideoFrame}
                    />
                </CollapsibleCard>
            )}

            {/* Main Track Section */}
            <CollapsibleCard
                title="🌊 Main Track"
                className="mt-4"
                isOpen={panelVisibility?.showMainTrack}
                onToggle={() => onToggleVisibility?.('showMainTrack')}
            >
                <div className="flex justify-between items-center bg-gray-900/10 p-3 rounded mb-2 border border-white/5">
                    <div className="flex items-center gap-4">
                        <h4 className="text-sm font-semibold text-gray-400">Audio Preview</h4>
                        <div className="flex gap-2">
                            <button
                                className="btn btn-primary flex items-center justify-center gap-1 px-4 py-1.5"
                                onClick={handlePlayMain}
                                disabled={!audioUrl}
                            >
                                <span className="text-lg">▶</span> Play
                            </button>
                            <button
                                className="btn btn-secondary flex items-center justify-center gap-1 px-4 py-1.5"
                                onClick={handlePauseMain}
                                disabled={!audioUrl}
                            >
                                <span className="text-lg">⏸</span> Pause
                            </button>
                        </div>
                    </div>

                    {/* Integrated Controls Bar inside Main Track */}
                    <div className="flex items-center gap-6 bg-black/20 px-4 py-2 rounded-lg border border-white/5">
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Zoom</label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="range"
                                    min={Math.floor(minZoom)}
                                    max="200"
                                    value={zoomLevel}
                                    onChange={(e) => setZoomLevel(Number(e.target.value))}
                                    className="accent-indigo-500 w-64 h-1.5 rounded-lg appearance-none bg-gray-700 cursor-pointer"
                                />
                                <button
                                    className="text-[10px] bg-gray-700 hover:bg-indigo-600 px-2 py-0.5 rounded text-gray-200 font-bold transition-colors uppercase"
                                    onClick={() => setZoomLevel(minZoom)}
                                    title="Fit to Screen"
                                >
                                    Fit
                                </button>
                            </div>
                        </div>

                        <div className="w-px h-8 bg-gray-700" />

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Beat Source</label>
                            <select
                                value={mainBeatSource}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    setMainBeatSource(val === 'main' ? 'main' : Number(val));
                                }}
                                className="bg-gray-800 text-white text-xs rounded border border-gray-600 outline-none focus:border-indigo-500 px-2 py-1"
                            >
                                <option value="main">Main Track</option>
                                {stems.map((s, i) => (
                                    <option key={i} value={i}>Stem: {s.type}</option>
                                ))}
                            </select>
                        </div>

                        <div className="w-px h-8 bg-gray-700" />

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">FPS</label>
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
                                className="bg-gray-800 text-white text-xs rounded border border-gray-600 outline-none focus:border-indigo-500 w-12 px-2 py-1 text-center"
                            />
                        </div>

                        <div className="w-px h-8 bg-gray-700" />

                        <div className="flex flex-col gap-1 items-end">
                            <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Duration</label>
                            <span className="text-xs text-gray-300 font-mono">
                                {duration > 0 ? `${duration.toFixed(2)}s` : '--'}
                            </span>
                        </div>
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
            </CollapsibleCard>




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

                    return (
                        <div className="stems-and-controls-wrapper">
                            {/* Stems & Legend Area */}
                            <CollapsibleCard
                                title="🥁 Project Stems & Marker Legend"
                                className="mt-8"
                                isOpen={panelVisibility?.showStems}
                                onToggle={() => onToggleVisibility?.('showStems')}
                            >
                                <div className="stems-list flex flex-col gap-8">
                                    {/* Marker Legend — always visible when any markers exist */}
                                    {(mainMarkers.length > 0 || stems.length > 0) && (
                                        <div style={{ display: 'flex', gap: '16px', marginBottom: '8px', padding: '6px 8px', fontSize: '12px', color: '#9ca3af', alignItems: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                                            <span style={{ fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Beat Key:</span>
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

                                            {/* Main track beat summary */}
                                            {mainMarkers.length > 0 && (
                                                <div className="ml-auto flex items-center gap-3 text-xs text-gray-400 border-l border-gray-700 pl-4">
                                                    <span className="font-semibold text-gray-500 uppercase">Main Track:</span>
                                                    {mainMarkers.filter(m => m.type === 'beat').length > 0 && (
                                                        <span>
                                                            <span style={{ color: MARKER_COLORS.downbeat }}>⬤</span>
                                                            {' '}{mainMarkers.filter(m => m.type === 'beat').length} beats
                                                        </span>
                                                    )}
                                                    {mainMarkers.filter(m => m.type === 'onset').length > 0 && (
                                                        <span>
                                                            <span style={{ color: MARKER_COLORS.onset }}>⬤</span>
                                                            {' '}{mainMarkers.filter(m => m.type === 'onset').length} onsets
                                                        </span>
                                                    )}
                                                    {mainMarkers.filter(m => m.type === 'loudness').length > 0 && (
                                                        <span>
                                                            <span style={{ color: MARKER_COLORS.loudness }}>⬤</span>
                                                            {' '}{mainMarkers.filter(m => m.type === 'loudness').length} loudness
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Stems section — only visible when stems exist */}
                                    {stems.length > 0 && (
                                        <>
                                            <div className="flex justify-between items-center bg-gray-900/50 p-3 rounded">
                                                <h4 className="text-sm font-semibold text-gray-400">Project Stems Controls</h4>
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
                                                <div key={index} className="stem-item bg-black/20 p-6 rounded border border-gray-800 pb-8">
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
                                        </>
                                    )}
                                </div>
                            </CollapsibleCard>

                            {/* Controls Container — outside collapsible section to stay persistent */}
                            <div className="controls-container flex flex-wrap gap-4 mt-8 bg-gray-900/40 p-6 rounded-xl border border-gray-800/80">
                                <button
                                    className="btn btn-primary shadow-lg shadow-indigo-500/20"
                                    onClick={handleGenerateClipFromRegion}
                                    disabled={!activeSelection || isAnalyzing}
                                >
                                    Generate Clip from Selection
                                </button>

                                <div className="flex gap-2">
                                    <button
                                        className="btn bg-indigo-700 hover:bg-indigo-600 text-white border-none rounded font-bold text-sm"
                                        onClick={handleExportMediaOnly}
                                        disabled={clips.length === 0}
                                        title="Step 1: Load all media into Resolve bin (Audio & Video)"
                                    >
                                        🎬 (1) Export Load Media Script
                                    </button>
                                    <button
                                        className="btn bg-indigo-800 hover:bg-indigo-700 text-white border-none rounded font-bold text-sm"
                                        onClick={handleExportManifest}
                                        disabled={clips.length === 0}
                                        title="Step 2: Place media items from bin onto timeline at designed positions"
                                    >
                                        🎨 (2) Place Media Script
                                    </button>
                                    <button
                                        className="btn bg-indigo-600 hover:bg-indigo-500 text-white border-none rounded font-bold text-sm"
                                        onClick={handleExportMarkers}
                                        disabled={mainMarkers.length === 0 && stems.length === 0}
                                        title="Step 3: Set all detected beat markers and onsets onto the Resolve timeline"
                                    >
                                        🚩 (3) Set Beat Markers
                                    </button>
                                </div>

                                <button
                                    className="btn btn-primary bg-emerald-600 hover:bg-emerald-500 border-none text-white rounded font-bold text-sm ml-auto"
                                    onClick={handleSaveToProject}
                                    disabled={!activeProject}
                                >
                                    💾 Save to Project
                                </button>
                            </div>

                            {/* Project Timeline Table */}
                            <div className="mt-8">
                                {/* Selection Status — positioned just above the table */}
                                {activeSelection && (
                                    <div className="selection-status mb-8 px-10 py-6 bg-indigo-900/40 border-2 border-indigo-500/50 rounded-2xl flex justify-between items-center shadow-2xl transition-all duration-300">
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-indigo-400 uppercase text-[10px] font-black tracking-widest">Selection Source</span>
                                                <span className="bg-indigo-500/20 text-indigo-200 px-2 py-0.5 rounded text-[10px] font-bold border border-indigo-500/30">
                                                    {activeSelection.source === 'video' ? 'VIDEO' : activeSelection.source === 'main' ? 'MAIN TRACK' : `STEM: ${stems[activeSelection.stemIndex!]?.type.toUpperCase()}`}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-3 mt-1">
                                                <span className="text-white text-2xl font-black font-mono tracking-tighter">
                                                    {activeSelection.start.toFixed(2)}s <span className="text-indigo-500 mx-1">→</span> {activeSelection.end.toFixed(2)}s
                                                </span>
                                                <span className="bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-lg text-sm font-black border border-emerald-500/30">
                                                    {(activeSelection.end - activeSelection.start).toFixed(2)}s TOTAL
                                                </span>
                                            </div>
                                        </div>

                                        <button
                                            className="btn-huge bg-emerald-600 hover:bg-emerald-500 text-white pulse-green border-none flex items-center gap-3 group"
                                            onClick={handleAddSegment}
                                        >
                                            <span className="text-3xl group-hover:scale-125 transition-transform duration-200">+</span>
                                            <span>Add Segment</span>
                                        </button>
                                    </div>
                                )}
                                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">📋 Project Timeline</h3>
                                <ProjectTimelineTable
                                    clips={clips}
                                    duration={duration}
                                    onUpdateClipLabel={handleUpdateClipLabel}
                                    onUpdateClipPrompt={handleUpdateClipPrompt}
                                    onUpdateClipStartTime={handleUpdateClipStartTime}
                                    onUpdateClipEndTime={handleUpdateClipEndTime}
                                    onRemoveClip={handleRemoveClip}
                                    onPickImage={handlePickImage}
                                    onGenerateClip={handleGenerateTimelineClip}
                                    onError={(msg) => onStatusChange && onStatusChange(`Table Error: ${msg}`)}
                                />
                            </div>

                            {/* Custom Floating Tooltip */}
                            {tooltipState.visible && tooltipState.content && (
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
                            )}


                        </div>
                    );
                })()
            }

        </div >
    );
};

export default MusicVideoAssemblerModule;
