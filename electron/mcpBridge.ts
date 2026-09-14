/**
 * electron/mcpBridge.ts
 * 
 * WHAT:
 *   Bridge module connecting the Electron main process to the Model Context Protocol (MCP)
 *   server, DaVinci Resolve HTTP bridge, and Resolver project filesystem.
 * 
 * WHY:
 *   Provides the Resolver desktop UI with real-time telemetry, tool schema discovery,
 *   one-click client configuration generation (for Claude Desktop, Antigravity, and Cursor),
 *   in-app interactive tool testing, and real-time agent invocation logging.
 */

import path from 'path';
import fs from 'fs';
import { app, BrowserWindow } from 'electron';
import {
    ResolveBridgeClient,
    installBridgeScript,
    type MarkerPayloadItem,
    type TimelineClipItem
} from './resolveBridge';

export interface McpToolSchemaProperty {
    type: string;
    description?: string;
    items?: { type: string; properties?: Record<string, unknown> };
}

export interface McpToolDefinition {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        required?: string[];
        properties: Record<string, McpToolSchemaProperty>;
    };
}

export interface McpActivityLogEntry {
    identifier: string;
    timestamp: string;
    tool_name: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters_dictionary: Record<string, any>;
    success: boolean;
    result_summary: string;
    execution_duration_milliseconds: number;
}

export interface McpStatusResponse {
    is_server_available: boolean;
    server_script_path: string;
    node_executable_path: string;
    registered_tools_count: number;
    davinci_resolve_bridge_online: boolean;
    davinci_resolve_active_project?: string | null;
    davinci_resolve_active_timeline?: string | null;
    project_output_directory_path: string;
}

export interface McpClientConfigurationsResponse {
    claude_desktop_configuration_json: string;
    claude_desktop_config_file_path: string;
    antigravity_configuration_json: string;
    cursor_configuration_json: string;
    command_line_test_snippet: string;
}

// ---------------------------------------------------------------------------
// Tool Catalog Specification
// ---------------------------------------------------------------------------

