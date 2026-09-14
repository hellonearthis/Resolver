/**
 * src/services/essentiaService.ts
 *
 * WHAT:
 *   WASM-powered audio analysis service wrapping the Essentia.js music information retrieval engine.
 *
 * WHY:
 *   Extracts rhythmic beat grids, onset attack transients, and perceptual loudness envelopes
 *   directly in the client runtime without sending raw audio to an external server.
 */

import { type MusicSection, SECTION_TYPE_COLOR_MAP, type SectionType } from '../types/sections';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BeatAlgorithm = 'multifeature' | 'degara';

export interface BeatResult {
    beats: number[];          // Timestamps in seconds
    bpm: number;              // Detected tempo in beats per minute
    confidence?: number;       // Confidence score (0 to 5.32 for multifeature)
}

export interface OnsetResult {
    onsets: number[];          // Timestamps in seconds
    onsetRate: number;         // Detected onsets per second
}

export interface LoudnessRegion {
    start: number;             // Interval start timestamp in seconds
    end: number;               // Interval end timestamp in seconds
    level: number;             // Normalized amplitude intensity ratio (0.0 to 1.0)
}

export interface LoudnessResult {
    regions: LoudnessRegion[];
}

// ---------------------------------------------------------------------------
// Essentia WASM + Core type definitions
// ---------------------------------------------------------------------------

interface EssentiaVectorFloat {
    size: () => number;
    get: (index: number) => number;
    delete: () => void;
}

interface EssentiaInstance {
    version: string;
    arrayToVector: (input_array: Float32Array) => EssentiaVectorFloat;
    RhythmExtractor2013: (
        signal_vector: EssentiaVectorFloat,
        maximum_tempo_bpm: number,
        algorithm_name: string,
        minimum_tempo_bpm: number
    ) => {
        ticks: EssentiaVectorFloat;
        bpm: number;
        confidence?: number;
        estimates?: EssentiaVectorFloat;
        bpmIntervals?: EssentiaVectorFloat;
    };
    OnsetRate: (signal_vector: EssentiaVectorFloat) => {
        onsets: EssentiaVectorFloat;
        onsetRate: number;
    };
    Loudness: (signal_vector: EssentiaVectorFloat) => {
        loudness: number;
    };
}

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

let cached_essentia_instance: EssentiaInstance | null = null;
let cached_essentia_wasm_module: unknown = null;
let essentia_initialization_promise: Promise<EssentiaInstance> | null = null;

// WHAT: Lazily loads and instantiates the Essentia WebAssembly binary and JavaScript wrapper.
// WHY: Deferring WASM compilation until the first analysis call avoids loading a 2.5MB binary on application launch.
async function getEssentia(): Promise<EssentiaInstance> {
    if (cached_essentia_instance) return cached_essentia_instance;
    if (essentia_initialization_promise) return essentia_initialization_promise;

    essentia_initialization_promise = (async () => {
        // Dynamic imports ensure WASM binaries are only loaded when required.
        const { EssentiaWASM } = await import(
            /* @vite-ignore */
            'essentia.js/dist/essentia-wasm.es.js'
        );

        cached_essentia_wasm_module = EssentiaWASM;

        const EssentiaCoreConstructor = (await import(
            /* @vite-ignore */
            'essentia.js/dist/essentia.js-core.es.js'
        )).default;

        cached_essentia_instance = new EssentiaCoreConstructor(cached_essentia_wasm_module, false);
        console.log('[Essentia] Initialised — version', cached_essentia_instance?.version);
        return cached_essentia_instance!;
    })();

    return essentia_initialization_promise;
}

