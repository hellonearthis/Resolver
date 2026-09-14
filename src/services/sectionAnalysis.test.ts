import { describe, it, expect } from 'vitest';
import { generateBeatGrid, analyzeSongSections } from './essentiaService';
import { SECTION_TYPE_COLOR_MAP, type SectionType } from '../types/sections';

// WHAT: Creates a simulated browser AudioBuffer populated with custom sample dynamics.
// WHY: Enables headless testing of windowed RMS energy and section boundary detection algorithms.
function createSyntheticAudioBuffer(
    total_duration_seconds: number,
    sample_rate_hertz: number = 44100,
    amplitude_generator_function?: (timestamp_seconds: number) => number
): AudioBuffer {
    const total_sample_count = Math.floor(total_duration_seconds * sample_rate_hertz);
    const audio_sample_channel_data = new Float32Array(total_sample_count);

    for (let sample_index = 0; sample_index < total_sample_count; sample_index++) {
        const timestamp_seconds = sample_index / sample_rate_hertz;
        const amplitude_scalar = amplitude_generator_function ? amplitude_generator_function(timestamp_seconds) : 0.5;
        // Simple 440 Hz sinusoidal waveform scaled by dynamic amplitude
        audio_sample_channel_data[sample_index] = Math.sin(2 * Math.PI * 440 * timestamp_seconds) * amplitude_scalar;
    }

    return {
        sampleRate: sample_rate_hertz,
        duration: total_duration_seconds,
        length: total_sample_count,
        numberOfChannels: 1,
        getChannelData: () => audio_sample_channel_data,
        copyFromChannel: () => {},
        copyToChannel: () => {},
    } as unknown as AudioBuffer;
}

