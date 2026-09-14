import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeBeats, analyzeOnsets, analyzeLoudness } from './essentiaService';

// ---------------------------------------------------------------------------
// Mock the Essentia WASM layer so we never load the real binary in tests
// ---------------------------------------------------------------------------

// WHAT: Mock implementation of the Essentia C++ WASM instance.
// WHY: In CI and unit testing, loading emscripten WASM binary files directly in node/happy-dom
// environments causes native binary resolution failures and slow test execution.
const mockEssentiaInstance = {
    version: '0.1.3-test',
    audioBufferToMonoSignal: vi.fn((audio_buffer: AudioBuffer) => {
        // Return a simple mono signal from channel 0
        return audio_buffer.getChannelData(0);
    }),
    arrayToVector: vi.fn((sample_array: Float32Array) => {
        // Return a shim that mimics Essentia VectorFloat
        return {
            size: () => sample_array.length,
            get: (sample_index: number) => sample_array[sample_index],
        };
    }),
    RhythmExtractor2013: vi.fn((): {
        ticks: {
            size: () => number;
            get: (tick_index: number) => number;
        };
        bpm: number;
        confidence?: number;
    } => ({
        ticks: {
            size: () => 4,
            get: (tick_index: number) => [0.5, 1.0, 1.5, 2.0][tick_index],
        },
        bpm: 120,
        confidence: 4.2,
    })),
    OnsetRate: vi.fn(() => ({
        onsets: {
            size: () => 3,
            get: (onset_index: number) => [0.25, 0.75, 1.25][onset_index],
        },
        onsetRate: 2.0,
    })),
    Loudness: vi.fn(() => ({
        loudness: 0,
    })),
};

// Mock the dynamic imports used by getEssentia()
vi.mock('essentia.js/dist/essentia-wasm.es.js', () => ({
    EssentiaWASM: { /* fake WASM module */ },
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
// Helpers
// ---------------------------------------------------------------------------

// WHAT: Creates a mocked browser AudioBuffer object with given float samples and sample rate.
// WHY: Node.js testing environments lack a native Web Audio API AudioBuffer constructor.
function createMockAudioBuffer(sample_data: Float32Array, sample_rate_hertz = 44100): AudioBuffer {
    return {
        sampleRate: sample_rate_hertz,
        duration: sample_data.length / sample_rate_hertz,
        length: sample_data.length,
        numberOfChannels: 1,
        getChannelData: () => sample_data,
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
            const pcm_audio_samples = new Float32Array(44100); // 1 second of silence
            const mock_audio_buffer = createMockAudioBuffer(pcm_audio_samples);

            const beat_analysis_result = await analyzeBeats(mock_audio_buffer, 'multifeature');

            expect(beat_analysis_result.beats).toEqual([0.5, 1.0, 1.5, 2.0]);
            expect(beat_analysis_result.bpm).toBe(120);
            expect(beat_analysis_result.confidence).toBe(4.2);
        });

        it('returns undefined confidence for degara algorithm', async () => {
            // Override the mock for this call
            mockEssentiaInstance.RhythmExtractor2013.mockReturnValueOnce({
                ticks: {
                    size: () => 2,
                    get: (tick_index: number) => [1.0, 2.0][tick_index],
                },
                bpm: 60,
                confidence: undefined as unknown as number,
            });

            const mock_audio_buffer = createMockAudioBuffer(new Float32Array(44100));
            const beat_analysis_result = await analyzeBeats(mock_audio_buffer, 'degara');

            expect(beat_analysis_result.beats).toEqual([1.0, 2.0]);
            expect(beat_analysis_result.bpm).toBe(60);
            expect(beat_analysis_result.confidence).toBeUndefined();
        });

        it('calls RhythmExtractor2013 with correct parameters', async () => {
            const mock_audio_buffer = createMockAudioBuffer(new Float32Array(44100));
            await analyzeBeats(mock_audio_buffer, 'multifeature');

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
            const mock_audio_buffer = createMockAudioBuffer(new Float32Array(44100));
            const onset_analysis_result = await analyzeOnsets(mock_audio_buffer);

            expect(onset_analysis_result.onsets).toEqual([0.25, 0.75, 1.25]);
            expect(onset_analysis_result.onsetRate).toBe(2.0);
        });
    });

    // -----------------------------------------------------------------------
    // analyzeLoudness
    // -----------------------------------------------------------------------
    describe('analyzeLoudness', () => {
        it('returns empty regions when audio is too short', async () => {
            const mock_audio_buffer = createMockAudioBuffer(new Float32Array(100), 44100);
            const loudness_result = await analyzeLoudness(mock_audio_buffer, 0.8, 2048, 1024);

            expect(loudness_result.regions).toEqual([]);
        });

        it('returns empty regions when peak loudness is zero', async () => {
            // All frames return loudness = 0 (the default mock)
            const pcm_audio_samples = new Float32Array(4096);
            const mock_audio_buffer = createMockAudioBuffer(pcm_audio_samples, 44100);
            const loudness_result = await analyzeLoudness(mock_audio_buffer, 0.8, 2048, 1024);

            expect(loudness_result.regions).toEqual([]);
        });

        it('detects loud regions above threshold', async () => {
            // Create enough samples for multiple frames
            const pcm_audio_samples = new Float32Array(8192);
            const mock_audio_buffer = createMockAudioBuffer(pcm_audio_samples, 44100);

            // Mock loudness values: [0.5, 0.9, 1.0, 0.3, 0.85, 0.2]
            const mock_loudness_values = [0.5, 0.9, 1.0, 0.3, 0.85, 0.2];
            let current_loudness_call_index = 0;
            mockEssentiaInstance.Loudness.mockImplementation(() => ({
                loudness: mock_loudness_values[current_loudness_call_index++] ?? 0,
            }));

            const loudness_result = await analyzeLoudness(mock_audio_buffer, 0.8, 2048, 1024);

            // With threshold = 0.8 * peak(1.0) = 0.8:
            // frames at indices 1,2 (value 0.9, 1.0) are >= 0.8 → region 1
            // frame at index 4 (value 0.85) is >= 0.8 → region 2
            expect(loudness_result.regions.length).toBeGreaterThanOrEqual(1);
            expect(loudness_result.regions[0].start).toBeGreaterThan(0);
            expect(loudness_result.regions[0].level).toBeGreaterThan(0);
        });

        it('closes trailing region at end of file', async () => {
            const pcm_audio_samples = new Float32Array(4096);
            const mock_audio_buffer = createMockAudioBuffer(pcm_audio_samples, 44100);

            // All frames above threshold → single region to end
            mockEssentiaInstance.Loudness.mockImplementation(() => ({
                loudness: 1.0,
            }));

            const loudness_result = await analyzeLoudness(mock_audio_buffer, 0.5, 2048, 1024);

            expect(loudness_result.regions.length).toBe(1);
            expect(loudness_result.regions[0].start).toBe(0);
            expect(loudness_result.regions[0].end).toBeGreaterThan(0);
        });
    });
});
