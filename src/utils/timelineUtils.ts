/**
 * src/utils/timelineUtils.ts
 *
 * WHAT:
 *   Comprehensive math, color, time formatting, and timeline row layout utilities
 *   for the Music Video Assembler and DaVinci Resolve bridge pipelines.
 *
 * WHY:
 *   Centralizing timeline calculations guarantees that video clip slicing, audio waveform
 *   mounting, Minimax frame boundary quantization, and UI track themes remain uniform
 *   across all views and export scripts.
 */

import type { VideoClip, TimelineRow } from '../types/assembler';

// WHAT: Dynamically synthesizes a zero-amplitude PCM WAV audio binary container in memory.
// WHY: WaveSurfer.js requires an audio source to mount its canvas and enable timeline
// scrubbing. In projects created without an initial soundtrack ("Blank Projects"),
// generating a silent audio buffer enables full playback, scrubbing, and marker placement.
export const createSilentAudioBlob = (duration_in_seconds: number): Blob => {
    const audio_sample_rate = 44100;
    const channel_count = 1;
    const total_sample_count = duration_in_seconds * audio_sample_rate;
    const block_align_bytes = channel_count * 2;
    const byte_rate_per_second = audio_sample_rate * block_align_bytes;
    const raw_audio_data_size_bytes = total_sample_count * block_align_bytes;
    const wav_file_array_buffer = new ArrayBuffer(44 + raw_audio_data_size_bytes);
    const wav_data_view = new DataView(wav_file_array_buffer);

    // WHAT: Writes an ASCII string sequentially into the binary DataView.
    // WHY: WAV containers require 4-byte ASCII header tags ('RIFF', 'WAVE', 'fmt ', 'data').
    const write_ascii_string_to_dataview = (
        target_dataview: DataView,
        byte_offset_position: number,
        ascii_text_characters: string
    ) => {
        for (let character_index = 0; character_index < ascii_text_characters.length; character_index++) {
            target_dataview.setUint8(
                byte_offset_position + character_index,
                ascii_text_characters.charCodeAt(character_index)
            );
        }
    };

    // RIFF header chunk descriptor
    write_ascii_string_to_dataview(wav_data_view, 0, 'RIFF');
    wav_data_view.setUint32(4, 36 + raw_audio_data_size_bytes, true);
    write_ascii_string_to_dataview(wav_data_view, 8, 'WAVE');

    // fmt sub-chunk
    write_ascii_string_to_dataview(wav_data_view, 12, 'fmt ');
    wav_data_view.setUint32(16, 16, true); // Subchunk1Size for uncompressed PCM
    wav_data_view.setUint16(20, 1, true);  // AudioFormat: 1 = Linear PCM
    wav_data_view.setUint16(22, channel_count, true);
    wav_data_view.setUint32(24, audio_sample_rate, true);
    wav_data_view.setUint32(28, byte_rate_per_second, true);
    wav_data_view.setUint16(32, block_align_bytes, true);
    wav_data_view.setUint16(34, 16, true); // BitsPerSample: 16-bit

    // data sub-chunk
    write_ascii_string_to_dataview(wav_data_view, 36, 'data');
    wav_data_view.setUint32(40, raw_audio_data_size_bytes, true);

    return new Blob([wav_file_array_buffer], { type: 'audio/wav' });
};

// WHAT: Standardized visual color codes for different categories of rhythmic timeline markers.
// WHY: Distinct colors enable users to instantly distinguish rhythmic downbeats from transients and loudness shifts.
export const MARKER_COLORS: Record<string, string> = {
    downbeat: 'rgba(6, 182, 212, 0.9)', // Cyan - Musical measure downbeats
    offbeat: 'rgba(255, 255, 255, 0.5)', // Dim White - Subdivided rhythmic pulses
    onset: 'rgba(245, 158, 11, 0.8)',    // Orange - Acoustic attack transients
    loudness: 'rgba(139, 92, 246, 0.8)', // Purple - Perceptual loudness threshold shifts
    default: 'rgba(156, 163, 175, 0.8)'   // Gray - Generic or unclassified markers
};

