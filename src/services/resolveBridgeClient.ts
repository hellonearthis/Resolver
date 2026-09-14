/**
 * src/services/resolveBridgeClient.ts
 * 
 * WHAT:
 *   Universal TypeScript client for communicating with DaVinci Resolve via the
 *   local HTTP loopback bridge (resolve_bridge.py).
 * 
 * WHY:
 *   Communicating directly over HTTP allows both Electron main and frontend/test
 *   runtimes to control Resolve with sub-50ms latency, zero Python subprocesses,
 *   and full compatibility with DaVinci Resolve Free edition.
 */

export const DEFAULT_RESOLVER_BRIDGE_PORT = 8878;
export const DEFAULT_RESOLVER_BRIDGE_TOKEN = 'resolver-local-bridge-key';

export interface MarkerPayloadItem {
    frame: number;
    timestamp: number;
    color: string;
    note: string;
    type: string;
    duration_sec: number;
}

export interface TimelineClipItem {
    videoPath?: string;
    path?: string;
    startTime: number;
    endTime: number;
    track: number;
    label: string;
}

export interface BridgeStatusResponse {
    is_installed: boolean;
    installed_file_path: string;
    is_online: boolean;
    application_name?: string;
    active_project_name?: string | null;
    active_timeline_name?: string | null;
    timeline_frame_rate?: number;
    error_message?: string;
}

// WHAT: Dynamic remote proxy representing an arbitrary Resolve Python API object.
// WHY: Permits dynamic chaining of remote methods across the HTTP bridge while satisfying TypeScript.
export type ResolveRemoteProxy = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [method_or_property_name: string]: any;
};

const BUILTIN_PROPERTIES_SET = new Set([
    'then', 'catch', 'finally',
    'constructor', 'prototype',
    'name', 'length', 'caller', 'callee', 'arguments',
    'bind', 'apply', 'call',
    'toString', 'valueOf', 'toLocaleString',
    'inspect', 'nodeType',
    'toJSON', 'asymmetricMatch', 'nodeType'
]);

export class ResolveBridgeClient {
    private bridge_server_base_url: string;
    private bridge_authentication_token: string;
    private fetch_function: typeof fetch;

    constructor(
        host_address_string: string = '127.0.0.1',
        port_number: number = DEFAULT_RESOLVER_BRIDGE_PORT,
        authentication_token_string: string = DEFAULT_RESOLVER_BRIDGE_TOKEN,
        fetch_function: typeof fetch = (globalThis.fetch ? globalThis.fetch.bind(globalThis) : fetch)
    ) {
        this.bridge_server_base_url = `http://${host_address_string}:${port_number}`;
        this.bridge_authentication_token = authentication_token_string;
        this.fetch_function = fetch_function;
    }

    // WHAT: Live root proxy pointing to reference ID 0 (the global Resolve application handle).
    // WHY: Mirroring the Python API structure allows natural object traversal.
    public get root(): ResolveRemoteProxy {
        return this.createRemoteObjectProxy(0, 'Resolve');
    }

    // WHAT: Serializes JavaScript arguments to wire format.
    // WHY: Objects holding an active __ref property are encoded as { __ref__: id }.
    private serializeArgumentForWire(argument_value: unknown): unknown {
        if (argument_value && typeof argument_value === 'object') {
            const argument_as_record = argument_value as Record<string, unknown>;
            if ('__ref' in argument_as_record) {
                return { __ref__: argument_as_record.__ref };
            }
            if (Array.isArray(argument_value)) {
                return argument_value.map((nested_item) => this.serializeArgumentForWire(nested_item));
            }
            const transformed_dictionary: Record<string, unknown> = {};
            for (const key_name of Object.keys(argument_as_record)) {
                transformed_dictionary[key_name] = this.serializeArgumentForWire(argument_as_record[key_name]);
            }
            return transformed_dictionary;
        }
        return argument_value;
    }

    // WHAT: Deserializes wire return values back into JavaScript types or Remote Proxies.
    // WHY: Any complex object returned by Resolve is wrapped in a dynamic Proxy.
    private deserializeReturnValueFromWire(wire_return_value: unknown): unknown {
        if (wire_return_value && typeof wire_return_value === 'object') {
            const return_value_as_record = wire_return_value as Record<string, unknown>;
            if ('__ref__' in return_value_as_record) {
                return this.createRemoteObjectProxy(
                    Number(return_value_as_record.__ref__),
                    String(return_value_as_record.__type__ || '')
                );
            }
            if (Array.isArray(wire_return_value)) {
                return wire_return_value.map((nested_item) => this.deserializeReturnValueFromWire(nested_item));
            }
            const reconstructed_object: Record<string, unknown> = {};
            for (const key_name of Object.keys(return_value_as_record)) {
                reconstructed_object[key_name] = this.deserializeReturnValueFromWire(return_value_as_record[key_name]);
            }
            return reconstructed_object;
        }
        return wire_return_value;
    }

