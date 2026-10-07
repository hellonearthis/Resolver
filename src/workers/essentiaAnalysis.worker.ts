/**
 * src/workers/essentiaAnalysis.worker.ts
 *
 * WHAT:
 *   Dedicated Web Worker hosting its own Essentia.js WASM instance.
 *
 * WHY:
 *   Beat / onset / loudness analysis on a multi-million-sample signal blocks for seconds.
 *   Running it here keeps the React UI, waveform and timeline responsive.
 */

import { computeBeats, computeOnsets, computeLoudness, getEssentia } from '../services/essentiaCore';
import type { EssentiaWorkerRequest, EssentiaWorkerResponse } from './essentiaWorkerProtocol';

const ctx = self as unknown as {
    onmessage: ((e: MessageEvent<EssentiaWorkerRequest>) => void) | null;
    postMessage: (msg: EssentiaWorkerResponse) => void;
};

ctx.onmessage = async (event) => {
    const request = event.data;
    try {
        let result: unknown;
        switch (request.kind) {
            case 'init':
                await getEssentia();
                result = null;
                break;
            case 'beats':
                result = await computeBeats(request.pcm, request.algorithm);
                break;
            case 'onsets':
                result = await computeOnsets(request.pcm);
                break;
            case 'loudness':
                result = await computeLoudness(request.pcm, request.sampleRate, request.options);
                break;
        }
        ctx.postMessage({ id: request.id, ok: true, result });
    } catch (error) {
        ctx.postMessage({
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};
