/**
 * Essentia.js Service — Lazy-initialised singleton for WASM-powered audio analysis.
 *
 * Exposes:
 *   analyzeBeats(audioBuffer, algorithm)  → { beats[], bpm, confidence? }
 *   analyzeOnsets(audioBuffer)             → { onsets[] }
 *   analyzeLoudness(audioBuffer, opts)     → { regions[] }
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BeatAlgorithm = 'multifeature' | 'degara';

export interface BeatResult {
    beats: number[];          // seconds
    bpm: number;
    confidence?: number;       // 0–5.32 for multifeature
}

export interface OnsetResult {
    onsets: number[];          // seconds
    onsetRate: number;         // onsets per second
}

export interface LoudnessRegion {
    start: number;
    end: number;
    level: number;             // normalised 0–1
}

export interface LoudnessResult {
    regions: LoudnessRegion[];
}

// ---------------------------------------------------------------------------
// Essentia WASM + Core type shims (no TS types ship with essentia.js 0.1.x)
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */
type EssentiaWASMModule = any;
type EssentiaInstance = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------
let _essentia: EssentiaInstance | null = null;
let _essentiaWASM: EssentiaWASMModule | null = null;
let _initPromise: Promise<EssentiaInstance> | null = null;

/**
 * Lazily load and instantiate Essentia WASM + JS wrapper.
 * Safe to call many times — will only initialise once.
 */
async function getEssentia(): Promise<EssentiaInstance> {
    if (_essentia) return _essentia;
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
        // Dynamic imports so the WASM binary is only fetched when first needed.
        // essentia-wasm.es.js uses a named export, not a default export.
        const { EssentiaWASM } = await import(
            /* @vite-ignore */
            'essentia.js/dist/essentia-wasm.es.js'
        );

        // EssentiaWASM is already the instantiated WASM module.
        _essentiaWASM = EssentiaWASM;

        const Essentia = (await import(
            /* @vite-ignore */
            'essentia.js/dist/essentia.js-core.es.js'
        )).default;

        _essentia = new Essentia(_essentiaWASM, false);
        console.log('[Essentia] Initialised — version', _essentia.version);
        return _essentia;
    })();

    return _initPromise;
}

export const initEssentia = () => getEssentia();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract mono Float32Array from an AudioBuffer (downmix if stereo) in JS to save WASM heap. */
function getMonoSignal(audioBuffer: AudioBuffer): Float32Array {
    const channels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    const mono = new Float32Array(length);

    if (channels === 1) {
        mono.set(audioBuffer.getChannelData(0));
    } else if (channels === 2) {
        const left = audioBuffer.getChannelData(0);
        const right = audioBuffer.getChannelData(1);
        for (let i = 0; i < length; i++) {
            mono[i] = (left[i] + right[i]) / 2;
        }
    } else {
        // Just take first channel for >2 channels for now, or average all
        const channelData = audioBuffer.getChannelData(0);
        mono.set(channelData);
    }
    return mono;
}

