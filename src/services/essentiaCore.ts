/**
 * src/services/essentiaCore.ts
 *
 * WHAT:
 *   Thread-agnostic Essentia.js WASM analysis routines operating on raw mono PCM (Float32Array).
 *
 * WHY:
 *   Shared by the background Web Worker (essentiaAnalysis.worker.ts) and the main-thread
 *   fallback path in essentiaService.ts. Contains no DOM / AudioBuffer dependencies so it
 *   can run inside a DedicatedWorkerGlobalScope.
 */

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

export interface LoudnessOptions {
    thresholdRatio: number;
    frameSize: number;
    hopSize: number;
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
// Singleton state (one instance per thread)
// ---------------------------------------------------------------------------

let cached_essentia_instance: EssentiaInstance | null = null;
let essentia_initialization_promise: Promise<EssentiaInstance> | null = null;

// WHAT: Lazily loads and instantiates the Essentia WebAssembly binary and JavaScript wrapper.
// WHY: Deferring WASM compilation until the first analysis call avoids loading a 2.5MB binary on application launch.
export async function getEssentia(): Promise<EssentiaInstance> {
    if (cached_essentia_instance) return cached_essentia_instance;
    if (essentia_initialization_promise) return essentia_initialization_promise;

    essentia_initialization_promise = (async () => {
        // Dynamic imports ensure WASM binaries are only loaded when required.
        const { EssentiaWASM } = await import(
            /* @vite-ignore */
            'essentia.js/dist/essentia-wasm.es.js'
        );

        const EssentiaCoreConstructor = (await import(
            /* @vite-ignore */
            'essentia.js/dist/essentia.js-core.es.js'
        )).default;

        cached_essentia_instance = new EssentiaCoreConstructor(EssentiaWASM, false);
        console.log('[Essentia] Initialised — version', cached_essentia_instance?.version);
        return cached_essentia_instance!;
    })();

    // Allow a retry if initialization failed
    essentia_initialization_promise.catch(() => { essentia_initialization_promise = null; });

    return essentia_initialization_promise;
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
// Analysis routines (mono PCM in, plain JSON out)
// ---------------------------------------------------------------------------

export async function computeBeats(
    mono_pcm_signal: Float32Array,
    beat_tracking_algorithm: BeatAlgorithm,
): Promise<BeatResult> {
    const essentia_service_handle = await getEssentia();
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

export async function computeOnsets(mono_pcm_signal: Float32Array): Promise<OnsetResult> {
    const essentia_service_handle = await getEssentia();
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

export async function computeLoudness(
    mono_pcm_signal: Float32Array,
    audio_sampling_rate_hz: number,
    { thresholdRatio: loudness_peak_threshold_ratio, frameSize: analysis_frame_size_samples, hopSize: analysis_hop_size_samples }: LoudnessOptions,
): Promise<LoudnessResult> {
    const essentia_service_handle = await getEssentia();
    const audio_duration_seconds = mono_pcm_signal.length / audio_sampling_rate_hz;

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
            end: Math.min(terminal_frame_timestamp, Number(audio_duration_seconds.toFixed(4))),
            level: Number((frame_loudness_values_collection[frame_loudness_values_collection.length - 1] / maximum_peak_loudness_value).toFixed(4)),
        });
    }

    return { regions: detected_loudness_regions_collection };
}
