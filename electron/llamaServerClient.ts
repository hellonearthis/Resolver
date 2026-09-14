import fs from 'fs';
import path from 'path';

// WHAT: Interface representing a discovered .gguf model file on local storage.
// WHY: Provides the UI and process launcher with model metadata and paired vision projector paths.
export interface DiscoveredGgufModel {
    model_name: string;
    file_path: string;
    directory_relative_path: string;
    file_size_megabytes: number;
    file_size_formatted: string;
    paired_multimodal_projector_path: string | null;
    supports_multimodal_vision: boolean;
}

// WHAT: Recursively scans a directory for .gguf model files and pairs them with any companion mmproj files.
// WHY: Gives the user a comprehensive list of locally installed models with vision projector status.
export function scanLocalGgufModels(scan_directory_path: string): DiscoveredGgufModel[] {
    const discovered_models_collection: DiscoveredGgufModel[] = [];
    if (!scan_directory_path || !fs.existsSync(scan_directory_path)) {
        return discovered_models_collection;
    }

    function traverseFolderTree(current_folder_path: string) {
        let directory_entries: fs.Dirent[] = [];
        try {
            directory_entries = fs.readdirSync(current_folder_path, { withFileTypes: true });
        } catch {
            return;
        }

        const model_files_in_directory: { name: string; full_path: string; size_bytes: number }[] = [];
        const projector_files_in_directory: { name: string; full_path: string }[] = [];

        for (const current_entry of directory_entries) {
            const entry_full_path = path.join(current_folder_path, current_entry.name);
            if (current_entry.isDirectory()) {
                traverseFolderTree(entry_full_path);
            } else if (current_entry.isFile() && current_entry.name.toLowerCase().endsWith('.gguf')) {
                if (current_entry.name.toLowerCase().startsWith('mmproj-')) {
                    projector_files_in_directory.push({
                        name: current_entry.name,
                        full_path: entry_full_path
                    });
                } else {
                    let file_size_bytes = 0;
                    try {
                        file_size_bytes = fs.statSync(entry_full_path).size;
                    } catch {
                        file_size_bytes = 0;
                    }
                    model_files_in_directory.push({
                        name: current_entry.name,
                        full_path: entry_full_path,
                        size_bytes: file_size_bytes
                    });
                }
            }
        }

        // Pair each model with the best matching projector in the same directory (or the single projector if only 1)
        for (const current_model of model_files_in_directory) {
            let paired_projector_path: string | null = null;
            if (projector_files_in_directory.length === 1) {
                paired_projector_path = projector_files_in_directory[0].full_path;
            } else if (projector_files_in_directory.length > 1) {
                const model_base_clean = current_model.name.toLowerCase().replace('.gguf', '');
                const matched_projector = projector_files_in_directory.find(proj => {
                    const proj_clean = proj.name.toLowerCase();
                    return model_base_clean.includes(proj_clean.replace('mmproj-', '').replace('.gguf', '')) ||
                           proj_clean.includes(model_base_clean);
                });
                paired_projector_path = matched_projector ? matched_projector.full_path : projector_files_in_directory[0].full_path;
            }

            const size_mb = Math.round(current_model.size_bytes / (1024 * 1024));
            const size_formatted = size_mb > 1024
                ? `${(size_mb / 1024).toFixed(1)} GB`
                : `${size_mb} MB`;

            const relative_dir = path.relative(scan_directory_path, current_folder_path);

            discovered_models_collection.push({
                model_name: current_model.name,
                file_path: current_model.full_path,
                directory_relative_path: relative_dir || '.',
                file_size_megabytes: size_mb,
                file_size_formatted: size_formatted,
                paired_multimodal_projector_path: paired_projector_path,
                supports_multimodal_vision: !!paired_projector_path
            });
        }
    }

    traverseFolderTree(scan_directory_path);
    discovered_models_collection.sort((first_model, second_model) => first_model.model_name.localeCompare(second_model.model_name));
    return discovered_models_collection;
}

