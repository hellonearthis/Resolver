import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { analyzeBeats } from '../services/essentiaService';
import DropZone from '../components/DropZone';
import ProjectsPanel from '../components/ProjectsPanel';
import { queuePrompt } from '../services/comfyService';
import type { BeatProject } from '../hooks/useProjectStorage';
import './MusicVideoAssemblerModule.css';

interface MusicVideoAssemblerModuleProps {
    projects: BeatProject[];
    activeProject?: BeatProject;
    onSelectProject: (id: string) => void;
    onCreateProject: (file: File) => BeatProject;
    onUpdateProject: (id: string, updates: Partial<BeatProject>) => void;
    onDeleteProject: (id: string) => void;
}

interface VideoClip {
    id: string;
    startTime: number;
    duration: number;
    endTime: number;
    track: number; // 1 or 2 for checkerboarding
    status: 'pending' | 'generating' | 'done' | 'error';
    videoPath?: string;
    promptText?: string;
}

interface SelectionState {
    source: 'main' | 'stem';
    stemIndex?: number;
    start: number;
    end: number;
}

const STEM_COLORS: Record<string, string> = {
    'drums': '#ef4444', // Red
    'bass': '#f59e0b', // Amber/Yellow
    'other': '#10b981', // Emerald/Green
    'vocals': '#3b82f6', // Blue
    'piano': '#8b5cf6', // Violet
    'guitar': '#ec4899', // Pink
};

const DEFAULT_STEM_COLOR = '#6b7280'; // Gray

interface StemData {
    type: string;
    url: string;
    path: string;
    color: string;
    beats: number[];
}

const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const adjustColorBrightness = (hex: string, percent: number) => {
    const num = parseInt(hex.replace("#", ""), 16),
        amt = Math.round(2.55 * percent),
        R = (num >> 16) + amt,
        B = ((num >> 8) & 0x00FF) + amt,
        G = (num & 0x0000FF) + amt;
    return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 + (B < 255 ? B < 1 ? 0 : B : 255) * 0x100 + (G < 255 ? G < 1 ? 0 : G : 255)).toString(16).slice(1);
};

