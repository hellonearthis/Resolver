/**
 * src/services/essentiaService.ts
 *
 * WHAT:
 *   WASM-powered audio analysis service wrapping the Essentia.js music information retrieval engine.
 *
 * WHY:
 *   Extracts rhythmic beat grids, onset attack transients, and perceptual loudness envelopes
 *   directly in the client runtime without sending raw audio to an external server.
 *
 * THREADING:
 *   Heavy WASM work runs in a dedicated Web Worker (src/workers/essentiaAnalysis.worker.ts) so the
 *   UI stays responsive. The mono PCM buffer is *transferred* (zero-copy) to the worker. If Workers
 *   are unavailable (e.g. jsdom tests) or the worker fails, analysis falls back to the main thread.
 */

import { type MusicSection, SECTION_TYPE_COLOR_MAP, type SectionType } from '../types/sections';
import {
    computeBeats,
    computeOnsets,
    computeLoudness,
    getEssentia,
    type BeatAlgorithm,
    type BeatResult,
    type OnsetResult,
    type LoudnessResult,
} from './essentiaCore';
import type { EssentiaWorkerPayload, EssentiaWorkerResponse } from '../workers/essentiaWorkerProtocol';

export type { BeatAlgorithm, BeatResult, OnsetResult, LoudnessRegion, LoudnessResult } from './essentiaCore';

// ---------------------------------------------------------------------------
// Worker client
// ---------------------------------------------------------------------------

let analysis_worker: Worker | null = null;
let worker_disabled = typeof Worker === 'undefined';
let next_request_id = 1;
const pending_requests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

// WHAT: Lazily spawns the analysis worker on first use.
function getWorker(): Worker | null {
    if (worker_disabled) return null;
    if (analysis_worker) return analysis_worker;
    try {
        analysis_worker = new Worker(
            new URL('../workers/essentiaAnalysis.worker.ts', import.meta.url),
            { type: 'module', name: 'essentia-analysis' },
        );
        analysis_worker.onmessage = (event: MessageEvent<EssentiaWorkerResponse>) => {
            const response = event.data;
            const pending = pending_requests.get(response.id);
            if (!pending) return;
            pending_requests.delete(response.id);
            if (response.ok) pending.resolve(response.result);
            else pending.reject(new Error(response.error));
        };
        analysis_worker.onerror = (event) => {
            // Fatal worker error (e.g. script failed to load): reject everything and stop using it.
            console.warn('[Essentia] Worker crashed, falling back to main thread:', event.message);
            event.preventDefault();
            disableWorker(new Error(event.message || 'Essentia worker error'));
        };
        return analysis_worker;
    } catch (error) {
        console.warn('[Essentia] Could not start worker, using main thread:', error);
        worker_disabled = true;
        return null;
    }
}

function disableWorker(reason: Error) {
    worker_disabled = true;
    analysis_worker?.terminate();
    analysis_worker = null;
    pending_requests.forEach(({ reject }) => reject(reason));
    pending_requests.clear();
}

class WorkerUnavailableError extends Error {}

// WHAT: Sends a request to the worker, transferring the PCM buffer to avoid copying.
function callWorker<T>(payload: EssentiaWorkerPayload): Promise<T> {
    const worker = getWorker();
    if (!worker) return Promise.reject(new WorkerUnavailableError('Worker unavailable'));
    const id = next_request_id++;
    const transfer: Transferable[] = 'pcm' in payload ? [payload.pcm.buffer as ArrayBuffer] : [];
    return new Promise<T>((resolve, reject) => {
        pending_requests.set(id, { resolve: resolve as (v: unknown) => void, reject });
        worker.postMessage({ ...payload, id }, transfer);
    });
}

// WHAT: Runs a job in the worker, falling back to the main thread only if the worker itself is
// unusable (not for genuine analysis errors, which are re-thrown).
async function runAnalysis<T>(
    mono_pcm_signal: Float32Array,
    buildPayload: (pcm: Float32Array) => EssentiaWorkerPayload,
    runInline: (pcm: Float32Array) => Promise<T>,
): Promise<T> {
    if (!worker_disabled) {
        // Keep a copy in case we must fall back after the original buffer is transferred (detached).
        const pcm_for_worker = mono_pcm_signal.slice();
        try {
            return await callWorker<T>(buildPayload(pcm_for_worker));
        } catch (error) {
            if (!worker_disabled && !(error instanceof WorkerUnavailableError)) throw error;
        }
    }
    return runInline(mono_pcm_signal);
}

// WHAT: Pre-warms Essentia (compiles WASM) in the worker, or on the main thread as a fallback.
export const initEssentia = async (): Promise<void> => {
    try {
        await callWorker<null>({ kind: 'init' });
    } catch {
        await getEssentia();
    }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// WHAT: Downmixes an arbitrary multi-channel AudioBuffer into a single mono Float32Array.
// WHY: Essentia's C++ DSP algorithms operate on mono audio signals; downmixing in JavaScript
// conserves WASM linear memory heap. Always returns a fresh buffer, so it is safe to transfer.
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// WHAT: Analyzes audio buffer to detect musical beat timestamps, tempo (BPM), and detection confidence.
// WHY: Generates the beat marker grid used for snapping video cuts in the Music Video Assembler.
export async function analyzeBeats(
    source_audio_buffer: AudioBuffer,
    beat_tracking_algorithm: BeatAlgorithm = 'multifeature',
): Promise<BeatResult> {
    return runAnalysis(
        getMonoSignal(source_audio_buffer),
        (pcm) => ({ kind: 'beats', pcm, algorithm: beat_tracking_algorithm }),
        (pcm) => computeBeats(pcm, beat_tracking_algorithm),
    );
}

// WHAT: Detects transient audio onset timestamps and overall onset frequency rate.
// WHY: Detects sudden attacks such as drum snare hits or vocal starts that make natural video transition points.
export async function analyzeOnsets(
    source_audio_buffer: AudioBuffer,
): Promise<OnsetResult> {
    return runAnalysis(
        getMonoSignal(source_audio_buffer),
        (pcm) => ({ kind: 'onsets', pcm }),
        (pcm) => computeOnsets(pcm),
    );
}

// WHAT: Performs frame-by-frame perceptual loudness analysis to identify high-energy audio intervals.
// WHY: Allows the editor to automatically align dynamic visual actions with high-energy musical passages.
export async function analyzeLoudness(
    source_audio_buffer: AudioBuffer,
    loudness_peak_threshold_ratio = 0.8,
    analysis_frame_size_samples = 2048,
    analysis_hop_size_samples = 1024,
): Promise<LoudnessResult> {
    const sampleRate = source_audio_buffer.sampleRate;
    const options = {
        thresholdRatio: loudness_peak_threshold_ratio,
        frameSize: analysis_frame_size_samples,
        hopSize: analysis_hop_size_samples,
    };
    return runAnalysis(
        getMonoSignal(source_audio_buffer),
        (pcm) => ({ kind: 'loudness', pcm, sampleRate, options }),
        (pcm) => computeLoudness(pcm, sampleRate, options),
    );
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