// WHAT: Resolves the absolute path to llama-server.exe in common locations or PATH.
// WHY: Ensures the application can spawn llama-server automatically without manual PATH setup.
export function findLlamaServerBinaryPath(): string | null {
    const common_search_paths = [
        'C:\\llamaCPP\\llama-server.exe',
        path.join(process.env.USERPROFILE || '', 'llama.cpp', 'build', 'bin', 'Release', 'llama-server.exe'),
        path.join(process.env.USERPROFILE || '', 'llamaCPP', 'llama-server.exe')
    ];

    for (const candidate_path of common_search_paths) {
        if (fs.existsSync(candidate_path)) {
            return candidate_path;
        }
    }

    return null;
}

// WHAT: Interface representing metadata and capabilities discovered from llama-server.
// WHY: Gives the Electron main process and renderer typed visibility into what model
// is currently hosted and whether vision/multimodal features are available.
export interface LlamaServerDiscoveredModelMetadata {
    model_identifier: string;
    model_aliases_list: string[];
    model_capabilities_list: string[];
    maximum_context_token_length?: number;
}

// WHAT: Interface representing the active connection state and diagnostic status.
// WHY: Allows the Settings module and background handlers to render clear diagnostic badges.
export interface LlamaServerConnectionDiagnosticResult {
    connection_status: 'online' | 'offline';
    resolved_endpoint_url: string | null;
    discovered_model_metadata: LlamaServerDiscoveredModelMetadata | null;
    multimodal_vision_supported: boolean;
    diagnostic_message: string;
}

// WHAT: Options to constrain or validate model discovery.
// WHY: Allows caller to assert multimodal vision or context size requirements during handshake.
export interface LlamaServerDiscoveryRequirementsOptions {
    require_multimodal_vision?: boolean;
    minimum_context_token_length?: number;
}

// WHAT: Standard client class managing communication and dynamic handshake with llama-server.
// WHY: Centralizes port probing, endpoint fallback, and OpenAI-compatible completions dispatch.
export class LlamaServerClient {
    private readonly configured_custom_endpoint_url: string | null;
    private actively_connected_endpoint_url: string | null = null;
    private actively_discovered_model_metadata: LlamaServerDiscoveredModelMetadata | null = null;

    constructor(custom_endpoint_url?: string) {
        // WHAT: Store user-specified endpoint if provided.
        // WHY: Allows configuration overrides from UI settings or configuration files.
        this.configured_custom_endpoint_url = custom_endpoint_url && custom_endpoint_url.trim().length > 0 
            ? custom_endpoint_url.trim() 
            : null;
    }

    // WHAT: Assembles the ordered list of candidate URLs to probe for an active llama-server.
    // WHY: Prioritizes environment variables and user configuration before testing default llama.cpp ports.
    private assembleCandidateEndpointsList(): string[] {
        const environment_specified_endpoint_url = process.env.LOCAL_AI_URL || process.env.LLAMA_SERVER_URL;
        const candidate_endpoints_collection = new Set<string>();

        if (environment_specified_endpoint_url && environment_specified_endpoint_url.trim().length > 0) {
            candidate_endpoints_collection.add(environment_specified_endpoint_url.trim().replace(/\/+$/, ''));
        }

        if (this.configured_custom_endpoint_url) {
            candidate_endpoints_collection.add(this.configured_custom_endpoint_url.replace(/\/+$/, ''));
        }

        // Standard llama.cpp default port (8080) and official PR #26508 standard port (9931)
        candidate_endpoints_collection.add('http://localhost:8080');
        candidate_endpoints_collection.add('http://127.0.0.1:8080');
        candidate_endpoints_collection.add('http://localhost:9931');
        candidate_endpoints_collection.add('http://127.0.0.1:9931');

        return Array.from(candidate_endpoints_collection);
    }

