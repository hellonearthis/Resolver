import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { analyzeBeats } from '../services/essentiaService';

import ProjectsPanel from '../components/ProjectsPanel';
import { queuePrompt } from '../services/comfyService';
import type { BeatProject } from '../hooks/useProjectStorage';
import ProjectTimelineTable from '../components/ProjectTimelineTable';
import './MusicVideoAssemblerModule.css';

/**
 * Props required to initialize the MusicVideoAssemblerModule.
 * Receives global project data and callbacks to interact with the broader application state.
 */
interface MusicVideoAssemblerModuleProps {
    projects: BeatProject[];
    activeProject?: BeatProject;
    onSelectProject: (id: string) => void;
    onUpdateProject: (id: string, updates: Partial<BeatProject>) => void;
    onDeleteProject: (id: string) => void;
}

import type { VideoClip, SelectionState, AudioMarker, StemData } from '../types/assembler';
import {
    MARKER_COLORS,
    STEM_COLORS,
    DEFAULT_STEM_COLOR,
    hexToRgba,
    adjustColorBrightness,
    formatTime
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
    onDeleteProject,
    onUpdateProject
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurfer = useRef<WaveSurfer | null>(null);
    const wsRegions = useRef<any>(null);
    const [audioFile, setAudioFile] = useState<{ name: string; path: string } | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [mainMarkers, setMainMarkers] = useState<AudioMarker[]>([]);
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
    const [minZoom, setMinZoom] = useState(1);
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

                        // Convert to AudioMarkers
                        const markers: AudioMarker[] = (stemBeats || []).map((t, i) => ({
                            time: t,
                            type: 'beat',
                            isDownbeat: i % 4 === 0,
                            color: undefined // Use default logic
                        }));

                        return {
                            type: stem.type,
                            url: URL.createObjectURL(sBlob),
                            path: stem.path,
                            color: stemColor,
                            markers: markers
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

                // If all are beats, apply downbeat logic retrospectively?
                // Or just trust the marker types.
                setMainMarkers(audioMarkers);
            } else {
                // Fallback to basic analysis if no markers found
                setStatusMessage("Analyzing main track beats...");
                const rawBeats = await analyzeAudio(blob);
                const audioMarkers: AudioMarker[] = rawBeats.map((t, i) => ({
                    time: t,
                    type: 'beat',
                    isDownbeat: i % 4 === 0
                }));
                setMainMarkers(audioMarkers);
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
    }, [audioUrl, mainMarkers, stems, mainBeatSource]);

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
                    if (stem.markers && stem.markers.length > 0) {
                        renderBeatMarkers(ws, stem.markers, wavesurfer.current?.getDuration() || 0);
                    }
                });

                stemSurfers.current.push(ws);
            }
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

    // Add the current selection as a segment to the timeline (no ComfyUI generation)
    const handleAddSegment = () => {
        if (!activeSelection) {
            setStatusMessage('Select a region on a waveform first.');
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

        setStatusMessage(`Segment added: ${formatTime(start)} – ${formatTime(end)}`);
    };

    // Remove a clip/segment from the timeline
    const handleRemoveClip = (clipId: string) => {
        setClips(prev => prev.filter(c => c.id !== clipId));
    };

    // Save clips to the active project
    const handleSaveToProject = async () => {
        if (!activeProject) {
            setStatusMessage('No project selected.');
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
                setStatusMessage('No output folder configured. Set one in Settings → Defaults.');
                return;
            }

            // Update project with clips and ensure outputDir is set
            onUpdateProject(activeProject.id, {
                clips: clips,
                outputDir: baseOutputDir,
            });
            setStatusMessage(`Project saved ✓  →  ${baseOutputDir}`);
        } catch (e) {
            console.error('Save failed:', e);
            setStatusMessage('Error saving project.');
        }
    };

    // Image picker for start/end images
    const handlePickImage = (clipId: string, field: 'startImagePath' | 'endImagePath') => {
        if (!activeProject?.outputDir) {
            setStatusMessage('No project folder available. Save the project first.');
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
    }, [clips, stems]);

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
                    {/* Marker Legend */}
                    <div style={{ display: 'flex', gap: '16px', marginBottom: '8px', padding: '6px 8px', fontSize: '12px', color: '#9ca3af', alignItems: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                        <span style={{ fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Markers:</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: MARKER_COLORS.downbeat, flexShrink: 0 }}></span>
                            <span>Downbeat</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: MARKER_COLORS.offbeat, border: '1px solid #4b5563', flexShrink: 0 }}></span>
                            <span>Offbeat</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: MARKER_COLORS.onset, flexShrink: 0 }}></span>
                            <span>Onset</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: MARKER_COLORS.loudness, flexShrink: 0 }}></span>
                            <span>Loudness</span>
                        </div>
                    </div>

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
                <button
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded font-bold text-sm"
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
                    onError={setStatusMessage}
                />
            </div>

            {statusMessage && <div className="status-bar mt-4 text-xs text-gray-400 italic text-center">{statusMessage}</div>}
        </div>
    );
};

export default MusicVideoAssemblerModule;
