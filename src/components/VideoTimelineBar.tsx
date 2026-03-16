import React, { useRef, useState, useCallback, useEffect } from 'react';
import type { SelectionState, VideoInfo, VideoThumbnail, VideoClip } from '../types/assembler';
import { formatTime } from '../utils/timelineUtils';
import './VideoTimelineBar.css';

interface VideoTimelineBarProps {
    videoPath: string;
    videoInfo: VideoInfo;
    thumbnails: VideoThumbnail[];
    clips: VideoClip[];
    onSelectionChange: (sel: SelectionState | null) => void;
    onSaveFrame: (time: number) => void;
}

const VideoTimelineBar: React.FC<VideoTimelineBarProps> = ({
    videoPath,
    videoInfo,
    thumbnails,
    clips,
    onSelectionChange,
    onSaveFrame,
}) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const filmstripRef = useRef<HTMLDivElement>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [dragState, setDragState] = useState<{ start: number; end: number } | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [zoom, setZoom] = useState(50); // px per second
    const [volume, setVolume] = useState(0.5);
    const [isMuted, setIsMuted] = useState(false);

    const duration = videoInfo.duration;
    const totalWidth = duration * zoom;

    // Convert file path to media:// protocol URL for Electron
    const videoSrc = `media://${videoPath.replace(/\\/g, '/')}`;

    // Auto-fit zoom on initial load
    useEffect(() => {
        if (filmstripRef.current && duration > 0) {
            const containerWidth = filmstripRef.current.parentElement?.clientWidth || 800;
            const fitZoom = (containerWidth - 32) / duration; // 32 is padding
            setZoom(Math.max(1, fitZoom));
        }
    }, [duration]);

    // Sync volume with video element
    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.volume = volume;
            videoRef.current.muted = isMuted;
        }
    }, [volume, isMuted]);

    // Video event handlers
    const handleTimeUpdate = useCallback(() => {
        if (videoRef.current) {
            const time = videoRef.current.currentTime;
            setCurrentTime(time);

            // Auto-scroll to follow playhead if playing or seeking
            if (filmstripRef.current?.parentElement?.parentElement) {
                const scrollContainer = filmstripRef.current.parentElement.parentElement;
                const playheadX = (time / duration) * totalWidth;
                const scrollLeft = scrollContainer.scrollLeft;
                const containerWidth = scrollContainer.clientWidth;

                // Only auto-scroll if playing (to track) OR if seeking and playhead is off-screen
                if (isPlaying || playheadX > scrollLeft + containerWidth || playheadX < scrollLeft) {
                    if (playheadX > scrollLeft + containerWidth - 50 || playheadX < scrollLeft + 50) {
                        scrollContainer.scrollLeft = playheadX - containerWidth / 2;
                    }
                }
            }
        }
    }, [duration, isPlaying, totalWidth]);

    const handlePlay = () => {
        if (videoRef.current) {
            videoRef.current.play();
            setIsPlaying(true);
        }
    };

    const handlePause = () => {
        if (videoRef.current) {
            videoRef.current.pause();
            setIsPlaying(false);
        }
    };

    const handleSeek = (time: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime = time;
            setCurrentTime(time);
        }
    };

    // Playback rate control
    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.playbackRate = playbackRate;
        }
    }, [playbackRate]);

    // Get position in filmstrip from a mouse event
    const getTimeFromMouseEvent = useCallback((e: React.MouseEvent | MouseEvent) => {
        if (!filmstripRef.current) return 0;
        const rect = filmstripRef.current.getBoundingClientRect();
        const scrollLeft = filmstripRef.current.parentElement?.scrollLeft || 0;
        const x = e.clientX - rect.left + scrollLeft;
        const clampedX = Math.max(0, Math.min(x, totalWidth));
        return (clampedX / totalWidth) * duration;
    }, [duration, totalWidth]);

    // Drag-to-select on filmstrip
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0) return; // Left click only
        const time = getTimeFromMouseEvent(e);
        setIsDragging(true);
        setDragState({ start: time, end: time });
        onSelectionChange(null); // Clear previous selection while dragging
    }, [getTimeFromMouseEvent, onSelectionChange]);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isDragging) return;
        const time = getTimeFromMouseEvent(e);
        setDragState(prev => prev ? { ...prev, end: time } : null);

        // Auto-scroll when dragging near edges
        if (filmstripRef.current?.parentElement) {
            const container = filmstripRef.current.parentElement;
            const rect = container.getBoundingClientRect();
            if (e.clientX > rect.right - 50) container.scrollLeft += 10;
            if (e.clientX < rect.left + 50) container.scrollLeft -= 10;
        }
    }, [isDragging, getTimeFromMouseEvent]);

    const handleMouseUp = useCallback((e: MouseEvent) => {
        if (!isDragging || !dragState) return;
        setIsDragging(false);
        const time = getTimeFromMouseEvent(e);
        const start = Math.min(dragState.start, time);
        const end = Math.max(dragState.start, time);

        if (end - start > 0.05) {
            // Valid selection
            setDragState({ start, end });
            onSelectionChange({ source: 'video', start, end });
        } else {
            // Click — seek instead
            handleSeek(time);
            setDragState(null);
            onSelectionChange(null);
        }
    }, [isDragging, dragState, getTimeFromMouseEvent, onSelectionChange]);

    // Attach global mouse listeners for drag
    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            return () => {
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isDragging, handleMouseMove, handleMouseUp]);

    // Generate time ruler ticks
    const generateTicks = useCallback(() => {
        if (duration <= 0) return [];
        // Determine tick interval based on zoom level (aim for ~100px per label)
        const pixelsPerTickGoal = 100;
        const timePerTick = pixelsPerTickGoal / zoom;
        
        let interval: number;
        if (timePerTick <= 0.1) interval = 0.1;
        else if (timePerTick <= 0.5) interval = 0.5;
        else if (timePerTick <= 1) interval = 1;
        else if (timePerTick <= 2) interval = 2;
        else if (timePerTick <= 5) interval = 5;
        else if (timePerTick <= 10) interval = 10;
        else if (timePerTick <= 30) interval = 30;
        else interval = 60;

        const ticks: { time: number; label: string }[] = [];
        for (let t = 0; t <= duration; t += interval) {
            ticks.push({ time: t, label: formatTime(t) });
        }
        return ticks;
    }, [duration, zoom]);

    // Compute playhead position
    const playheadPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

    // Filter clips for video source
    const videoClips = clips.filter(c => c.source === 'video');

    return (
        <div className="video-timeline-bar">
            {/* Video Preview + Controls */}
            <div className="vtb-preview-row">
                <div className="vtb-video-preview">
                    <video
                        ref={videoRef}
                        src={videoSrc}
                        onTimeUpdate={handleTimeUpdate}
                        onEnded={() => setIsPlaying(false)}
                        preload="metadata"
                        className="vtb-video-element"
                    />
                </div>

                <div className="vtb-controls">
                    <div className="vtb-controls-top">
                        <div className="vtb-play-controls">
                            {!isPlaying ? (
                                <button className="vtb-btn vtb-btn-play" onClick={handlePlay} title="Play">▶</button>
                            ) : (
                                <button className="vtb-btn vtb-btn-pause" onClick={handlePause} title="Pause">⏸</button>
                            )}
                        </div>

                        <div className="vtb-time-display">
                            <span className="vtb-time-current">{formatTime(currentTime)}</span>
                            <span className="vtb-time-separator">/</span>
                            <span className="vtb-time-total">{formatTime(duration)}</span>
                        </div>

                        <div className="vtb-speed-control">
                            <label className="vtb-speed-label">Speed</label>
                            <select
                                value={playbackRate}
                                onChange={e => setPlaybackRate(Number(e.target.value))}
                                className="vtb-speed-select"
                            >
                                <option value={0.25}>0.25×</option>
                                <option value={0.5}>0.5×</option>
                                <option value={1}>1×</option>
                                <option value={1.5}>1.5×</option>
                                <option value={2}>2×</option>
                            </select>
                        </div>

                        <div className="vtb-audio-control">
                            <button 
                                className={`vtb-btn vtb-btn-mute ${isMuted ? 'muted' : ''}`}
                                onClick={() => setIsMuted(!isMuted)}
                                title={isMuted ? "Unmute" : "Mute"}
                            >
                                {isMuted || volume === 0 ? '🔇' : '🔊'}
                            </button>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={volume}
                                onChange={e => setVolume(Number(e.target.value))}
                                className="vtb-volume-slider"
                            />
                        </div>

                        <div className="vtb-zoom-control">
                            <label className="vtb-zoom-label">Zoom</label>
                            <input
                                type="range"
                                min="5"
                                max="500"
                                value={zoom}
                                onChange={e => setZoom(Number(e.target.value))}
                                className="vtb-zoom-slider"
                            />
                        </div>

                        <button
                            className="vtb-btn vtb-btn-frame"
                            onClick={() => onSaveFrame(currentTime)}
                            title="Save current frame at full resolution"
                        >
                            📷 Save
                        </button>
                    </div>

                    <div className="vtb-info-row">
                        <span className="vtb-info-badge">{videoInfo.width}×{videoInfo.height}</span>
                        <span className="vtb-info-badge">{videoInfo.fps} fps</span>
                        <span className="vtb-info-badge">{videoInfo.codec}</span>
                        <span className="vtb-info-badge">{videoInfo.bitrate} kb/s</span>
                        <span className="vtb-info-badge">{videoInfo.totalFrames} frames</span>
                    </div>
                </div>
            </div>

            {/* Scrollable Timeline Area */}
            <div className="vtb-timeline-scroll">
                <div 
                    className="vtb-timeline-content" 
                    style={{ width: `${totalWidth}px` }}
                >
                    {/* Time Ruler */}
                    <div className="vtb-ruler">
                        {generateTicks().map((tick, i) => (
                            <div
                                key={i}
                                className="vtb-ruler-tick"
                                style={{ left: `${(tick.time / duration) * 100}%` }}
                            >
                                <div className="vtb-ruler-line" />
                                <span className="vtb-ruler-label">{tick.label}</span>
                            </div>
                        ))}
                    </div>

                    {/* Thumbnail Filmstrip */}
                    <div
                        ref={filmstripRef}
                        className="vtb-filmstrip"
                        onMouseDown={handleMouseDown}
                    >
                        {/* Thumbnail images */}
                        <div className="vtb-filmstrip-images">
                            {thumbnails.map((thumb, i) => (
                                <img
                                    key={i}
                                    src={`media://${thumb.path.replace(/\\/g, '/')}`}
                                    alt={`Frame at ${formatTime(thumb.time)}`}
                                    className="vtb-filmstrip-thumb"
                                    draggable={false}
                                />
                            ))}
                        </div>

                        {/* Saved clip regions */}
                        {videoClips.map(clip => (
                            <div
                                key={clip.id}
                                className="vtb-clip-region"
                                style={{
                                    left: `${(clip.startTime / duration) * 100}%`,
                                    width: `${((clip.endTime - clip.startTime) / duration) * 100}%`,
                                }}
                                title={`${clip.label || 'Clip'}: ${formatTime(clip.startTime)} → ${formatTime(clip.endTime)}`}
                            />
                        ))}

                        {/* Drag selection overlay */}
                        {dragState && (
                            <div 
                                className="vtb-selection-overlay" 
                                style={{
                                    left: `${(Math.min(dragState.start, dragState.end) / duration) * 100}%`,
                                    width: `${(Math.abs(dragState.end - dragState.start) / duration) * 100}%`,
                                }}
                            >
                                <span className="vtb-selection-label">
                                    {formatTime(Math.min(dragState.start, dragState.end))} → {formatTime(Math.max(dragState.start, dragState.end))}
                                </span>
                            </div>
                        )}

                        {/* Playhead */}
                        <div
                            className="vtb-playhead"
                            style={{ left: `${playheadPercent}%` }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default VideoTimelineBar;