const MusicVideoAssemblerModule: React.FC<MusicVideoAssemblerModuleProps> = ({
    projects,
    activeProject,
    onSelectProject,
    onCreateProject,
    onDeleteProject,
    onUpdateProject
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurfer = useRef<WaveSurfer | null>(null);
    const wsRegions = useRef<any>(null);
    const [audioFile, setAudioFile] = useState<{ name: string; path: string } | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [beats, setBeats] = useState<number[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [clips, setClips] = useState<VideoClip[]>([]);
    const [workflow, setWorkflow] = useState<any>(null);
    const [statusMessage, setStatusMessage] = useState('');
    const [stems, setStems] = useState<StemData[]>([]);
    const stemSurfers = useRef<WaveSurfer[]>([]);
    const stemRegionsRefs = useRef<Map<number, any>>(new Map());
    const [duration, setDuration] = useState(0);
    const [activeSelection, setActiveSelection] = useState<SelectionState | null>(null);

    // Zoom & Beat Source Controls
    const [zoomLevel, setZoomLevel] = useState(50); // minPxPerSec
    const [mainBeatSource, setMainBeatSource] = useState<'main' | number>('main'); // 'main' or index of stem

    // Load initial connection status & workflow
    useEffect(() => {
        // checkConnection(); // We can remove this if we just rely on explicit checks or global status
        loadWorkflow();
    }, []);

    const loadWorkflow = async () => {
        try {
            // @ts-ignore
            const ipcRenderer = window.require ? window.require('electron').ipcRenderer : window.ipcRenderer;
            const result = await ipcRenderer.invoke('load-default-workflow');
            if (result.success) setWorkflow(result.workflow);
        } catch (e) {
            console.error("Failed to load workflow", e);
        }
    };

    // Load Project Audio when activeProject changes
    useEffect(() => {
        if (activeProject && activeProject.audioPath) {
            loadProjectAudio(activeProject);
        }
    }, [activeProject]);

    const analyzeAudio = async (blob: Blob) => {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const result = await analyzeBeats(audioBuffer);
        return result.beats;
    };

    const loadProjectAudio = async (project: BeatProject) => {
        setIsAnalyzing(true);
        setStatusMessage("Loading audio files...");

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
                const promises = newStems.map(async (stem, index) => {
                    try {
                        const sBuffer = fs.readFileSync(stem.path);
                        const sBlob = new Blob([sBuffer], { type: 'audio/mpeg' });

                        let stemBeats = stem.beats;
                        const stemColor = stem.color || STEM_COLORS[stem.type.toLowerCase()] || DEFAULT_STEM_COLOR;

                        // Identify missing data
                        if (!stemBeats || stemBeats.length === 0) {
                            console.log(`Analyzing beats for stem: ${stem.type}`);
                            stemBeats = await analyzeAudio(sBlob);

                            // Update the local copy for saving later
                            newStems[index] = { ...stem, beats: stemBeats, color: stemColor };
                            stemsUpdated = true;
                        }

                        return {
                            type: stem.type,
                            url: URL.createObjectURL(sBlob),
                            path: stem.path,
                            color: stemColor,
                            beats: stemBeats || []
                        };
                    } catch (err) {
                        console.error(`Failed to load stem ${stem.path}`, err);
                        return null;
                    }
                });

                const results = await Promise.all(promises);
                // @ts-ignore
                loadedStems = results.filter(s => s !== null);
                setStems(loadedStems);
            } else {
                setStems([]);
            }

            // 3. Load Main beats
            if (project.markers && project.markers.length > 0) {
                const beatMarkers = project.markers
                    .filter(m => m.type === 'beat')
                    .map(m => m.timestamp);

                if (beatMarkers.length > 0) {
                    setBeats(beatMarkers);
                } else {
                    setStatusMessage("Analyzing main track beats...");
                    const b = await analyzeAudio(blob);
                    setBeats(b);
                }
            } else {
                setStatusMessage("Analyzing main track beats...");
                const b = await analyzeAudio(blob);
                setBeats(b);
            }

            setStatusMessage("Ready.");

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
            setStatusMessage(`Error loading project: ${e}`);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleAudioDrop = async (files: File[]) => {
        if (files.length > 0) {
            const file = files[0];
            const newProject = onCreateProject(file);
            loadProjectAudio(newProject);
        }
    };

    // Helper: inject beat markers into a WaveSurfer's internal wrapper
    const renderBeatMarkers = (ws: WaveSurfer, markerBeats: number[], markerDuration: number, brightColor = 'rgba(255, 255, 255, 0.8)', dimColor = 'rgba(255, 255, 255, 0.4)') => {
        try {
            const wrapper = ws.getWrapper();
            if (!wrapper) return;
            // Remove existing markers
            wrapper.querySelectorAll('.beat-marker').forEach(el => el.remove());
            if (markerDuration <= 0) return;
            markerBeats.forEach((beat, i) => {
                const left = (beat / markerDuration) * 100;
                if (left > 100) return;
                const isDownbeat = i % 4 === 0;
                const marker = document.createElement('div');
                marker.className = 'beat-marker';
                marker.style.cssText = `
                    position: absolute;
                    left: ${left}%;
                    top: 0;
                    bottom: 0;
                    width: ${isDownbeat ? '2px' : '1px'};
                    background-color: ${isDownbeat ? brightColor : dimColor};
                    pointer-events: none;
                    z-index: 10;
                `;
                wrapper.appendChild(marker);
            });
        } catch (e) {
            console.error('renderBeatMarkers error:', e);
        }
    };

    // Zoom Effect
    useEffect(() => {
        if (wavesurfer.current) {
            wavesurfer.current.zoom(zoomLevel);
            // Re-render main markers after zoom
            const currentBeats = mainBeatSource === 'main' ? beats : (typeof mainBeatSource === 'number' && stems[mainBeatSource] ? stems[mainBeatSource].beats : []);
            renderBeatMarkers(wavesurfer.current, currentBeats, duration);
        }
        stemSurfers.current.forEach((ws, idx) => {
            ws.zoom(zoomLevel);
            if (stems[idx] && stems[idx].beats) {
                renderBeatMarkers(ws, stems[idx].beats, duration, 'rgba(255, 255, 255, 0.6)', 'rgba(255, 255, 255, 0.3)');
            }
        });
    }, [zoomLevel]);

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

        ws.on('ready', () => {
            const dur = ws.getDuration();
            setDuration(dur);
            ws.zoom(zoomLevel);
            // Render beat markers inside WaveSurfer wrapper
            const currentBeats = mainBeatSource === 'main' ? beats : (typeof mainBeatSource === 'number' && stems[mainBeatSource] ? stems[mainBeatSource].beats : []);
            renderBeatMarkers(ws, currentBeats, dur);
        });

        // Register Regions Plugin
        const regions = ws.registerPlugin(RegionsPlugin.create());
        wsRegions.current = regions;

        regions.enableDragSelection({
            color: 'rgba(255, 0, 0, 0.2)',
        });

        // Snap to Beat Logic
        regions.on('region-updated', (region) => {
            const currentBeats = mainBeatSource === 'main' ? beats : (typeof mainBeatSource === 'number' && stems[mainBeatSource] ? stems[mainBeatSource].beats : []);

            if (currentBeats.length === 0) return;

            const snapToBeat = (time: number) => {
                const closest = currentBeats.reduce((prev, curr) =>
                    Math.abs(curr - time) < Math.abs(prev - time) ? curr : prev
                );
                return closest;
            };

            const snappedStart = snapToBeat(region.start);
            const snappedEnd = snapToBeat(region.end);

            if (Math.abs(region.start - snappedStart) > 0.01 || Math.abs(region.end - snappedEnd) > 0.01) {
                region.setOptions({
                    start: snappedStart,
                    end: Math.max(snappedEnd, snappedStart + 0.1)
                });
            }

            setActiveSelection({
                source: 'main',
                start: region.start,
                end: region.end
            });
            stemRegionsRefs.current.forEach(r => r.clearRegions());
        });

        regions.on('region-created', (region) => {
            setActiveSelection({
                source: 'main',
                start: region.start,
                end: region.end
            });
            stemRegionsRefs.current.forEach(r => r.clearRegions());
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
        ws.on('play', () => stemSurfers.current.forEach(s => s.play()));
        ws.on('pause', () => stemSurfers.current.forEach(s => s.pause()));

        wavesurfer.current = ws;

        return () => {
            ws.destroy();
        };
    }, [audioUrl, beats, stems, mainBeatSource]);

    // Initialize WaveSurfers (Stems)
    useEffect(() => {
        // Cleanup old stem surfers
        stemSurfers.current.forEach(ws => ws.destroy());
        stemSurfers.current = [];

        if (stems.length === 0) return;

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
                    setActiveSelection({
                        source: 'stem',
                        stemIndex: index,
                        start: region.start,
                        end: region.end
                    });

                    if (wsRegions.current) wsRegions.current.clearRegions();

                    stemRegionsRefs.current.forEach((val, key) => {
                        if (key !== index) val.clearRegions();
                    });

                    // Snap to Stem's OWN beats
                    const stemBeats = stem.beats || [];
                    if (stemBeats.length > 0) {
                        const snapToBeat = (time: number) => {
                            const closest = stemBeats.reduce((prev, curr) =>
                                Math.abs(curr - time) < Math.abs(prev - time) ? curr : prev
                            );
                            return closest;
                        };
                        const snappedStart = snapToBeat(region.start);
                        const snappedEnd = snapToBeat(region.end);
                        if (Math.abs(region.start - snappedStart) > 0.01 || Math.abs(region.end - snappedEnd) > 0.01) {
                            region.setOptions({
                                start: snappedStart,
                                end: Math.max(snappedEnd, snappedStart + 0.1)
                            });
                        }
                    }
                };

                stemRegions.on('region-created', handleStemRegionUpdate);
                stemRegions.on('region-updated', handleStemRegionUpdate);

                ws.on('ready', () => {
                    ws.zoom(zoomLevel);
                    if (stem.beats && stem.beats.length > 0) {
                        renderBeatMarkers(ws, stem.beats, wavesurfer.current?.getDuration() || 0, 'rgba(255, 255, 255, 0.6)', 'rgba(255, 255, 255, 0.3)');
                    }
                });

                stemSurfers.current.push(ws);
            }
        });

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

    const handleGenerateClipFromRegion = async () => {
        if (!activeSelection) {
            setStatusMessage("Please select a region on the waveform first.");
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
            promptText: "A cool music video scene, dynamic lighting, 4k" // Default prompt
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
        if (!workflow || !audioPath) {
            setStatusMessage("Workflow or Audio not loaded.");
            return;
        }

        // Update status
        setClips(prev => prev.map(c => c.id === clip.id ? { ...c, status: 'generating' } : c));

        try {
            const prompt = JSON.parse(JSON.stringify(workflow));

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
                setStatusMessage(`Started generation for Clip ${clip.id}`);
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
            setStatusMessage(`Manifest saved to ${result.path}`);
        } else {
            setStatusMessage(`Error saving manifest: ${result.error}`);
        }
    };


    const [isStemPlaying, setIsStemPlaying] = useState(false);

    const handlePlayStems = () => {
        if (wavesurfer.current) {
            // Mute main track to hear only stems
            wavesurfer.current.setVolume(0);
            wavesurfer.current.setMuted(true);

            // Seek all stems to start and ensure they are unmuted
            stemSurfers.current.forEach(s => {
                s.setVolume(1);
                s.setTime(0);
            });

            wavesurfer.current.stop();
            wavesurfer.current.play();
            setIsStemPlaying(true);
        }
    };

    const handlePauseAll = () => {
        if (wavesurfer.current) {
            wavesurfer.current.pause();
            wavesurfer.current.setVolume(1); // Restore main track volume
            wavesurfer.current.setMuted(false);
            setIsStemPlaying(false);
        }
        stemSurfers.current.forEach(s => s.pause());
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

            {/* ... (Select Project Card) ... */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">Select Project</h3>
                </div>
                <ProjectsPanel
                    projects={projects}
                    onLoad={(p) => onSelectProject(p.id)}
                    onDelete={onDeleteProject}
                    currentProjectId={activeProject?.id}
                />
            </div>

            {/* ... (DropZone) ... */}
            <div className="card mt-4">
                <DropZone onFilesDropped={handleAudioDrop} accept="audio/*" label="Drop Audio to Create New Project" />
                {audioFile && <p className="mt-2 text-sm text-gray-400">Current: {audioFile.name}</p>}
            </div>

            {/* Selection Status */}
            {activeSelection && (
                <div className="selection-status mt-4 p-2 bg-indigo-900/30 border border-indigo-500/50 rounded flex justify-between items-center text-sm">
                    <div>
                        <span className="text-gray-400 uppercase text-xs font-bold mr-2">Selection Source:</span>
                        <span className="text-white font-semibold">
                            {activeSelection.source === 'main' ? 'MAIN TRACK' : `STEM: ${stems[activeSelection.stemIndex!]?.type.toUpperCase()}`}
                        </span>
                    </div>
                    <div>
                        <span className="text-gray-400 text-xs mr-2">Range:</span>
                        <span className="text-indigo-300 font-mono">
                            {activeSelection.start.toFixed(2)}s - {activeSelection.end.toFixed(2)}s
                            <span className="ml-2 text-white">({(activeSelection.end - activeSelection.start).toFixed(2)}s)</span>
                        </span>
                    </div>
                </div>
            )}

            {/* Controls Bar */}
            <div className="controls-bar mt-4 flex items-center gap-4 bg-[var(--bg-tertiary)] p-3 rounded border border-gray-700">
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400 font-semibold uppercase">Zoom</label>
                    <input
                        type="range"
                        min="10"
                        max="200"
                        value={zoomLevel}
                        onChange={(e) => setZoomLevel(Number(e.target.value))}
                        className="w-32 accent-indigo-500"
                    />
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

                <div className="text-xs text-gray-500 ml-auto">
                    {duration > 0 && `Duration: ${duration.toFixed(2)}s`}
                </div>
            </div>

            {/* Main Track Header with Play/Stop */}
            <div className="flex justify-between items-center bg-gray-900/50 p-3 rounded mt-4">
                <h4 className="text-sm font-semibold text-gray-400">Main Track</h4>
                <div className="flex gap-2">
                    <button
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded text-sm font-bold flex items-center gap-1"
                        onClick={handlePlayMain}
                        disabled={!audioUrl}
                    >
                        <span className="text-lg">▶</span> Play
                    </button>
                    <button
                        className="bg-yellow-600 hover:bg-yellow-500 text-white px-3 py-1 rounded text-sm font-bold flex items-center gap-1"
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
                style={{ position: 'relative', transition: 'all 0.3s ease' }}
            >
                {isAnalyzing && <div className="overlay">Analyzing Beats...</div>}

                {/* Beat markers are now rendered inside WaveSurfer's wrapper via renderBeatMarkers */}
            </div>

            {/* Stems Container */}
            {stems.length > 0 && (
                <div className="stems-list mt-8 flex flex-col gap-8">
                    <div className="flex justify-between items-center bg-gray-900/50 p-3 rounded">
                        <h4 className="text-sm font-semibold text-gray-400">Project Stems</h4>
                        <div className="flex gap-4">
                            <button
                                className="btn btn-primary bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1 rounded text-sm font-bold flex items-center gap-2"
                                onClick={handlePlayStems}
                                disabled={!audioUrl}
                            >
                                <span className="text-lg">▶</span> Play Stems
                            </button>

                            <button
                                className="btn btn-secondary bg-yellow-600 hover:bg-yellow-500 text-white px-4 py-1 rounded text-sm font-bold flex items-center gap-2"
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
            )}

            <div className="controls-container flex gap-4 mt-6">
                <button className="btn btn-primary" onClick={handleGenerateClipFromRegion} disabled={!activeSelection || isAnalyzing}>
                    Generate Clip from Selection
                </button>
                <button className="btn btn-secondary" onClick={handleExportManifest} disabled={clips.length === 0}>
                    Export Manifest for Resolve
                </button>
            </div>

            <div className="clip-list mt-4 grid gap-2">
                {clips.map(clip => (
                    <div key={clip.id} className={`clip-item ${clip.status} p-3 rounded bg-gray-800 border border-gray-700 flex justify-between items-center`}>
                        <div className="clip-info flex flex-col">
                            <span className="font-mono text-indigo-300">
                                {clip.startTime.toFixed(2)}s - {clip.endTime.toFixed(2)}s
                            </span>
                            <span className="text-xs text-gray-400">
                                Track {clip.track} | {Math.round(clip.duration * 24)} frames | {(clip.track === 1 ? 'A Roll' : 'B Roll')}
                            </span>
                        </div>
                        <div className="clip-actions">
                            <span className={`status-badge px-2 py-1 rounded text-xs font-bold uppercase ${clip.status === 'done' ? 'bg-green-900 text-green-300' :
                                clip.status === 'error' ? 'bg-red-900 text-red-300' :
                                    'bg-yellow-900 text-yellow-300'
                                }`}>
                                {clip.status}
                            </span>
                        </div>
                    </div>
                ))}
            </div>

            {statusMessage && <div className="status-bar mt-4 text-xs text-gray-400 italic text-center">{statusMessage}</div>}
        </div>
    );
};

export default MusicVideoAssemblerModule;