    // WHAT: Creates a dynamic ES6 Proxy that intercepts arbitrary method invocations.
    // WHY: Allows fluent API calls like project.GetCurrentTimeline() without hardcoding schemas.
    private createRemoteObjectProxy(
        remote_reference_identifier: number,
        object_type_name: string = ''
    ): ResolveRemoteProxy {
        const dummy_target_function = () => { };
        return new Proxy(dummy_target_function, {
            get: (_target, property_name: string | symbol) => {
                if (property_name === '__ref') return remote_reference_identifier;
                if (property_name === '__type') return object_type_name;
                if (typeof property_name === 'symbol') return undefined;

                // WHAT: Crucial guard against infinite Promise resolution chains and introspection bugs.
                // WHY: When an awaited function or inspector accesses .then, .constructor, etc.,
                // returning an async function causes V8 to treat it as an endless thenable.
                if (BUILTIN_PROPERTIES_SET.has(property_name)) {
                    if (property_name === 'toString') {
                        return () => `<RemoteObject ${object_type_name} ref=${remote_reference_identifier}>`;
                    }
                    if (property_name === 'valueOf') {
                        return () => remote_reference_identifier;
                    }
                    if (property_name === 'toJSON') {
                        return () => ({ __ref: remote_reference_identifier, __type: object_type_name });
                    }
                    return undefined;
                }

                return async (...invocation_arguments: unknown[]) => {
                    return this.invokeRemoteMethod(
                        remote_reference_identifier,
                        property_name,
                        invocation_arguments
                    );
                };
            }
        });
    }