export const REGISTERED_MCP_TOOLS_DEFINITIONS: McpToolDefinition[] = [
    {
        name: 'resolve_get_status',
        description: 'Checks connection to DaVinci Resolve via the local HTTP loopback bridge (port 8878), reports whether the bridge script is installed, active project name, active timeline name, and timeline frame rate.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'resolve_install_bridge',
        description: 'Automatically installs the DaVinci Resolve HTTP bridge script (resolve_bridge.py) into Resolve\'s Utility scripts folder across Windows, macOS, or Linux.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'resolve_push_markers',
        description: 'Pushes beat markers, onset markers, loudness cues, or chapter markers directly onto DaVinci Resolve\'s active timeline with frame precision, custom colors, and notes.',
        inputSchema: {
            type: 'object',
            required: ['markers'],
            properties: {
                markers: {
                    type: 'array',
                    description: 'Collection of markers to place on the active timeline.',
                    items: {
                        type: 'object',
                        properties: {
                            frame: { type: 'number', description: 'Timeline frame number relative to timeline start.' },
                            timestamp: { type: 'number', description: 'Timestamp in seconds.' },
                            color: { type: 'string', description: 'Marker color (Blue, Cyan, Green, Yellow, Red, Fuchsia, Sand, Purple).' },
                            note: { type: 'string', description: 'Marker note text.' },
                            type: { type: 'string', description: 'Marker category (beat, onset, loudness, chapter, action).' },
                            duration_sec: { type: 'number', description: 'Marker duration in seconds (default 0.05).' }
                        }
                    }
                }
            }
        }
    },
    {
        name: 'resolve_import_media',
        description: 'Directly imports an audio file (e.g. song, stem) and/or a collection of video clip files into DaVinci Resolve\'s active Media Pool.',
        inputSchema: {
            type: 'object',
            properties: {
                audio_file_path: { type: 'string', description: 'Absolute path to the audio file to import.' },
                video_file_paths_collection: {
                    type: 'array',
                    description: 'Array of absolute file paths to video clips.',
                    items: { type: 'string' }
                }
            }
        }
    },
    {
        name: 'resolve_reconstruct_timeline',
        description: 'Reconstructs or creates a timeline in DaVinci Resolve with an audio track on track 1 and video clips placed at precise start and end timestamps.',
        inputSchema: {
            type: 'object',
            required: ['project_name', 'timeline_clips_collection'],
            properties: {
                project_name: { type: 'string', description: 'Project name for new timeline naming.' },
                audio_file_path: { type: 'string', description: 'Optional absolute path to audio track.' },
                timeline_frame_rate: { type: 'number', description: 'Timeline FPS (default 24).' },
                timeline_clips_collection: {
                    type: 'array',
                    description: 'Collection of video clips to assemble.',
                    items: {
                        type: 'object',
                        properties: {
                            videoPath: { type: 'string', description: 'Absolute path to video clip file.' },
                            startTime: { type: 'number', description: 'Start time in seconds.' },
                            endTime: { type: 'number', description: 'End time in seconds.' },
                            track: { type: 'number', description: 'Video track index (1 or 2).' },
                            label: { type: 'string', description: 'Shot or clip label.' }
                        }
                    }
                }
            }
        }
    },
    {
        name: 'resolve_execute_rpc',
        description: 'Executes arbitrary remote Python API method calls directly on DaVinci Resolve over the HTTP loopback bridge (ref 0 = Resolve app handle).',
        inputSchema: {
            type: 'object',
            required: ['attribute_name'],
            properties: {
                attribute_name: { type: 'string', description: 'Method or property name on the Resolve object (e.g. GetProjectManager).' },
                reference_identifier: { type: 'number', description: 'Remote object ref ID (0 for global Resolve object).' },
                invocation_arguments: { type: 'array', description: 'Array of positional arguments to pass.' }
            }
        }
    },
    {
        name: 'resolver_list_projects',
        description: 'Lists all beat and storyboard projects discovered in the Resolver project output directory.',
        inputSchema: {
            type: 'object',
            properties: {
                custom_projects_directory_path: { type: 'string', description: 'Optional custom directory path to scan.' }
            }
        }
    },
    {
        name: 'resolver_get_project',
        description: 'Retrieves the complete JSON state of a Resolver project bundle (duration, frame rate, audio stems, beat markers, storyboard clips, visual prompts).',
        inputSchema: {
            type: 'object',
            required: ['project_identifier'],
            properties: {
                project_identifier: { type: 'string', description: 'Project ID or name to load.' },
                custom_projects_directory_path: { type: 'string', description: 'Optional custom directory path to search.' }
            }
        }
    },
    {
        name: 'resolver_update_project',
        description: 'Updates or persists an entire Resolver project JSON bundle on disk.',
        inputSchema: {
            type: 'object',
            required: ['project_data'],
            properties: {
                project_data: { type: 'object', description: 'Full project JSON object to save.' },
                custom_projects_directory_path: { type: 'string', description: 'Optional custom directory path.' }
            }
        }
    },
    {
        name: 'resolver_update_clip_prompt',
        description: 'Updates a specific shot/clip\'s visual prompt, action notes, camera movement, or duration in an existing project.',
        inputSchema: {
            type: 'object',
            required: ['project_identifier', 'clip_identifier'],
            properties: {
                project_identifier: { type: 'string', description: 'Project ID or project name.' },
                clip_identifier: { type: 'string', description: 'Clip ID to update.' },
                prompt_text: { type: 'string', description: 'New visual prompt for the clip.' },
                action_notes: { type: 'string', description: 'Narrative or director notes.' },
                camera_movement: { type: 'string', description: 'Camera direction (e.g. Slow push-in, Dolly zoom).' },
                duration_seconds: { type: 'number', description: 'Duration of the clip in seconds.' }
            }
        }
    },
    {
        name: 'resolver_add_clip',
        description: 'Appends a new storyboard card/clip to a Resolver project.',
        inputSchema: {
            type: 'object',
            required: ['project_identifier', 'prompt_text'],
            properties: {
                project_identifier: { type: 'string', description: 'Project ID or project name.' },
                prompt_text: { type: 'string', description: 'Visual prompt description.' },
                action_notes: { type: 'string', description: 'Action or narrative notes.' },
                duration_seconds: { type: 'number', description: 'Duration in seconds (default 4.0).' },
                start_image_path: { type: 'string', description: 'Optional path to initial frame image.' },
                end_image_path: { type: 'string', description: 'Optional path to ending frame image.' }
            }
        }
    },
    {
        name: 'comfyui_get_status',
        description: 'Checks connectivity to the local ComfyUI server and retrieves GPU device telemetry.',
        inputSchema: {
            type: 'object',
            properties: {
                comfyui_host_url: { type: 'string', description: 'ComfyUI URL (default http://127.0.0.1:8188).' }
            }
        }
    },
    {
        name: 'comfyui_list_workflows',
        description: 'Lists all available ComfyUI workflow JSON templates bundled with Resolver.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    }
];

// ---------------------------------------------------------------------------
// Helper Methods & Main Bridge Functions
// ---------------------------------------------------------------------------

// WHAT: Resolves the absolute path to the resolver-mcp-server.mjs script.
// WHY: Ensures both local dev and production builds locate the executable entry point.
export function getMcpServerScriptFilePath(): string {
    const application_base_directory = app ? app.getAppPath() : process.cwd();
    const candidate_script_paths_collection = [
        path.join(application_base_directory, 'scripts', 'resolver-mcp-server.mjs'),
        path.join(process.cwd(), 'scripts', 'resolver-mcp-server.mjs'),
        path.join(__dirname, '../scripts/resolver-mcp-server.mjs'),
        path.join(__dirname, '../../scripts/resolver-mcp-server.mjs'),
    ];

    for (const candidate_path of candidate_script_paths_collection) {
        if (fs.existsSync(candidate_path)) {
            return candidate_path;
        }
    }

    return path.join(application_base_directory, 'scripts', 'resolver-mcp-server.mjs');
}

// WHAT: Reads the persistent project output directory setting from config.json.
// WHY: Gives the MCP bridge the accurate filesystem location to discover projects.
export function getResolverProjectOutputDirectoryPath(): string {
    try {
        const user_data_directory_path = app ? app.getPath('userData') : '';
        const configuration_file_path = path.join(user_data_directory_path, 'config.json');
        if (fs.existsSync(configuration_file_path)) {
            const raw_configuration_string = fs.readFileSync(configuration_file_path, 'utf8');
            const parsed_configuration_record = JSON.parse(raw_configuration_string);
            if (parsed_configuration_record.projectOutputDir) {
                return parsed_configuration_record.projectOutputDir;
            }
        }
    } catch {
        // Fall back to default
    }

    const application_base_directory = app ? app.getAppPath() : process.cwd();
    return path.join(application_base_directory, 'output');
}

// WHAT: Gathers full telemetry on the MCP server and DaVinci Resolve connection.
// WHY: Informs the Resolver dashboard of MCP health, bridge state, and available tools.
export async function getMcpServerStatus(): Promise<McpStatusResponse> {
    const server_script_path = getMcpServerScriptFilePath();
    const is_server_available = fs.existsSync(server_script_path);
    const resolve_bridge_client = new ResolveBridgeClient();
    const resolve_bridge_status = await resolve_bridge_client.checkConnectionStatus();
    const project_output_directory_path = getResolverProjectOutputDirectoryPath();

    return {
        is_server_available,
        server_script_path,
        node_executable_path: process.execPath || 'node',
        registered_tools_count: REGISTERED_MCP_TOOLS_DEFINITIONS.length,
        davinci_resolve_bridge_online: resolve_bridge_status.is_online,
        davinci_resolve_active_project: resolve_bridge_status.active_project_name,
        davinci_resolve_active_timeline: resolve_bridge_status.active_timeline_name,
        project_output_directory_path
    };
}

// WHAT: Generates copyable MCP configuration files for Claude Desktop, Antigravity, and Cursor.
// WHY: Gives users instantaneous 1-click integration with their AI assistant of choice.
export function generateMcpClientConfigurations(): McpClientConfigurationsResponse {
    const server_script_path = getMcpServerScriptFilePath().replace(/\\/g, '/');

    // Windows Claude Desktop config path
    const claude_desktop_config_file_path = process.platform === 'win32'
        ? path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json')
        : path.join(process.env.HOME || '', 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');

    const claude_desktop_configuration_json = JSON.stringify({
        mcpServers: {
            resolver: {
                command: "node",
                args: [server_script_path]
            }
        }
    }, null, 2);

    const antigravity_configuration_json = JSON.stringify({
        mcpServers: {
            resolver: {
                command: "node",
                args: [server_script_path]
            }
        }
    }, null, 2);

    const cursor_configuration_json = JSON.stringify({
        mcpServers: {
            resolver: {
                command: "node",
                args: [server_script_path]
            }
        }
    }, null, 2);

    const command_line_test_snippet = `node "${server_script_path}"`;

    return {
        claude_desktop_configuration_json,
        claude_desktop_config_file_path,
        antigravity_configuration_json,
        cursor_configuration_json,
        command_line_test_snippet
    };
}

// WHAT: Broadcasts an MCP activity log event to all open Electron renderer windows.
// WHY: Updates the Resolver UI activity stream in real-time when tools are executed.
export function broadcastMcpActivityEvent(activity_record: McpActivityLogEntry): void {
    const all_browser_windows_collection = BrowserWindow.getAllWindows();
    for (const browser_window_instance of all_browser_windows_collection) {
        if (!browser_window_instance.isDestroyed()) {
            browser_window_instance.webContents.send('mcp-activity-event', activity_record);
        }
    }
}

// WHAT: Executes an MCP tool locally inside the Electron main process.
// WHY: Allows the interactive UI tool tester to invoke tools directly with full logging.
export async function executeMcpToolDirectly(
    target_tool_name_string: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool_arguments_dictionary: Record<string, any> = {}
): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const execution_start_timestamp = Date.now();
    const resolve_bridge_client = new ResolveBridgeClient();

    try {
        let execution_result_payload: unknown = null;

        switch (target_tool_name_string) {
            case 'resolve_get_status': {
                execution_result_payload = await resolve_bridge_client.checkConnectionStatus();
                break;
            }

            case 'resolve_install_bridge': {
                execution_result_payload = installBridgeScript();
                break;
            }

            case 'resolve_push_markers': {
                const markers_array = (tool_arguments_dictionary.markers || []) as MarkerPayloadItem[];
                execution_result_payload = await resolve_bridge_client.pushMarkersToActiveTimeline(markers_array);
                break;
            }

            case 'resolve_import_media': {
                execution_result_payload = await resolve_bridge_client.importMediaIntoMediaPool(
                    tool_arguments_dictionary.audio_file_path || '',
                    tool_arguments_dictionary.video_file_paths_collection || []
                );
                break;
            }

            case 'resolve_reconstruct_timeline': {
                execution_result_payload = await resolve_bridge_client.reconstructTimeline(
                    tool_arguments_dictionary.project_name || 'MCP_Timeline',
                    tool_arguments_dictionary.audio_file_path || '',
                    Number(tool_arguments_dictionary.timeline_frame_rate) || 24,
                    (tool_arguments_dictionary.timeline_clips_collection || []) as TimelineClipItem[]
                );
                break;
            }

            case 'resolve_execute_rpc': {
                execution_result_payload = await resolve_bridge_client.invokeRemoteMethod(
                    Number(tool_arguments_dictionary.reference_identifier) || 0,
                    tool_arguments_dictionary.attribute_name,
                    tool_arguments_dictionary.invocation_arguments || []
                );
                break;
            }

            case 'resolver_list_projects': {
                const projects_folder_path = tool_arguments_dictionary.custom_projects_directory_path || getResolverProjectOutputDirectoryPath();
                if (!fs.existsSync(projects_folder_path)) {
                    execution_result_payload = [];
                    break;
                }
                const folder_entries = fs.readdirSync(projects_folder_path, { withFileTypes: true });
                const projects_list = [];
                for (const folder_entry of folder_entries) {
                    if (!folder_entry.isDirectory()) continue;
                    const json_file_path = path.join(projects_folder_path, folder_entry.name, 'project.json');
                    if (fs.existsSync(json_file_path)) {
                        try {
                            const project_data = JSON.parse(fs.readFileSync(json_file_path, 'utf8'));
                            projects_list.push({
                                id: project_data.id || folder_entry.name,
                                name: project_data.name || folder_entry.name,
                                folderName: folder_entry.name,
                                duration: project_data.duration || 0,
                                frameRate: project_data.frameRate || 24,
                                clipsCount: Array.isArray(project_data.clips) ? project_data.clips.length : 0,
                                markersCount: Array.isArray(project_data.markers) ? project_data.markers.length : 0,
                                updatedAt: project_data.updatedAt || ''
                            });
                        } catch {
                            // ignore
                        }
                    }
                }
                execution_result_payload = projects_list;
                break;
            }

            case 'resolver_get_project': {
                const projects_folder_path = tool_arguments_dictionary.custom_projects_directory_path || getResolverProjectOutputDirectoryPath();
                const target_id = String(tool_arguments_dictionary.project_identifier);
                const direct_path = path.join(projects_folder_path, target_id, 'project.json');
                const safe_path = path.join(projects_folder_path, `PRJ_${target_id.replace(/[^a-zA-Z0-9-_]/g, '_')}`, 'project.json');

                if (fs.existsSync(direct_path)) {
                    execution_result_payload = JSON.parse(fs.readFileSync(direct_path, 'utf8'));
                } else if (fs.existsSync(safe_path)) {
                    execution_result_payload = JSON.parse(fs.readFileSync(safe_path, 'utf8'));
                } else {
                    throw new Error(`Project not found: ${target_id}`);
                }
                break;
            }

            case 'comfyui_get_status': {
                const comfy_url = tool_arguments_dictionary.comfyui_host_url || 'http://127.0.0.1:8188';
                const response = await fetch(`${comfy_url}/system_stats`);
                if (response.ok) {
                    execution_result_payload = await response.json();
                } else {
                    throw new Error(`ComfyUI HTTP ${response.status}`);
                }
                break;
            }

            case 'comfyui_list_workflows': {
                const workflows_path = path.join(app ? app.getAppPath() : process.cwd(), 'comfyui_workflows');
                if (fs.existsSync(workflows_path)) {
                    const files = fs.readdirSync(workflows_path).filter((f) => f.endsWith('.json'));
                    execution_result_payload = files.map((f) => ({ fileName: f, filePath: path.join(workflows_path, f) }));
                } else {
                    execution_result_payload = [];
                }
                break;
            }

            default:
                throw new Error(`Unrecognized MCP tool: "${target_tool_name_string}"`);
        }

        const duration_ms = Date.now() - execution_start_timestamp;
        const activity_record: McpActivityLogEntry = {
            identifier: `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            timestamp: new Date().toLocaleTimeString(),
            tool_name: target_tool_name_string,
            parameters_dictionary: tool_arguments_dictionary,
            success: true,
            result_summary: typeof execution_result_payload === 'object'
                ? JSON.stringify(execution_result_payload).substring(0, 120)
                : String(execution_result_payload),
            execution_duration_milliseconds: duration_ms
        };

        broadcastMcpActivityEvent(activity_record);
        return { success: true, result: execution_result_payload };
    } catch (tool_error: unknown) {
        const duration_ms = Date.now() - execution_start_timestamp;
        const error_message = tool_error instanceof Error ? tool_error.message : String(tool_error);

        const activity_record: McpActivityLogEntry = {
            identifier: `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            timestamp: new Date().toLocaleTimeString(),
            tool_name: target_tool_name_string,
            parameters_dictionary: tool_arguments_dictionary,
            success: false,
            result_summary: error_message,
            execution_duration_milliseconds: duration_ms
        };

        broadcastMcpActivityEvent(activity_record);
        return { success: false, error: error_message };
    }
}
