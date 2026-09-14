/**
 * src/services/comfyService.ts
 *
 * WHAT:
 *   HTTP client and WebSocket event listener service for controlling local ComfyUI instances.
 *
 * WHY:
 *   Dispatches generative video and image workflows (such as MiniMax H3 and Qwen-VL) to ComfyUI,
 *   streams real-time execution progress updates back to the UI, and monitors execution completion.
 */

export const COMFY_API_URL = 'http://127.0.0.1:8188';

export interface ComfyNodeInputValues {
    [input_parameter_name: string]: unknown;
}

export interface ComfyNode {
    inputs: ComfyNodeInputValues;
    class_type: string;
    _meta: {
        title: string;
    };
}

export type ComfyWorkflow = Record<string, ComfyNode>;

export interface ComfyHistoryOutputItem {
    filename?: string;
    subfolder?: string;
    type?: string;
}

export interface ComfyHistoryRecord {
    prompt: unknown;
    outputs: Record<string, { images?: ComfyHistoryOutputItem[]; gifs?: ComfyHistoryOutputItem[]; text?: string[] }>;
    status?: {
        status_str: string;
        completed: boolean;
        messages?: Array<[string, { exception_message?: string; node_type?: string }]>;
    };
}

export interface ComfyQueueStatusResponse {
    queue_running: unknown[];
    queue_pending: unknown[];
}

// WHAT: Persistent unique client session token.
// WHY: ComfyUI tags queued tasks with client_id and publishes WebSocket progress events exclusively to matching subscribers.
const COMFY_CLIENT_ID = (Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2)).substring(0, 16);

interface ComfyFetchResponse {
    ok: boolean;
    status: number;
    statusText: string;
    json: () => Promise<unknown>;
}

// WHAT: Proxy fetch request dispatcher that routes requests through Electron IPC to bypass CORS.
// WHY: Modern Chromium security policies block direct renderer HTTP requests to local port 8188.
// Routing through main process net/fetch guarantees unobstructed communication.
const nodeFetch = async (target_endpoint_url: string, request_options: RequestInit = {}): Promise<ComfyFetchResponse> => {
    const electron_runtime_environment = (window as unknown as { 
        require?: (module_name: string) => { 
            ipcRenderer: { 
                invoke: (channel: string, url: string, options: RequestInit) => Promise<{ success: boolean; status?: number; error?: string; data?: unknown }> 
            } 
        } 
    });

    if (electron_runtime_environment.require) {
        try {
            const electron_ipc_renderer = electron_runtime_environment.require('electron').ipcRenderer;
            const ipc_invocation_result = await electron_ipc_renderer.invoke('comfy-fetch', target_endpoint_url, request_options);

            return {
                ok: ipc_invocation_result.success,
                status: ipc_invocation_result.status || (ipc_invocation_result.success ? 200 : 500),
                statusText: ipc_invocation_result.error || 'OK',
                json: async () => ipc_invocation_result.data
            };
        } catch (ipc_communication_error) {
            console.error("IPC Fetch Communication Error:", ipc_communication_error);
            return {
                ok: false,
                status: 500,
                statusText: String(ipc_communication_error),
                json: async () => ({})
            };
        }
    }

    // Browser fallback (for browser testing / development)
    const browser_fetch_response = await fetch(target_endpoint_url, request_options);
    return {
        ok: browser_fetch_response.ok,
        status: browser_fetch_response.status,
        statusText: browser_fetch_response.statusText,
        json: async () => browser_fetch_response.json()
    };
};

// WHAT: Verifies whether the local ComfyUI server is reachable and responsive.
// WHY: Allows the UI to render connection badges and block workflow submissions if ComfyUI is offline.
export const checkComfyConnection = async (): Promise<boolean> => {
    try {
        const connection_check_response = await nodeFetch(`${COMFY_API_URL}/system_stats`);
        return connection_check_response.ok;
    } catch (connection_verification_error) {
        console.error('ComfyUI connection health check failed:', connection_verification_error);
        return false;
    }
};

