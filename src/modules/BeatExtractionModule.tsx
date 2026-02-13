import React, { useState, useCallback, useEffect, useRef } from 'react';
import DropZone from '../components/DropZone';
import BeatVisualizer from '../components/BeatVisualizer';
import ProjectsPanel from '../components/ProjectsPanel';
import type { BeatProject, ProjectMarker } from '../hooks/useProjectStorage';
import {
    analyzeBeats,
    analyzeOnsets,
    analyzeLoudness,
    type BeatAlgorithm,
} from '../services/essentiaService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// MarkerData is now ProjectMarker from useProjectStorage
type MarkerData = ProjectMarker;

// Base colors matching standard Resolve palette


// Lighter variants for Onsets/Loudness (Same hue, higher brightness)
// User mapping:
// Beat (Blue) -> Sky
// Bass (Red) -> Pink
// Other (Yellow) -> Lemon
// Vocals (Purple) -> Lavender


// Re-defining based on User's explicit request:
// Beat (Blue) -> Sky
// Bass (Red) -> Pink
// Other (Yellow) -> Lemon
// Vocals (Purple) -> Lavender
const USER_STEM_MAPPING: Record<string, { base: string, light: string }> = {
    'beat': { base: 'Blue', light: 'Sky' },      // Default / Bass-like
    'bass': { base: 'Blue', light: 'Sky' },
    'drums': { base: 'Red', light: 'Pink' },
    'vocals': { base: 'Green', light: 'Emerald' },
    'other': { base: 'Yellow', light: 'Amber' }
};


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface BeatExtractionModuleProps {
    initialAudioPath?: string;
    initialStemType?: string;
    // Global Project Props
    projects: BeatProject[];
    activeProject?: BeatProject;
    onSelectProject: (id: string) => void;
    onCreateProject: (file: File) => BeatProject;
    onUpdateProject: (id: string, updates: Partial<BeatProject>) => void;
    onDeleteProject: (id: string) => void;
    // New props for embedded mode
    isEmbedded?: boolean;
    initialAlgorithm?: BeatAlgorithm;
    initialEnableOnsets?: boolean;
    initialEnableLoudness?: boolean;
    initialMarkers?: MarkerData[]; // New prop for cached markers
    onAnalysisComplete?: (markers: MarkerData[]) => void;
    onStatusChange?: (status: string) => void;
}


