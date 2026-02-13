import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the Essentia WASM layer so we never load the real binary in tests
// ---------------------------------------------------------------------------

const mockEssentiaInstance = {
    version: '0.1.3-test',
    audioBufferToMonoSignal: vi.fn((buf: AudioBuffer) => {
        // Return a simple mono signal from channel 0
        return buf.getChannelData(0);
    }),
    arrayToVector: vi.fn((arr: Float32Array) => {
        // Return a shim that mimics Essentia VectorFloat
        return {
            size: () => arr.length,
            get: (i: number) => arr[i],
        };
    }),
    RhythmExtractor2013: vi.fn((_signal: unknown, _maxTempo: number, _algorithm: string, _minTempo: number) => ({
        ticks: {
            size: () => 4,
            get: (i: number) => [0.5, 1.0, 1.5, 2.0][i],
        },
        bpm: 120,
        confidence: 4.2,
    })),
    OnsetRate: vi.fn((_signal: unknown) => ({
        onsets: {
            size: () => 3,
            get: (i: number) => [0.25, 0.75, 1.25][i],
        },
        onsetRate: 2.0,
    })),
    Loudness: vi.fn((_vec: unknown) => ({
        loudness: 0,
    })),
};

// Mock the dynamic imports used by getEssentia()
vi.mock('essentia.js/dist/essentia-wasm.es.js', () => ({
    default: vi.fn(async () => ({ /* fake WASM module */ })),
}));

vi.mock('essentia.js/dist/essentia.js-core.es.js', () => {
    // Must be a real constructor function so `new Essentia(...)` works
    function MockEssentia() {
        return mockEssentiaInstance;
    }
    return { default: MockEssentia };
});

// ---------------------------------------------------------------------------
// Import the functions under test AFTER mocks are in place
// ---------------------------------------------------------------------------

import { analyzeBeats, analyzeOnsets, analyzeLoudness } from './essentiaService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockAudioBuffer(samples: Float32Array, sampleRate = 44100): AudioBuffer {
    return {
        sampleRate,
        duration: samples.length / sampleRate,
        length: samples.length,
        numberOfChannels: 1,
        getChannelData: (_ch: number) => samples,
        copyFromChannel: vi.fn(),
        copyToChannel: vi.fn(),
    } as unknown as AudioBuffer;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('essentiaService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // -----------------------------------------------------------------------
    // analyzeBeats
    // -----------------------------------------------------------------------
    describe('analyzeBeats', () => {
        it('returns BeatResult with beats array, bpm, and confidence', async () => {
            const samples = new Float32Array(44100); // 1 second of silence
            const buf = createMockAudioBuffer(samples);

            const result = await analyzeBeats(buf, 'multifeature');

            expect(result.beats).toEqual([0.5, 1.0, 1.5, 2.0]);
            expect(result.bpm).toBe(120);
            expect(result.confidence).toBe(4.2);
        });

        it('returns undefined confidence for degara algorithm', async () => {
            // Override the mock for this call
            mockEssentiaInstance.RhythmExtractor2013.mockReturnValueOnce({
                ticks: {
                    size: () => 2,
                    get: (i: number) => [1.0, 2.0][i],
                },
                bpm: 60,
                confidence: undefined,
            });

            const buf = createMockAudioBuffer(new Float32Array(44100));
            const result = await analyzeBeats(buf, 'degara');

            expect(result.beats).toEqual([1.0, 2.0]);
            expect(result.bpm).toBe(60);
            expect(result.confidence).toBeUndefined();
        });

        it('calls RhythmExtractor2013 with correct parameters', async () => {
            const buf = createMockAudioBuffer(new Float32Array(44100));
            await analyzeBeats(buf, 'multifeature');

            expect(mockEssentiaInstance.RhythmExtractor2013).toHaveBeenCalledWith(
                expect.anything(), // signal vector
                208,               // maxTempo
                'multifeature',    // algorithm
                40,                // minTempo
            );
        });
    });

    // -----------------------------------------------------------------------
    // analyzeOnsets
    // -----------------------------------------------------------------------
    describe('analyzeOnsets', () => {
        it('returns OnsetResult with onsets array and onsetRate', async () => {
            const buf = createMockAudioBuffer(new Float32Array(44100));
            const result = await analyzeOnsets(buf);

            expect(result.onsets).toEqual([0.25, 0.75, 1.25]);
            expect(result.onsetRate).toBe(2.0);
        });
    });

    // -----------------------------------------------------------------------
    // analyzeLoudness
    // -----------------------------------------------------------------------
    describe('analyzeLoudness', () => {
        it('returns empty regions when audio is too short', async () => {
            const buf = createMockAudioBuffer(new Float32Array(100), 44100);
            const result = await analyzeLoudness(buf, 0.8, 2048, 1024);

            expect(result.regions).toEqual([]);
        });

        it('returns empty regions when peak loudness is zero', async () => {
            // All frames return loudness = 0 (the default mock)
            const samples = new Float32Array(4096);
            const buf = createMockAudioBuffer(samples, 44100);
            const result = await analyzeLoudness(buf, 0.8, 2048, 1024);

            expect(result.regions).toEqual([]);
        });

        it('detects loud regions above threshold', async () => {
            // Create enough samples for multiple frames
            const samples = new Float32Array(8192);
            const buf = createMockAudioBuffer(samples, 44100);

            // Mock loudness values: [0.5, 0.9, 1.0, 0.3, 0.85, 0.2]
            const loudnessValues = [0.5, 0.9, 1.0, 0.3, 0.85, 0.2];
            let callIndex = 0;
            mockEssentiaInstance.Loudness.mockImplementation(() => ({
                loudness: loudnessValues[callIndex++] ?? 0,
            }));

            const result = await analyzeLoudness(buf, 0.8, 2048, 1024);

            // With threshold = 0.8 * peak(1.0) = 0.8:
            // frames at indices 1,2 (value 0.9, 1.0) are >= 0.8 → region 1
            // frame at index 4 (value 0.85) is >= 0.8 → region 2
            expect(result.regions.length).toBeGreaterThanOrEqual(1);
            expect(result.regions[0].start).toBeGreaterThan(0);
            expect(result.regions[0].level).toBeGreaterThan(0);
        });

        it('closes trailing region at end of file', async () => {
            const samples = new Float32Array(4096);
            const buf = createMockAudioBuffer(samples, 44100);

            // All frames above threshold → single region to end
            mockEssentiaInstance.Loudness.mockImplementation(() => ({
                loudness: 1.0,
            }));

            const result = await analyzeLoudness(buf, 0.5, 2048, 1024);

            expect(result.regions.length).toBe(1);
            expect(result.regions[0].start).toBe(0);
            expect(result.regions[0].end).toBeGreaterThan(0);
        });
    });
});