// WHAT: Hex colors assigned to common source separation stem categories.
// WHY: Consistent track coloring helps the user visually identify stems across the multi-track viewer.
export const STEM_COLORS: Record<string, string> = {
    'drums': '#ef4444', // Red - Percussion
    'bass': '#f59e0b',  // Amber - Low end
    'other': '#10b981', // Emerald - Secondary instrumentation
    'vocals': '#3b82f6',// Blue - Lead voice
    'piano': '#8b5cf6', // Violet - Keys
    'guitar': '#ec4899',// Pink - Plucked strings
};

export const DEFAULT_STEM_COLOR = '#6b7280'; // Neutral Gray fallback

// WHAT: Maps stem categories to Tailwind color tokens for badges and UI indicators.
// WHY: Provides harmonious highlight styles in track labels.
export const THEME_STEM_MAPPING: Record<string, { base: string, light: string }> = {
    'beat': { base: 'Blue', light: 'Sky' },
    'bass': { base: 'Blue', light: 'Sky' },
    'drums': { base: 'Red', light: 'Pink' },
    'vocals': { base: 'Green', light: 'Emerald' },
    'other': { base: 'Yellow', light: 'Amber' }
};

// WHAT: Retrieves the theme color configuration for a given stem category string.
// WHY: Guarantees a safe fallback to 'other' if the stem label is unrecognized.
export const getStemTheme = (stem_category_identifier: string): { base: string, light: string } => {
    return THEME_STEM_MAPPING[stem_category_identifier.toLowerCase()] || THEME_STEM_MAPPING['other'];
};

// WHAT: Converts a 6-character hex color string and an alpha float into a CSS rgba() string.
// WHY: Enables dynamic opacity adjustment on solid theme colors for semi-transparent waveform overlays.
export const hexToRgba = (hex_color_code: string, opacity_alpha_channel: number): string => {
    const red_channel_intensity = parseInt(hex_color_code.slice(1, 3), 16);
    const green_channel_intensity = parseInt(hex_color_code.slice(3, 5), 16);
    const blue_channel_intensity = parseInt(hex_color_code.slice(5, 7), 16);
    return `rgba(${red_channel_intensity}, ${green_channel_intensity}, ${blue_channel_intensity}, ${opacity_alpha_channel})`;
};

// WHAT: Adjusts the brightness of a hex color by a given positive or negative percentage.
// WHY: Used for generating hover states and wave progress colors from a single base theme color.
export const adjustColorBrightness = (hex_color_code: string, brightness_adjustment_percentage: number): string => {
    const parsed_hex_integer = parseInt(hex_color_code.replace("#", ""), 16);
    const adjustment_amount = Math.round(2.55 * brightness_adjustment_percentage);

    const adjusted_red_channel = (parsed_hex_integer >> 16) + adjustment_amount;
    const adjusted_blue_channel = ((parsed_hex_integer >> 8) & 0x00FF) + adjustment_amount;
    const adjusted_green_channel = (parsed_hex_integer & 0x0000FF) + adjustment_amount;

    const clamped_red_channel = adjusted_red_channel < 255 ? (adjusted_red_channel < 1 ? 0 : adjusted_red_channel) : 255;
    const clamped_blue_channel = adjusted_blue_channel < 255 ? (adjusted_blue_channel < 1 ? 0 : adjusted_blue_channel) : 255;
    const clamped_green_channel = adjusted_green_channel < 255 ? (adjusted_green_channel < 1 ? 0 : adjusted_green_channel) : 255;

    return "#" + (
        0x1000000 +
        clamped_red_channel * 0x10000 +
        clamped_blue_channel * 0x100 +
        clamped_green_channel
    ).toString(16).slice(1);
};

// WHAT: Formats a raw floating-point second timestamp into a standard human-readable "mm:ss.ms" string.
// WHY: Audio editors and video timelines require minute/second notation rather than raw cumulative seconds.
export const formatTime = (time_in_seconds: number): string => {
    const whole_minutes_elapsed = Math.floor(time_in_seconds / 60);
    const remaining_seconds_elapsed = time_in_seconds % 60;
    return `${whole_minutes_elapsed}:${remaining_seconds_elapsed.toFixed(2).padStart(5, '0')}`;
};

// WHAT: Normalizes an absolute filesystem path into an Electron-safe media:// protocol URL.
// WHY: Standard browser fetch/img elements block local file:// paths due to sandboxing.
// The custom media:// protocol serves local disk assets securely through Electron's protocol handler.
export const pathToMediaUrl = (absolute_file_system_path: string): string => {
    if (!absolute_file_system_path) return '';
    return `media://${absolute_file_system_path.replace(/\\/g, '/')}`;
};