    // WHAT: Probes candidate endpoints and performs a handshake with GET /v1/models.
    // WHY: Discovers whatever model is loaded at runtime so users don't need to manually configure model names.
    public async discoverActiveLlamaServerModel(
        discovery_requirements_options?: LlamaServerDiscoveryRequirementsOptions
    ): Promise<boolean> {
        const candidate_endpoints_list = this.assembleCandidateEndpointsList();

        for (const current_candidate_endpoint_url of candidate_endpoints_list) {
            try {
                // WHAT: Query /v1/models with a 1500ms timeout.
                // WHY: Fast abort prevents hanging the Electron application if a port is closed or unrouted.
                const http_fetch_response = await fetch(`${current_candidate_endpoint_url}/v1/models`, {
                    signal: AbortSignal.timeout(1500),
                    headers: { 'Accept': 'application/json' }
                });

                if (!http_fetch_response.ok) {
                    continue;
                }

                const response_json_payload = await http_fetch_response.json() as {
                    data?: Array<{ id?: string; aliases?: string[]; capabilities?: string[] }>;
                    models?: Array<{ name?: string; aliases?: string[]; capabilities?: string[]; meta?: { n_ctx?: number } }>;
                };

                const primary_model_entry = response_json_payload.data?.[0];
                const raw_model_metadata_entry = response_json_payload.models?.[0];

                if (!primary_model_entry && !raw_model_metadata_entry) {
                    continue;
                }

                const resolved_model_identifier = primary_model_entry?.id || raw_model_metadata_entry?.name || 'default';
                const resolved_model_aliases_list = primary_model_entry?.aliases || raw_model_metadata_entry?.aliases || [];
                const resolved_model_capabilities_list = raw_model_metadata_entry?.capabilities 
                    || primary_model_entry?.capabilities 
                    || ['completion'];
                const resolved_context_token_length = raw_model_metadata_entry?.meta?.n_ctx ?? undefined;

                this.actively_connected_endpoint_url = current_candidate_endpoint_url;
                this.actively_discovered_model_metadata = {
                    model_identifier: resolved_model_identifier,
                    model_aliases_list: resolved_model_aliases_list,
                    model_capabilities_list: resolved_model_capabilities_list,
                    maximum_context_token_length: resolved_context_token_length
                };

                // WHAT: Validate capability constraints (such as multimodal vision support).
                // WHY: Immediately logs clear warnings if the loaded model lacks a vision projector.
                if (discovery_requirements_options?.require_multimodal_vision && !this.hasMultimodalVisionSupport()) {
                    console.warn(
                        `[LlamaServerClient] Connected model "${resolved_model_identifier}" at ${current_candidate_endpoint_url} does not have a multimodal projector (--mmproj) attached.`
                    );
                }

                console.log(`[LlamaServerClient] Successfully connected to llama-server at ${this.actively_connected_endpoint_url} with model "${resolved_model_identifier}"`);
                return true;

            } catch {
                // Endpoint probe failed or timed out; try subsequent candidate.
                continue;
            }
        }

        this.actively_connected_endpoint_url = null;
        this.actively_discovered_model_metadata = null;
        return false;
    }

    // WHAT: Returns the currently active endpoint URL.
    // WHY: Used to format chat completions and embeddings HTTP requests.
    public getActiveEndpointUrl(): string | null {
        return this.actively_connected_endpoint_url;
    }

    // WHAT: Returns the primary semantic identifier or alias for the active model.
    // WHY: Enables OpenAI-compatible requests to specify the active model ID or alias.
    public getActiveModelIdentifier(): string {
        if (!this.actively_discovered_model_metadata) {
            return 'default';
        }
        if (this.actively_discovered_model_metadata.model_aliases_list.length > 0) {
            return this.actively_discovered_model_metadata.model_aliases_list[0];
        }
        return this.actively_discovered_model_metadata.model_identifier;
    }

    // WHAT: Returns true if the active model supports multimodal vision inputs.
    // WHY: Checks for the 'multimodal' capability flag emitted when --mmproj is provided.
    public hasMultimodalVisionSupport(): boolean {
        if (!this.actively_discovered_model_metadata) {
            return false;
        }
        return this.actively_discovered_model_metadata.model_capabilities_list.includes('multimodal');
    }

    // WHAT: Formats the full URL for the chat completions endpoint.
    // WHY: Provides a ready-to-use endpoint string for fetch calls.
    public getChatCompletionsUrl(): string | null {
        if (!this.actively_connected_endpoint_url) {
            return null;
        }
        return `${this.actively_connected_endpoint_url}/v1/chat/completions`;
    }