/** Convert Essentia VectorFloat to a plain JS number[]. */
function vecToArray(vec: any): number[] {
    const arr: number[] = [];
    const size = vec.size();
    for (let i = 0; i < size; i++) {
        // Round to 4 decimal places to keep JSON clean
        arr.push(Number(vec.get(i).toFixed(4)));
    }
    return arr;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect beat positions using Essentia's BeatTrackerMultiFeature or
 * BeatTrackerDegara, wrapped by RhythmExtractor2013.
 */
export async function analyzeBeats(
    audioBuffer: AudioBuffer,
    algorithm: BeatAlgorithm = 'multifeature',
): Promise<BeatResult> {
    const essentia = await getEssentia();
    const mono = getMonoSignal(audioBuffer);
    const signal = essentia.arrayToVector(mono);
    let result: any;

    try {
        result = essentia.RhythmExtractor2013(
            signal,
            208,           // maxTempo
            algorithm,     // 'multifeature' | 'degara'
            40,            // minTempo
        );

        const beats = vecToArray(result.ticks);
        const bpm = Number((result.bpm as number).toFixed(4));
        const confidence = algorithm === 'multifeature' ? Number((result.confidence as number).toFixed(4)) : undefined;

        // Clean up result vectors if they are vectors
        if (result.ticks && result.ticks.delete) result.ticks.delete();
        if (result.estimates && result.estimates.delete) result.estimates.delete();
        if (result.bpmIntervals && result.bpmIntervals.delete) result.bpmIntervals.delete();

        return { beats, bpm, confidence };
    } finally {
        if (signal && signal.delete) signal.delete();
    }
}

/**
 * Detect audio onsets (transients) using OnsetRate.
 */
export async function analyzeOnsets(
    audioBuffer: AudioBuffer,
): Promise<OnsetResult> {
    const essentia = await getEssentia();
    const mono = getMonoSignal(audioBuffer);
    const signal = essentia.arrayToVector(mono);
    let result: any;

    try {
        result = essentia.OnsetRate(signal);
        const onsets = vecToArray(result.onsets);
        const onsetRate = Number((result.onsetRate as number).toFixed(4));

        if (result.onsets && result.onsets.delete) result.onsets.delete();

        return { onsets, onsetRate };
    } finally {
        if (signal && signal.delete) signal.delete();
    }
}

/**
 * Frame-wise loudness analysis. Returns regions that exceed `thresholdRatio`
 * of the peak loudness value.
 *
 * @param thresholdRatio  0-1, default 0.8 (80 % of peak loudness)
 * @param frameSize       samples per analysis frame (default 2048)
 * @param hopSize         hop between frames (default 1024)
 */
export async function analyzeLoudness(
    audioBuffer: AudioBuffer,
    thresholdRatio = 0.8,
    frameSize = 2048,
    hopSize = 1024,
): Promise<LoudnessResult> {
    const essentia = await getEssentia();
    const mono = getMonoSignal(audioBuffer);
    const sampleRate = audioBuffer.sampleRate;

    // Compute per-frame loudness manually via the Loudness algorithm
    // Note: We avoid allocating a single huge vector if possible, or just delete it.
    // Ideally we'd reuse the vector, but arrayToVector writes to it.
    // For performance and basic safety, we MUST delete the vector each iteration.

    const frameLoudness: number[] = [];

    for (let start = 0; start + frameSize <= mono.length; start += hopSize) {
        let vec: any = null;
        try {
            const frame = mono.subarray(start, start + frameSize);
            vec = essentia.arrayToVector(frame);
            const result = essentia.Loudness(vec);
            frameLoudness.push(result.loudness as number);
        } finally {
            if (vec && vec.delete) vec.delete();
        }
    }

    if (frameLoudness.length === 0) return { regions: [] };

    const peak = frameLoudness.reduce((a, b) => (a > b ? a : b), -Infinity);
    if (peak <= 0) return { regions: [] };

    const threshold = peak * thresholdRatio;
    const regions: LoudnessRegion[] = [];
    let regionStart: number | null = null;

    for (let i = 0; i < frameLoudness.length; i++) {
        const timeSec = Number(((i * hopSize) / sampleRate).toFixed(4));
        const normalised = Number((frameLoudness[i] / peak).toFixed(4));

        if (frameLoudness[i] >= threshold) {
            if (regionStart === null) regionStart = timeSec;
        } else {
            if (regionStart !== null) {
                regions.push({
                    start: regionStart,
                    end: timeSec,
                    level: normalised,
                });
                regionStart = null;
            }
        }
    }
    // Close trailing region
    if (regionStart !== null) {
        const endTime = Number((((frameLoudness.length - 1) * hopSize + frameSize) / sampleRate).toFixed(4));
        regions.push({
            start: regionStart,
            end: Math.min(endTime, Number(audioBuffer.duration.toFixed(4))),
            level: Number((frameLoudness[frameLoudness.length - 1] / peak).toFixed(4)),
        });
    }

    return { regions };
}
