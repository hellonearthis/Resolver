import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';

interface BeatVisualizerProps {
    audioUrl: string | null;
    beats: number[];
    markerColor?: string;
}

const BeatVisualizer: React.FC<BeatVisualizerProps> = ({ audioUrl, beats, markerColor = '#ef4444' }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const wavesurfer = useRef<WaveSurfer | null>(null);
    const rafRef = useRef<number | undefined>(undefined);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isReady, setIsReady] = useState(false);
    const [showMarkers, setShowMarkers] = useState(true);
    const [zoom, setZoom] = useState(1); // 1 = fit all, >1 = zoomed in
    const [containerWidth, setContainerWidth] = useState(0);

    useEffect(() => {
        if (!containerRef.current || !audioUrl) return;

        setIsReady(false);
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
        setZoom(1);

        // Get container width for calculating zoom
        const width = wrapperRef.current?.clientWidth || 800;
        setContainerWidth(width);

        wavesurfer.current = WaveSurfer.create({
            container: containerRef.current,
            waveColor: '#8b5cf6',
            progressColor: '#6366f1',
            cursorColor: '#fff',
            height: 80,
            barWidth: 2,
            barGap: 1,
            barRadius: 2,
            minPxPerSec: 1, // Start minimal, will zoom after ready
        });

        wavesurfer.current.load(audioUrl);

        wavesurfer.current.on('ready', () => {
            const dur = wavesurfer.current?.getDuration() || 0;
            setDuration(dur);
            setIsReady(true);
            // Fit to container by default
            if (wavesurfer.current && width && dur) {
                wavesurfer.current.zoom(width / dur);
            }
        });

        wavesurfer.current.on('audioprocess', () => {
            if (!rafRef.current) {
                rafRef.current = requestAnimationFrame(() => {
                    setCurrentTime(wavesurfer.current?.getCurrentTime() || 0);
                    rafRef.current = undefined;
                });
            }
        });

        wavesurfer.current.on('play', () => setIsPlaying(true));
        wavesurfer.current.on('pause', () => setIsPlaying(false));
        wavesurfer.current.on('finish', () => setIsPlaying(false));

        const ws = wavesurfer.current;

        return () => {
            try {
                if (rafRef.current) {
                    cancelAnimationFrame(rafRef.current);
                    rafRef.current = undefined;
                }
                ws?.destroy();
            } catch (e) {
                console.warn('WaveSurfer destroy error:', e);
            }
        };
    }, [audioUrl]);

    // Handle zoom changes
    useEffect(() => {
        if (wavesurfer.current && isReady && containerWidth && duration) {
            const pxPerSec = (containerWidth / duration) * zoom;
            wavesurfer.current.zoom(pxPerSec);
        }
    }, [zoom, isReady, containerWidth, duration]);

    // Auto-scroll to follow playhead when zoomed in
    useEffect(() => {
        if (!isPlaying || zoom <= 1 || !wrapperRef.current || !duration) return;

        const wrapper = wrapperRef.current;
        const waveformWidth = wrapper.scrollWidth;
        const viewportWidth = wrapper.clientWidth;
        const playheadPosition = (currentTime / duration) * waveformWidth;

        // Keep playhead in the center-left of viewport
        const targetScroll = playheadPosition - (viewportWidth * 0.3);
        wrapper.scrollLeft = Math.max(0, Math.min(targetScroll, waveformWidth - viewportWidth));
    }, [currentTime, isPlaying, zoom, duration]);

    const togglePlay = () => {
        if (wavesurfer.current) {
            wavesurfer.current.playPause();
        }
    };

    const handleZoomIn = () => {
        setZoom(prev => Math.min(prev * 1.5, 50));
    };

    const handleZoomOut = () => {
        setZoom(prev => Math.max(prev / 1.5, 1));
    };

    const handleZoomReset = () => {
        setZoom(1);
    };

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    if (!audioUrl) {
        return (
            <div style={{
                padding: '40px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px'
            }}>
                Drop an audio file to see the waveform
            </div>
        );
    }

    return (
        <div>
            {/* Waveform with Beat Markers */}
            <div
                ref={wrapperRef}
                style={{
                    position: 'relative',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '8px',
                    padding: '16px',
                    marginBottom: '16px',
                    overflowX: zoom > 1 ? 'auto' : 'hidden',
                    overflowY: 'hidden'
                }}
            >
                <div style={{ position: 'relative', width: zoom > 1 ? `${zoom * 100}%` : '100%' }}>
                    <div
                        ref={containerRef}
                        style={{ width: '100%' }}
                    />

                    {/* Beat Markers Overlay - scales with waveform */}
                    {showMarkers && isReady && duration > 0 && (
                        <div style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            pointerEvents: 'none'
                        }}>
                            {beats.map((beat, index) => {
                                const position = (beat / duration) * 100;
                                if (position > 100) return null;
                                return (
                                    <div
                                        key={index}
                                        style={{
                                            position: 'absolute',
                                            left: `${position}%`,
                                            top: 0,
                                            bottom: 0,
                                            width: '2px',
                                            background: markerColor,
                                            opacity: 0.8,
                                            boxShadow: `0 0 4px ${markerColor}`
                                        }}
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Controls */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 16px',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                flexWrap: 'wrap'
            }}>
                {/* Play/Pause */}
                <button
                    className="btn btn-primary"
                    onClick={togglePlay}
                    disabled={!isReady}
                    style={{
                        width: '48px',
                        height: '48px',
                        padding: 0,
                        fontSize: '1.5rem',
                        borderRadius: '50%'
                    }}
                >
                    {isPlaying ? '⏸' : '▶'}
                </button>

                {/* Time Display */}
                <div style={{ minWidth: '100px' }}>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        color: 'var(--text-secondary)',
                        fontSize: '0.9rem'
                    }}>
                        <span>{formatTime(currentTime)}</span>
                        <span>{formatTime(duration)}</span>
                    </div>
                </div>

                {/* Zoom Controls */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    marginLeft: '8px'
                }}>
                    <button
                        className="btn btn-secondary"
                        onClick={handleZoomOut}
                        disabled={!isReady || zoom <= 1}
                        style={{ padding: '6px 10px', fontSize: '1rem' }}
                        title="Zoom out (fit all)"
                    >
                        ➖
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={handleZoomReset}
                        disabled={!isReady || zoom === 1}
                        style={{ padding: '6px 10px', fontSize: '0.8rem', minWidth: '60px' }}
                        title="Fit all"
                    >
                        {zoom === 1 ? 'Fit All' : `${Math.round(zoom * 100)}%`}
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={handleZoomIn}
                        disabled={!isReady || zoom >= 50}
                        style={{ padding: '6px 10px', fontSize: '1rem' }}
                        title="Zoom in"
                    >
                        ➕
                    </button>
                </div>

                {/* Toggle Markers Button */}
                <button
                    className={`btn ${showMarkers ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setShowMarkers(!showMarkers)}
                    style={{ padding: '8px 12px', fontSize: '0.85rem' }}
                    title="Toggle beat markers"
                >
                    {showMarkers ? '🔴 Markers' : '⚫ Markers'}
                </button>

                {beats.length > 0 && (
                    <div className="beat-count" style={{ marginLeft: 'auto' }}>
                        <span className="beat-count-number">{beats.length}</span>
                        <span className="beat-count-label">beats</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default BeatVisualizer;