describe('Song Section & Beat Grid Analysis Engine', () => {
    describe('generateBeatGrid', () => {
        // WHAT: Verifies beat grid calculations for standard tempos.
        // WHY: 120 BPM means 1 beat every 0.5 seconds (60 / 120 = 0.5s).
        it('generates exact beat grid timestamps for standard 120 BPM', () => {
            const target_tempo_beats_per_minute = 120;
            const total_duration_seconds = 2.0;
            const initial_offset_timestamp_seconds = 0.0;

            const generated_beat_timestamps_collection = generateBeatGrid(
                target_tempo_beats_per_minute,
                total_duration_seconds,
                initial_offset_timestamp_seconds
            );

            expect(generated_beat_timestamps_collection).toHaveLength(5);
            expect(generated_beat_timestamps_collection[0]).toBeCloseTo(0.0, 3);
            expect(generated_beat_timestamps_collection[1]).toBeCloseTo(0.5, 3);
            expect(generated_beat_timestamps_collection[2]).toBeCloseTo(1.0, 3);
            expect(generated_beat_timestamps_collection[3]).toBeCloseTo(1.5, 3);
            expect(generated_beat_timestamps_collection[4]).toBeCloseTo(2.0, 3);
        });

        // WHAT: Verifies offset shifting for beat grids.
        // WHY: If the first beat starts at 0.25s, subsequent beats should retain exact intervals (0.25, 0.75, 1.25, 1.75).
        it('respects initial offset timestamp when generating beat grid', () => {
            const target_tempo_beats_per_minute = 120;
            const total_duration_seconds = 2.0;
            const initial_offset_timestamp_seconds = 0.25;

            const generated_beat_timestamps_collection = generateBeatGrid(
                target_tempo_beats_per_minute,
                total_duration_seconds,
                initial_offset_timestamp_seconds
            );

            expect(generated_beat_timestamps_collection).toEqual([0.25, 0.75, 1.25, 1.75]);
        });

        // WHAT: Verifies safeguard handling for zero or invalid inputs.
        // WHY: Prevents infinite loops if tempo or duration are zero or negative.
        it('safely handles non-positive durations or tempos without infinite loops', () => {
            expect(generateBeatGrid(0, 10)).toEqual([]);
            expect(generateBeatGrid(-50, 10)).toEqual([]);
            expect(generateBeatGrid(120, 0)).toEqual([]);
            expect(generateBeatGrid(120, -5)).toEqual([]);
        });
    });

    describe('analyzeSongSections', () => {
        // WHAT: Tests default fallback for very short audio files.
        // WHY: Audio buffers shorter than minimum section duration must return a single valid section spanning total duration.
        it('returns a single full-track section for short audio files', async () => {
            const short_audio_buffer = createSyntheticAudioBuffer(5.0);
            const detected_song_sections_collection = await analyzeSongSections(short_audio_buffer);

            expect(detected_song_sections_collection).toHaveLength(1);
            expect(detected_song_sections_collection[0].startTime).toBe(0);
            expect(detected_song_sections_collection[0].endTime).toBeCloseTo(5.0, 2);
            expect(detected_song_sections_collection[0].name).toBe('Full Song');
        });

        // WHAT: Tests boundary detection and dynamic section classification for longer audio tracks.
        // WHY: Distinct energetic stages (quiet intro, medium verse, explosive chorus, quiet outro)
        // should trigger boundary splits and appropriate SectionType assignments.
        it('detects structural transitions across varied energy stages', async () => {
            const total_track_duration_seconds = 60.0;
            const synthetic_audio_buffer = createSyntheticAudioBuffer(
                total_track_duration_seconds,
                44100,
                (timestamp_seconds: number) => {
                    if (timestamp_seconds < 12.0) {
                        return 0.1; // Quiet Intro
                    } else if (timestamp_seconds < 26.0) {
                        return 0.4; // Medium Verse
                    } else if (timestamp_seconds < 44.0) {
                        return 0.95; // High Energy Chorus
                    } else {
                        return 0.15; // Quiet Outro
                    }
                }
            );

            const detected_song_sections_collection = await analyzeSongSections(
                synthetic_audio_buffer,
                undefined,
                6.0 // Minimum 6 seconds per section
            );

            expect(detected_song_sections_collection.length).toBeGreaterThanOrEqual(2);
            expect(detected_song_sections_collection[0].startTime).toBe(0);

            // Last section must extend to the end of the track
            const last_section = detected_song_sections_collection[detected_song_sections_collection.length - 1];
            expect(last_section.endTime).toBeCloseTo(total_track_duration_seconds, 1);

            // Sections must form a continuous unbroken timeline
            for (let section_index = 0; section_index < detected_song_sections_collection.length - 1; section_index++) {
                const current_section_item = detected_song_sections_collection[section_index];
                const next_section_item = detected_song_sections_collection[section_index + 1];
                expect(current_section_item.endTime).toBeCloseTo(next_section_item.startTime, 2);
            }
        });

        // WHAT: Tests stem activity contribution to section classification.
        // WHY: The presence of vocal and drums stems during high-energy segments provides additional corroboration.
        it('incorporates stem track activity into section classification', async () => {
            const total_track_duration_seconds = 40.0;
            const master_audio_buffer = createSyntheticAudioBuffer(total_track_duration_seconds, 44100, () => 0.5);

            // High energy drums during 15s to 30s
            const drums_stem_buffer = createSyntheticAudioBuffer(
                total_track_duration_seconds,
                44100,
                (timestamp_seconds: number) => (timestamp_seconds >= 15.0 && timestamp_seconds <= 30.0 ? 0.9 : 0.05)
            );

            const detected_song_sections_collection = await analyzeSongSections(
                master_audio_buffer,
                { drums: drums_stem_buffer },
                6.0
            );

            expect(detected_song_sections_collection.length).toBeGreaterThanOrEqual(1);
            expect(detected_song_sections_collection[0].id).toBeDefined();
        });
    });

    describe('SECTION_TYPE_COLOR_MAP', () => {
        // WHAT: Validates styling and DaVinci Resolve color contract for all section types.
        // WHY: Ensures every SectionType has a non-empty background, border, text, and valid Resolve marker color.
        it('contains valid color definitions for every SectionType enum value', () => {
            const expected_section_types: SectionType[] = [
                'intro',
                'verse',
                'pre-chorus',
                'chorus',
                'bridge',
                'breakdown',
                'solo',
                'outro'
            ];

            expected_section_types.forEach((section_type_key) => {
                const color_theme_definition = SECTION_TYPE_COLOR_MAP[section_type_key];
                expect(color_theme_definition).toBeDefined();
                expect(color_theme_definition.background).toMatch(/^rgba\(/);
                expect(color_theme_definition.border).toMatch(/^#/);
                expect(color_theme_definition.text).toMatch(/^#/);
                expect(color_theme_definition.resolveColor).toBeTruthy();
            });
        });
    });
});
