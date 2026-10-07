import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';

interface Stem {
    type: string;
    path: string;
}

interface MultiTrackWaveformProps {
    stems: Stem[];
    markers?: Record<string, number[]>; // stemType -> timestamps
}

// WHAT: Color lookup dictionary mapping audio stem types to distinctive hex colors.
// WHY: Visual differentiation between drums, bass, vocals, and instruments helps the
// editor immediately discern rhythm vs melodic layers in the multi-track view.
const STEM_COLOR_PALETTE_MAP: Record<string, string> = {
    'Drums': '#ef4444',  // Red - High impact percussive events
    'Bass': '#3b82f6',   // Blue - Low-frequency rhythmic foundations
    'Vocals': '#10b981', // Emerald Green - Prominent lead melodic content
    'Other': '#f59e0b',  // Amber - Secondary instrumental and harmonic beds
};

// WHAT: Resolves the waveform hex color based on audio stem category.
// WHY: Hoisted to the module scope to prevent declaration-order errors and avoid
// recreating the color mapping function on every component render.
function getStemColor(stem_instrument_type: string, is_progress_indicator: boolean = false): string {
    const base_color = STEM_COLOR_PALETTE_MAP[stem_instrument_type] || '#8b5cf6'; // Purple default fallback
    return is_progress_indicator ? base_color : base_color;
}

