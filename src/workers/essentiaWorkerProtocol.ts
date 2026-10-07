/**
 * src/workers/essentiaWorkerProtocol.ts
 *
 * WHAT: Message contract between essentiaService (main thread) and essentiaAnalysis.worker.
 */

import type { BeatAlgorithm, LoudnessOptions } from '../services/essentiaCore';

export type EssentiaWorkerRequest =
    | { id: number; kind: 'init' }
    | { id: number; kind: 'beats'; pcm: Float32Array; algorithm: BeatAlgorithm }
    | { id: number; kind: 'onsets'; pcm: Float32Array }
    | { id: number; kind: 'loudness'; pcm: Float32Array; sampleRate: number; options: LoudnessOptions };

export type EssentiaWorkerResponse =
    | { id: number; ok: true; result: unknown }
    | { id: number; ok: false; error: string };

// Distributive Omit so each union member keeps its own fields
export type EssentiaWorkerPayload = EssentiaWorkerRequest extends infer R
    ? R extends EssentiaWorkerRequest ? Omit<R, 'id'> : never
    : never;
