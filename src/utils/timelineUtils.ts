import type { VideoClip, TimelineRow } from '../types/assembler';

/**
 * Dynamically generates a silent WAV audio blob of the specified duration.
 * This ensures WaveSurfer instances can mount and allow timeline interactions
 * even in "Blank" projects that lack a source audio file.
 */
export const createSilentAudioBlob = (durationSec: number): Blob => {
    const sampleRate = 44100;
    const numChannels = 1;
    const numSamples = durationSec * sampleRate;
    const blockAlign = numChannels * 2;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (v: DataView, offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
            v.setUint8(offset + i, str.charCodeAt(i));
        }
    };

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    return new Blob([buffer], { type: 'audio/wav' });
};

/** 
 * Standardized colors for different types of audio markers on the timeline. 
 */
export const MARKER_COLORS = {
    downbeat: 'rgba(6, 182, 212, 0.9)', // Cyan
    offbeat: 'rgba(255, 255, 255, 0.5)', // Dim White
    onset: 'rgba(245, 158, 11, 0.8)',    // Orange
    loudness: 'rgba(139, 92, 246, 0.8)', // Purple
    default: 'rgba(156, 163, 175, 0.8)'   // Gray
};

/** 
 * Default visual colors corresponding to common source separation stem types. 
 */
export const STEM_COLORS: Record<string, string> = {
    'drums': '#ef4444', // Red
    'bass': '#f59e0b', // Amber/Yellow
    'other': '#10b981', // Emerald/Green
    'vocals': '#3b82f6', // Blue
    'piano': '#8b5cf6', // Violet
    'guitar': '#ec4899', // Pink
};

export const DEFAULT_STEM_COLOR = '#6b7280'; // Gray

/** 
 * Maps stem types to semantic Tailwind color names used by UI components (e.g., badges). 
 */
export const THEME_STEM_MAPPING: Record<string, { base: string, light: string }> = {
    'beat': { base: 'Blue', light: 'Sky' },      // Default / Bass-like
    'bass': { base: 'Blue', light: 'Sky' },
    'drums': { base: 'Red', light: 'Pink' },
    'vocals': { base: 'Green', light: 'Emerald' },
    'other': { base: 'Yellow', light: 'Amber' }
};

/**
 * Gets the configured theme colors for a given stem type, falling back to 'other' if unknown.
 * @param type The string stem identifier (e.g. 'vocals', 'drums')
 */
export const getStemTheme = (type: string) => {
    return THEME_STEM_MAPPING[type.toLowerCase()] || THEME_STEM_MAPPING['other'];
};


/**
 * Converts a hex color string and an alpha value into an rgba string.
 * @param hex The hex color code (e.g., '#ff0000')
 * @param alpha The opacity from 0.0 to 1.0
 * @returns An rgba string acceptable by CSS
 */
export const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * Lightens or darkens a hex color by a given percentage.
 * @param hex The base hex color code
 * @param percent Positive for lighter, negative for darker (-100 to 100)
 * @returns The adjusted hex color string
 */
export const adjustColorBrightness = (hex: string, percent: number) => {
    const num = parseInt(hex.replace("#", ""), 16),
        amt = Math.round(2.55 * percent),
        R = (num >> 16) + amt,
        B = ((num >> 8) & 0x00FF) + amt,
        G = (num & 0x0000FF) + amt;
    return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 + (B < 255 ? B < 1 ? 0 : B : 255) * 0x100 + (G < 255 ? G < 1 ? 0 : G : 255)).toString(16).slice(1);
};

/**
 * Formats seconds into a human-readable mm:ss.ms format.
 * @param seconds Time in seconds
 * @returns Formatted time string, e.g., '1:05.50'
 */
export const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toFixed(2).padStart(5, '0')}`;
};

/**
 * Converts an absolute file path to a media:// protocol URL for Electron.
 * This bypasses browser security restrictions for loading local resources.
 */
export const pathToMediaUrl = (filePath: string): string => {
    if (!filePath) return '';
    // Replace backslashes for URL compatibility and prepend protocol
    return `media://${filePath.replace(/\\/g, '/')}`;
};

/**
 * Constructs an array of timeline rows from an array of video clips. 
 * Automatically fills gaps with 'unselected' rows to represent empty track space.
 * @param clips The user's saved video clips
 * @param trackDuration Total length of the audio track
 * @returns Ordered timeline blocks including gaps
 */
export const buildTimelineRows = (clips: VideoClip[], trackDuration: number): TimelineRow[] => {
    if (trackDuration <= 0) return [];

    const sorted = [...clips].sort((a, b) => a.startTime - b.startTime);
    const rows: TimelineRow[] = [];
    let cursor = 0;

    sorted.forEach((clip) => {
        // Gap before this clip
        if (clip.startTime > cursor + 0.001) {
            rows.push({
                type: 'unselected',
                startTime: cursor,
                endTime: clip.startTime,
                duration: clip.startTime - cursor,
                label: 'Unselected',
            });
        }
        // The clip itself
        rows.push({
            type: 'clip',
            startTime: clip.startTime,
            endTime: clip.endTime,
            duration: clip.endTime - clip.startTime,
            clip,
            label: clip.label,
        });
        cursor = clip.endTime;
    });

    // Trailing gap
    if (cursor < trackDuration - 0.001) {
        rows.push({
            type: 'unselected',
            startTime: cursor,
            endTime: trackDuration,
            duration: trackDuration - cursor,
            label: 'Unselected',
        });
    }

    // If no clips at all, one big unselected row
    if (rows.length === 0) {
        rows.push({
            type: 'unselected',
            startTime: 0,
            endTime: trackDuration,
            duration: trackDuration,
            label: 'Unselected',
        });
    }

    return rows;
};

/**
 * Calculates the number of frames for an audio selection and snaps it
 * to the nearest valid Minimax frame count (17n + 5).
 *
 * @param durationSeconds The duration of the selected chunk in seconds
 * @param fps The frame rate (e.g., 24, 25, 30, 60)
 * @returns The nearest valid Minimax frame count that loosely matches the duration
 */
export const getValidMinimaxFrameCount = (durationSeconds: number, fps: number): number => {
    const exactFrames = Math.max(5, Math.round(durationSeconds * fps));
    const rem = exactFrames % 17;
    const add = ((5 - rem) % 17 + 17) % 17;
    return exactFrames + add;
};

/**
 * Returns the duration (in seconds) rounded UP to the nearest valid Minimax frame boundary.
 *
 * @param durationSeconds The raw duration in seconds
 * @param fps The frame rate (e.g. 20, 24, 25)
 * @returns The snapped duration in seconds (always >= the original)
 */
export const getAlignedDuration = (durationSeconds: number, fps: number): number => {
    const frames = getValidMinimaxFrameCount(durationSeconds, fps);
    return frames / fps;
};