const MultiTrackWaveform: React.FC<MultiTrackWaveformProps> = ({ stems, markers = {} }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [wavesurfers, setWavesurfers] = useState<WaveSurfer[]>([]);
    // WHAT: Storing references to RegionsPlugin instances directly.
    // WHY: Enables adding and clearing transient marker visualizers without recreating WaveSurfer.
    const regionsPluginsRef = useRef<ReturnType<typeof RegionsPlugin.create>[]>([]);
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);

    // WHAT: Initializes synchronized WaveSurfer instances for every audio stem.
    // WHY: Each audio track needs its own waveform visualization canvas while sharing
    // transport controls (play, pause, seek) with the rest of the project.
    useEffect(() => {
        const current_container_element = containerRef.current;
        if (!current_container_element || stems.length === 0) return;

        regionsPluginsRef.current = [];

        const initialized_wavesurfer_instances: WaveSurfer[] = [];
        let maximum_detected_duration_seconds = 0;

        stems.forEach((current_stem) => {
            const track_wrapper_element = document.createElement('div');
            track_wrapper_element.style.marginBottom = '8px';
            track_wrapper_element.style.position = 'relative';

            // WHAT: Constructing track title badge for the audio stem.
            // WHY: Gives the user immediate feedback on which stem track is rendered.
            const track_label_element = document.createElement('div');
            track_label_element.className = 'absolute top-1 left-1 z-10 text-[10px] px-1 py-0.5 rounded bg-black/70 text-white pointer-events-none track-stem-label';
            track_label_element.dataset.stemType = current_stem.type;
            track_label_element.innerHTML = `<strong>${current_stem.type}</strong>`;
            track_wrapper_element.appendChild(track_label_element);

            const waveform_canvas_container = document.createElement('div');
            track_wrapper_element.appendChild(waveform_canvas_container);
            current_container_element.appendChild(track_wrapper_element);

            // WHAT: Instantiate WaveSurfer for this stem track.
            // WHY: Renders high-performance WebGL/Canvas audio peaks with custom track colors.
            const current_wavesurfer_instance = WaveSurfer.create({
                container: waveform_canvas_container,
                waveColor: getStemColor(current_stem.type),
                progressColor: getStemColor(current_stem.type, true),
                height: 64,
                barWidth: 2,
                cursorWidth: 1,
                cursorColor: '#fff',
                normalize: true,
                minPxPerSec: 50,
                interact: true, // Allow clicking to seek
                hideScrollbar: true,
            });

            // WHAT: Register the RegionsPlugin for marker overlays.
            // WHY: Enables displaying vertical lines or shaded slices at rhythmic beat locations.
            const regions_plugin_instance = current_wavesurfer_instance.registerPlugin(RegionsPlugin.create());
            regionsPluginsRef.current.push(regions_plugin_instance);

            // WHAT: Reading audio file directly into memory buffer for local playback.
            // WHY: Bypasses browser fetch and CORS restrictions inside Electron desktop app.
            try {
                const electron_runtime = (window as unknown as { require?: (module_name: string) => { readFileSync: (file_path: string) => Uint8Array } });
                if (electron_runtime.require) {
                    const filesystem_module = electron_runtime.require('fs');
                    const file_buffer = filesystem_module.readFileSync(current_stem.path);
                    const audio_blob = new Blob([file_buffer as unknown as BlobPart], { type: 'audio/mpeg' });
                    const audio_object_url = URL.createObjectURL(audio_blob);

                    current_wavesurfer_instance.load(audio_object_url).catch(load_error => {
                        const error_message = load_error instanceof Error ? load_error.message : String(load_error);
                        if (load_error?.name !== 'AbortError' && !error_message.toLowerCase().includes('abort') && !error_message.toLowerCase().includes('destroy')) {
                            console.error("Wavesurfer load error:", load_error);
                        }
                    });
                }
            } catch (file_read_error) {
                console.error("Failed to load stem file from disk:", current_stem.path, file_read_error);
            }

            current_wavesurfer_instance.on('ready', () => {
                const track_duration_seconds = current_wavesurfer_instance.getDuration();
                if (track_duration_seconds > maximum_detected_duration_seconds) {
                    maximum_detected_duration_seconds = track_duration_seconds;
                    setDuration(track_duration_seconds);
                }
            });

            // WHAT: Master seek synchronization on user interaction.
            // WHY: Clicking on any single stem waveform must seek all other stems to the identical timestamp.
            current_wavesurfer_instance.on('interaction', (new_playback_time_seconds) => {
                initialized_wavesurfer_instances.forEach(other_wavesurfer_instance => {
                    if (other_wavesurfer_instance !== current_wavesurfer_instance) {
                        const total_track_duration = other_wavesurfer_instance.getDuration() || 1;
                        other_wavesurfer_instance.seekTo(new_playback_time_seconds / total_track_duration);
                    }
                });
                setCurrentTime(new_playback_time_seconds);
            });

            current_wavesurfer_instance.on('finish', () => {
                setIsPlaying(false);
            });

            initialized_wavesurfer_instances.push(current_wavesurfer_instance);
        });

        queueMicrotask(() => {
            setWavesurfers(initialized_wavesurfer_instances);
        });

        return () => {
            initialized_wavesurfer_instances.forEach(wavesurfer_instance => {
                try {
                    wavesurfer_instance.destroy();
                } catch (cleanup_error) {
                    console.warn('WaveSurfer cleanup error:', cleanup_error);
                }
            });
            if (current_container_element) {
                current_container_element.innerHTML = '';
            }
        };
    }, [stems]);

    // WHAT: Renders marker regions across all active waveform instances.
    // WHY: Keeps marker visuals in sync whenever beat analysis completes or changes.
    useEffect(() => {
        if (wavesurfers.length === 0 || regionsPluginsRef.current.length === 0) return;

        wavesurfers.forEach((_wavesurfer_instance, track_index) => {
            const current_stem = stems[track_index];
            const regions_plugin_instance = regionsPluginsRef.current[track_index];

            if (!current_stem || !regions_plugin_instance) {
                console.warn('[Waveform] Missing stem or region plugin for index', track_index);
                return;
            }

            // Clear existing regions before redrawing
            try {
                regions_plugin_instance.clearRegions();
            } catch (clear_error) {
                console.error('[Waveform] Failed to clear regions', clear_error);
            }

            let stem_marker_timestamps = markers[current_stem.type];
            if (!stem_marker_timestamps) {
                const lowercase_stem_type = current_stem.type.toLowerCase();
                const matched_marker_key = Object.keys(markers).find(
                    key_name => key_name.toLowerCase() === lowercase_stem_type
                );
                if (matched_marker_key) {
                    stem_marker_timestamps = markers[matched_marker_key];
                }
            }

            if (stem_marker_timestamps && stem_marker_timestamps.length > 0) {
                const marker_color_accent = getStemColor(current_stem.type);

                stem_marker_timestamps.forEach((timestamp_seconds) => {
                    try {
                        regions_plugin_instance.addRegion({
                            start: timestamp_seconds,
                            end: timestamp_seconds + 0.05,
                            color: marker_color_accent,
                            drag: false,
                            resize: false,
                        });
                    } catch (add_region_error) {
                        console.error('[Waveform] Failed to add region at timestamp:', timestamp_seconds, add_region_error);
                    }
                });
            }
        });
    }, [wavesurfers, markers, stems]);

    // WHAT: Toggles synchronized multi-track playback.
    // WHY: Controls all stems in tandem so the user hears the unified mix.
    const handleTogglePlayback = () => {
        if (isPlaying) {
            wavesurfers.forEach(wavesurfer_instance => wavesurfer_instance.pause());
            setIsPlaying(false);
        } else {
            wavesurfers.forEach(wavesurfer_instance => wavesurfer_instance.play());
            setIsPlaying(true);
        }
    };

    return (
        <div className="bg-gray-900/50 p-4 rounded border border-gray-700">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-white">Multi-Track Preview</h3>
                <div className="flex gap-2 text-xs text-gray-400">
                    <span>{stems.length} tracks</span>
                    <span>{currentTime.toFixed(1)}s / {duration.toFixed(1)}s</span>
                </div>
            </div>

            {/* Containers for each stem will be mounted here */}
            <div ref={containerRef} className="space-y-2" />

            {/* Playback Controls */}
            <div className="mt-4 flex justify-between items-center">
                <div className="flex gap-2">
                    <button
                        onClick={handleTogglePlayback}
                        className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-medium flex items-center gap-1"
                    >
                        {isPlaying ? '⏸ Pause All' : '▶ Play All'}
                    </button>
                    <button
                        onClick={() => {
                            wavesurfers.forEach(wavesurfer_instance => wavesurfer_instance.stop());
                            setIsPlaying(false);
                            setCurrentTime(0);
                        }}
                        className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
                    >
                        ⏹ Stop
                    </button>
                </div>
                <div className="text-xs text-gray-400 italic">
                    Click any waveform track to seek all stems synchronously.
                </div>
            </div>
        </div>
    );
};

export default MultiTrackWaveform;