    // WHAT: Formats the full URL for the embeddings endpoint.
    // WHY: Directs embedding vector requests when running llama-server with --embeddings.
    public getEmbeddingsUrl(): string | null {
        if (!this.actively_connected_endpoint_url) {
            return null;
        }
        return `${this.actively_connected_endpoint_url}/v1/embeddings`;
    }

    // WHAT: Performs a test connection and returns a diagnostic report.
    // WHY: Invoked by the Settings UI IPC bridge to display status pills and model metadata.
    public async testLlamaServerConnection(): Promise<LlamaServerConnectionDiagnosticResult> {
        const connection_successful = await this.discoverActiveLlamaServerModel();

        if (connection_successful && this.actively_connected_endpoint_url) {
            return {
                connection_status: 'online',
                resolved_endpoint_url: this.actively_connected_endpoint_url,
                discovered_model_metadata: this.actively_discovered_model_metadata,
                multimodal_vision_supported: this.hasMultimodalVisionSupport(),
                diagnostic_message: `Connected to model "${this.getActiveModelIdentifier()}" on ${this.actively_connected_endpoint_url}`
            };
        }

        return {
            connection_status: 'offline',
            resolved_endpoint_url: null,
            discovered_model_metadata: null,
            multimodal_vision_supported: false,
            diagnostic_message: 'llama-server is offline. Please launch llama-server.exe on port 8080 (or run start_llama_server.bat).'
        };
    }

    // WHAT: Generates an image description via llama-server using an OpenAI-compatible multimodal chat completion.
    // WHY: Directly queries the running Qwen-VL / multimodal model on llama-server with GPU acceleration,
    // bypassing the need for ComfyUI to load a separate VLM checkpoint.
    public async generateMultimodalVisionDescription(
        image_base64_data_uri: string,
        vision_instruction_prompt: string,
        maximum_output_tokens: number = 1024
    ): Promise<{ success: boolean; text?: string; error?: string }> {
        const discovery_successful = await this.discoverActiveLlamaServerModel({ require_multimodal_vision: true });
        if (!discovery_successful || !this.actively_connected_endpoint_url) {
            return {
                success: false,
                error: 'llama-server is offline or lacks multimodal vision projector (--mmproj).'
            };
        }

        const completions_endpoint_url = this.getChatCompletionsUrl();
        if (!completions_endpoint_url) {
            return {
                success: false,
                error: 'Failed to resolve llama-server chat completions URL.'
            };
        }

        try {
            const http_completion_response = await fetch(completions_endpoint_url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.getActiveModelIdentifier(),
                    messages: [
                        {
                            role: 'user',
                            content: [
                                {
                                    type: 'text',
                                    text: vision_instruction_prompt
                                },
                                {
                                    type: 'image_url',
                                    image_url: {
                                        url: image_base64_data_uri
                                    }
                                }
                            ]
                        }
                    ],
                    temperature: 0.4,
                    max_tokens: maximum_output_tokens
                })
            });

            if (!http_completion_response.ok) {
                const response_error_text = await http_completion_response.text();
                return {
                    success: false,
                    error: `llama-server HTTP error ${http_completion_response.status}: ${response_error_text}`
                };
            }

            const response_payload_json = (await http_completion_response.json()) as {
                choices?: Array<{
                    message?: {
                        content?: string;
                        reasoning_content?: string;
                    };
                }>;
            };

            const primary_choice_message = response_payload_json.choices?.[0]?.message;
            let extracted_response_text = primary_choice_message?.content?.trim() || '';

            // Handle models where response text is generated in reasoning_content
            if (!extracted_response_text && primary_choice_message?.reasoning_content) {
                extracted_response_text = primary_choice_message.reasoning_content.trim();
            }

            if (!extracted_response_text) {
                return {
                    success: false,
                    error: 'llama-server returned an empty vision description.'
                };
            }

            return {
                success: true,
                text: extracted_response_text
            };

        } catch (network_request_error: unknown) {
            const error_message_string = network_request_error instanceof Error 
                ? network_request_error.message 
                : String(network_request_error);
            return {
                success: false,
                error: `Vision completion network error: ${error_message_string}`
            };
        }
    }
}
