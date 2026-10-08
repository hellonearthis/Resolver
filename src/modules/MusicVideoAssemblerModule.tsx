import React, { useEffect, useRef, useState } from 'react';
import { AppTooltip } from '../components/ui/Tooltip';

import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { 
    analyzeBeats, 
    analyzeOnsets, 
    analyzeLoudness, 
    generateBeatGrid, 
    analyzeSongSections, 
    type BeatAlgorithm, 
    type LoudnessRegion, 
    initEssentia 
} from '../services/essentiaService';

import DropZone, { type FileWithPath } from '../components/DropZone';
import ProjectsPanel from '../components/ProjectsPanel';
import BpmTapControl from '../components/BpmTapControl';
import SectionTimelineBar from '../components/SectionTimelineBar';
import { type MusicSection, SECTION_TYPE_COLOR_MAP } from '../types/sections';
import { 
    queuePrompt, 
    uploadFileToComfyUI, 
    convertAudioForComfyUI, 
    waitForPromptWebSocket,
    type ComfyWorkflow
} from '../services/comfyService';
import workflowJsonTemplate from '../../comfyui_workflows/Extract_Stems.json';
import { getAlignedDuration } from '../utils/timelineUtils';
import type { BeatProject, ProjectMarker } from '../hooks/useProjectStorage';
import ProjectTimelineTable from '../components/ProjectTimelineTable';
import type { ImageFunction } from '../types/assembler';
import CollapsibleCard from '../components/CollapsibleCard';
import VideoTimelineBar from '../components/VideoTimelineBar';
import DurationEditPopup from '../components/DurationEditPopup';

import './MusicVideoAssemblerModule.css';

interface NodeFsModule {
    existsSync: (path_string: string) => boolean;
    readdirSync: (directory_path: string) => string[];
    readFileSync: (file_path: string) => Uint8Array;
    mkdirSync: (target_dir: string, options?: { recursive?: boolean }) => void;
    copyFileSync: (source_path: string, destination_path: string) => void;
    statSync: (file_path: string) => { mtimeMs: number };
}

interface NodePathModule {
    join: (...path_segments: string[]) => string;
    resolve: (...path_segments: string[]) => string;
    isAbsolute: (path_string: string) => boolean;
    basename: (path_string: string, optional_extension?: string) => string;
    dirname: (path_string: string) => string;
    extname: (path_string: string) => string;
    parse: (path_string: string) => { name: string; ext: string; base: string; dir: string };
}

interface ElectronIpcRenderer {
    invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
    send: (channel: string, ...args: unknown[]) => void;
    on: (channel: string, listener: (...args: unknown[]) => void) => void;
    removeListener: (channel: string, listener: (...args: unknown[]) => void) => void;
}

interface WaveSurferRegionLike {
    id?: string;
    start: number;
    end: number;
    color?: string;
    element?: HTMLElement;
    setOptions: (options: { start?: number; end?: number; color?: string }) => void;
    remove?: () => void;
}

interface WaveSurferRegionsPluginInstance {
    getRegions: () => WaveSurferRegionLike[];
    addRegion: (options: { start: number; end: number; color?: string; id?: string; drag?: boolean; resize?: boolean }) => WaveSurferRegionLike;
    enableDragSelection: (options: { color: string }) => void;
    clearRegions: () => void;
    on: (event_name: string, callback_listener: (region_candidate: WaveSurferRegionLike) => void) => void;
}

import {
    extractMainMarkersFromProject,
    buildResolveExportMarkers,
    buildResolveSectionMarkers,
    createClipFromSelection,
    updateClipStartTime,
    updateClipEndTimeWithRipple,
    parseSrtSubtitlesToClips,
    calculateMarkerLegendCounts,
    type ResolveExportMarker,
    type MarkerLegendTooltipItem
} from '../utils/assemblerUtils';
export type { ResolveExportMarker, MarkerLegendTooltipItem };

// WHAT: Safely retrieves the Electron IPC bridge when executing in a desktop container.
// WHY: Prevents browser errors during SSR and pure web execution while enabling native Resolve RPC.
const getElectronIpc = (): ElectronIpcRenderer | null => {
    try {
        if (window.require) {
            const electron_module = window.require('electron') as { ipcRenderer?: ElectronIpcRenderer } | null;
            return electron_module?.ipcRenderer ?? null;
        }
        return (window as unknown as { ipcRenderer?: ElectronIpcRenderer }).ipcRenderer ?? null;
    } catch {
        return null;
    }
};

// WHAT: Safely retrieves Node filesystem module.
// WHY: Enables binary audio buffering and stems directory management in desktop Electron.
const getNodeFs = (): NodeFsModule | null => {
    try {
        return window.require ? (window.require('fs') as NodeFsModule) : null;
    } catch {
        return null;
    }
};