// WHAT: Constructs a contiguous sequence of timeline rows, automatically inserting 'unselected' gap blocks.
// WHY: Video timelines require contiguous blocks from 0 to trackDuration so empty intervals
// can be clicked, selected, or generated without layout discontinuities.
export const buildTimelineRows = (
    video_clips_collection: VideoClip[],
    total_audio_track_duration_seconds: number
): TimelineRow[] => {
    if (total_audio_track_duration_seconds <= 0) return [];

    const sorted_clips_collection = [...video_clips_collection].sort(
        (first_clip, second_clip) => first_clip.startTime - second_clip.startTime
    );
    const constructed_timeline_rows_collection: TimelineRow[] = [];
    let current_timeline_cursor_position_seconds = 0;

    sorted_clips_collection.forEach((current_video_clip) => {
        // WHAT: Detect gap between current cursor position and the start of this clip.
        // WHY: Empty intervals must be represented as 'unselected' blocks so the user can claim them.
        if (current_video_clip.startTime > current_timeline_cursor_position_seconds + 0.001) {
            constructed_timeline_rows_collection.push({
                type: 'unselected',
                startTime: current_timeline_cursor_position_seconds,
                endTime: current_video_clip.startTime,
                duration: current_video_clip.startTime - current_timeline_cursor_position_seconds,
                label: 'Unselected',
            });
        }

        // WHAT: Insert the active user video clip block.
        // WHY: Displays assigned images, duration, and status in the row sequence.
        constructed_timeline_rows_collection.push({
            type: 'clip',
            startTime: current_video_clip.startTime,
            endTime: current_video_clip.endTime,
            duration: current_video_clip.endTime - current_video_clip.startTime,
            clip: current_video_clip,
            label: current_video_clip.label,
        });

        current_timeline_cursor_position_seconds = current_video_clip.endTime;
    });

    // WHAT: Check for trailing gap between the last clip and total track duration.
    // WHY: Ensures the timeline extends cleanly to the end of the song.
    if (current_timeline_cursor_position_seconds < total_audio_track_duration_seconds - 0.001) {
        constructed_timeline_rows_collection.push({
            type: 'unselected',
            startTime: current_timeline_cursor_position_seconds,
            endTime: total_audio_track_duration_seconds,
            duration: total_audio_track_duration_seconds - current_timeline_cursor_position_seconds,
            label: 'Unselected',
        });
    }

    // WHAT: If no clips exist, populate one giant unselected row covering the entire audio duration.
    // WHY: Allows the user to select the first segment anywhere in the song.
    if (constructed_timeline_rows_collection.length === 0) {
        constructed_timeline_rows_collection.push({
            type: 'unselected',
            startTime: 0,
            endTime: total_audio_track_duration_seconds,
            duration: total_audio_track_duration_seconds,
            label: 'Unselected',
        });
    }

    return constructed_timeline_rows_collection;
};

// WHAT: Quantizes a continuous audio selection duration to the nearest valid MiniMax H3 video frame count (17n + 5).
// WHY: The MiniMax video generation model strictly enforces frame counts adhering to the formula:
// total_frames = 17 * n + 5 (e.g. 5, 22, 39, 56, 73, etc.). Passing non-compliant frame counts causes API errors.
export const getValidMinimaxFrameCount = (
    selection_duration_seconds: number,
    video_frames_per_second: number
): number => {
    const raw_calculated_frame_count = Math.max(5, Math.round(selection_duration_seconds * video_frames_per_second));
    const modulo_remainder_frames = raw_calculated_frame_count % 17;
    const additional_padding_frames = ((5 - modulo_remainder_frames) % 17 + 17) % 17;
    return raw_calculated_frame_count + additional_padding_frames;
};

// WHAT: Calculates the audio selection duration rounded UP to the nearest valid MiniMax frame boundary.
// WHY: Guarantees that video generated for this clip will be long enough to cover the audio beat interval.
export const getAlignedDuration = (
    raw_selection_duration_seconds: number,
    video_frames_per_second: number
): number => {
    const quantized_minimax_frame_count = getValidMinimaxFrameCount(raw_selection_duration_seconds, video_frames_per_second);
    return quantized_minimax_frame_count / video_frames_per_second;
};
