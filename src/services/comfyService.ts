
export const COMFY_API_URL = 'http://127.0.0.1:8188';

export interface ComfyNode {
    inputs: Record<string, any>;
    class_type: string;
    _meta: {
        title: string;
    };
}

export type ComfyWorkflow = Record<string, ComfyNode>;

// Persistent client ID for the session to match WebSocket events with queued prompts
const COMFY_CLIENT_ID = (Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2)).substring(0, 16);

// Helper to bypass CORS using Electron's Node.js integration
// Helper to bypass CORS using Electron's Main Process via IPC
const nodeFetch = async (url: string, options: RequestInit = {}): Promise<{ ok: boolean, status: number, statusText: string, json: () => Promise<any> }> => {
    // @ts-ignore
    if (window.require) {
        try {
            // @ts-ignore
            const { ipcRenderer } = window.require('electron');
            // Use the IPC handler we defined in main.ts
            const result = await ipcRenderer.invoke('comfy-fetch', url, options);

            return {
                ok: result.success,
                status: result.status || (result.success ? 200 : 500),
                statusText: result.error || 'OK',
                json: async () => result.data
            };
        } catch (e) {
            console.error("IPC Fetch Error", e);
            return {
                ok: false,
                status: 500,
                statusText: String(e),
                json: async () => ({})
            };
        }
    }

    // Fallback to browser fetch (will likely fail CORS if not proxied)
    return fetch(url, options);
};

export const checkComfyConnection = async (): Promise<boolean> => {
    try {
        const response = await nodeFetch(`${COMFY_API_URL}/system_stats`);
        return response.ok;
    } catch (error) {
        console.error('ComfyUI connection check failed:', error);
        return false;
    }
};

export const queuePrompt = async (workflow: ComfyWorkflow): Promise<{ prompt_id: string } | null> => {
    try {
        const response = await nodeFetch(`${COMFY_API_URL}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                prompt: workflow,
                client_id: COMFY_CLIENT_ID
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to queue prompt: ${response.statusText}`);
        }

        const data = await response.json();
        return data; // { prompt_id: "...", number: ... }
    } catch (error) {
        console.error('Failed to queue prompt:', error);
        return null;
    }
};

export const getHistory = async (promptId: string): Promise<any> => {
    try {
        const response = await nodeFetch(`${COMFY_API_URL}/history/${promptId}`);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error('Failed to get history:', error);
        return null;
    }
};

export const getQueue = async (): Promise<{ queue_running: any[], queue_pending: any[] } | null> => {
    try {
        const response = await nodeFetch(`${COMFY_API_URL}/queue`);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error('Failed to get queue:', error);
        return null;
    }
};

/**
 * Uploads an image or audio file to ComfyUI's input directory.
 * @param filePath The absolute path to the local file
 * @param type Typically 'input'
 * @param overwrite Whether to overwrite an existing file
 */
export const uploadFileToComfyUI = async (filePath: string, type: 'input' = 'input', overwrite: boolean = true): Promise<{ name: string } | null> => {
    try {
        // We use Electron IPC since we need to read the local file and send it as FormData
        // @ts-ignore
        if (window.require) {
            // @ts-ignore
            const { ipcRenderer } = window.require('electron');
            const result = await ipcRenderer.invoke('comfy-upload-file', COMFY_API_URL, filePath, type, overwrite);

            if (result.success && result.data && result.data.name) {
                return { name: result.data.name };
            }
            console.error('Failed to upload file via IPC:', result.error);
            return null;
        }

        console.error('uploadFileToComfyUI requires Electron environment.');
        return null;
    } catch (error) {
        console.error('Failed to upload file:', error);
        return null;
    }
};

/**
 * Converts an audio file to WAV using ffmpeg (via Electron IPC).
 * Returns the path to the temp WAV file, or null on failure.
 */
export const convertAudioForComfyUI = async (filePath: string): Promise<string | null> => {
    try {
        // @ts-ignore
        if (window.require) {
            // @ts-ignore
            const { ipcRenderer } = window.require('electron');
            const result = await ipcRenderer.invoke('convert-audio-to-wav', filePath);
            if (result.success && result.path) {
                return result.path;
            }
            console.error('Audio conversion failed:', result.error);
            return null;
        }
        console.error('convertAudioForComfyUI requires Electron environment.');
        return null;
    } catch (error) {
        console.error('Audio conversion error:', error);
        return null;
    }
};

/**
 * Progress callback signature for WebSocket-based generation tracking.
 */
export type ProgressCallback = (status: string) => void;

/**
 * Connects to ComfyUI's WebSocket API and waits for a specific prompt to complete.
 * Provides real-time progress updates via the onProgress callback.
 *
 * @param promptId The prompt_id returned by queuePrompt
 * @param workflow The workflow object (used to look up node titles from IDs)
 * @param onProgress Callback invoked with human-readable progress strings
 * @returns The history outputs once the prompt finishes
 */