    // WHAT: Dispatches a method invocation over HTTP POST to resolve_bridge.py.
    // WHY: Executes the method inside DaVinci Resolve and retrieves the result.
    public async invokeRemoteMethod(
        remote_reference_identifier: number,
        attribute_name_string: string,
        invocation_arguments_array: unknown[] = []
    ): Promise<unknown> {
        const serialized_arguments = invocation_arguments_array.map((arg) =>
            this.serializeArgumentForWire(arg)
        );

        const request_payload_dictionary = {
            token: this.bridge_authentication_token,
            ref: remote_reference_identifier,
            attr: attribute_name_string,
            args: serialized_arguments,
            kwargs: {}
        };

        const http_response = await this.fetch_function(this.bridge_server_base_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request_payload_dictionary)
        });

        if (!http_response.ok) {
            throw new Error(`HTTP ${http_response.status} from Resolve Bridge: ${http_response.statusText}`);
        }

        const response_json_data = await http_response.json();
        if (!response_json_data.ok) {
            throw new Error(response_json_data.error || 'Unknown bridge execution error');
        }

        return this.deserializeReturnValueFromWire(response_json_data.value);
    }

    // WHAT: Polls the health endpoint of the bridge server.
    // WHY: Verifies that DaVinci Resolve is open and running the bridge script.
    public async checkConnectionStatus(
        is_installed: boolean = false,
        installed_file_path: string = ''
    ): Promise<BridgeStatusResponse> {
        let timeout_timer_identifier: ReturnType<typeof setTimeout> | null = null;
        try {
            const abort_controller = new AbortController();
            timeout_timer_identifier = setTimeout(() => abort_controller.abort(), 1500);

            const ping_response = await this.fetch_function(`${this.bridge_server_base_url}/status`, {
                method: 'GET',
                signal: abort_controller.signal
            });

            if (!ping_response.ok) {
                return {
                    is_installed,
                    installed_file_path,
                    is_online: false,
                    error_message: `HTTP ${ping_response.status} from bridge`
                };
            }

            const ping_data = await ping_response.json();
            return {
                is_installed,
                installed_file_path,
                is_online: true,
                application_name: ping_data.app,
                active_project_name: ping_data.project,
                active_timeline_name: ping_data.timeline,
            };
        } catch (connection_error: unknown) {
            return {
                is_installed,
                installed_file_path,
                is_online: false,
                error_message: connection_error instanceof Error ? connection_error.message : String(connection_error)
            };
        } finally {
            if (timeout_timer_identifier) {
                clearTimeout(timeout_timer_identifier);
            }
        }
    }

    // WHAT: Directly pushes an array of beat, onset, or loudness markers onto Resolve's active timeline.
    // WHY: Instant, interactive round-trip without requiring manual script export or re-import.
    public async pushMarkersToActiveTimeline(markers_collection: MarkerPayloadItem[]): Promise<{
        success: boolean;
        pushed_count: number;
        timeline_name: string;
        error?: string;
    }> {
        try {
            const resolve_app_handle = this.root;
            const project_manager = await resolve_app_handle.GetProjectManager();
            if (!project_manager) throw new Error('Could not access ProjectManager.');

            const current_project = await project_manager.GetCurrentProject();
            if (!current_project) throw new Error('No project is currently open in DaVinci Resolve.');

            const current_timeline = await current_project.GetCurrentTimeline();
            if (!current_timeline) throw new Error('No active timeline selected in DaVinci Resolve.');

            const timeline_name_string = await current_timeline.GetName();
            const frame_rate_setting_string = await current_timeline.GetSetting('timelineFrameRate');
            const timeline_frame_rate_number = parseFloat(frame_rate_setting_string) || 24;
            const start_frame_offset_number = parseInt(await current_timeline.GetStartFrame(), 10) || 0;

            let successful_markers_count = 0;

            for (const marker_item of markers_collection) {
                const target_frame_number = start_frame_offset_number + marker_item.frame;

                // WHAT: Normalize colors to Resolve's accepted color set.
                // WHY: Resolve rejects arbitrary hex values and requires standard named colors.
                let resolve_marker_color = 'Blue';
                const lower_case_color_string = marker_item.color.toLowerCase();
                if (lower_case_color_string.includes('red') || lower_case_color_string.includes('#ff0000')) {
                    resolve_marker_color = 'Red';
                } else if (lower_case_color_string.includes('yellow') || lower_case_color_string.includes('#ffff00')) {
                    resolve_marker_color = 'Yellow';
                } else if (lower_case_color_string.includes('green') || lower_case_color_string.includes('#00ff00')) {
                    resolve_marker_color = 'Green';
                } else if (lower_case_color_string.includes('cyan') || lower_case_color_string.includes('#00ffff')) {
                    resolve_marker_color = 'Cyan';
                } else if (lower_case_color_string.includes('magenta') || lower_case_color_string.includes('fuchsia')) {
                    resolve_marker_color = 'Fuchsia';
                } else if (lower_case_color_string.includes('orange')) {
                    resolve_marker_color = 'Sand';
                } else if (lower_case_color_string.includes('purple')) {
                    resolve_marker_color = 'Purple';
                }

                const marker_duration_frames = Math.max(
                    1,
                    Math.round((marker_item.duration_sec || 0.05) * timeline_frame_rate_number)
                );

                const custom_marker_data_json = JSON.stringify({
                    type: marker_item.type,
                    timestamp: marker_item.timestamp
                });

                // timeline.AddMarker(frame, color, name, note, duration)
                const add_marker_result = await current_timeline.AddMarker(
                    target_frame_number,
                    resolve_marker_color,
                    marker_item.note || marker_item.type,
                    custom_marker_data_json,
                    marker_duration_frames
                );

                if (add_marker_result) {
                    successful_markers_count++;
                }
            }

            return {
                success: true,
                pushed_count: successful_markers_count,
                timeline_name: timeline_name_string
            };
        } catch (push_markers_error: unknown) {
            const error_message_string = push_markers_error instanceof Error
                ? push_markers_error.message
                : String(push_markers_error);
            return {
                success: false,
                pushed_count: 0,
                timeline_name: '',
                error: error_message_string
            };
        }
    }

    // WHAT: Directly imports audio and video media files into the active project Media Pool.
    // WHY: Bypasses manual dragging or file staging scripts.
    public async importMediaIntoMediaPool(
        audio_file_path: string,
        video_file_paths_collection: string[]
    ): Promise<{
        success: boolean;
        audio_imported: boolean;
        imported_video_count: number;
        error?: string;
    }> {
        try {
            const resolve_app_handle = this.root;
            const project_manager = await resolve_app_handle.GetProjectManager();
            const current_project = await project_manager.GetCurrentProject();
            if (!current_project) throw new Error('No project open in DaVinci Resolve.');

            const media_pool = await current_project.GetMediaPool();
            if (!media_pool) throw new Error('Could not access Resolve Media Pool.');

            let audio_imported_boolean = false;
            if (audio_file_path) {
                const imported_audio_items = await media_pool.ImportMedia([audio_file_path]);
                audio_imported_boolean = Boolean(imported_audio_items && imported_audio_items.length > 0);
            }

            const valid_video_paths = video_file_paths_collection.filter((vp) => Boolean(vp));

            let imported_video_clips_count = 0;
            if (valid_video_paths.length > 0) {
                const imported_video_items = await media_pool.ImportMedia(valid_video_paths);
                imported_video_clips_count = imported_video_items ? imported_video_items.length : 0;
            }

            return {
                success: true,
                audio_imported: audio_imported_boolean,
                imported_video_count: imported_video_clips_count
            };
        } catch (media_import_error: unknown) {
            const error_message_string = media_import_error instanceof Error
                ? media_import_error.message
                : String(media_import_error);
            return {
                success: false,
                audio_imported: false,
                imported_video_count: 0,
                error: error_message_string
            };
        }
    }

    // WHAT: Reconstructs a full video assembler timeline directly inside DaVinci Resolve.
    // WHY: Automatically places imported media clips onto tracks at exact frame offsets in one step.
    public async reconstructTimeline(
        project_name: string,
        audio_file_path: string,
        timeline_frame_rate: number,
        timeline_clips_collection: TimelineClipItem[]
    ): Promise<{
        success: boolean;
        timeline_name: string;
        placed_clips_count: number;
        error?: string;
    }> {
        try {
            const resolve_app_handle = this.root;
            const project_manager = await resolve_app_handle.GetProjectManager();
            const current_project = await project_manager.GetCurrentProject();
            if (!current_project) throw new Error('No project open in DaVinci Resolve.');

            const media_pool = await current_project.GetMediaPool();
            if (!media_pool) throw new Error('Could not access Media Pool.');

            let active_timeline = await current_project.GetCurrentTimeline();
            if (!active_timeline) {
                const generated_timeline_name = `Reconstructed_${project_name || 'Project'}_${Date.now()}`;
                active_timeline = await media_pool.CreateEmptyTimeline(generated_timeline_name);
                if (!active_timeline) throw new Error('Failed to create new timeline in Resolve.');
            }

            const timeline_name = await active_timeline.GetName();
            await current_project.SetCurrentTimeline(active_timeline);

            const start_frame_offset_number = parseInt(await active_timeline.GetStartFrame(), 10) || 0;
            const fps = timeline_frame_rate || 24;

            if (audio_file_path) {
                const audio_items = await media_pool.ImportMedia([audio_file_path]);
                if (audio_items && audio_items.length > 0) {
                    await media_pool.AppendToTimeline([
                        {
                            mediaPoolItem: audio_items[0],
                            recordFrame: start_frame_offset_number,
                            mediaType: 2 // Audio
                        }
                    ]);
                }
            }

            const clip_path_to_item_map = new Map<string, unknown>();
            const unique_video_paths = Array.from(
                new Set(
                    timeline_clips_collection
                        .map((candidate_clip) => candidate_clip.videoPath || candidate_clip.path || '')
                        .filter((valid_path) => Boolean(valid_path))
                )
            );

            if (unique_video_paths.length > 0) {
                const imported_items = await media_pool.ImportMedia(unique_video_paths);
                if (imported_items) {
                    for (let index = 0; index < imported_items.length; index++) {
                        clip_path_to_item_map.set(unique_video_paths[index], imported_items[index]);
                    }
                }
            }

            let placed_count = 0;
            for (const clip_item of timeline_clips_collection) {
                const clip_path = clip_item.videoPath || clip_item.path || '';
                const pool_item = clip_path_to_item_map.get(clip_path);
                if (!pool_item) continue;

                const start_record_frame = start_frame_offset_number + Math.round(clip_item.startTime * fps);
                const clip_duration_frames = Math.max(1, Math.round((clip_item.endTime - clip_item.startTime) * fps));

                await media_pool.AppendToTimeline([
                    {
                        mediaPoolItem: pool_item,
                        startFrame: 0,
                        endFrame: clip_duration_frames - 1,
                        recordFrame: start_record_frame,
                        mediaType: 1 // Video
                    }
                ]);
                placed_count++;
            }

            return {
                success: true,
                timeline_name,
                placed_clips_count: placed_count
            };
        } catch (reconstruction_error: unknown) {
            const error_message_string = reconstruction_error instanceof Error
                ? reconstruction_error.message
                : String(reconstruction_error);
            return {
                success: false,
                timeline_name: '',
                placed_clips_count: 0,
                error: error_message_string
            };
        }
    }
}