const BeatExtractionModule: React.FC<BeatExtractionModuleProps> = ({
    initialAudioPath,
    initialStemType,
    projects,
    activeProject,
    onSelectProject,
    onCreateProject,
    onUpdateProject,
    onDeleteProject,
    isEmbedded = false,

    initialAlgorithm = 'multifeature',
    initialEnableOnsets = false,
    initialEnableLoudness = false,
    initialMarkers, // Destructure new prop
    onAnalysisComplete,
    onStatusChange,
}) => {

    const [audioFile, setAudioFile] = useState<File | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [audioPath, setAudioPath] = useState<string>('');
    const [beats, setBeats] = useState<number[]>([]);
    const [markerData, setMarkerData] = useState<MarkerData[]>([]);
    const [bpm, setBpm] = useState<number | null>(null);
    const [confidence, setConfidence] = useState<number | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [status, setStatus] = useState('');
    const [selectedStemType, setSelectedStemType] = useState('beat');
    const [frameRate, setFrameRate] = useState(24);
    const [lastExportedCsvPath, setLastExportedCsvPath] = useState<string>('');

    // Essentia-specific settings
    const [algorithm, setAlgorithm] = useState<BeatAlgorithm>(initialAlgorithm);
    const [enableOnsets, setEnableOnsets] = useState(initialEnableOnsets);
    const [enableLoudness, setEnableLoudness] = useState(initialEnableLoudness);

    // Sync redundant local state with props when embedded
    useEffect(() => {
        if (isEmbedded) {
            setAlgorithm(initialAlgorithm);
            setEnableOnsets(initialEnableOnsets);
            setEnableLoudness(initialEnableLoudness);
        }
    }, [isEmbedded, initialAlgorithm, initialEnableOnsets, initialEnableLoudness]);

    // Report status changes to parent
    useEffect(() => {
        if (onStatusChange) {
            onStatusChange(status);
        }
    }, [status, onStatusChange]);


    // -----------------------------------------------------------------------
    // Core Analysis Logic (Extracted for reuse)
    // -----------------------------------------------------------------------
    const runAnalysis = async (file: File, typeOverride?: string) => {
        setIsAnalyzing(true);
        setStatus('Reading and decoding audio data…');

        // Reset state for new analysis
        setBeats([]);
        setMarkerData([]);
        setBpm(null);
        setConfidence(null);

        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            // Use override type if provided (e.g. from auto-load), else current state
            const effectiveStemType = typeOverride || selectedStemType;

            // ---- Beat detection ------------------------------------------------
            setStatus(`Analyzing beats (${algorithm})…`);
            const beatResult = await analyzeBeats(audioBuffer, algorithm);
            console.log('[Essentia] BPM:', beatResult.bpm, 'beats:', beatResult.beats.length, 'confidence:', beatResult.confidence);

            const allMarkers: MarkerData[] = [];

            // Map stem type to colors
            const stemMapping = USER_STEM_MAPPING[effectiveStemType.toLowerCase()] || USER_STEM_MAPPING['other'];

            // 1. Beats
            beatResult.beats.forEach(time => {
                const frame = Math.round(time * frameRate);
                allMarkers.push({
                    timestamp: time,
                    frame,
                    color: stemMapping.base, // Use stem color
                    note: effectiveStemType, // Use stem type as Note
                    type: 'beat',
                    duration_sec: 1 / frameRate
                });
            });

            // 2. Onsets (if enabled)
            if (enableOnsets) {
                setStatus('Analyzing onsets…');
                const onsetResult = await analyzeOnsets(audioBuffer);
                const onsetColor = stemMapping.light; // Lighter variant

                onsetResult.onsets.forEach(time => {
                    const frame = Math.round(time * frameRate);
                    allMarkers.push({
                        timestamp: time,
                        frame,
                        color: onsetColor,
                        note: 'Onset',
                        type: 'onset',
                        duration_sec: 0.05
                    });
                });
            }

            // 3. Loudness (if enabled)
            if (enableLoudness) {
                setStatus('Analyzing loudness…');
                const loudResult = await analyzeLoudness(audioBuffer);
                const loudColor = stemMapping.light;

                loudResult.regions.forEach(region => {
                    const frame = Math.round(region.start * frameRate);
                    allMarkers.push({
                        timestamp: region.start,
                        frame,
                        color: loudColor,
                        note: 'Loud',
                        type: 'loudness',
                        duration_sec: region.end - region.start
                    });
                });
            }

            setBpm(beatResult.bpm);
            if (beatResult.confidence) setConfidence(beatResult.confidence);

            // Sort all markers by timestamp
            allMarkers.sort((a, b) => a.timestamp - b.timestamp);
            setMarkerData(allMarkers);

            const beatCount = allMarkers.filter(m => m.type === 'beat').length;
            const onsetCount = allMarkers.filter(m => m.type === 'onset').length;
            const loudCount = allMarkers.filter(m => m.type === 'loudness').length;

            let summary = `${beatCount} beats @${Math.round(beatResult.bpm)} BPM`;
            if (beatResult.confidence != null) summary += ` (confidence ${beatResult.confidence.toFixed(2)})`;
            if (onsetCount > 0) summary += ` · ${onsetCount} onsets`;
            if (loudCount > 0) summary += ` · ${loudCount} loud regions`;
            setStatus(summary);

            // Notify parent if embedded
            if (onAnalysisComplete) {
                onAnalysisComplete(allMarkers);
            }

        } catch (err) {
            console.error('Analysis failed:', err);
            setStatus('Analysis failed. Try a different audio file.');
        } finally {
            setIsAnalyzing(false);
            audioContext.close().catch(() => { /* already closed */ });
        }
    };

    // -----------------------------------------------------------------------
    // Auto-load initial audio path (from Stem Separation)
    // -----------------------------------------------------------------------
    // Track if we've already triggered analysis for this path to prevent StrictMode double-invocation
    const analysisTriggeredRef = useRef<string | null>(null);

    useEffect(() => {
        if (!initialAudioPath) return;

        // Prevent double-triggering for the same file in Strict Mode
        // Include initialMarkers length in key to re-trigger if markers change? No, just loading.
        const triggerKey = `${initialAudioPath} -${initialStemType} -${algorithm} -${enableOnsets} -${enableLoudness} `;
        if (analysisTriggeredRef.current === triggerKey) {
            return;
        }

        const fs = window.require ? window.require('fs') : null;
        const nodePath = window.require ? window.require('path') : null;

        if (fs && nodePath && fs.existsSync(initialAudioPath)) {
            try {
                const buffer = fs.readFileSync(initialAudioPath);
                const fileName = nodePath.basename(initialAudioPath);
                const blob = new Blob([buffer]);
                const file = new File([blob], fileName, { type: 'audio/mpeg' }); // Type guess
                Object.defineProperty(file, 'path', { value: initialAudioPath, writable: false });

                setAudioFile(file);
                setAudioPath(initialAudioPath);

                // Set Stem Type mapping
                if (initialStemType) {
                    const typeMap: Record<string, string> = {
                        'Drums': 'drums',   // Now explicit Red
                        'Bass': 'bass',     // Blue
                        'Vocals': 'vocals', // Green
                        'Other': 'other'    // Yellow
                    };

                    const mappedType = typeMap[initialStemType] || 'beat';
                    setSelectedStemType(mappedType);

                    // CHECK CACHE FIRST
                    if (initialMarkers && initialMarkers.length > 0) {
                        console.log('Loading cached markers:', initialMarkers.length);
                        setMarkerData(initialMarkers);
                        // Extract beats for visualization if needed, though markerData is the source of truth
                        const beats = initialMarkers.filter(m => m.type === 'beat').map(m => m.timestamp);
                        setBeats(beats);

                        setStatus(`Loaded ${initialMarkers.length} markers from project.`);
                        analysisTriggeredRef.current = triggerKey;
                        // Do NOT call runAnalysis

                        // BUT we might want to notify parent again? Probably not needed as parent passed them.
                        return;
                    }

                    // Trigger Analysis Automatically if no cache
                    console.log('Auto-loading audio from:', initialAudioPath);
                    analysisTriggeredRef.current = triggerKey;
                    runAnalysis(file, mappedType);
                } else {
                    setAudioUrl(prev => {
                        if (prev) URL.revokeObjectURL(prev);
                        return URL.createObjectURL(file);
                    });
                    setStatus(`Loaded stem: ${fileName}. Ready to analyze.`);
                }

            } catch (err) {
                console.error("Failed to auto-load audio:", err);
                setStatus("Error loading audio file.");
            }
        }
    }, [initialAudioPath, initialStemType, algorithm, enableOnsets, enableLoudness, initialMarkers]);


    // -----------------------------------------------------------------------
    // Audio drop → full analysis pipeline
    // -----------------------------------------------------------------------
    const handleAudioDrop = useCallback(async (files: File[]) => {
        if (files.length === 0) return;

        const file = files[0];
        setAudioFile(file);
        setAudioPath((file as any).path || file.name);

        // Revoke previous object URL to prevent memory leak
        setAudioUrl(prev => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(file);
        });

        // If dropping a file that is different from active project's audio,
        // we might want to warn or just treat it as temporary/new analysis.
        // For now, we just let it run.
        if (activeProject && (file as any).path !== activeProject.audioPath) {
            // Optional: onSelectProject(''); // Deselect current project?
        }

        setLastExportedCsvPath('');

        // Run analysis
        runAnalysis(file);

    }, [activeProject, selectedStemType, frameRate, algorithm, enableOnsets, enableLoudness]);

    // -----------------------------------------------------------------------
    // CSV export — extended format with type & duration columns
    // -----------------------------------------------------------------------
    const exportToCSV = useCallback(() => {
        if (markerData.length === 0) {
            setStatus('No data to export');
            return;
        }

        const csvContent = [
            'frame,timestamp,color,note,type,duration_sec',
            ...markerData.map(m =>
                `${m.frame},${m.timestamp.toFixed(3)},${m.color},${m.note},${m.type},${m.duration_sec} `
            ),
        ].join('\n');

        const fileName = `beats_${audioFile?.name.replace(/\.[^/.]+$/, '') || 'export'}.csv`;
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setLastExportedCsvPath(fileName);
        setStatus(`Exported ${markerData.length} markers to CSV`);

        if (activeProject) {
            onUpdateProject(activeProject.id, { csvPath: fileName });
        }
    }, [markerData, audioFile, activeProject, onUpdateProject]);

    // -----------------------------------------------------------------------
    // Project management (Global)
    // -----------------------------------------------------------------------
    const handleSaveProject = useCallback(() => {
        if (!audioFile || markerData.length === 0) {
            setStatus('Nothing to save - analyze audio first');
            return;
        }

        const projectName = audioFile.name.replace(/\.[^/.]+$/, '');
        const sharedFields = {
            bpm: bpm || undefined,
            beatCount: beats.length,
            frameRate,
            stemType: selectedStemType,
            algorithm,
            enableOnsets,
            enableLoudness,
            markers: markerData,
            csvPath: lastExportedCsvPath || undefined,
        };

        if (activeProject) {
            onUpdateProject(activeProject.id, sharedFields);
            setStatus(`Updated project: ${projectName} `);
        } else {
            // Create new project
            const newProject = onCreateProject(audioFile);
            // Immediately update with analysis data
            onUpdateProject(newProject.id, sharedFields);
            setStatus(`Saved project: ${projectName} `);
        }
    }, [audioFile, audioPath, markerData, bpm, beats, frameRate, selectedStemType,
        algorithm, enableOnsets, enableLoudness,
        lastExportedCsvPath, activeProject, onCreateProject, onUpdateProject]);

    const handleLoadProject = useCallback((project: BeatProject) => {
        onSelectProject(project.id);
    }, [onSelectProject]);

    const handleDeleteProject = useCallback((id: string) => {
        onDeleteProject(id);
        if (activeProject?.id === id) {
            onSelectProject(''); // Close if deleted
        }
        setStatus('Project deleted');
    }, [onDeleteProject, activeProject, onSelectProject]);

    // -----------------------------------------------------------------------
    // React to Active Project Changes (Load Data)
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (!activeProject) return;

        // If embedded, we ONLY want to sync markers/settings if they match our current stem
        // But we DO NOT want to switch the audio file to the project's main file.
        if (isEmbedded) {
            // Optional: Sync settings from project if you want global defaults
            setFrameRate(activeProject.frameRate);
            // Don't override stem type or audio path
            return;
        }

        // If we represent the same audio/markers, skip extensive reload 
        if (activeProject.audioPath === audioPath &&
            markerData.length === (activeProject.markers?.length || 0) &&
            activeProject.frameRate === frameRate) {
            // Minor props update checks could go here
            return;
        }

        console.log('Loading active project:', activeProject.name);

        setFrameRate(activeProject.frameRate);
        setSelectedStemType(activeProject.stemType);
        setBpm(activeProject.bpm || null);
        setLastExportedCsvPath(activeProject.csvPath || '');
        setAlgorithm((activeProject.algorithm as BeatAlgorithm) || 'multifeature');
        setEnableOnsets(activeProject.enableOnsets ?? false);
        setEnableLoudness(activeProject.enableLoudness ?? false);

        // Restore saved markers
        const savedMarkers = activeProject.markers || [];
        setMarkerData(savedMarkers);
        setBeats(savedMarkers.filter(m => m.type === 'beat').map(m => m.timestamp));
        setConfidence(null);

        // Audio Loading
        if (activeProject.audioPath !== audioPath) {
            setAudioPath(activeProject.audioPath || '');

            // Try load from disk (Electron)
            const fs = window.require ? window.require('fs') : null;
            const nodePath = window.require ? window.require('path') : null;

            if (fs && nodePath && activeProject.audioPath && fs.existsSync(activeProject.audioPath)) {
                try {
                    const buffer = fs.readFileSync(activeProject.audioPath);
                    const fileName = nodePath.basename(activeProject.audioPath);
                    const blob = new Blob([buffer]);
                    const file = new File([blob], fileName, { type: 'audio/mpeg' });
                    Object.defineProperty(file, 'path', { value: activeProject.audioPath, writable: false });

                    setAudioFile(file);
                    setAudioUrl(prev => {
                        if (prev) URL.revokeObjectURL(prev);
                        return URL.createObjectURL(file);
                    });
                    setStatus(`Loaded project: ${activeProject.name} `);
                } catch (err) {
                    console.error('Failed to load audio from disk:', err);
                    setAudioFile(null);
                    setAudioUrl(null);
                    setStatus(`Error loading audio for ${activeProject.name}`);
                }
            } else {
                setAudioFile(null);
                setAudioUrl(null);
                setStatus(`Project loaded(${activeProject.name}).Audio file missing or web - mode.`);
            }
        }

    }, [activeProject, isEmbedded]);

    // -----------------------------------------------------------------------
    // Reprocess — re-run analysis with current settings on the loaded audio
    // -----------------------------------------------------------------------
    const handleReprocess = useCallback(async () => {
        if (!audioFile) {
            setStatus('Drop an audio file first, then change settings and reprocess.');
            return;
        }

        setIsAnalyzing(true);
        setStatus(`Reprocessing with ${algorithm} algorithm…`);

        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        try {
            const arrayBuffer = await audioFile.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            // ---- Beat detection ------------------------------------------------
            setStatus(`Analyzing beats(${algorithm})…`);
            const beatResult = await analyzeBeats(audioBuffer, algorithm);
            console.log('[Reprocess] BPM:', beatResult.bpm, 'beats:', beatResult.beats.length);

            const stemColors = USER_STEM_MAPPING[selectedStemType.toLowerCase()] || USER_STEM_MAPPING['beat'];
            const beatColor = stemColors.base;
            const variantColor = stemColors.light;

            // Re-initialize allMarkers for this scope
            const allMarkers: MarkerData[] = [];

            for (const t of beatResult.beats) {
                allMarkers.push({
                    timestamp: t,
                    frame: Math.round(t * frameRate),
                    color: beatColor,
                    note: selectedStemType,
                    type: 'beat',
                    duration_sec: 0,
                });
            }

            setBpm(Math.round(beatResult.bpm));
            setConfidence(beatResult.confidence ?? null);
            setBeats(beatResult.beats);

            // ---- Onset detection (optional) ------------------------------------
            if (enableOnsets) {
                setStatus('Detecting onsets…');
                const onsetResult = await analyzeOnsets(audioBuffer);
                for (const t of onsetResult.onsets) {
                    allMarkers.push({
                        timestamp: t,
                        frame: Math.round(t * frameRate),
                        color: variantColor,
                        note: 'onset',
                        type: 'onset',
                        duration_sec: 0,
                    });
                }
            }

            // ---- Loudness regions (optional) -----------------------------------
            if (enableLoudness) {
                setStatus('Analyzing loudness…');
                const loudnessResult = await analyzeLoudness(audioBuffer, 0.8);
                for (const r of loudnessResult.regions) {
                    allMarkers.push({
                        timestamp: r.start,
                        frame: Math.round(r.start * frameRate),
                        color: variantColor,
                        note: `Loud ${(r.level * 100).toFixed(0)}% `,
                        type: 'loudness',
                        duration_sec: parseFloat((r.end - r.start).toFixed(3)),
                    });
                }
            }


            allMarkers.sort((a, b) => a.timestamp - b.timestamp);
            setMarkerData(allMarkers);

            const beatCount = allMarkers.filter(m => m.type === 'beat').length;
            const onsetCount = allMarkers.filter(m => m.type === 'onset').length;
            const loudCount = allMarkers.filter(m => m.type === 'loudness').length;

            let summary = `${beatCount} beats @${Math.round(beatResult.bpm)} BPM`;
            if (beatResult.confidence != null) summary += ` (confidence ${beatResult.confidence.toFixed(2)})`;
            if (onsetCount > 0) summary += ` · ${onsetCount} onsets`;
            if (loudCount > 0) summary += ` · ${loudCount} loud regions`;
            setStatus(summary);
        } catch (err) {
            console.error('Reprocess failed:', err);
            setStatus('Reprocess failed. Try a different audio file.');
        } finally {
            setIsAnalyzing(false);
            audioContext.close().catch(() => { /* already closed */ });
        }
    }, [audioFile, selectedStemType, frameRate, algorithm, enableOnsets, enableLoudness]);

    const handleStemTypeChange = (stemType: string) => {
        setSelectedStemType(stemType);
        const stemColors = USER_STEM_MAPPING[stemType.toLowerCase()] || USER_STEM_MAPPING['beat'];

        setMarkerData(prev => prev.map(m => {
            if (m.type === 'beat') {
                return { ...m, color: stemColors.base, note: stemType };
            } else if (m.type === 'onset' || m.type === 'loudness') {
                // Update variant colors too if stem type changes
                return { ...m, color: stemColors.light };
            }
            return m;
        }));
    };


    // -----------------------------------------------------------------------
    // Stage for Resolve — write self-contained Python script to Resolve's
    // Scripts/Comp folder so it appears in Workspace > Scripts menu
    // -----------------------------------------------------------------------
    const handleStageForResolve = useCallback(async () => {
        if (markerData.length === 0) {
            setStatus('No markers to stage — analyze audio first');
            return;
        }

        const ipcRenderer = window.require ? window.require('electron').ipcRenderer : null;
        if (!ipcRenderer) {
            setStatus('Stage for Resolve requires the Electron app');
            return;
        }

        setStatus('Staging script for Resolve…');
        try {
            const result = await ipcRenderer.invoke('stage-for-resolve', {
                projectName: audioFile?.name.replace(/\.[^/.]+$/, '') || 'Untitled',
                audioPath: audioPath || '',
                csvPath: lastExportedCsvPath || '',
                markers: markerData,
            });

            if (result.success) {
                setStatus(`✅ Staged ${markerData.length} markers → Open Resolve: Workspace > Scripts > 01_Load_Beats`);
            } else {
                setStatus(`❌ Failed to stage: ${result.error} `);
            }
        } catch (err) {
            console.error('Stage for Resolve failed:', err);
            setStatus('❌ Failed to stage script for Resolve');
        }
    }, [markerData, audioFile, audioPath, lastExportedCsvPath]);

    const handleFrameRateChange = (newFps: number) => {
        setFrameRate(newFps);
        setMarkerData(prev => prev.map(m => ({
            ...m,
            frame: Math.round(m.timestamp * newFps),
        })));
    };

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------
    return (
        <div className="module-container">
            <div className="module-header" style={{ display: isEmbedded ? 'none' : 'block' }}>
                <h2 className="module-title">🎵 Beat Extraction</h2>
                <p className="module-description">
                    Load an audio file, detect beats with Essentia.js, and export as CSV for DaVinci Resolve markers.
                </p>
            </div>

            {/* Projects Panel - Hide if embedded */}
            {!isEmbedded && (
                <ProjectsPanel
                    projects={projects}
                    onLoad={handleLoadProject}
                    onDelete={handleDeleteProject}
                    currentProjectId={activeProject?.id}
                />
            )}

            <div className={isEmbedded ? "block" : "grid-2"}>
                {/* Audio File card - Hide DropZone if embedded (since we auto-load) */}
                {!isEmbedded && (
                    <div className="card">
                        <div className="card-header">
                            <h3 className="card-title">Audio File</h3>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                {bpm && <span className="status-badge success">{bpm} BPM</span>}
                                {confidence != null && (
                                    <span className="status-badge" style={{
                                        background: confidence > 3 ? 'var(--success)' : confidence > 1.5 ? 'var(--warning, orange)' : 'var(--error, red)',
                                        color: '#fff',
                                        fontSize: '0.75rem',
                                    }}>
                                        conf {confidence.toFixed(1)}
                                    </span>
                                )}
                            </div>
                        </div>
                        <DropZone
                            onFilesDropped={handleAudioDrop}
                            accept="audio/*"
                            label="Drop MP3 or WAV here"
                            defaultAudioPath={audioPath || undefined}
                        />
                        {audioFile && (
                            <p style={{ marginTop: '12px', color: 'var(--text-secondary)' }}>
                                📁 {audioFile.name}
                            </p>
                        )}
                    </div>
                )}


                {/* Settings card - Hide if embedded (Parent has controls) */}
                {!isEmbedded && (
                    <div className="card">
                        <div className="card-header">
                            <h3 className="card-title">Settings</h3>
                        </div>

                        {/* Frame rate */}
                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                Timeline Frame Rate (FPS)
                            </label>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <input
                                    type="number"
                                    value={frameRate}
                                    onChange={(e) => handleFrameRateChange(Number(e.target.value) || 24)}
                                    min={1}
                                    max={120}
                                    className="input-field"
                                    style={{
                                        width: '80px',
                                        padding: '8px 12px',
                                        background: 'var(--bg-tertiary)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '6px',
                                        color: 'var(--text-primary)',
                                        fontSize: '1rem',
                                    }}
                                />
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>fps</span>
                                {[24, 25, 30, 60].map(fps => (
                                    <button
                                        key={fps}
                                        className={`btn ${frameRate === fps ? 'btn-primary' : 'btn-secondary'} `}
                                        onClick={() => handleFrameRateChange(fps)}
                                        style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                                    >
                                        {fps}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Stem color */}
                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                Stem Color Mapping
                            </label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                    {Object.entries(USER_STEM_MAPPING).map(([stem, colors]) => (
                                        <button
                                            key={stem}
                                            className={`btn ${selectedStemType === stem ? 'btn-primary' : 'btn-secondary'} `}
                                            onClick={() => handleStemTypeChange(stem)}
                                            style={{ textTransform: 'capitalize' }}
                                        >
                                            {stem} → {colors.base}/{colors.light}
                                        </button>
                                    ))}
                                </div>

                            </div>
                        </div>

                        {/* Algorithm selector */}
                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                Beat Algorithm
                            </label>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                    className={`btn ${algorithm === 'multifeature' ? 'btn-primary' : 'btn-secondary'} `}
                                    onClick={() => setAlgorithm('multifeature')}
                                    style={{ fontSize: '0.85rem' }}
                                >
                                    MultiFeature (accurate)
                                </button>
                                <button
                                    className={`btn ${algorithm === 'degara' ? 'btn-primary' : 'btn-secondary'} `}
                                    onClick={() => setAlgorithm('degara')}
                                    style={{ fontSize: '0.85rem' }}
                                >
                                    Degara (fast)
                                </button>
                            </div>
                        </div>

                        {/* Analysis toggles */}
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                Additional Analysis
                            </label>
                            <div style={{ display: 'flex', gap: '16px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--text-primary)' }}>
                                    <input
                                        type="checkbox"
                                        checked={enableOnsets}
                                        onChange={e => setEnableOnsets(e.target.checked)}
                                    />
                                    Onset Detection
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--text-primary)' }}>
                                    <input
                                        type="checkbox"
                                        checked={enableLoudness}
                                        onChange={e => setEnableLoudness(e.target.checked)}
                                    />
                                    Loudness Regions
                                </label>
                            </div>
                        </div>

                        {/* Reprocess button */}
                        <div style={{ marginTop: '16px' }}>
                            <button
                                className="btn btn-primary"
                                onClick={handleReprocess}
                                disabled={!audioFile || isAnalyzing}
                                style={{ width: '100%' }}
                            >
                                {isAnalyzing ? '⏳ Reprocessing…' : '🔄 Reprocess'}
                            </button>
                            {!audioFile && markerData.length > 0 && (
                                <p style={{ marginTop: '6px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                    Drop audio file to enable reprocessing
                                </p>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Waveform */}
            {/* Waveform - Hide while analyzing if embedded (parent shows status) */}
            {!isEmbedded && (
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Waveform Preview</h3>
                        {beats.length > 0 && (
                            <div className="beat-count">
                                <span className="beat-count-number">{beats.length}</span>
                                <span className="beat-count-label">beats detected</span>
                            </div>
                        )}
                    </div>

                    {isAnalyzing ? (
                        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                            <div style={{ fontSize: '2rem', marginBottom: '12px' }}>⏳</div>
                            {status || 'Analyzing audio…'}
                        </div>
                    ) : (
                        <BeatVisualizer audioUrl={audioUrl} beats={beats} />
                    )}
                </div>
            )}

            {/* Export & Save */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">Export & Save</h3>
                    {status && (!isEmbedded || !isAnalyzing) && <span className="status-badge">{status}</span>}
                </div>

                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <button
                        className="btn btn-primary"
                        onClick={exportToCSV}
                        disabled={markerData.length === 0}
                    >
                        📥 Export CSV
                    </button>
                    {!isEmbedded && (
                        <button
                            className="btn btn-secondary"
                            onClick={handleSaveProject}
                            disabled={markerData.length === 0}
                        >
                            💾 {activeProject ? 'Update Project' : 'Save Project'}
                        </button>
                    )}
                    <button
                        className="btn btn-secondary"
                        onClick={handleStageForResolve}
                        disabled={markerData.length === 0 || isAnalyzing}
                        title="Generate a Python script in Resolve's Scripts folder — run from Workspace > Scripts"
                    >
                        🎬 Stage for Resolve
                    </button>
                </div>

                {markerData.length > 0 && (
                    <div style={{ marginTop: '16px' }}>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '8px' }}>
                            CSV Preview (first 5 rows):
                        </p>
                        <pre style={{
                            background: 'var(--bg-tertiary)',
                            padding: '12px',
                            borderRadius: '8px',
                            fontSize: '0.85rem',
                            overflow: 'auto',
                        }}>
                            {`frame, timestamp, color, note, type, duration_sec\n${markerData
                                .slice(0, 5)
                                .map(m => `${m.frame},${m.timestamp.toFixed(3)},${m.color},${m.note},${m.type},${m.duration_sec}`)
                                .join('\n')
                                } `}
                        </pre>
                    </div>
                )}
            </div>
        </div>
    );
};

export default BeatExtractionModule;