export const waitForPromptWebSocket = (
    promptId: string,
    workflow: Record<string, any> | null,
    onProgress?: ProgressCallback
): Promise<any> => {
    return new Promise((resolve, reject) => {
        const COMFY_WS_URL = `ws://127.0.0.1:8188/ws?clientId=${COMFY_CLIENT_ID}`;
        let ws: WebSocket;
        let resolved = false;
        let connectionTimeout: ReturnType<typeof setTimeout>;

        // Helper: look up a human-readable node title from the workflow
        const getNodeTitle = (nodeId: string): string => {
            if (!workflow) return nodeId;
            const node = workflow[nodeId];
            if (node?._meta?.title) return node._meta.title;
            if (node?.class_type) return node.class_type;
            return nodeId;
        };

        const cleanup = () => {
            clearTimeout(connectionTimeout);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        };

        // Fallback: poll /history if WebSocket fails
        const fallbackToPolling = () => {
            if (resolved) return;
            console.warn('[ComfyProgress] WebSocket unavailable, falling back to polling.');
            if (onProgress) onProgress('Processing... (polling mode)');

            const interval = setInterval(async () => {
                try {
                    const res = await nodeFetch(`${COMFY_API_URL}/history/${promptId}`);
                    if (!res.ok) return;
                    const history = await res.json();

                    if (history[promptId]) {
                        clearInterval(interval);
                        resolved = true;
                        if (history[promptId].status?.status_str === 'error') {
                            const msgs = history[promptId].status.messages;
                            let errMsg = 'ComfyUI reported an error';
                            if (msgs?.[1]?.exception_message) {
                                errMsg = `ComfyUI Error (${msgs[1].node_type}): ${msgs[1].exception_message}`;
                            }
                            reject(new Error(errMsg));
                        } else {
                            resolve(history[promptId].outputs);
                        }
                    }
                } catch (e) {
                    console.error('[ComfyProgress] Polling error:', e);
                }
            }, 1500);
        };

        try {
            ws = new WebSocket(COMFY_WS_URL);

            // If no connection within 3s, fall back to polling
            connectionTimeout = setTimeout(() => {
                if (ws.readyState !== WebSocket.OPEN) {
                    ws.close();
                    fallbackToPolling();
                }
            }, 3000);

            ws.onopen = () => {
                clearTimeout(connectionTimeout);
                console.log('[ComfyProgress] WebSocket connected');
                if (onProgress) onProgress('Connected to ComfyUI...');
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    const { type, data } = msg;

                    // Only process messages for our prompt
                    // Some messages don't include prompt_id (e.g. status), skip those checks

                    if (type === 'execution_start') {
                        if (data.prompt_id === promptId) {
                            if (onProgress) onProgress('Execution starting...');
                        }
                    } else if (type === 'execution_cached') {
                        // Nodes that were cached and skipped
                        if (data.prompt_id === promptId && data.nodes?.length) {
                            if (onProgress) onProgress(`Cached ${data.nodes.length} nodes, skipping...`);
                        }
                    } else if (type === 'executing') {
                        if (data.prompt_id === promptId || !data.prompt_id) {
                            if (data.node === null) {
                                // Execution complete — fetch history to get outputs
                                cleanup();
                                resolved = true;
                                // Small delay to let ComfyUI finalize history
                                setTimeout(async () => {
                                    try {
                                        const res = await nodeFetch(`${COMFY_API_URL}/history/${promptId}`);
                                        if (res.ok) {
                                            const history = await res.json();
                                            if (history[promptId]?.status?.status_str === 'error') {
                                                const msgs = history[promptId].status.messages;
                                                let errMsg = 'ComfyUI reported an error';
                                                if (msgs?.[1]?.exception_message) {
                                                    errMsg = `ComfyUI Error (${msgs[1].node_type}): ${msgs[1].exception_message}`;
                                                }
                                                reject(new Error(errMsg));
                                            } else {
                                                resolve(history[promptId]?.outputs || {});
                                            }
                                        } else {
                                            resolve({});
                                        }
                                    } catch (e) {
                                        reject(e);
                                    }
                                }, 500);
                            } else {
                                const title = getNodeTitle(data.node);
                                if (onProgress) onProgress(`Running: ${title}...`);
                            }
                        }
                    } else if (type === 'progress') {
                        // Step-level progress within a node (e.g. KSampler steps)
                        const { value, max, node } = data;
                        const pct = Math.round((value / max) * 100);
                        const title = node ? getNodeTitle(node) : 'Processing';
                        if (onProgress) onProgress(`${title}: Step ${value}/${max} (${pct}%)`);
                    } else if (type === 'execution_error') {
                        cleanup();
                        resolved = true;
                        const errMsg = data.exception_message
                            ? `ComfyUI Error (${data.node_type || 'unknown'}): ${data.exception_message}`
                            : 'ComfyUI execution error';
                        reject(new Error(errMsg));
                    }
                } catch (e) {
                    // Non-JSON message or parse error, ignore
                }
            };

            ws.onerror = (err) => {
                console.error('[ComfyProgress] WebSocket error:', err);
                if (!resolved) {
                    cleanup();
                    fallbackToPolling();
                }
            };

            ws.onclose = () => {
                if (!resolved) {
                    fallbackToPolling();
                }
            };
        } catch (e) {
            console.error('[ComfyProgress] Failed to create WebSocket:', e);
            fallbackToPolling();
        }
    });
};
