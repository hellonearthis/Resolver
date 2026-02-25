import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';

interface Stem {
    type: string;
    path: string;
}

interface MultiTrackWaveformProps {
    stems: Stem[];
    markers?: Record<string, number[]>; // stemType -> timestamps
}

const MultiTrackWaveform: React.FC<MultiTrackWaveformProps> = ({ stems, markers = {} }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [wavesurfers, setWavesurfers] = useState<WaveSurfer[]>([]);
    const regionsPluginsRef = useRef<any[]>([]); // Store plugin instances directly
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);

    // Initialize WaveSurfers
    useEffect(() => {
        if (!containerRef.current || stems.length === 0) return;

        // Cleanup old instances
        wavesurfers.forEach(ws => {
            try { ws.destroy(); } catch (e) { /* ignore */ }
        });
        setWavesurfers([]);
        regionsPluginsRef.current = [];

        const newSurfers: WaveSurfer[] = [];
        let maxDuration = 0;

        stems.forEach((stem) => {
            const wrapper = document.createElement('div');
            wrapper.style.marginBottom = '8px';
            wrapper.style.position = 'relative';

            // Label
            const label = document.createElement('div');
            // Try explicit match first, then lowercase match for debug count
            label.className = 'stem-label';
            let debugCount = 0;
            const stemType = stem.type;
            let m = markers[stemType];
            if (!m) {
                const lowerType = stemType.toLowerCase();
                const markerKey = Object.keys(markers).find(k => k.toLowerCase() === lowerType);
                if (markerKey) m = markers[markerKey];
            }
            if (m) debugCount = m.length;

            label.innerHTML = `<strong>${stem.type}</strong> <span style="opacity:0.7; font-size:9px">(${debugCount} markers)</span>`;

            label.style.position = 'absolute';
            label.style.top = '4px';
            label.style.left = '4px';
            label.style.zIndex = '10';
            label.style.fontSize = '10px';
            label.style.padding = '2px 4px';
            label.style.borderRadius = '3px';
            label.style.background = 'rgba(0,0,0,0.7)';
            label.style.color = '#fff';
            label.style.pointerEvents = 'none';
            wrapper.appendChild(label);

            const div = document.createElement('div');
            wrapper.appendChild(div);
            containerRef.current?.appendChild(wrapper);

            // Create WaveSurfer first
            const ws = WaveSurfer.create({
                container: div,
                waveColor: getStemColor(stem.type),
                progressColor: getStemColor(stem.type, true),
                height: 64,
                barWidth: 2,
                cursorWidth: 1,
                cursorColor: '#fff',
                normalize: true,
                minPxPerSec: 50,
                interact: true, // Allow clicking to seek
                hideScrollbar: true,
                // plugins: [wsRegions], // Don't pass here
            });

            // Register plugin explicitly and store reference
            const wsRegions = ws.registerPlugin(RegionsPlugin.create());
            regionsPluginsRef.current.push(wsRegions);

            // Handle media protocol for Electron
            // Direct file read to bypass protocol/fetch issues
            try {
                // @ts-ignore
                const fs = window.require('fs');
                const buffer = fs.readFileSync(stem.path);
                const blob = new Blob([buffer], { type: 'audio/mpeg' }); // MIME type might need to vary, but mp3/wav usually works with generic or specific
                const url = URL.createObjectURL(blob);

                ws.load(url).catch(e => {
                    const msg = e instanceof Error ? e.message : String(e);
                    if (e?.name !== 'AbortError' && !msg.toLowerCase().includes('abort') && !msg.toLowerCase().includes('destroy')) {
                        console.error("Wavesurfer load error:", e);
                    }
                });


                // Cleanup using an event listener on destroy (though checking documentation, destroy doesn't emit 'destroy' on the instance itself usually, but let's try to keep it simple)
                // We'll rely on the useEffect cleanup to revoke if we track them, but for now this is a massive improvement over broken media://
            } catch (err) {
                console.error("Failed to load stem:", stem.path, err);
            }

            ws.on('ready', () => {
                const dur = ws.getDuration();
                if (dur > maxDuration) {
                    maxDuration = dur;
                    setDuration(dur);
                }
            });

            // Master seek on interaction
            ws.on('interaction', (newTime) => {
                // Sync others
                newSurfers.forEach(other => {
                    if (other !== ws) {
                        other.seekTo(newTime / (other.getDuration() || 1));
                    }
                });
                setCurrentTime(newTime);
            });

            ws.on('finish', () => {
                // If all finished? simpler to just track one or master state
                setIsPlaying(false);
            });

            newSurfers.push(ws);
        });

        setWavesurfers(newSurfers);

        return () => {
            newSurfers.forEach(ws => {
                try { ws.destroy(); } catch (e) { /* ignore */ }
            });
            if (containerRef.current) containerRef.current.innerHTML = '';
        };

    }, [stems]);

    // Handle Markers (Separate Effect)
    useEffect(() => {
        // console.log('[Waveform] Marker Effect Triggered', { 
        //     wavesurfersCount: wavesurfers.length, 
        //     pluginsCount: regionsPluginsRef.current.length,
        //     markersKeys: Object.keys(markers) 
        // });

        if (wavesurfers.length === 0 || regionsPluginsRef.current.length === 0) return;

        wavesurfers.forEach((_ws, index) => {
            const stem = stems[index];
            const wsRegions = regionsPluginsRef.current[index];

            if (!stem || !wsRegions) {
                console.warn('[Waveform] Missing stem or region plugin for index', index);
                return;
            }

            // Clear existing regions
            try {
                wsRegions.clearRegions();
            } catch (e) {
                console.error('[Waveform] Failed to clear regions', e);
            }

            // Re-add regions
            // Try explicit match first, then lowercase match
            let stemMarkers = markers[stem.type];
            if (!stemMarkers) {
                const lowerType = stem.type.toLowerCase();
                const markerKey = Object.keys(markers).find(k => k.toLowerCase() === lowerType);
                if (markerKey) stemMarkers = markers[markerKey];
            }

            if (stemMarkers && stemMarkers.length > 0) {
                console.log(`[Waveform] Adding ${stemMarkers.length} markers for ${stem.type} (Plugin: ${!!wsRegions})`);
                if (stemMarkers.length > 0) {
                    console.log(`[Waveform] First marker for ${stem.type}: ${stemMarkers[0]}s`);
                }

                // Update the label count dynamically
                if (containerRef.current && containerRef.current.children[index]) {
                    const wrapper = containerRef.current.children[index];
                    const label = wrapper.querySelector('.stem-label');
                    if (label) {
                        label.innerHTML = `<strong>${stem.type}</strong> <span style="opacity:0.7; font-size:9px">(${stemMarkers.length} markers)</span>`;
                    }
                }

                try {
                    stemMarkers.forEach(time => {
                        if (typeof time === 'number' && !isNaN(time)) {
                            wsRegions.addRegion({
                                start: time,
                                end: time + 0.05,
                                color: 'rgba(255, 255, 255, 0.5)',
                                drag: false,
                                resize: false,
                            });
                        }
                    });
                } catch (e) {
                    console.error('[Waveform] Error adding regions:', e);
                }
            } else {
                // console.log(`[Waveform] No markers found for stem: ${stem.type}. Available keys:`, Object.keys(markers));
            }
        });
    }, [wavesurfers, markers, stems]);

    // Master Play/Pause
    const togglePlay = () => {
        if (wavesurfers.length === 0) return;

        if (isPlaying) {
            wavesurfers.forEach(ws => ws.pause());
            setIsPlaying(false);
        } else {
            wavesurfers.forEach(ws => ws.play());
            setIsPlaying(true);
        }
    };

    const getStemColor = (type: string, isProgress = false) => {
        const colors: Record<string, string> = {
            'Drums': '#ef4444',  // Red
            'Bass': '#3b82f6',   // Blue
            'Vocals': '#10b981', // Green (Emerald)
            'Other': '#f59e0b',  // Yellow (Amber)
        };
        const base = colors[type] || '#8b5cf6'; // Purple default
        return isProgress ? lighten(base) : base;
    };

    // Simple lighten helper
    const lighten = (col: string) => col; // Placeholder, maybe redundant if we just use opacity or same color

    return (
        <div className="bg-gray-900/50 p-4 rounded border border-gray-700">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-white">Multi-Track Preview</h3>
                <div className="flex gap-2 text-xs text-gray-400">
                    <span>{stems.length} tracks</span>
                    <span>{currentTime.toFixed(1)}s / {duration.toFixed(1)}s</span>
                </div>
            </div>

            <div ref={containerRef} className="mb-4 bg-gray-900 rounded overflow-hidden" />

            <div className="flex justify-center">
                <button
                    onClick={togglePlay}
                    className="btn bg-white text-black px-6 py-2 rounded-full font-bold hover:bg-gray-200 transition-colors shadow-lg flex items-center gap-2"
                >
                    {isPlaying ? (
                        <>
                            <span>⏸</span> Pause
                        </>
                    ) : (
                        <>
                            <span>▶</span> Play All
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};

export default MultiTrackWaveform;
