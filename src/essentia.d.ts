declare module 'essentia.js/dist/essentia-wasm.es.js' {
    const EssentiaWASM: () => Promise<any>;
    export default EssentiaWASM;
}

declare module 'essentia.js/dist/essentia.js-core.es.js' {
    class Essentia {
        constructor(wasmModule: any, isDebug?: boolean);
        version: string;
        algorithmNames: string[];
        arrayToVector(input: Float32Array): any;
        vectorToArray(input: any): Float32Array;
        audioBufferToMonoSignal(buffer: AudioBuffer): Float32Array;
        BeatTrackerMultiFeature(signal: any, maxTempo?: number, minTempo?: number): { ticks: any; confidence: number };
        BeatTrackerDegara(signal: any, maxTempo?: number, minTempo?: number): { ticks: any };
        RhythmExtractor2013(signal: any, maxTempo?: number, method?: string, minTempo?: number): { bpm: number; ticks: any; confidence: number; estimates: any; bpmIntervals: any };
        OnsetRate(signal: any): { onsets: any; onsetRate: number };
        Loudness(signal: any): { loudness: number };
        shutdown(): void;
        delete(): void;
    }
    export default Essentia;
}