// WHAT: Dispatches a parameterized workflow graph to ComfyUI's execution queue.
// WHY: Initiates the background generation of video frames, prompt expansions, or vision analyses.
export const queuePrompt = async (workflow_graph_payload: ComfyWorkflow): Promise<{ prompt_id: string } | null> => {
    try {
        const queue_response = await nodeFetch(`${COMFY_API_URL}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                prompt: workflow_graph_payload,
                client_id: COMFY_CLIENT_ID
            }),
        });

        if (!queue_response.ok) {
            let error_detail_message = "";
            try {
                const error_response_data = await queue_response.json();
                error_detail_message = JSON.stringify(error_response_data);
            } catch (error_parsing_failure) {
                console.warn("Could not parse ComfyUI error response payload:", error_parsing_failure);
                error_detail_message = queue_response.statusText;
            }
            throw new Error(`Failed to queue prompt: ${error_detail_message}`);
        }

        const queue_result_data = (await queue_response.json()) as { prompt_id: string };
        return queue_result_data;
    } catch (prompt_dispatch_error) {
        console.error('Failed to queue prompt to ComfyUI:', prompt_dispatch_error);
        throw prompt_dispatch_error;
    }
};

// WHAT: Fetches completed execution results and generated output artifacts for a specific prompt ID.
// WHY: Retrieves the generated video file paths, saved frames, or extracted textual descriptions.
export const getHistory = async (target_prompt_identifier: string): Promise<Record<string, ComfyHistoryRecord> | null> => {
    try {
        const history_response = await nodeFetch(`${COMFY_API_URL}/history/${target_prompt_identifier}`);
        if (!history_response.ok) return null;
        return (await history_response.json()) as Record<string, ComfyHistoryRecord>;
    } catch (history_retrieval_error) {
        console.error('Failed to fetch prompt execution history:', history_retrieval_error);
        return null;
    }
};

// WHAT: Queries current execution status and pending item count in the ComfyUI queue.
// WHY: Informs the user how many tasks are queued ahead of the active clip.
export const getQueue = async (): Promise<ComfyQueueStatusResponse | null> => {
    try {
        const queue_status_response = await nodeFetch(`${COMFY_API_URL}/queue`);
        if (!queue_status_response.ok) return null;
        return (await queue_status_response.json()) as ComfyQueueStatusResponse;
    } catch (queue_query_error) {
        console.error('Failed to query ComfyUI queue status:', queue_query_error);
        return null;
    }
};

// WHAT: Uploads a local image or audio file into ComfyUI's input directory via Electron IPC.
// WHY: ComfyUI's LoadImage and LoadAudio nodes expect input media to reside in the input/ folder.
export const uploadFileToComfyUI = async (
    source_file_path: string,
    destination_subfolder_type: 'input' = 'input',
    overwrite_existing_file: boolean = true
): Promise<{ name: string } | null> => {
    try {
        const electron_runtime_environment = (window as unknown as { 
            require?: (module_name: string) => { 
                ipcRenderer: { 
                    invoke: (channel: string, ...args: unknown[]) => Promise<{ success: boolean; data?: { name: string }; error?: string }> 
                } 
            } 
        });

        if (electron_runtime_environment.require) {
            const electron_ipc_renderer = electron_runtime_environment.require('electron').ipcRenderer;
            const upload_result = await electron_ipc_renderer.invoke(
                'comfy-upload-file',
                COMFY_API_URL,
                source_file_path,
                destination_subfolder_type,
                overwrite_existing_file
            );

            if (upload_result.success && upload_result.data && upload_result.data.name) {
                return { name: upload_result.data.name };
            }
            console.error('Failed to upload file to ComfyUI via IPC:', upload_result.error);
            return null;
        }

        console.error('uploadFileToComfyUI requires Electron desktop runtime environment.');
        return null;
    } catch (file_upload_error) {
        console.error('Failed to upload file to ComfyUI:', file_upload_error);
        return null;
    }
};

// WHAT: Converts an audio file to a standard WAV format using FFmpeg via Electron IPC.
// WHY: Ensures audio files match the sample rate and uncompressed PCM format required by ComfyUI.
export const convertAudioForComfyUI = async (source_audio_file_path: string): Promise<string | null> => {
    try {
        const electron_runtime_environment = (window as unknown as { 
            require?: (module_name: string) => { 
                ipcRenderer: { 
                    invoke: (channel: string, path: string) => Promise<{ success: boolean; path?: string; error?: string }> 
                } 
            } 
        });

        if (electron_runtime_environment.require) {
            const electron_ipc_renderer = electron_runtime_environment.require('electron').ipcRenderer;
            const conversion_result = await electron_ipc_renderer.invoke('convert-audio-to-wav', source_audio_file_path);
            if (conversion_result.success && conversion_result.path) {
                return conversion_result.path;
            }
            console.error('Audio conversion failed:', conversion_result.error);
            return null;
        }
        console.error('convertAudioForComfyUI requires Electron desktop runtime environment.');
        return null;
    } catch (audio_conversion_error) {
        console.error('Audio conversion error:', audio_conversion_error);
        return null;
    }
};

// WHAT: Progress callback notification signature for WebSocket tracking.
// WHY: Supplies human-readable status text and an optional percentage completion integer (0-100).
export type ProgressCallback = (status_message: string, completion_percentage?: number) => void;

export interface ComfyNodeOutputs {
    images?: Array<{ filename?: string; subfolder?: string; type?: string }>;
    gifs?: Array<{ filename?: string; subfolder?: string; type?: string }>;
    videos?: Array<{ filename?: string; subfolder?: string; type?: string }>;
    filenames?: string[];
    text?: string[];
    [output_key: string]: unknown;
}

export type ComfyHistoryOutputs = Record<string, ComfyNodeOutputs>;

// WHAT: Connects to ComfyUI's live WebSocket pipeline to track execution progress of a queued prompt.
// WHY: Provides sub-second feedback on which node is executing (e.g. "Sampling: Step 12/20 (60%)"),
// falling back gracefully to polling if WebSocket connections are obstructed.
export const waitForPromptWebSocket = (
    target_prompt_identifier: string,
    workflow_graph_definition: Record<string, ComfyNode> | null,
    progress_notification_callback?: ProgressCallback
): Promise<ComfyHistoryOutputs> => {
    return new Promise((resolve_promise, reject_promise) => {
        const websocket_server_endpoint_url = `ws://127.0.0.1:8188/ws?clientId=${COMFY_CLIENT_ID}`;
        let live_websocket_instance: WebSocket | null = null;
        let is_execution_promise_resolved = false;
        let websocket_connection_timeout_timer: ReturnType<typeof setTimeout>;
        let periodic_safety_polling_timer: ReturnType<typeof setInterval>;

        // WHAT: Look up a human-readable node title from the workflow graph definition.
        // WHY: Replaces raw node ID numbers (e.g. "137") with friendly names (e.g. "Load Image (Start Frame)").
        const resolve_human_readable_node_title = (node_identifier: string): string => {
            if (!workflow_graph_definition) return node_identifier;
            const target_node_definition = workflow_graph_definition[node_identifier];
            if (target_node_definition?._meta?.title) return target_node_definition._meta.title;
            if (target_node_definition?.class_type) return target_node_definition.class_type;
            return node_identifier;
        };

        const cleanup_connection_resources = () => {
            clearTimeout(websocket_connection_timeout_timer);
            clearInterval(periodic_safety_polling_timer);
            if (live_websocket_instance && live_websocket_instance.readyState === WebSocket.OPEN) {
                live_websocket_instance.close();
            }
        };

        const resolve_execution_with_history = async () => {
            if (is_execution_promise_resolved) return;
            cleanup_connection_resources();
            is_execution_promise_resolved = true;

            // WHAT: Brief 600ms settling delay before querying the history endpoint.
            // WHY: ComfyUI occasionally requires a few hundred milliseconds to commit final output artifacts to disk.
            setTimeout(async () => {
                try {
                    const history_response = await nodeFetch(`${COMFY_API_URL}/history/${target_prompt_identifier}`);
                    if (history_response.ok) {
                        const history_data = (await history_response.json()) as Record<string, ComfyHistoryRecord>;
                        const target_prompt_record = history_data[target_prompt_identifier];

                        if (target_prompt_record?.status?.status_str === 'error') {
                            const error_messages_collection = target_prompt_record.status.messages;
                            let formatted_error_message = 'ComfyUI reported an execution error';
                            if (error_messages_collection?.[1]?.[1]?.exception_message) {
                                const error_details = error_messages_collection[1][1];
                                formatted_error_message = `ComfyUI Error (${error_details.node_type || 'Unknown Node'}): ${error_details.exception_message}`;
                            }
                            reject_promise(new Error(formatted_error_message));
                        } else {
                            resolve_promise(target_prompt_record?.outputs || {});
                        }
                    } else {
                        resolve_promise({});
                    }
                } catch (history_fetch_error) {
                    reject_promise(history_fetch_error);
                }
            }, 600);
        };

        // WHAT: Fallback polling loop when WebSocket connections fail or drop.
        // WHY: Guarantees prompt completion detection even if local firewall rules block WebSockets.
        const initiate_polling_fallback = () => {
            if (is_execution_promise_resolved) return;
            console.warn('[ComfyProgress] WebSocket unavailable, falling back to HTTP polling.');
            if (progress_notification_callback) {
                progress_notification_callback('Processing... (HTTP polling mode)');
            }

            const polling_interval_timer = setInterval(async () => {
                try {
                    const history_response = await nodeFetch(`${COMFY_API_URL}/history/${target_prompt_identifier}`);
                    if (!history_response.ok) return;
                    const history_data = (await history_response.json()) as Record<string, ComfyHistoryRecord>;

                    if (history_data[target_prompt_identifier]) {
                        clearInterval(polling_interval_timer);
                        is_execution_promise_resolved = true;
                        const target_prompt_record = history_data[target_prompt_identifier];

                        if (target_prompt_record.status?.status_str === 'error') {
                            const error_messages_collection = target_prompt_record.status.messages;
                            let formatted_error_message = 'ComfyUI reported an execution error';
                            if (error_messages_collection?.[1]?.[1]?.exception_message) {
                                const error_details = error_messages_collection[1][1];
                                formatted_error_message = `ComfyUI Error (${error_details.node_type || 'Unknown Node'}): ${error_details.exception_message}`;
                            }
                            reject_promise(new Error(formatted_error_message));
                        } else {
                            resolve_promise(target_prompt_record.outputs || {});
                        }
                    }
                } catch (polling_error) {
                    console.error('[ComfyProgress] Polling error:', polling_error);
                }
            }, 2000);
        };

        try {
            live_websocket_instance = new WebSocket(websocket_server_endpoint_url);

            // WHAT: 3-second connection timeout guard.
            // WHY: If WebSocket fails to open within 3 seconds, switch to HTTP polling.
            websocket_connection_timeout_timer = setTimeout(() => {
                if (live_websocket_instance && live_websocket_instance.readyState !== WebSocket.OPEN) {
                    live_websocket_instance.close();
                    initiate_polling_fallback();
                }
            }, 3000);

            // WHAT: Periodic 8-second safety net poll.
            // WHY: In rare cases where a WebSocket completion packet is dropped, this guarantees completion is caught.
            periodic_safety_polling_timer = setInterval(async () => {
                try {
                    const history_response = await nodeFetch(`${COMFY_API_URL}/history/${target_prompt_identifier}`);
                    if (history_response.ok) {
                        const history_data = (await history_response.json()) as Record<string, ComfyHistoryRecord>;
                        if (history_data[target_prompt_identifier] && !is_execution_promise_resolved) {
                            console.log('[ComfyProgress] Safety poll detected prompt completion.');
                            resolve_execution_with_history();
                        }
                    }
                } catch (safety_poll_error) {
                    console.warn('[ComfyProgress] Safety poll warning:', safety_poll_error);
                }
            }, 8000);

            live_websocket_instance.onopen = () => {
                clearTimeout(websocket_connection_timeout_timer);
                console.log('[ComfyProgress] WebSocket connected to ComfyUI.');
                if (progress_notification_callback) {
                    progress_notification_callback('Connected to ComfyUI...');
                }
            };

            live_websocket_instance.onmessage = (incoming_websocket_event) => {
                try {
                    const parsed_websocket_message = JSON.parse(incoming_websocket_event.data);
                    const { type: message_type, data: message_payload } = parsed_websocket_message;

                    if (message_type === 'execution_start') {
                        if (message_payload.prompt_id === target_prompt_identifier) {
                            if (progress_notification_callback) {
                                progress_notification_callback('Execution starting...');
                            }
                        }
                    } else if (message_type === 'execution_cached') {
                        if (message_payload.prompt_id === target_prompt_identifier && message_payload.nodes?.length) {
                            if (progress_notification_callback) {
                                progress_notification_callback(`Cached ${message_payload.nodes.length} nodes, skipping...`);
                            }
                        }
                    } else if (message_type === 'executing') {
                        if (message_payload.prompt_id === target_prompt_identifier || !message_payload.prompt_id) {
                            if (message_payload.node === null) {
                                console.log('[ComfyProgress] Execution signal: Idle/Complete');
                                resolve_execution_with_history();
                            } else {
                                const node_display_title = resolve_human_readable_node_title(message_payload.node);
                                if (progress_notification_callback) {
                                    progress_notification_callback(`Running: ${node_display_title}...`);
                                }
                            }
                        }
                    } else if (message_type === 'progress') {
                        const { value: current_step_value, max: maximum_step_value, node: current_node_identifier } = message_payload;
                        const completion_percentage = Math.round((current_step_value / maximum_step_value) * 100);
                        const node_display_title = current_node_identifier ? resolve_human_readable_node_title(current_node_identifier) : 'Processing';
                        if (progress_notification_callback) {
                            progress_notification_callback(`${node_display_title}: Step ${current_step_value}/${maximum_step_value} (${completion_percentage}%)`, completion_percentage);
                        }
                    } else if (message_type === 'execution_success' || message_type === 'execution_complete') {
                        if (message_payload.prompt_id === target_prompt_identifier) {
                            console.log(`[ComfyProgress] Explicit completion signal: ${message_type}`);
                            resolve_execution_with_history();
                        }
                    } else if (message_type === 'execution_error') {
                        if (message_payload.prompt_id === target_prompt_identifier || !message_payload.prompt_id) {
                            cleanup_connection_resources();
                            is_execution_promise_resolved = true;
                            const formatted_error_message = message_payload.exception_message
                                ? `ComfyUI Error (${message_payload.node_type || 'unknown'}): ${message_payload.exception_message}`
                                : 'ComfyUI execution error';
                            reject_promise(new Error(formatted_error_message));
                        }
                    }
                } catch (message_processing_error) {
                    console.warn('[ComfyProgress] Could not parse WebSocket frame:', message_processing_error);
                }
            };

            live_websocket_instance.onerror = (websocket_error_event) => {
                console.error('[ComfyProgress] WebSocket encountered error:', websocket_error_event);
                if (!is_execution_promise_resolved) {
                    cleanup_connection_resources();
                    initiate_polling_fallback();
                }
            };

            live_websocket_instance.onclose = () => {
                if (!is_execution_promise_resolved) {
                    cleanup_connection_resources();
                    initiate_polling_fallback();
                }
            };
        } catch (websocket_initialization_error) {
            console.error('[ComfyProgress] Failed to create WebSocket:', websocket_initialization_error);
            initiate_polling_fallback();
        }
    });
};