// WHAT: Safely retrieves Node path manipulation module.
// WHY: Cross-platform directory separator handling between Windows and POSIX DaVinci Resolve environments.
const getNodePath = (): NodePathModule | null => {
    try {
        return window.require ? (window.require('path') as NodePathModule) : null;
    } catch {
        return null;
    }
};

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
    onUpdateProject: (id: string, updates: Partial<BeatProject> | ((prev: BeatProject) => Partial<BeatProject>)) => void;
    onDeleteProject: (id: string) => void;
    onRefreshProjects: () => void;
    onStatusChange?: (msg: string) => void;
    onGenerateVideo?: (clipId: string) => Promise<void>;
    onPickImage?: (clipId: string, field: 'startImagePath' | 'endImagePath') => void;
    onCopyImageFromNext?: (clipId: string, field: 'startImagePath' | 'endImagePath') => void;
    comfyConnected?: boolean;
    comfyOutputDir?: string;
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
    onUpdateProject,
    onDeleteProject,
    onRefreshProjects,
    onStatusChange,
    onGenerateVideo,
    onPickImage,
    comfyConnected,
    comfyOutputDir,
    panelVisibility,
    onToggleVisibility
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurfer = useRef<WaveSurfer | null>(null);
    const wsRegions = useRef<WaveSurferRegionsPluginInstance | null>(null);
    const [audioFile, setAudioFile] = useState<{ name: string; path: string } | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [mainMarkers, setMainMarkers] = useState<AudioMarker[]>(() => extractMainMarkersFromProject(activeProject?.markers));
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const clips = (activeProject?.clips || []) as VideoClip[];
    const [stems, setStems] = useState<StemData[]>([]);
    const stemSurfers = useRef<WaveSurfer[]>([]);
    const stemRegionsRefs = useRef<Map<number, WaveSurferRegionsPluginInstance>>(new Map());

    // Duration Popup State
    const [durationPopup, setDurationPopup] = useState<{ clipId: string, duration: number, startTime: number, x: number, y: number } | null>(null);
    const [duration, setDuration] = useState(0);
    const [activeSelection, setActiveSelection] = useState<SelectionState | null>(null);
    const lastProjectIdRef = useRef<string | null>(null);
    const stemRafRef = useRef<number | null>(null);

    // Refs to break stale closures in WaveSurfer async callbacks (ready, redraw, zoom)
    const mainMarkersRef = useRef<AudioMarker[]>(mainMarkers);
    mainMarkersRef.current = mainMarkers;
    const durationRef = useRef<number>(duration);
    durationRef.current = duration;

    // --- Post-Generation Sync Logic ---
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

    const mainBeatSourceRef = useRef<'main' | number>(mainBeatSource);
    mainBeatSourceRef.current = mainBeatSource;
    const stemsRef = useRef<StemData[]>(stems);
    stemsRef.current = stems;

    // BPM, Tap Tempo & Section Analysis State
    const [projectBpm, setProjectBpm] = useState<number>(activeProject?.bpm || 120);
    const [projectSections, setProjectSections] = useState<MusicSection[]>(activeProject?.sections || []);
    const [isDetectingSections, setIsDetectingSections] = useState<boolean>(false);
    const [isPushingSectionsToResolve, setIsPushingSectionsToResolve] = useState<boolean>(false);
    const [resolveBridgeOnline, setResolveBridgeOnline] = useState<boolean>(false);
    const [playbackCurrentTime, setPlaybackCurrentTime] = useState<number>(0);

    useEffect(() => {
        loadConfig();
        initEssentia();
    }, []);

    // WHAT: Retrieves application default configuration including preferred project output directory.
    // WHY: Populates initial state with user-selected scratch/render directory from settings.
    const loadConfig = async () => {
        try {
            const ipcRenderer = getElectronIpc();
            if (!ipcRenderer) return;

            const response = await ipcRenderer.invoke<{ success: boolean; config?: { projectOutputDir?: string } }>('get-config');
            if (response.success && response.config?.projectOutputDir) {
                setDefaultOutputDir(response.config.projectOutputDir);
                setOutputDir((prev_output_dir) => prev_output_dir || response.config!.projectOutputDir!);
            }
        } catch (caught_error) {
            console.error("Failed to load config", caught_error);
        }
    };

    // Load Project Audio when activeProject changes
    useEffect(() => {
        if (activeProject) {
            loadProjectAudio(activeProject);

            if (activeProject.bpm) {
                setProjectBpm(activeProject.bpm);
            }
            if (activeProject.sections && Array.isArray(activeProject.sections)) {
                setProjectSections(activeProject.sections);
            } else {
                setProjectSections([]);
            }

            // Auto defaults for older projects without frameRate
            if (!activeProject.frameRate) {
                onUpdateProject(activeProject.id, { frameRate: 20 });
            }
        } else if (!activeProject) {
            lastProjectIdRef.current = null;
            setDuration(0);
            setAudioUrl(null);
            setStems([]);
            setProjectSections([]);
        }
    }, [
        activeProject?.id,
        activeProject?.markers?.length,
        activeProject?.stems?.length,
        activeProject?.clips // Dependency on clips array itself to catch status updates
    ]);

    // WHAT: Periodically polls the DaVinci Resolve bridge connection status.
    // WHY: Enables or disables the "Push to Resolve" buttons in real time.
    useEffect(() => {
        const checkBridgeHealth = async () => {
            const ipc_renderer_instance = getElectronIpc();
            if (ipc_renderer_instance) {
                try {
                    const health_response = await ipc_renderer_instance.invoke<{ is_online: boolean }>('resolve-bridge-status');
                    setResolveBridgeOnline(Boolean(health_response?.is_online));
                } catch {
                    setResolveBridgeOnline(false);
                }
            }
        };
        checkBridgeHealth();
        const bridge_health_timer = setInterval(checkBridgeHealth, 5000);
        return () => clearInterval(bridge_health_timer);
    }, []);

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
                stemSurfers.current.forEach(stem_surfer => stem_surfer.zoom(zoomLevel));
                window.dispatchEvent(new Event('resize'));
            }, 400);
        }
    }, [panelVisibility?.showStems, zoomLevel]);


    // WHAT: Decodes an audio blob and performs algorithmic beat detection using Essentia.
    // WHY: Provides both timestamp markers and estimated BPM for the main audio track.
    const analyzeAudio = async (audio_blob: Blob) => {
        const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) throw new Error('AudioContext not supported in this runtime environment.');
        const audio_context_instance = new AudioContextClass();
        const array_buffer = await audio_blob.arrayBuffer();
        const audio_buffer = await audio_context_instance.decodeAudioData(array_buffer);
        const beat_detection_result = await analyzeBeats(audio_buffer, algorithm);
        return beat_detection_result;
    };

    const handleUpdateDuration = (newDuration: number) => {
        if (!activeProject || isAnalyzing) return;

        // Update local state and project storage
        setDuration(newDuration);
        onUpdateProject(activeProject.id, { duration: newDuration });

        // If it's a blank project (no physical audio file), re-generate the silent audio blob
        if (!audioFile) {
            const silentBlob = createSilentAudioBlob(newDuration);
            const url = URL.createObjectURL(silentBlob);
            setAudioUrl(url);

            // Clean up old URL if necessary (though React usually handles this if we replace it)
            if (onStatusChange) onStatusChange(`Project length updated to ${newDuration.toFixed(2)}s`);
        }
    };

    const handleAudioDrop = (files: FileWithPath[]) => {
        if (files.length > 0) {
            const file = files[0];
            const pathStr = file.path;

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
                    const pathModule = getNodePath();
                    if (pathModule) {
                        const audioDir = pathModule.dirname(pathStr);
                        setOutputDir(audioDir);
                        finalOutputDir = audioDir;
                    }
                } catch (caught_error) {
                    console.error("Failed to auto-set output dir", caught_error);
                }
            }

            if (!activeProject || activeProject.audioPath !== pathStr) {
                onCreateProject(file, finalOutputDir || undefined);
                if (onStatusChange) onStatusChange(`Project created for ${file.name}`);
            }
        }
    };

    // --- Video Drop Handler ---
    const handleVideoDrop = async (files: FileWithPath[]) => {
        if (files.length === 0) return;
        const file = files[0];
        const pathStr = file.path;

        if (!pathStr) {
            if (onStatusChange) onStatusChange('Error: Could not read video file path.');
            return;
        }

        const ipcRenderer = getElectronIpc();
        if (!ipcRenderer) {
            if (onStatusChange) onStatusChange('Error: Desktop IPC unavailable.');
            return;
        }

        if (onStatusChange) onStatusChange(`Loading video: ${file.name}...`);

        try {
            // Get video metadata via ffprobe
            const infoResult = await ipcRenderer.invoke<{ success: boolean; info?: VideoInfo; error?: string }>('get-video-info', pathStr);
            if (!infoResult.success || !infoResult.info) {
                if (onStatusChange) onStatusChange(`Video info error: ${infoResult.error || 'Failed to read info'}`);
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
                const thumbResult = await ipcRenderer.invoke<{ success: boolean; thumbnails?: VideoThumbnail[]; error?: string }>('extract-video-thumbnails', {
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
        } catch (caught_error: unknown) {
            console.error('Video drop error:', caught_error);
            const error_message = caught_error instanceof Error ? caught_error.message : String(caught_error);
            if (onStatusChange) onStatusChange(`Video error: ${error_message}`);
        }
    };

    // --- Save Full-Resolution Video Frame ---
    const handleSaveVideoFrame = async (time: number) => {
        if (!videoFile || !activeProject?.outputDir) {
            if (onStatusChange) onStatusChange('No video loaded or no project selected.');
            return;
        }

        const ipcRenderer = getElectronIpc();
        if (!ipcRenderer) {
            if (onStatusChange) onStatusChange('Desktop IPC bridge unavailable.');
            return;
        }

        if (onStatusChange) onStatusChange(`Saving frame at ${time.toFixed(3)}s...`);
        try {
            const result = await ipcRenderer.invoke<{ success: boolean; framePath?: string; error?: string }>('save-video-frame', {
                filePath: videoFile.path,
                time,
                outputDir: activeProject.outputDir,
            });
            if (result.success) {
                if (onStatusChange) onStatusChange(`Frame saved: ${result.framePath}`);
            } else {
                if (onStatusChange) onStatusChange(`Frame save error: ${result.error}`);
            }
        } catch (caught_error: unknown) {
            const error_message = caught_error instanceof Error ? caught_error.message : String(caught_error);
            if (onStatusChange) onStatusChange(`Frame save error: ${error_message}`);
        }
    };

    // --- Core Logic: Run & Poll ---
    const handleRunSeparation = async () => {
        if (!comfyConnected || !audioFile?.path || !outputDir) {
            if (onStatusChange) onStatusChange('Missing setup (Audio, ComfyUI Connection, or Output Folder)');
            return;
        }

        setIsProcessing(true);
        if (onStatusChange) onStatusChange('Preparing workflow...');
        const startTime = Date.now(); // Capture start time to find new files

        try {
            const prompt = JSON.parse(JSON.stringify(workflowJsonTemplate)) as ComfyWorkflow;

            let loadNodeKey: string | null = null;
            for (const [key, node] of Object.entries(prompt)) {
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

            prompt[loadNodeKey].inputs.audio = uploaded.name;

            const runId = Date.now().toString();
            const prefix = `stem_${runId}`;

            for (const node of Object.values(prompt)) {
                if (node.class_type.includes('Save') && node.inputs) {
                    const currentPrefix = String(node.inputs.filename_prefix || '');
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
            const newStems: StemData[] = movedFiles.map((moved_file, file_index) => ({
                id: `stem-${file_index}-${Date.now()}`,
                type: moved_file.type,
                path: moved_file.path,
                url: `media://${moved_file.path.replace(/\\/g, '/')}`,
                color: STEM_COLORS[moved_file.type.toLowerCase()] || Object.values(STEM_COLORS)[file_index % Object.values(STEM_COLORS).length] || DEFAULT_STEM_COLOR,
                markers: [],
                beats: []
            }));

            // If we're updating stems we should just wipe existing old stems from the array.
            setStems(newStems);

            if (activeProject) {
                // We need to omit 'url' when saving to `ProjectStorage` since it isn't tracked in project data
                const projectStemsToSave = newStems.map(stem_item => ({
                    type: stem_item.type,
                    path: stem_item.path,
                    color: stem_item.color,
                    markers: [] as ProjectMarker[],
                    beats: [] as number[]
                }));

                onUpdateProject(activeProject.id, {
                    stems: projectStemsToSave,
                    outputDir: outputDir || undefined
                });
            }

            if (onStatusChange) onStatusChange(newStems.length > 0 ? 'Separation Complete!' : 'Warning: No output files found.');

        } catch (caught_error: unknown) {
            console.error(caught_error);
            const error_message = caught_error instanceof Error ? caught_error.message : String(caught_error);
            if (onStatusChange) onStatusChange(`Error: ${error_message}`);
        } finally {
            setIsProcessing(false);
        }
    };

    const waitForGeneration = async (promptId: string): Promise<unknown> => {
        return waitForPromptWebSocket(
            promptId,
            workflowJsonTemplate as unknown as ComfyWorkflow,
            (status) => {
                if (onStatusChange) onStatusChange(status);
            }
        );
    };

    // WHAT: Inspects ComfyUI output directories, discovers newly isolated audio stems, and copies them to the active project folder.
    // WHY: Keeps project bundles self-contained and portable across machines by collecting generated stems into local project subdirectories.
    const moveFilesToProject = async (targetDir: string, _startTime: number, runPrefix: string) => {
        const fs = getNodeFs();
        const path = getNodePath();
        if (!fs || !path || !comfyOutputDir) return [];

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
                const matches = files.filter((file_candidate: string) => regex.test(file_candidate))
                    .map((file_candidate: string) => {
                        const fullPath = path.join(comfyOutputDir, file_candidate);
                        const stats = fs.statSync(fullPath);
                        return { file: file_candidate, path: fullPath, time: stats.mtimeMs as number };
                    })
                    .sort((earlier_stat, later_stat) => later_stat.time - earlier_stat.time);

                if (matches.length > 0) {
                    const latest = matches[0];
                    const extension_suffix = path.extname(latest.file);
                    const destFilename = `${baseName}_${type}${extension_suffix}`;
                    const destPath = path.join(stemsDir, destFilename);

                    fs.copyFileSync(latest.path, destPath);
                    console.log(`Found & Moved: ${latest.path} -> ${destPath}`);
                    movedStems.push({ type, path: `./stems/${destFilename}` });
                } else {
                    console.warn(`No new ${type} file found in ${comfyOutputDir} matching ${runPrefix}`);
                }
            }
        } catch (caught_error) {
            console.error("Error moving files:", caught_error);
        }

        return movedStems;
    };


    // WHAT: Analyzes beat timestamps, onset transients, and perceptual loudness envelopes for an isolated stem track.
    // WHY: Provides tempo-synchronized visual markers allowing editors to cut on specific instrumental beats.
    const runBeatAnalysis = async (audioPath: string, stemType: string) => {
        setIsProcessing(true);
        if (onStatusChange) onStatusChange(`Analyzing beats for ${stemType} (${algorithm})…`);
        setDetectionStatus(`Analyzing ${stemType}...`);

        const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) throw new Error('AudioContext unavailable in current browser context.');
        const audioContext = new AudioContextClass();
        try {
            const fs = getNodeFs();
            if (!fs) throw new Error('Filesystem access unavailable.');
            const buffer = fs.readFileSync(audioPath);
            const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            setDetectionStatus('Analyzing beats...');
            const beatResult = await analyzeBeats(audioBuffer, algorithm);
            console.log('[Essentia] BPM:', beatResult.bpm, 'beats:', beatResult.beats.length);

            const allMarkers: AudioMarker[] = [];
            const stemMapping = getStemTheme(stemType);
            const frameRate = activeProject?.frameRate || 24;

            beatResult.beats.forEach((time_seconds: number) => {
                allMarkers.push({
                    time: time_seconds,
                    color: stemMapping.base,
                    type: 'beat',
                    isDownbeat: false
                });
            });

            if (enableOnsets) {
                setDetectionStatus('Analyzing onsets...');
                const onsetResult = await analyzeOnsets(audioBuffer);
                onsetResult.onsets.forEach((time_seconds: number) => {
                    allMarkers.push({
                        time: time_seconds,
                        color: stemMapping.light,
                        type: 'onset'
                    });
                });
            }

            if (enableLoudness) {
                setDetectionStatus('Analyzing loudness...');
                const loudResult = await analyzeLoudness(audioBuffer);
                loudResult.regions.forEach((loudness_region: LoudnessRegion) => {
                    allMarkers.push({
                        time: loudness_region.start,
                        color: stemMapping.light,
                        type: 'loudness'
                    });
                });
            }

            const beatsOnly = allMarkers.filter((marker_item: AudioMarker) => marker_item.type === 'beat').map((marker_item: AudioMarker) => marker_item.time);

            // Update markers on the specific stem object inside `stems` array
            const updatedStems = stems.map(stem_item => {
                if (stem_item.type === stemType) {
                    return { ...stem_item, markers: allMarkers, beats: beatsOnly };
                }
                return stem_item;
            });
            setStems(updatedStems);

            // Save to project
            if (activeProject && onUpdateProject) {
                // Wipe older markers for this stem note
                const otherMarkers = (activeProject.markers || []).filter((marker_item: ProjectMarker) => marker_item.note !== stemType);

                // Convert AudioMarkers to ProjectMarkers before saving
                const projectMarkersToSave: ProjectMarker[] = allMarkers.map(marker_item => {
                    const mappedType = (marker_item.type === 'beat' || marker_item.type === 'onset' || marker_item.type === 'loudness')
                        ? marker_item.type
                        : 'beat';

                    return {
                        timestamp: marker_item.time,
                        frame: Math.round(marker_item.time * frameRate),
                        color: marker_item.color || stemMapping.base,
                        note: stemType,
                        type: mappedType as "beat" | "onset" | "loudness",
                        duration_sec: 0.05 // Default duration for markers
                    };
                });

                // Omit URL for project stems
                const projectStemsToSave = updatedStems.map(stem_item => ({
                    type: stem_item.type,
                    path: stem_item.path,
                    color: stem_item.color,
                    markers: [] as ProjectMarker[]
                }));

                const detected_stem_tempo_bpm = Math.round(beatResult.bpm * 10) / 10;
                onUpdateProject(activeProject.id, {
                    stems: projectStemsToSave,
                    markers: [...otherMarkers, ...projectMarkersToSave],
                    outputDir: outputDir || undefined,
                    bpm: detected_stem_tempo_bpm
                });
                setProjectBpm(detected_stem_tempo_bpm);
            }

            setDetectionStatus(`Complete: ${beatsOnly.length} beats @${Math.round(beatResult.bpm)} BPM`);
            if (onStatusChange) onStatusChange(`Analysis for ${stemType} complete!`);

        } catch (caught_error: unknown) {
            console.error('Analysis failed:', caught_error);
            const error_message = caught_error instanceof Error ? caught_error.message : String(caught_error);
            setDetectionStatus(`Analysis failed for ${stemType}.`);
            if (onStatusChange) onStatusChange(`Error analyzing stem: ${error_message}`);
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
            const pathModule = getNodePath();
            if (pathModule && !pathModule.isAbsolute(path)) {
                // Determine best base directory
                const baseDir = activeProject?.outputDir || outputDir || '';
                if (baseDir) {
                    finalPath = pathModule.resolve(baseDir, path);
                    console.log(`[handleAnalyzeLocal] Resolved ${path} -> ${finalPath}`);
                }
            }
        } catch (caught_error) {
            console.error("[handleAnalyzeLocal] Path resolution error:", caught_error);
        }
        await runBeatAnalysis(finalPath, type);
    };

    // WHAT: Loads audio waveform, extracts stem tracks, and restores project video timeline state.
    // WHY: Re-establishes editor timeline state whenever the active project changes.
    const loadProjectAudio = async (project: BeatProject) => {
        console.log("[loadProjectAudio] Loading project:", project.name, project.id);

        // Track updates needed for the project
        const stemsUpdated = false;
        const newStems = project.stems ? [...project.stems] : [];

        // Determine if we need to reload the audio files (heavy operation)
        const isNewProject = lastProjectIdRef.current !== project.id;
        lastProjectIdRef.current = project.id;

        if (onStatusChange && isNewProject) onStatusChange(`Loading project audio: ${project.audioFileName}`);

        try {
            const fs = getNodeFs();
            const pathModule = getNodePath();
            const ipcRenderer = getElectronIpc();

            // 1. Audio Setup (Only if project changed)
            if (isNewProject && fs && pathModule) {
                setIsAnalyzing(true);
                setDuration(project.duration || 0);
                setStems([]);
                setMainMarkers([]);

                if (project.audioPath) {
                    const absoluteAudioPath = pathModule.resolve(project.outputDir || '', project.audioPath);

                    const buffer = fs.readFileSync(absoluteAudioPath);
                    const blob = new Blob([buffer.buffer as ArrayBuffer], { type: 'audio/mpeg' });
                    const url = URL.createObjectURL(blob);

                    setAudioUrl(url);
                    setAudioFile({ name: project.audioFileName || 'Unknown', path: absoluteAudioPath }); // Keep absolute in state for FFmpeg
                } else {
                    // Generate a silent audio blob so WaveSurfer can initialize and allow timeline selection
                    const blankDuration = project.duration || 60 * 5; // Use project duration or default to 5 minutes
                    const silentBlob = createSilentAudioBlob(blankDuration);
                    const url = URL.createObjectURL(silentBlob);

                    setAudioUrl(url);
                    setAudioFile(null);
                    setDuration(blankDuration);
                }

                if (project.outputDir) setOutputDir(project.outputDir);
            }

            // 2. Load Stems & Analyze their beats
            const loadedStems: StemData[] = [];
            if (newStems.length > 0 && fs && pathModule) {
                // Deduplicate stems by path to prevent visual duplication on load
                const uniqueStems = newStems.filter((stem_item, filter_index, self_array) =>
                    filter_index === self_array.findIndex((comparison_item) => comparison_item.path === stem_item.path)
                );

                for (let stem_index = 0; stem_index < uniqueStems.length; stem_index++) {
                    const current_stem = uniqueStems[stem_index];

                    // Optimization: Reuse existing URL if available
                    const existingStem = stems.find(stem_element => stem_element.path === current_stem.path);
                    let finalUrl = existingStem?.url;

                    try {
                        if (!finalUrl) {
                            const absoluteStemPath = pathModule.resolve(project.outputDir || '', current_stem.path);
                            const stem_audio_buffer = fs.readFileSync(absoluteStemPath);
                            const stem_audio_blob = new Blob([stem_audio_buffer.buffer as ArrayBuffer], { type: 'audio/mpeg' });
                            finalUrl = URL.createObjectURL(stem_audio_blob);
                        }

                        const projectMarkers = project.markers || [];
                        const stemProjectMarkers = projectMarkers.filter(marker_candidate => marker_candidate.note === current_stem.type);

                        // Fallback to stem.markers if the global filter finds nothing (backwards compatibility)
                        const markersToUse = stemProjectMarkers.length > 0 ? stemProjectMarkers : (current_stem.markers || []);
                        const stemColor = current_stem.color || STEM_COLORS[current_stem.type.toLowerCase()] || DEFAULT_STEM_COLOR;

                        let finalAudioMarkers: AudioMarker[] = [];

                        // 1. Try modern ProjectMarkers array
                        if (markersToUse && markersToUse.length > 0) {
                            let beatIndex = 0;
                            finalAudioMarkers = markersToUse.map(marker_item => {
                                let isDownbeat = false;
                                if (marker_item.type === 'beat') {
                                    isDownbeat = beatIndex % 4 === 0;
                                    beatIndex++;
                                }
                                return {
                                    time: marker_item.timestamp,
                                    type: marker_item.type as "beat" | "onset" | "loudness",
                                    isDownbeat,
                                    color: marker_item.color
                                };
                            });
                        }
                        // 2. Fallback to legacy flat beats array
                        else if (current_stem.beats && current_stem.beats.length > 0) {
                            finalAudioMarkers = current_stem.beats.map((beat_timestamp, flat_index) => ({
                                time: beat_timestamp,
                                type: 'beat',
                                isDownbeat: flat_index % 4 === 0,
                                color: undefined
                            }));
                        }

                        loadedStems.push({
                            type: current_stem.type,
                            url: finalUrl as string,
                            path: current_stem.path,
                            color: stemColor,
                            markers: finalAudioMarkers
                        });
                    } catch (stem_error) {
                        console.error(`Failed to load stem ${current_stem.path}`, stem_error);
                    }
                }
                setStems(loadedStems);
            } else {
                setStems([]);
            }

            // 3. Load Main Markers
            const audioMarkers = extractMainMarkersFromProject(project.markers);
            setMainMarkers(audioMarkers);
            mainMarkersRef.current = audioMarkers;

            if (wavesurfer.current && audioMarkers.length > 0) {
                const durToUse = duration || project.duration || wavesurfer.current.getDuration() || 0;
                renderBeatMarkers(wavesurfer.current, audioMarkers, durToUse);
            }

            if (onStatusChange) onStatusChange("Ready.");

            // 5. Restore Video Timeline State
            if (project.videoPath && isNewProject && ipcRenderer && pathModule && fs) {
                try {
                    const infoResult = await ipcRenderer.invoke<{ success: boolean; info: VideoInfo }>('get-video-info', project.videoPath);
                    if (infoResult.success) {
                        setVideoFile({ path: project.videoPath, info: infoResult.info });

                        // Check for existing thumbnails
                        if (project.outputDir) {
                            const thumbDir = pathModule.join(project.outputDir, 'thumbnails');
                            if (fs.existsSync(thumbDir)) {
                                const thumbnail_files = fs.readdirSync(thumbDir)
                                    .filter((file_candidate: string) => file_candidate.startsWith('thumb_') && file_candidate.endsWith('.jpg'))
                                    .sort();
                                if (thumbnail_files.length > 0) {
                                    const thumbs: VideoThumbnail[] = thumbnail_files.map((thumb_filename: string, thumb_index: number) => ({
                                        path: pathModule.join(thumbDir, thumb_filename),
                                        time: thumb_index / 3, // Assumes 3fps extraction
                                    }));
                                    setVideoThumbnails(thumbs);
                                }
                            }
                        }
                    }
                } catch (caught_error) {
                    console.warn('[loadProjectAudio] Failed to restore video state:', caught_error);
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

        } catch (caught_error) {
            console.error("Failed to load project audio", caught_error);
            if (onStatusChange) onStatusChange(`Error loading project: ${caught_error}`);
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
            const fs = getNodeFs();
            if (!fs) throw new Error('Filesystem access unavailable.');
            const buffer = fs.readFileSync(audioFile.path);
            const blob = new Blob([buffer.buffer as ArrayBuffer], { type: 'audio/mpeg' });

            const beat_detection_payload = await analyzeAudio(blob);
            const rawBeats = beat_detection_payload.beats;
            const detected_master_tempo_bpm = beat_detection_payload.bpm
                ? Math.round(beat_detection_payload.bpm * 10) / 10
                : projectBpm;

            const audioMarkers: AudioMarker[] = rawBeats.map((time_seconds, beat_index) => ({
                time: time_seconds,
                type: 'beat',
                isDownbeat: beat_index % 4 === 0,
                color: beat_index % 4 === 0 ? MARKER_COLORS.downbeat : MARKER_COLORS.offbeat
            }));

            setMainMarkers(audioMarkers);
            mainMarkersRef.current = audioMarkers;
            setProjectBpm(detected_master_tempo_bpm);
            setDetectionStatus(`Complete: ${rawBeats.length} beats @${detected_master_tempo_bpm} BPM.`);
            if (onStatusChange) onStatusChange("Main track beat analysis complete!");

            if (wavesurfer.current) {
                const totalDur = duration || activeProject.duration || wavesurfer.current.getDuration() || 0;
                renderBeatMarkers(wavesurfer.current, audioMarkers, totalDur);
            }

            // Save to project explicitly so it persists
            onUpdateProject(activeProject.id, {
                bpm: detected_master_tempo_bpm,
                markers: audioMarkers.map(marker_item => ({
                    timestamp: marker_item.time,
                    frame: Math.round(marker_item.time * (activeProject.frameRate || 20)),
                    color: marker_item.color || (marker_item.isDownbeat ? MARKER_COLORS.downbeat : MARKER_COLORS.offbeat),
                    note: '',
                    type: marker_item.type as "beat" | "onset" | "loudness",
                    duration_sec: 0.05 // Default duration for markers
                }))
            });

        } catch (caught_error: unknown) {
            console.error("Main track analysis failed:", caught_error);
            const error_message = caught_error instanceof Error ? caught_error.message : String(caught_error);
            setDetectionStatus("Analysis failed.");
            if (onStatusChange) onStatusChange(`Error analyzing main track: ${error_message}`);
        } finally {
            setIsProcessing(false);
            setTimeout(() => {
                setDetectionStatus('');
                if (onStatusChange) onStatusChange('');
            }, 4000);
        }
    };

    // WHAT: Updates local BPM state and stores the adjusted tempo on activeProject.
    // WHY: Keeps BPM synchronized when user types or steps the tempo value.
    const handleBpmChange = (new_tempo_value: number) => {
        const validated_tempo_value = Math.max(20, Math.min(300, new_tempo_value));
        setProjectBpm(validated_tempo_value);
        if (activeProject && onUpdateProject) {
            onUpdateProject(activeProject.id, { bpm: validated_tempo_value });
        }
    };

    // WHAT: Synthesizes an exact beat grid for the audio duration and updates main markers.
    // WHY: Allows manual tempo override or alignment when Essentia algorithm estimates incorrectly.
    const handleApplyBeatGrid = (target_tempo_beats_per_minute: number) => {
        if (!activeProject) return;
        const total_duration_seconds = duration || activeProject.duration || 60;
        const initial_offset_timestamp_seconds = mainMarkers.length > 0
            ? Math.max(0, mainMarkers[0].time % (60 / target_tempo_beats_per_minute))
            : 0;

        const generated_beat_timestamps_collection = generateBeatGrid(
            target_tempo_beats_per_minute,
            total_duration_seconds,
            initial_offset_timestamp_seconds
        );

        const new_audio_markers_collection: AudioMarker[] = generated_beat_timestamps_collection.map((beat_timestamp_seconds, beat_index) => ({
            time: beat_timestamp_seconds,
            type: 'beat',
            isDownbeat: beat_index % 4 === 0,
            color: beat_index % 4 === 0 ? MARKER_COLORS.downbeat : MARKER_COLORS.offbeat
        }));

        setMainMarkers(new_audio_markers_collection);
        setProjectBpm(target_tempo_beats_per_minute);

        const frame_rate_value = activeProject.frameRate || 24;
        const project_markers_to_save: ProjectMarker[] = new_audio_markers_collection.map((marker_item) => ({
            timestamp: marker_item.time,
            frame: Math.round(marker_item.time * frame_rate_value),
            color: marker_item.color || (marker_item.isDownbeat ? MARKER_COLORS.downbeat : MARKER_COLORS.offbeat),
            note: 'grid',
            type: 'beat',
            duration_sec: 0.05
        }));

        onUpdateProject(activeProject.id, {
            bpm: target_tempo_beats_per_minute,
            markers: project_markers_to_save
        });

        if (wavesurfer.current) {
            renderBeatMarkers(wavesurfer.current, new_audio_markers_collection, total_duration_seconds);
        }

        if (onStatusChange) {
            onStatusChange(`Applied beat grid: ${target_tempo_beats_per_minute} BPM (${new_audio_markers_collection.length} beats)`);
        }
    };

    // WHAT: Computes audio dynamics and structural transitions to detect song sections.
    // WHY: Automatically tags Verse, Chorus, Bridge, etc., for timeline arrangement and video pacing.
    const handleDetectSections = async () => {
        if (!activeProject || !audioFile?.path) {
            if (onStatusChange) onStatusChange('No audio file loaded for section detection.');
            return;
        }

        setIsDetectingSections(true);
        if (onStatusChange) onStatusChange('Analyzing audio dynamics and song sections...');

        try {
            const fs_module = getNodeFs();
            if (!fs_module) throw new Error('File system access is unavailable.');

            const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!AudioContextClass) throw new Error('AudioContext unavailable.');
            const audio_context_instance = new AudioContextClass();

            // Decode master audio
            const master_file_buffer = fs_module.readFileSync(audioFile.path);
            const master_array_buffer = master_file_buffer.buffer.slice(
                master_file_buffer.byteOffset,
                master_file_buffer.byteOffset + master_file_buffer.byteLength
            ) as ArrayBuffer;
            const master_audio_buffer = await audio_context_instance.decodeAudioData(master_array_buffer);

            // Decode available stem audio buffers for multi-stem activity weighting
            const optional_stem_audio_buffers_dictionary: Record<string, AudioBuffer> = {};
            if (stems.length > 0) {
                for (const stem_item of stems) {
                    if (stem_item.path && fs_module.existsSync(stem_item.path)) {
                        try {
                            const stem_file_buffer = fs_module.readFileSync(stem_item.path);
                            const stem_array_buffer = stem_file_buffer.buffer.slice(
                                stem_file_buffer.byteOffset,
                                stem_file_buffer.byteOffset + stem_file_buffer.byteLength
                            ) as ArrayBuffer;
                            const decoded_stem_buffer = await audio_context_instance.decodeAudioData(stem_array_buffer);
                            optional_stem_audio_buffers_dictionary[stem_item.type.toLowerCase()] = decoded_stem_buffer;
                        } catch (stem_decode_error) {
                            console.warn(`Failed to decode stem for section analysis: ${stem_item.type}`, stem_decode_error);
                        }
                    }
                }
            }

            const detected_song_sections = await analyzeSongSections(
                master_audio_buffer,
                optional_stem_audio_buffers_dictionary
            );

            setProjectSections(detected_song_sections);
            onUpdateProject(activeProject.id, { sections: detected_song_sections });

            await audio_context_instance.close();

            if (onStatusChange) {
                onStatusChange(`Detected ${detected_song_sections.length} song sections! Click "➕ Add to Project Timeline" to populate clips.`);
            }
        } catch (section_detection_error) {
            console.error('Section detection failed:', section_detection_error);
            const error_message = section_detection_error instanceof Error ? section_detection_error.message : String(section_detection_error);
            if (onStatusChange) onStatusChange(`Section detection failed: ${error_message}`);
        } finally {
            setIsDetectingSections(false);
        }
    };

    // WHAT: Pushes detected song sections as colored chapter markers to DaVinci Resolve.
    // WHY: Populates Resolve's timeline ruler with labeled verse/chorus navigation markers.
    const handlePushSectionsToResolve = async () => {
        if (!activeProject || projectSections.length === 0) {
            if (onStatusChange) onStatusChange('No sections available to push to DaVinci Resolve.');
            return;
        }

        const ipc_renderer_instance = getElectronIpc();
        if (!ipc_renderer_instance) {
            if (onStatusChange) onStatusChange('Desktop IPC unavailable.');
            return;
        }

        setIsPushingSectionsToResolve(true);
        if (onStatusChange) onStatusChange('Pushing section markers to DaVinci Resolve...');

        try {
            const resolve_markers_payload = buildResolveSectionMarkers(projectSections, activeProject.frameRate || 24);

            const result = await ipc_renderer_instance.invoke<{ success: boolean; pushed_count?: number; timeline_name?: string; error?: string }>(
                'resolve-bridge-push-markers',
                { markers: resolve_markers_payload }
            );

            if (result && result.success) {
                if (onStatusChange) {
                    onStatusChange(`⚡ Successfully pushed ${result.pushed_count ?? projectSections.length} sections to DaVinci Resolve "${result.timeline_name || 'Active'}"!`);
                }
            } else {
                const error_reason = result?.error || 'Unknown bridge response';
                if (onStatusChange) onStatusChange(`Resolve push failed: ${error_reason}`);
            }
        } catch (push_error) {
            console.error('Failed to push sections to Resolve:', push_error);
            const error_message = push_error instanceof Error ? push_error.message : String(push_error);
            if (onStatusChange) onStatusChange(`Resolve bridge error: ${error_message}`);
        } finally {
            setIsPushingSectionsToResolve(false);
        }
    };

    // WHAT: Converts detected song sections into discrete video clip segments on the Project Timeline.
    // WHY: Provides an instant narrative storyboard foundation with aligned timings for all verses and choruses.
    const handleAddSectionsToTimeline = () => {
        if (!activeProject || projectSections.length === 0) {
            if (onStatusChange) onStatusChange('No song sections available to add.');
            return;
        }

        const project_fps = activeProject.frameRate || 20;
        const new_clips_collection: VideoClip[] = projectSections.map((section_item, section_index) => {
            const raw_duration = Math.max(0.1, section_item.endTime - section_item.startTime);
            const aligned_duration = getAlignedDuration(raw_duration, project_fps);
            const aligned_end_time = section_item.startTime + aligned_duration;
            const track_number = (section_index % 2) + 1;

            return {
                id: `clip-section-${Date.now()}-${section_index}`,
                startTime: section_item.startTime,
                endTime: aligned_end_time,
                duration: aligned_duration,
                track: track_number,
                status: 'pending',
                source: 'main',
                label: section_item.name || `${section_item.type.toUpperCase()} ${section_index + 1}`,
                notes: {
                    action: `${section_item.name} (${section_item.type.toUpperCase()}) - ${(section_item.energyLevel ?? 0) > 0.6 ? 'High Energy' : 'Moderate Energy'}`,
                    dialogue: '',
                    sound: ''
                }
            };
        });

        // Merge with existing clips, avoiding exact start-time duplicates
        const existing_clips = clips || [];
        const existing_start_times = new Set(existing_clips.map(clip_item => Math.round(clip_item.startTime * 100)));
        const non_duplicate_new_clips = new_clips_collection.filter(new_clip => !existing_start_times.has(Math.round(new_clip.startTime * 100)));

        if (non_duplicate_new_clips.length === 0 && new_clips_collection.length > 0) {
            if (onStatusChange) onStatusChange('Sections already exist on the Project Timeline.');
            return;
        }

        const merged_clips_collection = [...existing_clips, ...non_duplicate_new_clips].sort((a, b) => a.startTime - b.startTime);

        onUpdateProject(activeProject.id, { clips: merged_clips_collection });

        if (onStatusChange) {
            onStatusChange(`Added ${non_duplicate_new_clips.length} song section clips to Project Timeline!`);
        }
    };

    // WHAT: Modifies an existing section's label, type, or timestamps and persists to active project.
    // WHY: Enables manual correction of auto-detected section bounds or naming.
    const handleUpdateSection = (updated_section: MusicSection) => {
        const revised_sections_collection = projectSections.map(existing_section =>
            existing_section.id === updated_section.id ? updated_section : existing_section
        );
        setProjectSections(revised_sections_collection);
        if (activeProject && onUpdateProject) {
            onUpdateProject(activeProject.id, { sections: revised_sections_collection });
        }
    };

    // WHAT: Removes a section from the project timeline.
    // WHY: Allows editors to clean up unwanted or merged section boundaries.
    const handleDeleteSection = (section_identifier: string) => {
        const filtered_sections_collection = projectSections.filter(section_item => section_item.id !== section_identifier);
        setProjectSections(filtered_sections_collection);
        if (activeProject && onUpdateProject) {
            onUpdateProject(activeProject.id, { sections: filtered_sections_collection });
        }
    };

    // WHAT: Seeks the master waveform player to a specific timestamp in seconds.
    // WHY: Clicking on a section header immediately jumps playback to that section.
    const handleSeekToSectionTime = (seek_timestamp_seconds: number) => {
        if (wavesurfer.current && duration > 0) {
            const progress_ratio = Math.max(0, Math.min(1, seek_timestamp_seconds / duration));
            wavesurfer.current.seekTo(progress_ratio);
        }
    };

    // ------------------------------------------------------------------------------------------------
    // Timeline Generation Logic
    // ------------------------------------------------------------------------------------------------

    // handleGenerateTimelineClip removed: now handled by App.tsx shared engine

    /**
     * Scans the project's "videos" directory for any MP4 files that match
     * our naming convention but aren't currently linked in the clips state.
     * Useful if the app was closed or interrupted during generation.
     */
    const handleSyncGeneratedVideos = async () => {
        if (!activeProject?.outputDir) {
            if (onStatusChange) onStatusChange("No project output directory found to scan.");
            return;
        }

        const fs = getNodeFs();
        const path = getNodePath();
        if (!fs || !path) return;
        const videosDir = path.join(activeProject.outputDir, 'videos');

        if (!fs.existsSync(videosDir)) {
            if (onStatusChange) onStatusChange("No 'videos' folder found in project directory.");
            return;
        }

        if (onStatusChange) onStatusChange("Scanning 'videos' folder for missing takes...");

        try {
            const files = fs.readdirSync(videosDir).filter((file_candidate: string) => file_candidate.endsWith('.mp4'));
            let updateCount = 0;

            const updatedClips = clips.map(clip => {
                const safeLabel = clip.label.replace(/[^a-z0-9]/gi, '_');
                
                // 1. Identify which videos currently exist in the videos folder for this clip
                const matchingFiles = files.filter((file_candidate: string) => {
                    const regex = new RegExp(`^${safeLabel}_take(\\d+)\\.mp4$`, 'i');
                    return regex.test(file_candidate);
                }).map((file_candidate: string) => {
                    const takeNum = parseInt(file_candidate.match(/_take(\d+)\.mp4$/i)?.[1] || "0", 10);
                    return {
                        fullPath: path.join(videosDir, file_candidate),
                        take: takeNum
                    };
                }).sort((take_a, take_b) => take_b.take - take_a.take);

                const foundPaths = matchingFiles.map(match_item => match_item.fullPath);
                
                // 2. Cross-reference with existing project data to catch deleted or manual additions
                const existingVideos = clip.generatedVideos || [];
                // Only keep existing videos that still exist on disk
                const stillExisting = existingVideos.filter(video_path => fs.existsSync(video_path));
                
                // Combine and deduplicate
                const combinedVideos = Array.from(new Set([...stillExisting, ...foundPaths]));
                
                // 3. Check active video path
                let currentVideoPath = clip.videoPath;
                const activeExists = currentVideoPath ? fs.existsSync(currentVideoPath) : false;

                // Determine if we need an update
                const videosChanged = combinedVideos.length !== existingVideos.length;
                const activeMissing = currentVideoPath && !activeExists;
                const statusUpdate = (combinedVideos.length > 0 && clip.status !== 'done');

                if (videosChanged || activeMissing || statusUpdate) {
                    updateCount++;
                    
                    // If active video is missing, try to pick the latest take from what's available
                    if (activeMissing || !currentVideoPath) {
                        currentVideoPath = matchingFiles.length > 0 ? matchingFiles[0].fullPath : (combinedVideos.length > 0 ? combinedVideos[0] : undefined);
                    }

                    return {
                        ...clip,
                        status: combinedVideos.length > 0 ? 'done' as const : (clip.status === 'done' ? 'pending' : clip.status),
                        videoPath: currentVideoPath,
                        generatedVideos: combinedVideos
                    };
                }
                return clip;
            });

            if (updateCount > 0) {
                if (onStatusChange) onStatusChange(`Sync complete: Updated ${updateCount} clips with missing videos.`);

                // Save immediately with the FRESH clips array to avoid stale closure issues
                handleSaveToProject(updatedClips);
            } else {
                if (onStatusChange) onStatusChange("Sync complete: No new videos found.");
            }
        } catch (caught_error: unknown) {
            console.error("Sync Error:", caught_error);
            const error_message = caught_error instanceof Error ? caught_error.message : String(caught_error);
            if (onStatusChange) onStatusChange(`Sync failed: ${error_message}`);
        }
    };


    // Helper: inject beat markers into a WaveSurfer's internal wrapper
    const renderBeatMarkers = (ws_instance: WaveSurfer, markers: AudioMarker[], markerDuration: number) => {
        try {
            const wrapper = ws_instance.getWrapper();
            if (!wrapper) return;
            // Remove existing markers
            wrapper.querySelectorAll('.beat-marker').forEach(element_item => element_item.remove());

            const resolvedDuration = markerDuration > 0 ? markerDuration : (ws_instance.getDuration() || durationRef.current || 0);
            if (resolvedDuration <= 0 || !markers || markers.length === 0) return;

            markers.forEach((marker_item) => {
                const left = (marker_item.time / resolvedDuration) * 100;
                if (left > 100) return;

                let color = MARKER_COLORS.default;

                if (marker_item.color) {
                    color = marker_item.color;
                } else {
                    switch (marker_item.type) {
                        case 'beat':
                            color = marker_item.isDownbeat ? MARKER_COLORS.downbeat : MARKER_COLORS.offbeat;
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
                const isDownbeat = marker_item.type === 'beat' && marker_item.isDownbeat;
                const width = isDownbeat ? '2px' : '1px';
                const opacity = marker_item.type === 'onset' ? '0.75' : (marker_item.isDownbeat ? '1' : '0.85');
                const zIndex = isDownbeat ? '32' : '30';

                const div = document.createElement('div');
                div.className = 'beat-marker';
                div.style.cssText = `
                    position: absolute;
                    left: ${left}%;
                    top: 0;
                    height: 100%;
                    min-height: 100%;
                    width: ${width};
                    background-color: ${color};
                    opacity: ${opacity};
                    pointer-events: none;
                    z-index: ${zIndex};
                    box-shadow: ${isDownbeat ? `0 0 3px ${color}` : 'none'};
                `;

                if (isDownbeat) {
                    const pip = document.createElement('div');
                    pip.className = 'beat-marker-pip';
                    pip.style.cssText = `
                        position: absolute;
                        top: 0;
                        left: -3px;
                        width: 8px;
                        height: 4px;
                        background-color: ${color};
                        border-radius: 0 0 2px 2px;
                        pointer-events: none;
                    `;
                    div.appendChild(pip);
                }

                wrapper.appendChild(div);
            });
        } catch (marker_render_error) {
            console.error('renderBeatMarkers error:', marker_render_error);
        }
    };

    // Zoom Effect — only run when audio is loaded (duration > 0)
    useEffect(() => {
        if (duration <= 0) return; // Audio not ready yet

        if (wavesurfer.current) {
            try {
                wavesurfer.current.zoom(zoomLevel);
            } catch {
                // Silently ignore — audio may still be decoding
            }
            const currentMarkers = mainBeatSource === 'main' ? mainMarkers : (typeof mainBeatSource === 'number' && stems[mainBeatSource] ? stems[mainBeatSource].markers : []);
            renderBeatMarkers(wavesurfer.current, currentMarkers, duration);
        }
        stemSurfers.current.forEach((stem_surfer, stem_index) => {
            try {
                stem_surfer.zoom(zoomLevel);
            } catch {
                // Silently ignore
            }
            if (stems[stem_index] && stems[stem_index].markers) {
                renderBeatMarkers(stem_surfer, stems[stem_index].markers, duration);
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

        ws.on('error', (wavesurfer_error: unknown) => {
            const error_message = wavesurfer_error instanceof Error ? wavesurfer_error.message : String(wavesurfer_error);
            if (!error_message.toLowerCase().includes('abort') && !error_message.toLowerCase().includes('destroy')) {
                console.error("Wavesurfer error:", wavesurfer_error);
            }
        });

        ws.on('timeupdate', (current_time_seconds: number) => {
            setPlaybackCurrentTime(current_time_seconds);
        });

        ws.on('ready', () => {
            const dur = ws.getDuration();
            setDuration(dur);
            durationRef.current = dur;

            // Sync duration to project storage if it has changed
            if (activeProject && activeProject.duration !== dur) {
                onUpdateProject(activeProject.id, { duration: dur });
            }

            // Calculate Min Zoom to prevent horizontal scrolling
            if (containerRef.current) {
                const width = containerRef.current.clientWidth;
                const calculatedMin = dur > 0 ? width / dur : 1;
                setMinZoom(calculatedMin);
            }

            try {
                ws.zoom(zoomLevel);
            } catch (zoom_error) {
                console.warn("WaveSurfer initial zoom failed", zoom_error);
            }
            // Render beat markers inside WaveSurfer wrapper using refs to avoid stale closure
            const source = mainBeatSourceRef.current;
            const currentMarkers = source === 'main'
                ? mainMarkersRef.current
                : (typeof source === 'number' && stemsRef.current[source]
                    ? stemsRef.current[source].markers
                    : []);
            renderBeatMarkers(ws, currentMarkers, dur);

            // Trigger region render
            setWaveSurfersReady(prev => prev + 1);
        });

        ws.on('redraw', () => {
            const dur = ws.getDuration() || durationRef.current;
            const source = mainBeatSourceRef.current;
            const currentMarkers = source === 'main'
                ? mainMarkersRef.current
                : (typeof source === 'number' && stemsRef.current[source]
                    ? stemsRef.current[source].markers
                    : []);
            renderBeatMarkers(ws, currentMarkers, dur);
        });

        // Register Regions Plugin
        const regions = ws.registerPlugin(RegionsPlugin.create()) as unknown as WaveSurferRegionsPluginInstance;
        wsRegions.current = regions;

        // Helper: clear only interactive (drag) regions, keep saved ones
        const clearInteractiveRegions = (regions_plugin: WaveSurferRegionsPluginInstance) => {
            const allRegions = regions_plugin.getRegions();
            allRegions.forEach((region_item: WaveSurferRegionLike) => {
                if (!region_item.id || !region_item.id.startsWith('saved-')) {
                    region_item.remove?.();
                }
            });
        };

        regions.enableDragSelection({
            color: 'rgba(255, 0, 0, 0.2)',
        });

        // Snap to Beat Logic
        regions.on('region-updated', (region_item: WaveSurferRegionLike) => {
            const currentMarkers = mainBeatSource === 'main' ? mainMarkers : (typeof mainBeatSource === 'number' && stems[mainBeatSource] ? stems[mainBeatSource].markers : []);

            let newStart = region_item.start;

            // Stage 1: Snap START to the nearest beat marker (if within threshold)
            if (currentMarkers.length > 0) {
                const snapToBeat = (time: number) => {
                    const snapPoints = [{ time: 0 }, ...currentMarkers, { time: ws.getDuration() }];
                    const closest = snapPoints.reduce((prev, curr) =>
                        Math.abs(curr.time - time) < Math.abs(prev.time - time) ? curr : prev
                    );
                    return closest.time;
                };
                const snappedStart = snapToBeat(region_item.start);
                const SNAP_THRESHOLD_PX = 10;
                const snapThresholdSecs = SNAP_THRESHOLD_PX / zoomLevel;
                if (Math.abs(region_item.start - snappedStart) <= snapThresholdSecs) {
                    newStart = snappedStart;
                }
            }

            // Stage 2: Calculate Aligned duration and set END relative to newStart
            const fps = activeProject?.frameRate || 24;
            const rawDuration = Math.max(0.1, region_item.end - newStart);
            const alignedDuration = getAlignedDuration(rawDuration, fps);
            const newEnd = newStart + alignedDuration;

            if (newStart !== region_item.start || Math.abs(newEnd - region_item.end) > 0.001) {
                region_item.setOptions({
                    start: newStart,
                    end: newEnd
                });
            }

            setActiveSelection({
                source: 'main',
                start: region_item.start,
                end: region_item.end
            });
            stemRegionsRefs.current.forEach(stem_region => clearInteractiveRegions(stem_region));
        });

        regions.on('region-created', (region_item: WaveSurferRegionLike) => {
            // Skip saved regions being re-added
            if (region_item.id && region_item.id.startsWith('saved-')) return;
            setActiveSelection({
                source: 'main',
                start: region_item.start,
                end: region_item.end
            });
            stemRegionsRefs.current.forEach(stem_region => clearInteractiveRegions(stem_region));
        });

        // Sync Stems on Interaction
        const syncStems = () => {
            const time = ws.getCurrentTime();
            stemSurfers.current.forEach(stem_surfer => {
                if (Math.abs(stem_surfer.getCurrentTime() - time) > 0.1) {
                    stem_surfer.setTime(time);
                }
            });
        };

        ws.on('interaction', syncStems);
        ws.on('play', () => {
            if (isStemPlaying) stemSurfers.current.forEach(stem_surfer => stem_surfer.play());
        });
        ws.on('pause', () => {
            if (isStemPlaying) stemSurfers.current.forEach(stem_surfer => stem_surfer.pause());
        });

        wavesurfer.current = ws;

        return () => {
            try {
                ws.destroy();
            } catch {
                // Ignore destroy errors
            }
        };
    }, [audioUrl]);

    const stemsFingerprint = stems.map(stem_item => stem_item.path + stem_item.type).join(',');

    // Initialize WaveSurfers (Stems)
    useEffect(() => {
        let isActive = true;

        if (stemRafRef.current) {
            cancelAnimationFrame(stemRafRef.current);
            stemRafRef.current = null;
        }

        // Cleanup function for stems
        const cleanupStems = () => {
            stemSurfers.current.forEach(stem_surfer => {
                try {
                    stem_surfer.destroy();
                } catch {
                    // Ignore
                }
            });
            stemSurfers.current = [];
        };

        if (stems.length === 0) return;

        // Use requestAnimationFrame to ensure the DOM has updated and containers are available
        stemRafRef.current = requestAnimationFrame(() => {
            if (!isActive) return;

            stems.forEach((stem, index) => {
                const containerId = `stem-waveform-${index}`;
                const container = document.getElementById(containerId);
                if (container) {
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
                    const stemRegions = ws.registerPlugin(RegionsPlugin.create()) as unknown as WaveSurferRegionsPluginInstance;
                    stemRegionsRefs.current.set(index, stemRegions);

                    stemRegions.enableDragSelection({
                        color: hexToRgba(stem.color, 0.2),
                    });

                    const handleStemRegionUpdate = (region_item: WaveSurferRegionLike) => {
                        // Skip saved regions
                        if (region_item.id && region_item.id.startsWith('saved-')) return;

                        let newStart = region_item.start;
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
                            const snappedStart = snapToBeat(region_item.start);
                            const SNAP_THRESHOLD_PX = 10;
                            const snapThresholdSecs = SNAP_THRESHOLD_PX / zoomLevel;
                            if (Math.abs(region_item.start - snappedStart) <= snapThresholdSecs) {
                                newStart = snappedStart;
                            }
                        }

                        // Stage 2: Calculate Aligned duration and set END relative to newStart
                        const fps = activeProject?.frameRate || 24;
                        const rawDuration = Math.max(0.1, region_item.end - newStart);
                        const alignedDuration = getAlignedDuration(rawDuration, fps);
                        const newEnd = newStart + alignedDuration;

                        if (newStart !== region_item.start || Math.abs(newEnd - region_item.end) > 0.001) {
                            region_item.setOptions({
                                start: newStart,
                                end: newEnd
                            });
                        }

                        setActiveSelection({
                            source: 'stem',
                            stemIndex: index,
                            start: region_item.start,
                            end: region_item.end
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
    }, [stemsFingerprint]);

    // Validate beat source if stems change
    useEffect(() => {
        // If mainBeatSource was a stem index that no longer exists, reset to 'main'
        if (typeof mainBeatSource === 'number' && (!stems[mainBeatSource] || stems.length === 0)) {
            setMainBeatSource('main');
        }
    }, [stems, mainBeatSource]);

    // WHAT: Global keyboard listener for non-linear editor (NLE) playback navigation and clip markers.
    // WHY: Provides keyboard workflow parity with standard NLE suites (Space, J, K, L, I, O, C) for sub-frame beat editing.
    useEffect(() => {
        const handleKeyDown = (keyboard_event: KeyboardEvent) => {
            // Disable when typing inside active text inputs or contenteditable containers
            if (
                document.activeElement?.tagName === 'INPUT' ||
                document.activeElement?.tagName === 'TEXTAREA' ||
                (document.activeElement as HTMLElement)?.isContentEditable
            ) {
                return;
            }

            const main_wavesurfer = wavesurfer.current;
            if (!main_wavesurfer) {
                return;
            }

            const current_playback_time = main_wavesurfer.getCurrentTime();
            const total_duration = main_wavesurfer.getDuration();

            switch (keyboard_event.key.toLowerCase()) {
                case ' ': {
                    keyboard_event.preventDefault();
                    if (main_wavesurfer.isPlaying()) {
                        main_wavesurfer.pause();
                        stemSurfers.current.forEach(stem_surfer => stem_surfer.pause());
                    } else {
                        main_wavesurfer.play();
                        stemSurfers.current.forEach(stem_surfer => stem_surfer.play());
                    }
                    break;
                }
                case 'k': {
                    // WHAT: Pause playback immediately across all tracks
                    keyboard_event.preventDefault();
                    main_wavesurfer.pause();
                    stemSurfers.current.forEach(stem_surfer => stem_surfer.pause());
                    break;
                }
                case 'l': {
                    // WHAT: Play forward or cycle speed multiplier (up to 8x)
                    keyboard_event.preventDefault();
                    if (!main_wavesurfer.isPlaying()) {
                        main_wavesurfer.setPlaybackRate(1);
                        stemSurfers.current.forEach(stem_surfer => stem_surfer.setPlaybackRate(1));
                        main_wavesurfer.play();
                        stemSurfers.current.forEach(stem_surfer => stem_surfer.play());
                    } else {
                        const current_rate = main_wavesurfer.getPlaybackRate();
                        const next_rate = Math.min(8, current_rate * 2);
                        main_wavesurfer.setPlaybackRate(next_rate);
                        stemSurfers.current.forEach(stem_surfer => stem_surfer.setPlaybackRate(next_rate));
                    }
                    break;
                }
                case 'j': {
                    // WHAT: Rewind / return to 1x normal speed or step backward by 5 seconds
                    keyboard_event.preventDefault();
                    const current_rate = main_wavesurfer.getPlaybackRate();
                    if (main_wavesurfer.isPlaying() && current_rate > 1) {
                        main_wavesurfer.setPlaybackRate(1);
                        stemSurfers.current.forEach(stem_surfer => stem_surfer.setPlaybackRate(1));
                    } else {
                        const new_rewound_time = Math.max(0, current_playback_time - 5);
                        main_wavesurfer.setTime(new_rewound_time);
                        stemSurfers.current.forEach(stem_surfer => stem_surfer.setTime(new_rewound_time));
                    }
                    break;
                }
                case 'i': {
                    // WHAT: Mark In point for region selection
                    keyboard_event.preventDefault();
                    if (wsRegions.current) {
                        const all_regions = wsRegions.current.getRegions();
                        const existing_region = all_regions.find((region_item: WaveSurferRegionLike) => !region_item.id || !region_item.id.startsWith('saved-'));

                        const mark_in_time = current_playback_time;
                        let mark_out_time = Math.min(total_duration, mark_in_time + 5);

                        if (existing_region) {
                            mark_out_time = existing_region.end;
                            if (mark_in_time > mark_out_time) {
                                mark_out_time = Math.min(total_duration, mark_in_time + 5);
                            }
                            existing_region.setOptions({ start: mark_in_time, end: mark_out_time });
                            setActiveSelection({ source: 'main', start: mark_in_time, end: mark_out_time });
                        } else {
                            wsRegions.current.addRegion({
                                start: mark_in_time,
                                end: mark_out_time,
                                color: 'rgba(255, 0, 0, 0.2)',
                            });
                            setActiveSelection({ source: 'main', start: mark_in_time, end: mark_out_time });
                        }
                    }
                    break;
                }
                case 'o': {
                    // WHAT: Mark Out point for region selection
                    keyboard_event.preventDefault();
                    if (wsRegions.current) {
                        const all_regions = wsRegions.current.getRegions();
                        const existing_region = all_regions.find((region_item: WaveSurferRegionLike) => !region_item.id || !region_item.id.startsWith('saved-'));

                        const mark_out_time = current_playback_time;
                        let mark_in_time = Math.max(0, mark_out_time - 5);

                        if (existing_region) {
                            mark_in_time = existing_region.start;
                            if (mark_in_time > mark_out_time) {
                                mark_in_time = Math.max(0, mark_out_time - 5);
                            }
                            existing_region.setOptions({ start: mark_in_time, end: mark_out_time });
                            setActiveSelection({ source: 'main', start: mark_in_time, end: mark_out_time });
                        } else {
                            wsRegions.current.addRegion({
                                start: mark_in_time,
                                end: mark_out_time,
                                color: 'rgba(255, 0, 0, 0.2)',
                            });
                            setActiveSelection({ source: 'main', start: mark_in_time, end: mark_out_time });
                        }
                    }
                    break;
                }
                case 'c': {
                    // WHAT: Cut keyboard command ('C') triggers segment creation from current active selection
                    keyboard_event.preventDefault();
                    document.dispatchEvent(new CustomEvent('NLE_ADD_SEGMENT'));
                    break;
                }
                default:
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [stems]);

    // WHAT: Catches the decoupled 'NLE_ADD_SEGMENT' custom event
    // WHY: Decouples keyboard listener from closure staleness, assuring freshest selection and clip arrays.
    useEffect(() => {
        const handleCustomAdd = () => {
            handleAddSegment();
        };
        document.addEventListener('NLE_ADD_SEGMENT', handleCustomAdd);
        return () => document.removeEventListener('NLE_ADD_SEGMENT', handleCustomAdd);
    }, [activeSelection, clips, stems]);

    // WHAT: Adds the currently active region selection as a discrete video clip to the timeline
    // WHY: Aligns clip duration to valid MiniMax frame boundary mathematical formulas.
    const handleAddSegment = () => {
        if (!activeSelection) {
            if (onStatusChange) {
                onStatusChange('Select a region on a waveform first.');
            }
            return;
        }
        const project_fps = activeProject?.frameRate || 20;
        const new_clip_item = createClipFromSelection({
            selection: activeSelection,
            stems,
            existingClipsCount: clips.length,
            frameRate: project_fps
        });

        onUpdateProject(activeProject!.id, (prev: BeatProject) => ({ clips: [...(prev.clips || []), new_clip_item] }) as Partial<BeatProject>);
        setActiveSelection(null);

        // Clear interactive drag regions so only saved ones remain visible
        if (wsRegions.current) {
            wsRegions.current.clearRegions();
        }
        stemRegionsRefs.current.forEach(region_instance => region_instance.clearRegions());

        const total_aligned_frames = Math.round(new_clip_item.duration * project_fps);
        if (onStatusChange) {
            onStatusChange(`Segment added: ${formatTime(new_clip_item.startTime)} – ${formatTime(new_clip_item.endTime)} (${total_aligned_frames} frames @ ${project_fps}fps, ${new_clip_item.duration.toFixed(2)}s)`);
        }

        if (activeProject) {
            onUpdateProject(activeProject.id, { clips: [...clips, new_clip_item] });
        }
    };

    // WHAT: Deletes a specific clip from the timeline by unique ID
    // WHY: Allows pruning and reordering segments without modifying underlying audio sources.
    const handleRemoveClip = (clipId: string) => {
        const filtered_clips = clips.filter(clip_item => clip_item.id !== clipId);
        onUpdateProject(activeProject!.id, { clips: filtered_clips });
    };

    // WHAT: Serializes and saves all project clips, markers, and stem definitions to disk
    // WHY: Preserves full project state across sessions and updates the active project file.
    const handleSaveToProject = async (overrideClips?: VideoClip[]) => {
        if (!activeProject) {
            if (onStatusChange) {
                onStatusChange('No project selected.');
            }
            return;
        }
        try {
            const ipcRenderer = getElectronIpc();

            // If project has no outputDir, load it from user preferences config
            let base_output_directory = activeProject.outputDir;
            if (!base_output_directory && ipcRenderer) {
                const config_response = await ipcRenderer.invoke<{ success: boolean; config?: { projectOutputDir?: string } }>('get-config');
                if (config_response.success && config_response.config?.projectOutputDir) {
                    base_output_directory = config_response.config.projectOutputDir;
                }
            }

            if (!base_output_directory) {
                if (onStatusChange) {
                    onStatusChange('No output folder configured. Set one in Settings → Defaults.');
                }
                return;
            }

            // Build the full set of project stems (with current marker data) for saving
            const project_stems_to_save = stems.map(stem_item => ({
                type: stem_item.type,
                path: stem_item.path,
                color: stem_item.color,
                beats: stem_item.markers
                    ? stem_item.markers.filter(marker_item => marker_item.type === 'beat').map(marker_item => marker_item.time)
                    : [],
                markers: stem_item.markers
                    ? stem_item.markers.map(marker_item => ({
                        timestamp: marker_item.time,
                        frame: Math.round(marker_item.time * (activeProject.frameRate || 20)),
                        color: marker_item.color || '#ffffff',
                        note: stem_item.type,
                        type: marker_item.type as 'beat' | 'onset' | 'loudness',
                        duration_sec: 0.05
                    }))
                    : []
            }));

            // Build main markers from current mainMarkers state
            const main_markers_to_save = mainMarkers.map(main_marker => ({
                timestamp: main_marker.time,
                frame: Math.round(main_marker.time * (activeProject.frameRate || 20)),
                color: main_marker.color || (main_marker.isDownbeat ? MARKER_COLORS.downbeat : MARKER_COLORS.offbeat),
                note: '',
                type: main_marker.type as 'beat' | 'onset' | 'loudness',
                duration_sec: 0.05
            }));

            // Update project with all available metadata
            const beat_only_markers = mainMarkers.filter(marker_item => marker_item.type === 'beat');
            onUpdateProject(activeProject.id, {
                clips: overrideClips || clips,
                outputDir: base_output_directory,
                markers: main_markers_to_save,
                stems: project_stems_to_save,
                frameRate: activeProject.frameRate || 20,
                algorithm: algorithm,
                beatCount: beat_only_markers.length || undefined,
                bpm: beat_only_markers.length > 1
                    ? Math.round(60 / ((beat_only_markers[beat_only_markers.length - 1].time - beat_only_markers[0].time) / (beat_only_markers.length - 1)))
                    : activeProject.bpm,
            });
            if (onStatusChange) {
                onStatusChange(`Project saved ✓  →  ${base_output_directory}`);
            }
        } catch (save_error: unknown) {
            console.error('Save failed:', save_error);
            if (onStatusChange) {
                onStatusChange('Error saving project.');
            }
        }
    };

    // WHAT: Invokes the native file dialog to choose start or end reference frames
    // WHY: Allows specifying keyframes for image-to-video (I2V) and start-end interpolation workflows.
    const handlePickImage = async (clipId: string, field: 'startImagePath' | 'endImagePath') => {
        if (onPickImage) {
            onPickImage(clipId, field);
        }
    };

    // WHAT: Modifies the semantic function assigned to an image slot on a timeline clip.
    // WHY: Keeps the timeline table synchronized with storyboard image role configurations.
    const handleUpdateClipRole = (clipId: string, slot: 'startImageFunction' | 'endImageFunction', role: ImageFunction) => {
        const updated_clips = clips.map(clip_item =>
            clip_item.id === clipId
                ? { ...clip_item, [slot]: role }
                : clip_item
        );
        if (activeProject) {
            onUpdateProject(activeProject.id, { clips: updated_clips });
        }
    };

    // WHAT: Modifies a clip's user-facing text label
    // WHY: Enables organizing narrative storyboards by scene name.
    const handleUpdateClipLabel = (clipId: string, newLabel: string) => {
        const updated_clips = clips.map(clip_item => clip_item.id === clipId ? { ...clip_item, label: newLabel } : clip_item);
        if (activeProject) {
            onUpdateProject(activeProject.id, { clips: updated_clips });
        }
    };

    // WHAT: Updates the prompt action description in a clip's metadata
    // WHY: Controls generative prompt generation for ComfyUI video tasks.
    const handleUpdateClipPrompt = (clipId: string, newPrompt: string) => {
        const updated_clips = clips.map(clip_item =>
            clip_item.id === clipId
                ? { ...clip_item, notes: { ...(clip_item.notes || { action: '', dialogue: '', sound: '' }), action: newPrompt } }
                : clip_item
        );
        if (activeProject) {
            onUpdateProject(activeProject.id, { clips: updated_clips });
        }
    };

    // WHAT: Shifts a clip's start time and adjusts its end time to preserve duration
    // WHY: Supports manual positioning and nudge operations on the timeline.
    const handleUpdateClipStartTime = (clipId: string, newStartTime: number) => {
        const updated_clips = updateClipStartTime(clips, clipId, newStartTime);
        if (activeProject) {
            onUpdateProject(activeProject.id, { clips: updated_clips });
        }
    };

    // WHAT: Adjusts clip end time and ripples downstream clips to maintain continuous sequencing
    // WHY: Maintains timing integrity across contiguous music video segments.
    const handleUpdateClipEndTime = (clipId: string, newEndTime: number) => {
        const project_frame_rate = activeProject?.frameRate || 20;
        onUpdateProject(activeProject!.id, (prev: BeatProject) => {
            const current_clips = prev.clips || [];
            const updated_clips = updateClipEndTimeWithRipple(current_clips, clipId, newEndTime, project_frame_rate);
            if (activeProject) {
                onUpdateProject(activeProject.id, { clips: updated_clips });
            }
            return { clips: updated_clips };
        });
    };

    // WHAT: Attaches tooltip hover and context-menu listeners to a single WaveSurfer region element.
    // WHY: Main-track and stem-track regions need identical interaction behavior (hover tooltip, mousemove tracking,
    // mouseleave dismiss, right-click duration popup) — this shared helper eliminates duplicating 4 addEventListener
    // calls and the tooltip JSX builder for each track type.
    const attachRegionInteractionListeners = (
        region_element: HTMLElement,
        clip_item: VideoClip,
        total_frames_count: number,
        tooltip_accent_color: { border: string; text: string }
    ) => {
        region_element.addEventListener('mouseenter', (mouse_event: MouseEvent) => {
            setTooltipState({
                visible: true,
                x: mouse_event.clientX,
                y: mouse_event.clientY - 60,
                content: (
                    <div style={{ backgroundColor: '#11111e', border: `1px solid ${tooltip_accent_color.border}`, borderRadius: '8px', padding: '8px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', fontSize: '10px', fontWeight: '700', pointerEvents: 'none' }}>
                        <div style={{ color: tooltip_accent_color.text, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '2px' }}>{clip_item.label || 'Unnamed Clip'}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '8px', color: '#94a3b8' }}>
                            <span>START:</span><span style={{ color: 'white', fontFamily: 'monospace' }}>{formatTime(clip_item.startTime)}</span>
                            <span>DUR:</span><span style={{ color: 'white', fontFamily: 'monospace' }}>{(clip_item.duration || (clip_item.endTime - clip_item.startTime)).toFixed(2)}s</span>
                            <span>FRAMES:</span><span style={{ color: '#f59e0b', fontFamily: 'monospace', fontWeight: '800' }}>{total_frames_count}</span>
                        </div>
                    </div>
                )
            });
        });
        region_element.addEventListener('mousemove', (mouse_event: MouseEvent) => {
            setTooltipState(previous_state => previous_state.visible ? { ...previous_state, x: mouse_event.clientX, y: mouse_event.clientY - 60 } : previous_state);
        });
        region_element.addEventListener('mouseleave', () => setTooltipState(previous_state => ({ ...previous_state, visible: false })));
        region_element.addEventListener('contextmenu', (mouse_event: MouseEvent) => {
            mouse_event.preventDefault();
            setDurationPopup({
                clipId: clip_item.id,
                duration: clip_item.duration || (clip_item.endTime - clip_item.startTime),
                startTime: clip_item.startTime,
                x: mouse_event.clientX,
                y: mouse_event.clientY,
            });
        });
    };

    // WHAT: Styles a WaveSurfer region element and wires up its interaction listeners.
    // WHY: Both main-track and stem-track regions share identical visual styling (z-index, border, border-radius)
    // and interaction behavior — this consolidates region setup into a single call site.
    const styleAndBindRegion = (
        region_element: HTMLElement,
        clip_item: VideoClip,
        region_color: string,
        project_fps: number,
        tooltip_accent_color: { border: string; text: string }
    ) => {
        region_element.style.zIndex = '10';
        region_element.style.border = `1px solid ${region_color.replace('0.48', '0.8')}`;
        region_element.style.borderRadius = '2px';
        const total_frames_count = Math.round((clip_item.duration || (clip_item.endTime - clip_item.startTime)) * project_fps);
        attachRegionInteractionListeners(region_element, clip_item, total_frames_count, tooltip_accent_color);
    };

    // WHAT: Visualizes saved clip regions over the main track and individual stem waveforms.
    // WHY: Provides instant visual verification of timeline coverage against audio waveforms.
    useEffect(() => {
        const renderSavedRegions = () => {
            const alternating_colors_palette = [
                'rgba(99, 102, 241, 0.48)', // Vivid Indigo
                'rgba(168, 85, 247, 0.48)'  // Vivid Purple
            ];
            const project_fps = activeProject?.frameRate || 20;

            // WHAT: Accent color tokens for main-track vs stem-track tooltip chrome.
            // WHY: Main-track regions use indigo accents while stem-track regions use purple accents,
            // providing instant visual differentiation of which waveform layer a tooltip belongs to.
            const main_track_accent = { border: 'rgba(99,102,241,0.3)', text: '#818cf8' };
            const stem_track_accent = { border: 'rgba(167,139,250,0.3)', text: '#a78bfa' };

            // Render main-track clips
            const current_main_regions = wsRegions.current;
            if (current_main_regions) {
                current_main_regions.clearRegions();
                const main_track_clips = clips.filter(clip_item => clip_item.source === 'main');
                main_track_clips.forEach((clip_item, clip_index) => {
                    const region_color = alternating_colors_palette[clip_index % alternating_colors_palette.length];
                    const created_region = current_main_regions.addRegion({
                        id: `saved-${clip_item.id}`,
                        start: clip_item.startTime,
                        end: clip_item.endTime,
                        color: region_color,
                        drag: false,
                        resize: false,
                    });
                    if (created_region.element) {
                        styleAndBindRegion(created_region.element, clip_item, region_color, project_fps, main_track_accent);
                    }
                });
            }

            // Render stem clips
            stemRegionsRefs.current.forEach((stem_region_instance, stem_index) => {
                stem_region_instance.clearRegions();
                const stem_type_string = stems[stem_index]?.type;
                if (!stem_type_string) {
                    return;
                }
                const stem_matching_clips = clips.filter(clip_item => clip_item.source === 'stem' && clip_item.stemName === stem_type_string);
                stem_matching_clips.forEach((clip_item, clip_index) => {
                    const region_color = alternating_colors_palette[clip_index % alternating_colors_palette.length];
                    const created_region = stem_region_instance.addRegion({
                        id: `saved-${clip_item.id}`,
                        start: clip_item.startTime,
                        end: clip_item.endTime,
                        color: region_color,
                        drag: false,
                        resize: false,
                    });
                    if (created_region.element) {
                        styleAndBindRegion(created_region.element, clip_item, region_color, project_fps, stem_track_accent);
                    }
                });
            });
        };

        const timer = setTimeout(renderSavedRegions, 250);
        return () => clearTimeout(timer);
    }, [clips, stems, duration, waveSurfersReady]);

    // WHAT: Converts the active waveform selection directly into a video generation job
    // WHY: Streamlines taking a selected musical bar or phrase directly to video generation.
    const handleGenerateClipFromRegion = async () => {
        if (!activeSelection) {
            if (onStatusChange) {
                onStatusChange("Please select a region on the waveform first.");
            }
            return;
        }

        const { start: selection_start_time, end: selection_end_time, source, stemIndex } = activeSelection;
        const segment_duration = selection_end_time - selection_start_time;

        const timeline_track_index = (clips.length % 2) + 1;

        if (!activeProject) {
            return;
        }

        const new_clip_item: VideoClip = {
            id: Date.now().toString(),
            startTime: selection_start_time,
            endTime: selection_end_time,
            duration: segment_duration,
            track: timeline_track_index,
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

        const updated_clips_collection = [...clips, new_clip_item];
        onUpdateProject(activeProject.id, { clips: updated_clips_collection });

        if (onGenerateVideo) {
            onGenerateVideo(new_clip_item.id);
        }
    };

    // WHAT: Stages marker export Lua/Python script for DaVinci Resolve import
    // WHY: Translates web beat detection data into native Resolve timeline markers.
    const handleExportMarkers = async () => {
        if (!activeProject) {
            if (onStatusChange) {
                onStatusChange('No project selected.');
            }
            return;
        }

        const aggregated_export_markers = buildResolveExportMarkers(mainMarkers, stems, activeProject.frameRate || 24);

        if (aggregated_export_markers.length === 0) {
            if (onStatusChange) {
                onStatusChange('No markers found to export.');
            }
            return;
        }

        const ipcRenderer = getElectronIpc();
        const pathModule = getNodePath();

        if (!ipcRenderer || !pathModule) {
            if (onStatusChange) {
                onStatusChange('Resolve export requires running in Electron.');
            }
            return;
        }

        let resolved_audio_path_string = activeProject.audioPath || audioFile?.path;
        if (resolved_audio_path_string && !pathModule.isAbsolute(resolved_audio_path_string) && activeProject.outputDir) {
            resolved_audio_path_string = pathModule.resolve(activeProject.outputDir, resolved_audio_path_string);
        }

        const export_data_payload = {
            projectName: activeProject.name || 'Untitled Project',
            audioPath: resolved_audio_path_string,
            csvPath: '',
            markers: aggregated_export_markers
        };

        if (onStatusChange) {
            onStatusChange('Generating Resolve Markers script...');
        }
        const export_result = await ipcRenderer.invoke<{ success: boolean; scriptPath?: string; error?: string }>('stage-for-resolve', export_data_payload);

        if (export_result.success) {
            if (onStatusChange) {
                onStatusChange(`Markers script generated: ${export_result.scriptPath}`);
            }
        } else {
            if (onStatusChange) {
                onStatusChange(`Marker export failed: ${export_result.error}`);
            }
        }
    };

    // WHAT: Generates a script that imports audio and video files into the DaVinci Resolve Media Pool
    // WHY: Media files must be indexed in Resolve before they can be sequenced onto tracks.
    const handleExportMediaOnly = async () => {
        if (!activeProject || !audioFile?.path) {
            if (onStatusChange) {
                onStatusChange('No project or audio file selected.');
            }
            return;
        }

        const ipcRenderer = getElectronIpc();
        const pathModule = getNodePath();

        if (!ipcRenderer || !pathModule) {
            if (onStatusChange) {
                onStatusChange('Resolve media export requires running in Electron.');
            }
            return;
        }

        let resolved_audio_path_string = activeProject.audioPath || audioFile?.path;
        if (resolved_audio_path_string && !pathModule.isAbsolute(resolved_audio_path_string) && activeProject.outputDir) {
            resolved_audio_path_string = pathModule.resolve(activeProject.outputDir, resolved_audio_path_string);
        }

        const absolute_video_paths_collection = clips
            .filter(clip_item => clip_item.videoPath)
            .map(clip_item => {
                let video_path_string = clip_item.videoPath!;
                if (!pathModule.isAbsolute(video_path_string) && activeProject.outputDir) {
                    video_path_string = pathModule.resolve(activeProject.outputDir, video_path_string);
                }
                return video_path_string;
            });

        const export_data_payload = {
            projectName: activeProject.name,
            audioPath: resolved_audio_path_string,
            videoPaths: absolute_video_paths_collection,
            beats: []
        };

        if (onStatusChange) {
            onStatusChange('Generating Resolve Load Media script...');
        }
        const export_result = await ipcRenderer.invoke<{ success: boolean; scriptPath?: string; error?: string }>('stage-video-sync', export_data_payload);

        if (export_result.success) {
            if (onStatusChange) {
                onStatusChange(`Load Media script generated: ${export_result.scriptPath}`);
            }
        } else {
            if (onStatusChange) {
                onStatusChange(`Load Media export failed: ${export_result.error}`);
            }
        }
    };

    // WHAT: Generates an assembly script to construct an entire edited timeline in Resolve
    // WHY: Provides an offline fallback if live HTTP bridge is not currently running.
    const handleExportManifest = async () => {
        if (!activeProject) {
            if (onStatusChange) {
                onStatusChange('No project selected.');
            }
            return;
        }

        const project_clips_with_video = clips.filter(clip_item => clip_item.videoPath);
        if (project_clips_with_video.length === 0) {
            if (onStatusChange) {
                onStatusChange('No generated clips found in the timeline.');
            }
            return;
        }

        const ipcRenderer = getElectronIpc();
        const pathModule = getNodePath();

        if (!ipcRenderer || !pathModule) {
            if (onStatusChange) {
                onStatusChange('Resolve timeline export requires running in Electron.');
            }
            return;
        }

        let resolved_audio_path_string = activeProject.audioPath || audioFile?.path;
        if (resolved_audio_path_string && !pathModule.isAbsolute(resolved_audio_path_string) && activeProject.outputDir) {
            resolved_audio_path_string = pathModule.resolve(activeProject.outputDir, resolved_audio_path_string);
        }

        const resolved_clips_collection = project_clips_with_video.map(clip_item => {
            let video_path_string = clip_item.videoPath!;
            if (!pathModule.isAbsolute(video_path_string) && activeProject.outputDir) {
                video_path_string = pathModule.resolve(activeProject.outputDir, video_path_string);
            }
            return {
                ...clip_item,
                videoPath: video_path_string,
                path: video_path_string
            };
        });

        const export_data_payload = {
            projectName: activeProject.name || 'Untitled Project',
            audioPath: resolved_audio_path_string,
            frameRate: activeProject.frameRate || 24,
            clips: resolved_clips_collection
        };

        if (onStatusChange) {
            onStatusChange('Generating Resolve export script...');
        }

        const export_result = await ipcRenderer.invoke<{ success: boolean; scriptPath?: string; error?: string }>('stage-timeline-to-resolve', export_data_payload);

        if (export_result.success) {
            if (onStatusChange) {
                onStatusChange(`Resolve script generated: ${export_result.scriptPath}`);
            }
        } else {
            console.error('Export failed:', export_result.error);
            if (onStatusChange) {
                onStatusChange(`Export failed: ${export_result.error}`);
            }
        }
    };

    // ---------------------------------------------------------------------------
    // DaVinci Resolve Live HTTP Bridge Handlers
    // ---------------------------------------------------------------------------

    // WHAT: Directly pushes beat, onset, and loudness markers into DaVinci Resolve's active timeline.
    // WHY: Provides instant sub-second synchronization without writing scripts or manual clicking in Resolve.
    const handleLivePushMarkers = async () => {
        if (!activeProject) {
            if (onStatusChange) {
                onStatusChange('No active project selected.');
            }
            return;
        }

        const aggregated_markers_collection = buildResolveExportMarkers(mainMarkers, stems, activeProject.frameRate || 24);

        if (aggregated_markers_collection.length === 0) {
            if (onStatusChange) {
                onStatusChange('No markers found to push.');
            }
            return;
        }

        const ipcRenderer = getElectronIpc();
        if (!ipcRenderer) {
            if (onStatusChange) {
                onStatusChange('Live Resolve Bridge requires running in Electron.');
            }
            return;
        }

        if (onStatusChange) {
            onStatusChange('⚡ Pushing markers directly to DaVinci Resolve...');
        }
        try {
            const push_result = await ipcRenderer.invoke<{ success: boolean; pushed_count?: number; timeline_name?: string; error?: string }>('resolve-bridge-push-markers', {
                markers: aggregated_markers_collection
            });

            if (push_result.success) {
                if (onStatusChange) {
                    onStatusChange(`⚡ Successfully pushed ${push_result.pushed_count} markers to timeline: "${push_result.timeline_name}"!`);
                }
            } else {
                if (onStatusChange) {
                    onStatusChange(`Bridge Push Failed: ${push_result.error}. (Make sure resolve_bridge is running in Resolve)`);
                }
            }
        } catch (push_error: unknown) {
            const error_message_string = push_error instanceof Error ? push_error.message : String(push_error);
            if (onStatusChange) {
                onStatusChange(`Bridge Error: ${error_message_string}`);
            }
        }
    };

    // WHAT: Imports audio and generated video clips directly into Resolve's active Media Pool.
    // WHY: Avoids manual media import steps through the bridge HTTP connection.
    const handleLiveImportMedia = async () => {
        if (!activeProject) {
            if (onStatusChange) {
                onStatusChange('No active project selected.');
            }
            return;
        }

        const ipcRenderer = getElectronIpc();
        const pathModule = getNodePath();
        if (!ipcRenderer || !pathModule) {
            if (onStatusChange) {
                onStatusChange('Live Resolve Bridge requires running in Electron.');
            }
            return;
        }

        let resolved_audio_path_string = activeProject.audioPath || audioFile?.path || '';
        if (resolved_audio_path_string && !pathModule.isAbsolute(resolved_audio_path_string) && activeProject.outputDir) {
            resolved_audio_path_string = pathModule.resolve(activeProject.outputDir, resolved_audio_path_string);
        }

        const absolute_video_paths_collection = clips
            .filter(clip_item => clip_item.videoPath)
            .map(clip_item => {
                let video_path_string = clip_item.videoPath!;
                if (!pathModule.isAbsolute(video_path_string) && activeProject.outputDir) {
                    video_path_string = pathModule.resolve(activeProject.outputDir, video_path_string);
                }
                return video_path_string;
            });

        if (onStatusChange) {
            onStatusChange('⚡ Importing media directly into DaVinci Resolve Media Pool...');
        }
        try {
            const import_result = await ipcRenderer.invoke<{ success: boolean; audio_imported?: boolean; imported_video_count?: number; error?: string }>('resolve-bridge-import-media', {
                audioPath: resolved_audio_path_string,
                videoPaths: absolute_video_paths_collection
            });

            if (import_result.success) {
                if (onStatusChange) {
                    onStatusChange(`⚡ Media Imported: ${import_result.audio_imported ? 'Audio + ' : ''}${import_result.imported_video_count} video clips added to Media Pool!`);
                }
            } else {
                if (onStatusChange) {
                    onStatusChange(`Media Import Failed: ${import_result.error}`);
                }
            }
        } catch (import_error: unknown) {
            const error_message_string = import_error instanceof Error ? import_error.message : String(import_error);
            if (onStatusChange) {
                onStatusChange(`Bridge Error: ${error_message_string}`);
            }
        }
    };

    // WHAT: Reconstructs the complete video timeline with clips placed at designed start/end times.
    // WHY: 1-click timeline assembly directly into the active Resolve project.
    const handleLiveBuildTimeline = async () => {
        if (!activeProject) {
            if (onStatusChange) {
                onStatusChange('No active project selected.');
            }
            return;
        }

        const timeline_clips_collection = clips.filter(clip_item => clip_item.videoPath);
        if (timeline_clips_collection.length === 0) {
            if (onStatusChange) {
                onStatusChange('No generated video clips found on the timeline.');
            }
            return;
        }

        const ipcRenderer = getElectronIpc();
        const pathModule = getNodePath();
        if (!ipcRenderer || !pathModule) {
            if (onStatusChange) {
                onStatusChange('Live Resolve Bridge requires running in Electron.');
            }
            return;
        }

        let resolved_audio_path_string = activeProject.audioPath || audioFile?.path || '';
        if (resolved_audio_path_string && !pathModule.isAbsolute(resolved_audio_path_string) && activeProject.outputDir) {
            resolved_audio_path_string = pathModule.resolve(activeProject.outputDir, resolved_audio_path_string);
        }

        const resolved_timeline_clips = timeline_clips_collection.map(clip_item => {
            let video_path_string = clip_item.videoPath!;
            if (!pathModule.isAbsolute(video_path_string) && activeProject.outputDir) {
                video_path_string = pathModule.resolve(activeProject.outputDir, video_path_string);
            }
            return {
                ...clip_item,
                videoPath: video_path_string,
                path: video_path_string
            };
        });

        if (onStatusChange) {
            onStatusChange('⚡ Reconstructing timeline in DaVinci Resolve...');
        }
        try {
            const build_result = await ipcRenderer.invoke<{ success: boolean; timeline_name?: string; placed_clips_count?: number; error?: string }>('resolve-bridge-reconstruct-timeline', {
                projectName: activeProject.name || 'Untitled Project',
                audioPath: resolved_audio_path_string,
                frameRate: activeProject.frameRate || 24,
                clips: resolved_timeline_clips
            });

            if (build_result.success) {
                if (onStatusChange) {
                    onStatusChange(`⚡ Timeline Built: "${build_result.timeline_name}" with ${build_result.placed_clips_count} clips placed!`);
                }

                // WHAT: Automatically push section markers and chapter points to the newly reconstructed Resolve timeline
                if (projectSections.length > 0) {
                    try {
                        const frame_rate_val = activeProject.frameRate || 24;
                        const auto_section_markers = projectSections.map(section_item => ({
                            frame: Math.round(section_item.startTime * frame_rate_val),
                            timestamp: section_item.startTime,
                            color: SECTION_TYPE_COLOR_MAP[section_item.type]?.resolveColor || 'Blue',
                            note: `${section_item.name} (${section_item.type.toUpperCase()})`,
                            type: 'chapter',
                            duration_sec: Math.max(1, section_item.endTime - section_item.startTime)
                        }));
                        await ipcRenderer.invoke('resolve-bridge-push-markers', { markers: auto_section_markers });
                    } catch (auto_marker_error) {
                        console.warn('Auto-pushing section markers to newly reconstructed timeline:', auto_marker_error);
                    }
                }
            } else {
                if (onStatusChange) {
                    onStatusChange(`Timeline Build Failed: ${build_result.error}`);
                }
            }
        } catch (build_error: unknown) {
            const error_message_string = build_error instanceof Error ? build_error.message : String(build_error);
            if (onStatusChange) {
                onStatusChange(`Bridge Error: ${error_message_string}`);
            }
        }
    };

    const [isStemPlaying, setIsStemPlaying] = useState(false);

    // WHAT: Starts playback of all stems in sync from timestamp zero
    // WHY: Lets users audition isolated instrumental arrangements without the master track.
    const handlePlayStems = () => {
        stemSurfers.current.forEach(stem_surfer => {
            stem_surfer.setVolume(1);
            stem_surfer.setTime(0);
            stem_surfer.play();
        });
        setIsStemPlaying(true);
    };

    // WHAT: Pauses playback on all stem tracks simultaneously
    // WHY: Stops multi-track stem auditioning.
    const handlePauseAll = () => {
        stemSurfers.current.forEach(stem_surfer => stem_surfer.pause());
        setIsStemPlaying(false);
    };

    // WHAT: Resumes playback on the main master waveform
    // WHY: Toggles main track auditioning and clears stem solo state.
    const handlePlayMain = () => {
        if (wavesurfer.current) {
            wavesurfer.current.setVolume(1);
            wavesurfer.current.setMuted(false);
            setIsStemPlaying(false);
            wavesurfer.current.play();
        }
    };

    // WHAT: Pauses playback on the main master waveform
    // WHY: Halts playback without shifting playhead.
    const handlePauseMain = () => {
        if (wavesurfer.current) {
            wavesurfer.current.pause();
        }
    };

    // WHAT: Plays an individual separated stem track by index
    // WHY: Allows solo listening to individual instruments (e.g. Drums only or Bass only).
    const handlePlayStem = (stemIndex: number) => {
        const stem_surfer = stemSurfers.current[stemIndex];
        if (stem_surfer) {
            stem_surfer.play();
        }
    };

    // WHAT: Pauses an individual separated stem track by index
    // WHY: Halts solo playback on a specific instrument track.
    const handlePauseStem = (stemIndex: number) => {
        const stem_surfer = stemSurfers.current[stemIndex];
        if (stem_surfer) {
            stem_surfer.pause();
        }
    };

    // WHAT: Parses standard SRT and VTT subtitle files into discrete timeline video clips
    // WHY: Automates storyboard generation from transcribed speech or lyrics.
    const handleImportSubtitles = (change_event: React.ChangeEvent<HTMLInputElement>) => {
        const subtitle_file = change_event.target.files?.[0];
        if (!subtitle_file || !activeProject) {
            return;
        }

        const file_reader = new FileReader();
        file_reader.onload = (file_read_event) => {
            const raw_file_text = file_read_event.target?.result as string;
            if (!raw_file_text) {
                return;
            }
            
            const imported_clips_collection = parseSrtSubtitlesToClips(raw_file_text);
            
            if (imported_clips_collection.length > 0) {
                onUpdateProject(activeProject.id, (previous_project_state) => {
                    const merged_clips = [...(previous_project_state.clips || []), ...imported_clips_collection];
                    merged_clips.sort((clip_a, clip_b) => clip_a.startTime - clip_b.startTime);
                    return { clips: merged_clips };
                });
                if (onStatusChange) {
                    onStatusChange(`Imported ${imported_clips_collection.length} subtitle clips.`);
                }
            } else {
                if (onStatusChange) {
                    onStatusChange('No valid SRT/VTT subtitles found.');
                }
            }
        };
        file_reader.readAsText(subtitle_file);
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
                className="my-0.5"
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
                className="my-0.5"
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
                className="my-0.5"
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
            <div className="my-0.5">
                <CollapsibleCard
                    title="Audio Analysis & Stem Generation"
                    isOpen={panelVisibility?.showAudioAnalysis}
                    onToggle={() => onToggleVisibility?.('showAudioAnalysis')}
                    headerRight={
                        <div className="flex gap-2">
                            <span className={`status-badge ${comfyConnected ? 'success' : 'error'}`}>
                                {comfyConnected ? 'Connected' : 'Disconnected'}
                            </span>
                            <span className={`status-badge success`}>
                                Ready
                            </span>
                        </div>
                    }
                >
                    <div className="flex flex-row gap-0">
                        {/* Left column — Generation Actions */}
                        <div className="flex flex-col gap-6 flex-1" style={{ paddingRight: '8px' }}>
                            <div className="flex flex-col gap-2">
                                <AppTooltip content="Uses ComfyUI to separate instruments into distinct audio tracks (Vocals, Drums, Bass, etc.)." placement="right" offset={[0, 48]}>
                                    <span>
                                        <button
                                            onClick={handleRunSeparation}
                                            disabled={isProcessing || !comfyConnected || !audioFile?.path}
                                            className={`btn w-full ${isProcessing || !comfyConnected || !audioFile?.path ? 'btn-secondary opacity-50 cursor-not-allowed' : 'btn-primary'}`}
                                            style={{ marginBottom: '5px' }}
                                        >
                                            {isProcessing && !detectionStatus.includes("main") ? (
                                                <>Processing Music File...</>
                                            ) : (
                                                <>Start Stem Separation</>
                                            )}
                                        </button>
                                    </span>
                                </AppTooltip>
                                <AppTooltip content="Analyzes the master track for beats, downbeats, and energy changes." placement="right" offset={[0, 48]}>
                                    <span>
                                        <button
                                            onClick={handleRunMainBeatAnalysis}
                                            disabled={isProcessing || !activeProject || !audioFile?.path}
                                            className={`btn w-full ${isProcessing || !activeProject || !audioFile?.path ? 'btn-secondary opacity-50 cursor-not-allowed' : 'btn-primary'}`}
                                            style={{ marginBottom: '5px' }}
                                        >
                                            {isProcessing && detectionStatus.includes("main") ? <>Analyzing Main Track...</> : <>Run Main Track Beat Analysis</>}
                                        </button>
                                    </span>
                                </AppTooltip>
                            </div>

                            {/* Individual Stem Analysis Section */}
                            {stems.length > 0 && (
                                <div className="border-t border-gray-700/50 pt-3">
                                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Stem Analysis</h4>
                                    <div className="flex flex-col gap-2">
                                        <AppTooltip content="Run full beat and onset analysis on all successfully separated stem tracks." placement="top" offset={[0, 48]}>
                                            <span>
                                                <button
                                                    className="btn w-full btn-secondary justify-center border border-indigo-500/30 hover:border-indigo-500/80"
                                                    onClick={async () => {
                                                        for (const stem_item of stems) {
                                                            await handleAnalyzeLocal(stem_item.path, stem_item.type);
                                                        }
                                                    }}
                                                    disabled={isProcessing}
                                                >
                                                    {isProcessing ? 'Analyzing...' : 'Analyze All Stems'}
                                                </button>
                                            </span>
                                        </AppTooltip>
                                        <div className="grid grid-cols-2 gap-2">
                                            {stems.map((stem_item, stem_index) => (
                                                <AppTooltip key={stem_index} content={`Analyze ${stem_item.type} for beats and onsets.`} placement="top" offset={[0, 48]}>
                                                    <span>
                                                        <button
                                                            className="btn btn-secondary text-xs py-1 px-2 border border-gray-700 hover:border-indigo-500/50 flex justify-center items-center gap-2"
                                                            onClick={() => handleAnalyzeLocal(stem_item.path, stem_item.type)}
                                                            disabled={isProcessing}
                                                        >
                                                            <span style={{ color: stem_item.color, fontSize: '8px' }}>⬤</span>
                                                            {stem_item.type}
                                                        </button>
                                                    </span>
                                                </AppTooltip>
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
                                        onChange={(change_event) => setAlgorithm(change_event.target.value as BeatAlgorithm)}
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
                                            onChange={(change_event) => setEnableOnsets(change_event.target.checked)}
                                            className="accent-[var(--accent-primary)]"
                                        />
                                        Extract Onsets (Granular events)
                                    </label>
                                    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white transition-colors">
                                        <input
                                            type="checkbox"
                                            checked={enableLoudness}
                                            onChange={(change_event) => setEnableLoudness(change_event.target.checked)}
                                            className="accent-[var(--accent-primary)]"
                                        />
                                        Extract Loudness Envelopes
                                    </label>
                                </div>

                                {/* Manual BPM Adjustment & Tap Tempo Engine */}
                                <div className="pt-2 border-t border-white/5">
                                    <label className="block text-xs text-gray-400 mb-2 uppercase">Tempo & Beat Grid</label>
                                    <BpmTapControl
                                        currentBpm={projectBpm}
                                        onBpmChange={handleBpmChange}
                                        onApplyGrid={handleApplyBeatGrid}
                                    />
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
                        onSelectionChange={(selection_state) => setActiveSelection(selection_state)}
                        onSaveFrame={handleSaveVideoFrame}
                        onClipContextMenu={(clip_id, clip_duration, clip_start_time, mouse_x, mouse_y) => setDurationPopup({ clipId: clip_id, duration: clip_duration, startTime: clip_start_time, x: mouse_x, y: mouse_y })}
                    />
                </CollapsibleCard>
            )}

            {/* Main Track Section */}
            <CollapsibleCard
                title="🌊 Main Track"
                className="my-0.5"
                isOpen={panelVisibility?.showMainTrack}
                onToggle={() => onToggleVisibility?.('showMainTrack')}
            >
                <div className="flex justify-between items-center bg-gray-900/10 p-3 rounded mb-2 border border-white/5">
                    <div className="flex items-center gap-4">
                        <h4 className="text-sm font-semibold text-gray-400">Audio Preview</h4>
                        <div className="flex gap-2">
                            <AppTooltip content="Play the master track along with any unmuted preview audio." placement="top" offset={[0, 48]}>
                                <span>
                                    <button
                                        className="btn btn-primary flex items-center justify-center gap-1 px-4 py-1.5"
                                        onClick={handlePlayMain}
                                        disabled={!audioUrl}
                                    >
                                        <span className="text-lg">▶</span> Play
                                    </button>
                                </span>
                            </AppTooltip>
                            <AppTooltip content="Pause playback across all tracks." placement="top" offset={[0, 48]}>
                                <span>
                                    <button
                                        className="btn btn-secondary flex items-center justify-center gap-1 px-4 py-1.5"
                                        onClick={handlePauseMain}
                                        disabled={!audioUrl}
                                    >
                                        <span className="text-lg">⏸</span> Pause
                                    </button>
                                </span>
                            </AppTooltip>
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
                                    onChange={(change_event) => setZoomLevel(Number(change_event.target.value))}
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
                                onChange={(change_event) => {
                                    const selected_source_value = change_event.target.value;
                                    setMainBeatSource(selected_source_value === 'main' ? 'main' : Number(selected_source_value));
                                }}
                                className="bg-gray-800 text-white text-xs rounded border border-gray-600 outline-none focus:border-indigo-500 px-2 py-1"
                            >
                                <option value="main">Main Track</option>
                                {stems.map((stem_item, stem_index) => (
                                    <option key={stem_index} value={stem_index}>Stem: {stem_item.type}</option>
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
                                onChange={(change_event) => {
                                    if (activeProject) {
                                        onUpdateProject(activeProject.id, { frameRate: Number(change_event.target.value) });
                                    }
                                }}
                                className="bg-gray-800 text-white text-xs rounded border border-gray-600 outline-none focus:border-indigo-500 w-12 px-2 py-1 text-center"
                            />
                        </div>

                        <div className="w-px h-8 bg-gray-700" />

                        <div className="flex flex-col gap-1 items-end">
                            <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Duration</label>
                            {audioFile ? (
                                <span className="text-xs text-gray-300 font-mono">
                                    {duration > 0 ? `${duration.toFixed(2)}s` : '--'}
                                </span>
                            ) : (
                                <div className="flex items-center gap-1 group">
                                    <input
                                        type="number"
                                        step="0.1"
                                        min="1"
                                        value={duration}
                                        onChange={(change_event) => handleUpdateDuration(parseFloat(change_event.target.value) || 0)}
                                        className="bg-gray-800 text-indigo-300 text-xs font-mono rounded border border-gray-600 outline-none focus:border-indigo-500 w-20 px-2 py-0.5 text-right transition-all hover:border-indigo-500/50"
                                        title="Manually edit project duration (Blank projects only)"
                                    />
                                    <span className="text-[10px] text-gray-500 font-bold group-hover:text-indigo-400">s</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Section Boundaries Ribbon */}
                <div className="mb-2">
                    <SectionTimelineBar
                        sections={projectSections}
                        totalDuration={duration || activeProject?.duration || 0}
                        currentTime={playbackCurrentTime}
                        isDetecting={isDetectingSections}
                        isPushingToResolve={isPushingSectionsToResolve}
                        resolveOnline={resolveBridgeOnline}
                        onDetectSections={handleDetectSections}
                        onPushSectionsToResolve={handlePushSectionsToResolve}
                        onAddSectionsToTimeline={handleAddSectionsToTimeline}
                        onUpdateSection={handleUpdateSection}
                        onDeleteSection={handleDeleteSection}
                        onSectionClick={(clicked_section) => handleSeekToSectionTime(clicked_section.startTime)}
                    />
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

            {
                (() => {
                    // WHAT: Computes marker distribution counts across the main track and stems
                    // WHY: Populates the hovering breakdown tooltip for downbeats, offbeats, onsets, and loudness.
                    const downbeatData = calculateMarkerLegendCounts(mainMarkers, stems, marker_item => marker_item.type === 'beat' && !!marker_item.isDownbeat);
                    const offbeatData = calculateMarkerLegendCounts(mainMarkers, stems, marker_item => marker_item.type === 'beat' && !marker_item.isDownbeat);
                    const onsetData = calculateMarkerLegendCounts(mainMarkers, stems, marker_item => marker_item.type === 'onset');
                    const loudnessData = calculateMarkerLegendCounts(mainMarkers, stems, marker_item => marker_item.type === 'loudness');

                    const renderTooltipContent = (tooltip_title: string, tooltip_data_items: MarkerLegendTooltipItem[]) => (
                        <div className="flex flex-col gap-1 p-2 border border-gray-600 rounded shadow-2xl text-xs min-w-[120px] z-[9999]" style={{ backgroundColor: '#000000', opacity: 1 }}>
                            <div className="font-bold text-gray-300 border-b border-gray-700 pb-1 mb-1">{tooltip_title}</div>
                            {tooltip_data_items.map((legend_item, legend_item_index) => (
                                <div key={legend_item_index} className="flex justify-between items-center gap-4">
                                    <span className="font-bold uppercase" style={{ color: legend_item.color }}>{legend_item.label}</span>
                                    <span className="text-gray-300 font-mono">{legend_item.count}</span>
                                </div>
                            ))}
                        </div>
                    );

                    const handleMouseEnter = (mouse_event: React.MouseEvent, tooltip_title: string, tooltip_data_items: MarkerLegendTooltipItem[]) => {
                        setTooltipState({
                            visible: true,
                            x: mouse_event.clientX - 128,
                            y: mouse_event.clientY - 20,
                            content: renderTooltipContent(tooltip_title, tooltip_data_items)
                        });
                    };

                    const handleMouseMove = (mouse_event: React.MouseEvent) => {
                        if (tooltipState.visible) {
                            setTooltipState(previous_state => ({ ...previous_state, x: mouse_event.clientX - 128, y: mouse_event.clientY - 20 }));
                        }
                    };

                    const handleMouseLeave = () => setTooltipState(previous_state => ({ ...previous_state, visible: false }));

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
                                                onMouseEnter={(mouse_event) => handleMouseEnter(mouse_event, "Downbeats", downbeatData)}
                                                onMouseMove={handleMouseMove}
                                                onMouseLeave={handleMouseLeave}
                                                style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'help' }}
                                            >
                                                <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: MARKER_COLORS.downbeat, flexShrink: 0 }}></span>
                                                <span>Downbeat</span>
                                            </div>
                                            <div
                                                onMouseEnter={(mouse_event) => handleMouseEnter(mouse_event, "Offbeats", offbeatData)}
                                                onMouseMove={handleMouseMove}
                                                onMouseLeave={handleMouseLeave}
                                                style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'help' }}
                                            >
                                                <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: MARKER_COLORS.offbeat, border: '1px solid #4b5563', flexShrink: 0 }}></span>
                                                <span>Offbeat</span>
                                            </div>
                                            <div
                                                onMouseEnter={(mouse_event) => handleMouseEnter(mouse_event, "Onsets", onsetData)}
                                                onMouseMove={handleMouseMove}
                                                onMouseLeave={handleMouseLeave}
                                                style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'help' }}
                                            >
                                                <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: MARKER_COLORS.onset, flexShrink: 0 }}></span>
                                                <span>Onset</span>
                                            </div>
                                            <div
                                                onMouseEnter={(mouse_event) => handleMouseEnter(mouse_event, "Loudness", loudnessData)}
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
                                                    {mainMarkers.filter(marker_item => marker_item.type === 'beat').length > 0 && (
                                                        <span>
                                                            <span style={{ color: MARKER_COLORS.downbeat }}>⬤</span>
                                                            {' '}{mainMarkers.filter(marker_item => marker_item.type === 'beat').length} beats
                                                        </span>
                                                    )}
                                                    {mainMarkers.filter(marker_item => marker_item.type === 'onset').length > 0 && (
                                                        <span>
                                                            <span style={{ color: MARKER_COLORS.onset }}>⬤</span>
                                                            {' '}{mainMarkers.filter(marker_item => marker_item.type === 'onset').length} onsets
                                                        </span>
                                                    )}
                                                    {mainMarkers.filter(marker_item => marker_item.type === 'loudness').length > 0 && (
                                                        <span>
                                                            <span style={{ color: MARKER_COLORS.loudness }}>⬤</span>
                                                            {' '}{mainMarkers.filter(marker_item => marker_item.type === 'loudness').length} loudness
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
                                                    <AppTooltip content="Synchronize and play all stem tracks from the beginning." placement="top" offset={[0, 48]}>
                                                        <span>
                                                            <button
                                                                className="btn w-full mt-2 btn-primary flex items-center justify-center gap-2"
                                                                onClick={handlePlayStems}
                                                                disabled={!audioUrl}
                                                            >
                                                                <span className="text-lg">▶</span> Play Stems
                                                            </button>
                                                        </span>
                                                    </AppTooltip>

                                                    <AppTooltip content="Pause all stem track previews." placement="top" offset={[0, 48]}>
                                                        <span>
                                                            <button
                                                                className="btn w-full mt-2 btn-secondary flex items-center justify-center gap-2"
                                                                onClick={handlePauseAll}
                                                                disabled={!audioUrl}
                                                            >
                                                                <span className="text-lg">⏸</span> Pause
                                                            </button>
                                                        </span>
                                                    </AppTooltip>
                                                </div>
                                            </div>

                                            {stems.map((stem_item, stem_index) => (
                                                <div key={stem_index} className="stem-item bg-black/20 p-6 rounded border border-gray-800 pb-8">
                                                    <div className="flex justify-between items-center mb-1">
                                                        <div className="flex items-center gap-2">
                                                            <div className="text-xs font-bold uppercase" style={{ color: stem_item.color }}>{stem_item.type}</div>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <AppTooltip content={`Listen to the ${stem_item.type} stem only.`} placement="top" offset={[0, 48]}>
                                                                <span>
                                                                    <button
                                                                        className="text-xs bg-indigo-600 hover:bg-indigo-500 px-2 py-0.5 rounded text-white font-bold flex items-center gap-1"
                                                                        onClick={() => handlePlayStem(stem_index)}
                                                                    >
                                                                        ▶ Play
                                                                    </button>
                                                                </span>
                                                            </AppTooltip>
                                                            <AppTooltip content={`Pause ${stem_item.type} preview.`} placement="top" offset={[0, 48]}>
                                                                <span>
                                                                    <button
                                                                        className="text-xs bg-yellow-600 hover:bg-yellow-500 px-2 py-0.5 rounded text-white font-bold flex items-center gap-1"
                                                                        onClick={() => handlePauseStem(stem_index)}
                                                                    >
                                                                        ⏸ Pause
                                                                    </button>
                                                                </span>
                                                            </AppTooltip>
                                                        </div>
                                                    </div>
                                                    <div
                                                        id={`stem-waveform-${stem_index}`}
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
                                <AppTooltip content="Queue a ComfyUI video generation task based on the current selection's duration." placement="top" offset={[0, 48]}>
                                    <span>
                                        <button
                                            className="btn btn-primary shadow-lg shadow-indigo-500/20"
                                            onClick={handleGenerateClipFromRegion}
                                            disabled={!activeSelection || isAnalyzing}
                                        >
                                            Generate Clip from Selection
                                        </button>
                                    </span>
                                </AppTooltip>

                                <AppTooltip content="Import an SRT/VTT subtitle file as video clips on the timeline." placement="top" offset={[0, 48]}>
                                    <label className="btn btn-secondary border border-gray-600 hover:border-indigo-500/50 cursor-pointer flex items-center justify-center text-sm">
                                        Import Subtitles (.srt, .vtt)
                                        <input 
                                            type="file" 
                                            accept=".srt,.vtt" 
                                            onChange={handleImportSubtitles} 
                                            style={{ display: 'none' }} 
                                        />
                                    </label>
                                </AppTooltip>

                                {/* Live Resolve Bridge Direct Actions */}
                                <div className="flex gap-1.5 p-1 bg-emerald-950/40 border border-emerald-500/30 rounded-lg items-center">
                                    <span className="text-[10px] font-bold text-emerald-400 px-1.5 flex items-center gap-1">
                                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                        BRIDGE
                                    </span>
                                    <AppTooltip content="Instant Live Sync: Directly import audio and video clips into DaVinci Resolve via HTTP Bridge" placement="top" offset={[0, 48]}>
                                        <span>
                                            <button
                                                className="btn bg-emerald-700 hover:bg-emerald-600 text-white border-none rounded font-bold text-xs px-2.5 py-1.5 flex items-center gap-1"
                                                onClick={handleLiveImportMedia}
                                                disabled={clips.length === 0 && !audioFile}
                                            >
                                                ⚡ Live Load Media
                                            </button>
                                        </span>
                                    </AppTooltip>
                                    <AppTooltip content="Instant Live Sync: Place video clips on the active timeline in DaVinci Resolve via HTTP Bridge" placement="top" offset={[0, 48]}>
                                        <span>
                                            <button
                                                className="btn bg-emerald-800 hover:bg-emerald-700 text-white border-none rounded font-bold text-xs px-2.5 py-1.5 flex items-center gap-1"
                                                onClick={handleLiveBuildTimeline}
                                                disabled={clips.length === 0}
                                            >
                                                ⚡ Live Place Clips
                                            </button>
                                        </span>
                                    </AppTooltip>
                                    <AppTooltip content="Instant Live Sync: Directly push all beat and onset markers to the Resolve timeline in real time" placement="top" offset={[0, 48]}>
                                        <span>
                                            <button
                                                className="btn bg-emerald-600 hover:bg-emerald-500 text-white border-none rounded font-bold text-xs px-2.5 py-1.5 flex items-center gap-1"
                                                onClick={handleLivePushMarkers}
                                                disabled={mainMarkers.length === 0 && stems.length === 0}
                                            >
                                                ⚡ Live Push Markers
                                            </button>
                                        </span>
                                    </AppTooltip>
                                </div>

                                <div className="flex gap-2">
                                    <AppTooltip content="Step 1: Load all media into Resolve bin (Audio & Video)" placement="top" offset={[0, 48]}>
                                        <span>
                                            <button
                                                className="btn bg-indigo-700 hover:bg-indigo-600 text-white border-none rounded font-bold text-sm"
                                                onClick={handleExportMediaOnly}
                                                disabled={clips.length === 0}
                                            >
                                                🎬 (1) Export Load Media Script
                                            </button>
                                        </span>
                                    </AppTooltip>
                                    <AppTooltip content="Step 2: Place media items from bin onto timeline at designed positions" placement="top" offset={[0, 48]}>
                                        <span>
                                            <button
                                                className="btn bg-indigo-800 hover:bg-indigo-700 text-white border-none rounded font-bold text-sm"
                                                onClick={handleExportManifest}
                                                disabled={clips.length === 0}
                                            >
                                                🎨 (2) Place Media Script
                                            </button>
                                        </span>
                                    </AppTooltip>
                                    <AppTooltip content="Step 3: Set all detected beat markers and onsets onto the Resolve timeline" placement="top" offset={[0, 48]}>
                                        <span>
                                            <button
                                                className="btn bg-indigo-600 hover:bg-indigo-500 text-white border-none rounded font-bold text-sm"
                                                onClick={handleExportMarkers}
                                                disabled={mainMarkers.length === 0 && stems.length === 0}
                                            >
                                                🚩 (3) Set Beat Markers
                                            </button>
                                        </span>
                                    </AppTooltip>
                                </div>

                                <div className="flex gap-2 ml-auto">
                                    <AppTooltip content="Scan the project folder for generated videos that might have been missed." placement="top" offset={[0, 48]}>
                                        <span>
                                            <button
                                                className="btn bg-indigo-600 hover:bg-indigo-500 text-white border-none rounded font-bold text-sm"
                                                onClick={handleSyncGeneratedVideos}
                                                disabled={!activeProject}
                                            >
                                                🔄 Sync Videos
                                            </button>
                                        </span>
                                    </AppTooltip>

                                    <AppTooltip content="Save all current project data, markers, and clip status." placement="top" offset={[0, 48]}>
                                        <span>
                                            <button
                                                className="btn btn-primary bg-emerald-600 hover:bg-emerald-500 border-none text-white rounded font-bold text-sm"
                                                onClick={() => handleSaveToProject()}
                                                disabled={!activeProject}
                                            >
                                                💾 Save Project
                                            </button>
                                        </span>
                                    </AppTooltip>
                                </div>
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
                                    onUpdateClipRole={handleUpdateClipRole}
                                    onGenerateClip={onGenerateVideo || (() => {})}
                                    onError={(error_message_string: string) => onStatusChange?.(error_message_string)}
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

            {durationPopup && (
                <DurationEditPopup 
                    clipId={durationPopup.clipId}
                    initialDuration={durationPopup.duration}
                    startTime={durationPopup.startTime}
                    frameRate={activeProject?.frameRate || 20}
                    position={{ x: durationPopup.x, y: durationPopup.y }}
                    onClose={() => setDurationPopup(null)}
                    onSave={(clip_id, updated_duration) => {
                        handleUpdateClipEndTime(clip_id, durationPopup.startTime + updated_duration);
                        setDurationPopup(null);
                    }}
                />
            )}

        </div>
    );
};

export default MusicVideoAssemblerModule;
