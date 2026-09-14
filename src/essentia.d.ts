declare module 'essentia.js/dist/essentia-wasm.es.js' {
    export const EssentiaWASM: unknown;
}

declare module 'essentia.js/dist/essentia.js-core.es.js' {
    export interface EssentiaVector {
        delete: () => void;
        size: () => number;
        get: (index: number) => number;
    }

    class Essentia {
        constructor(wasmModule: unknown, isDebug?: boolean);
        version: string;
        algorithmNames: string[];
        arrayToVector(input: Float32Array): EssentiaVector;
        vectorToArray(input: EssentiaVector): Float32Array;
        audioBufferToMonoSignal(buffer: AudioBuffer): Float32Array;
        BeatTrackerMultiFeature(signal: EssentiaVector, maxTempo?: number, minTempo?: number): { ticks: EssentiaVector; confidence: number };
        BeatTrackerDegara(signal: EssentiaVector, maxTempo?: number, minTempo?: number): { ticks: EssentiaVector };
        RhythmExtractor2013(signal: EssentiaVector, maxTempo?: number, method?: string, minTempo?: number): { bpm: number; ticks: EssentiaVector; confidence: number; estimates: EssentiaVector; bpmIntervals: EssentiaVector };
        OnsetRate(signal: EssentiaVector): { onsets: EssentiaVector; onsetRate: number };
        Loudness(signal: EssentiaVector): { loudness: number };
        shutdown(): void;
        delete(): void;
    }
    export default Essentia;
}