export const initEssentia = () => getEssentia();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// WHAT: Downmixes an arbitrary multi-channel AudioBuffer into a single mono Float32Array.
// WHY: Essentia's C++ DSP algorithms operate on mono audio signals; downmixing in JavaScript
// conserves WASM linear memory heap.
function getMonoSignal(source_audio_buffer: AudioBuffer): Float32Array {
    const audio_channel_count = source_audio_buffer.numberOfChannels;
    const total_sample_length = source_audio_buffer.length;
    const mono_signal_buffer = new Float32Array(total_sample_length);

    if (audio_channel_count === 1) {
        mono_signal_buffer.set(source_audio_buffer.getChannelData(0));
    } else if (audio_channel_count === 2) {
        const left_channel_data = source_audio_buffer.getChannelData(0);
        const right_channel_data = source_audio_buffer.getChannelData(1);
        for (let sample_index = 0; sample_index < total_sample_length; sample_index++) {
            mono_signal_buffer[sample_index] = (left_channel_data[sample_index] + right_channel_data[sample_index]) / 2;
        }
    } else {
        // For >2 channels, use channel 0 as primary reference
        const primary_channel_data = source_audio_buffer.getChannelData(0);
        mono_signal_buffer.set(primary_channel_data);
    }
    return mono_signal_buffer;
}

// WHAT: Converts a C++ Emscripten VectorFloat into a standard JavaScript array of timestamps.
// WHY: Unpacks memory references and rounds timestamps to 4 decimal places for clean storage.
function vecToArray(source_vector_float: EssentiaVectorFloat): number[] {
    const extracted_numbers_array: number[] = [];
    const vector_element_count = source_vector_float.size();
    for (let vector_element_index = 0; vector_element_index < vector_element_count; vector_element_index++) {
        extracted_numbers_array.push(Number(source_vector_float.get(vector_element_index).toFixed(4)));
    }
    return extracted_numbers_array;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// WHAT: Analyzes audio buffer to detect musical beat timestamps, tempo (BPM), and detection confidence.
// WHY: Generates the beat marker grid used for snapping video cuts in the Music Video Assembler.
export async function analyzeBeats(
    source_audio_buffer: AudioBuffer,
    beat_tracking_algorithm: BeatAlgorithm = 'multifeature',
): Promise<BeatResult> {
    const essentia_service_handle = await getEssentia();
    const mono_pcm_signal = getMonoSignal(source_audio_buffer);
    const audio_signal_vector = essentia_service_handle.arrayToVector(mono_pcm_signal);

    try {
        const rhythm_analysis_result = essentia_service_handle.RhythmExtractor2013(
            audio_signal_vector,
            208,                      // Maximum tempo constraint (208 BPM)
            beat_tracking_algorithm,  // 'multifeature' | 'degara'
            40,                       // Minimum tempo constraint (40 BPM)
        );

        const detected_beat_timestamps = vecToArray(rhythm_analysis_result.ticks);
        const detected_tempo_bpm = Number(rhythm_analysis_result.bpm.toFixed(4));
        const algorithm_confidence_score = beat_tracking_algorithm === 'multifeature' && typeof rhythm_analysis_result.confidence === 'number'
            ? Number(rhythm_analysis_result.confidence.toFixed(4))
            : undefined;

        // Free C++ Emscripten vectors from WebAssembly heap
        if (rhythm_analysis_result.ticks?.delete) rhythm_analysis_result.ticks.delete();
        if (rhythm_analysis_result.estimates?.delete) rhythm_analysis_result.estimates.delete();
        if (rhythm_analysis_result.bpmIntervals?.delete) rhythm_analysis_result.bpmIntervals.delete();

        return {
            beats: detected_beat_timestamps,
            bpm: detected_tempo_bpm,
            confidence: algorithm_confidence_score
        };
    } finally {
        if (audio_signal_vector?.delete) audio_signal_vector.delete();
    }
}

// WHAT: Detects transient audio onset timestamps and overall onset frequency rate.
// WHY: Detects sudden attacks such as drum snare hits or vocal starts that make natural video transition points.
export async function analyzeOnsets(
    source_audio_buffer: AudioBuffer,
): Promise<OnsetResult> {
    const essentia_service_handle = await getEssentia();
    const mono_pcm_signal = getMonoSignal(source_audio_buffer);
    const audio_signal_vector = essentia_service_handle.arrayToVector(mono_pcm_signal);

    try {
        const onset_analysis_result = essentia_service_handle.OnsetRate(audio_signal_vector);
        const detected_onset_timestamps = vecToArray(onset_analysis_result.onsets);
        const detected_onset_rate = Number(onset_analysis_result.onsetRate.toFixed(4));

        if (onset_analysis_result.onsets?.delete) onset_analysis_result.onsets.delete();

        return {
            onsets: detected_onset_timestamps,
            onsetRate: detected_onset_rate
        };
    } finally {
        if (audio_signal_vector?.delete) audio_signal_vector.delete();
    }
}

// WHAT: Performs frame-by-frame perceptual loudness analysis to identify high-energy audio intervals.
// WHY: Allows the editor to automatically align dynamic visual actions with high-energy musical passages.
export async function analyzeLoudness(
    source_audio_buffer: AudioBuffer,
    loudness_peak_threshold_ratio = 0.8,
    analysis_frame_size_samples = 2048,
    analysis_hop_size_samples = 1024,
): Promise<LoudnessResult> {
    const essentia_service_handle = await getEssentia();
    const mono_pcm_signal = getMonoSignal(source_audio_buffer);
    const audio_sampling_rate_hz = source_audio_buffer.sampleRate;

    const frame_loudness_values_collection: number[] = [];

    for (let frame_start_index = 0; frame_start_index + analysis_frame_size_samples <= mono_pcm_signal.length; frame_start_index += analysis_hop_size_samples) {
        let frame_vector_float: EssentiaVectorFloat | null = null;
        try {
            const current_audio_frame = mono_pcm_signal.subarray(frame_start_index, frame_start_index + analysis_frame_size_samples);
            frame_vector_float = essentia_service_handle.arrayToVector(current_audio_frame);
            const loudness_computation_result = essentia_service_handle.Loudness(frame_vector_float);
            frame_loudness_values_collection.push(loudness_computation_result.loudness);
        } finally {
            if (frame_vector_float?.delete) frame_vector_float.delete();
        }
    }

    if (frame_loudness_values_collection.length === 0) return { regions: [] };

    const maximum_peak_loudness_value = frame_loudness_values_collection.reduce(
        (highest_value, current_value) => (highest_value > current_value ? highest_value : current_value),
        -Infinity
    );
    if (maximum_peak_loudness_value <= 0) return { regions: [] };

    const effective_loudness_threshold = maximum_peak_loudness_value * loudness_peak_threshold_ratio;
    const detected_loudness_regions_collection: LoudnessRegion[] = [];
    let current_region_start_timestamp: number | null = null;

    for (let frame_index = 0; frame_index < frame_loudness_values_collection.length; frame_index++) {
        const frame_timestamp_seconds = Number(((frame_index * analysis_hop_size_samples) / audio_sampling_rate_hz).toFixed(4));
        const normalized_loudness_ratio = Number((frame_loudness_values_collection[frame_index] / maximum_peak_loudness_value).toFixed(4));

        if (frame_loudness_values_collection[frame_index] >= effective_loudness_threshold) {
            if (current_region_start_timestamp === null) {
                current_region_start_timestamp = frame_timestamp_seconds;
            }
        } else {
            if (current_region_start_timestamp !== null) {
                detected_loudness_regions_collection.push({
                    start: current_region_start_timestamp,
                    end: frame_timestamp_seconds,
                    level: normalized_loudness_ratio,
                });
                current_region_start_timestamp = null;
            }
        }
    }

    // Close trailing active loudness region if audio ends while above threshold
    if (current_region_start_timestamp !== null) {
        const terminal_frame_timestamp = Number((((frame_loudness_values_collection.length - 1) * analysis_hop_size_samples + analysis_frame_size_samples) / audio_sampling_rate_hz).toFixed(4));
        detected_loudness_regions_collection.push({
            start: current_region_start_timestamp,
            end: Math.min(terminal_frame_timestamp, Number(source_audio_buffer.duration.toFixed(4))),
            level: Number((frame_loudness_values_collection[frame_loudness_values_collection.length - 1] / maximum_peak_loudness_value).toFixed(4)),
        });
    }

    return { regions: detected_loudness_regions_collection };
}

// ---------------------------------------------------------------------------
// Rhythmic Grid Generation (Manual BPM & Tap Tempo)
// ---------------------------------------------------------------------------

// WHAT: Generates an evenly spaced rhythmic beat grid based on a specified BPM and duration.
// WHY: Used for manual tempo overrides, tap-tempo adjustments, or blank timelines without audio files.
export function generateBeatGrid(
    target_tempo_beats_per_minute: number,
    total_duration_seconds: number,
    initial_offset_timestamp_seconds: number = 0
): number[] {
    if (target_tempo_beats_per_minute <= 0 || total_duration_seconds <= 0) {
        return [];
    }

    const interval_duration_seconds = 60 / target_tempo_beats_per_minute;
    const generated_beat_timestamps_collection: number[] = [];

    let current_beat_timestamp = Math.max(0, initial_offset_timestamp_seconds);
    while (current_beat_timestamp <= total_duration_seconds) {
        generated_beat_timestamps_collection.push(Number(current_beat_timestamp.toFixed(4)));
        current_beat_timestamp += interval_duration_seconds;
    }

    return generated_beat_timestamps_collection;
}

// ---------------------------------------------------------------------------
// Automated Song Section Boundaries (Verse / Chorus Transitions)
// ---------------------------------------------------------------------------

export interface StemAudioBuffersDictionary {
    vocals?: AudioBuffer;
    drums?: AudioBuffer;
    bass?: AudioBuffer;
    other?: AudioBuffer;
}

// WHAT: Analyzes audio dynamics and optional stem activity to detect verse/chorus transitions.
// WHY: Partitions a song into musical narrative blocks (Intro, Verse, Chorus, Bridge, Outro)
// to guide automated video pacing, shot changes, and DaVinci Resolve chapter markers.
export async function analyzeSongSections(
    master_audio_buffer: AudioBuffer,
    _optional_stem_audio_buffers_dictionary?: StemAudioBuffersDictionary,
    minimum_section_duration_seconds: number = 8.0
): Promise<MusicSection[]> {
    const audio_duration_seconds = master_audio_buffer.duration;
    if (audio_duration_seconds < minimum_section_duration_seconds) {
        return [{
            id: 'section_0',
            name: 'Full Song',
            type: 'verse',
            startTime: 0,
            endTime: audio_duration_seconds,
            color: SECTION_TYPE_COLOR_MAP.verse.border,
            energyLevel: 0.5
        }];
    }

    // Step 1: Compute windowed RMS energy for master track
    const sample_rate_hz = master_audio_buffer.sampleRate;
    const channel_samples_array = master_audio_buffer.getChannelData(0);
    const window_duration_seconds = 1.0;
    const window_size_samples = Math.floor(sample_rate_hz * window_duration_seconds);
    const total_windows_count = Math.floor(channel_samples_array.length / window_size_samples);

    if (total_windows_count < 2) {
        return [{
            id: 'section_0',
            name: 'Full Song',
            type: 'verse',
            startTime: 0,
            endTime: audio_duration_seconds,
            color: SECTION_TYPE_COLOR_MAP.verse.border,
            energyLevel: 0.5
        }];
    }

    const window_energy_values_collection: number[] = new Array(total_windows_count);
    let peak_window_energy_value = 0.0001;

    for (let window_index = 0; window_index < total_windows_count; window_index++) {
        const window_start_sample = window_index * window_size_samples;
        let sum_squared_samples = 0;
        for (let sample_offset = 0; sample_offset < window_size_samples; sample_offset++) {
            const sample_value = channel_samples_array[window_start_sample + sample_offset];
            sum_squared_samples += sample_value * sample_value;
        }
        const rms_energy_value = Math.sqrt(sum_squared_samples / window_size_samples);
        window_energy_values_collection[window_index] = rms_energy_value;
        if (rms_energy_value > peak_window_energy_value) {
            peak_window_energy_value = rms_energy_value;
        }
    }

    // Normalize energies 0.0 to 1.0
    const normalized_energy_values_collection = window_energy_values_collection.map(
        (raw_energy) => raw_energy / peak_window_energy_value
    );

    // Step 2: Smooth energy curve with moving average
    const smoothing_radius = 2;
    const smoothed_energy_values_collection: number[] = new Array(total_windows_count);
    for (let index = 0; index < total_windows_count; index++) {
        let window_sum = 0;
        let counted_samples = 0;
        for (let offset = -smoothing_radius; offset <= smoothing_radius; offset++) {
            const target_index = index + offset;
            if (target_index >= 0 && target_index < total_windows_count) {
                window_sum += normalized_energy_values_collection[target_index];
                counted_samples++;
            }
        }
        smoothed_energy_values_collection[index] = window_sum / counted_samples;
    }

    // Step 3: Find candidate transition timestamps where energy delta peaks
    const candidate_boundary_timestamps_collection: number[] = [0];
    let previous_boundary_timestamp = 0;

    for (let index = 1; index < total_windows_count - 1; index++) {
        const current_timestamp = index * window_duration_seconds;
        const energy_delta_magnitude = Math.abs(
            smoothed_energy_values_collection[index + 1] - smoothed_energy_values_collection[index - 1]
        );

        // A notable transition requires substantial gradient and spacing from previous transition
        if (
            energy_delta_magnitude > 0.08 &&
            (current_timestamp - previous_boundary_timestamp) >= minimum_section_duration_seconds &&
            (audio_duration_seconds - current_timestamp) >= minimum_section_duration_seconds
        ) {
            candidate_boundary_timestamps_collection.push(Number(current_timestamp.toFixed(2)));
            previous_boundary_timestamp = current_timestamp;
        }
    }

    candidate_boundary_timestamps_collection.push(Number(audio_duration_seconds.toFixed(2)));

    // Step 4: Classify each segment based on energy and musical positioning
    const mean_song_energy = smoothed_energy_values_collection.reduce((sum, val) => sum + val, 0) / total_windows_count;
    const classified_sections_collection: MusicSection[] = [];

    let verse_counter_number = 1;
    let chorus_counter_number = 1;

    for (let boundary_index = 0; boundary_index < candidate_boundary_timestamps_collection.length - 1; boundary_index++) {
        const segment_start_time = candidate_boundary_timestamps_collection[boundary_index];
        const segment_end_time = candidate_boundary_timestamps_collection[boundary_index + 1];
        const segment_duration = segment_end_time - segment_start_time;

        const start_window_index = Math.floor(segment_start_time / window_duration_seconds);
        const end_window_index = Math.min(total_windows_count, Math.ceil(segment_end_time / window_duration_seconds));
        
        let segment_energy_sum = 0;
        let segment_window_count = 0;
        for (let window_index = start_window_index; window_index < end_window_index; window_index++) {
            segment_energy_sum += smoothed_energy_values_collection[window_index];
            segment_window_count++;
        }
        const segment_mean_energy = segment_window_count > 0 ? (segment_energy_sum / segment_window_count) : mean_song_energy;

        // Determine section type heuristics
        let detected_section_type: SectionType = 'verse';
        let section_display_name = '';

        const is_first_segment = boundary_index === 0;
        const is_last_segment = boundary_index === candidate_boundary_timestamps_collection.length - 2;

        if (is_first_segment) {
            detected_section_type = 'intro';
            section_display_name = 'Intro';
        } else if (is_last_segment && segment_mean_energy < mean_song_energy) {
            detected_section_type = 'outro';
            section_display_name = 'Outro';
        } else if (segment_mean_energy > mean_song_energy * 1.15) {
            detected_section_type = 'chorus';
            section_display_name = `Chorus ${chorus_counter_number++}`;
        } else if (segment_duration < 12.0 && segment_mean_energy > mean_song_energy * 0.95 && boundary_index < candidate_boundary_timestamps_collection.length - 2) {
            detected_section_type = 'pre-chorus';
            section_display_name = 'Pre-Chorus';
        } else if (boundary_index >= 3 && segment_mean_energy < mean_song_energy * 0.85) {
            detected_section_type = 'bridge';
            section_display_name = 'Bridge';
        } else {
            detected_section_type = 'verse';
            section_display_name = `Verse ${verse_counter_number++}`;
        }

        const section_color = SECTION_TYPE_COLOR_MAP[detected_section_type]?.border || '#3b82f6';

        classified_sections_collection.push({
            id: `section_${boundary_index}_${Date.now().toString(36)}`,
            name: section_display_name,
            type: detected_section_type,
            startTime: segment_start_time,
            endTime: segment_end_time,
            color: section_color,
            energyLevel: Number(segment_mean_energy.toFixed(2))
        });
    }

    return classified_sections_collection;
}

