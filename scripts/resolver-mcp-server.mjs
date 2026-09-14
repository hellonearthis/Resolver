#!/usr/bin/env node

/**
 * scripts/resolver-mcp-server.mjs
 * 
 * WHAT:
 *   Official Model Context Protocol (MCP) server for Resolver & DaVinci Resolve.
 *   Provides stdio transport for direct connection by Claude Desktop, Antigravity,
 *   Cursor, Zed, and autonomous AI agents.
 * 
 * WHY:
 *   Enables external Large Language Models and AI agents to programmatically control
 *   DaVinci Resolve (markers, media pool, timeline reconstruction, RPC execution),
 *   read/write Resolver project bundles and storyboard cards, and inspect ComfyUI
 *   generation pipelines with sub-50ms latency over standard MCP interfaces.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ---------------------------------------------------------------------------
// File & Environment Resolution
// ---------------------------------------------------------------------------

const current_module_file_path = fileURLToPath(import.meta.url);
const current_scripts_directory_path = path.dirname(current_module_file_path);
const workspace_root_directory_path = path.resolve(current_scripts_directory_path, '..');

const DEFAULT_RESOLVER_BRIDGE_PORT = 8878;
const DEFAULT_RESOLVER_BRIDGE_TOKEN = 'resolver-local-bridge-key';
const DEFAULT_COMFYUI_SERVER_URL = 'http://127.0.0.1:8188';

// WHAT: Resolves the active user configuration file path across platforms.
// WHY: Allows the standalone MCP server to discover the user's custom project output directory.
function getResolverUserConfigurationFilePath() {
    if (process.platform === 'win32') {
        const user_app_data_directory = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
        return path.join(user_app_data_directory, 'Resolver', 'config.json');
    } else if (process.platform === 'darwin') {
        const user_home_directory = process.env.HOME || '';
        return path.join(user_home_directory, 'Library', 'Application Support', 'Resolver', 'config.json');
    } else {
        const user_home_directory = process.env.HOME || '';
        return path.join(user_home_directory, '.config', 'Resolver', 'config.json');
    }
}

// WHAT: Loads persistent user settings or supplies reliable defaults.
// WHY: Ensures paths like projectOutputDir and comfyOutputDir match the desktop application.
function loadResolverUserConfiguration() {
    const configuration_file_path = getResolverUserConfigurationFilePath();
    const default_configuration_record = {
        comfyOutputDir: 'C:\\ComfyUI_windows_portable\\ComfyUI\\output',
        projectOutputDir: path.join(workspace_root_directory_path, 'output'),
        llmProvider: 'llama-server',
        llamaServerUrl: 'http://localhost:8080'
    };

    try {
        if (fs.existsSync(configuration_file_path)) {
            const raw_file_contents_string = fs.readFileSync(configuration_file_path, 'utf8');
            const parsed_configuration_record = JSON.parse(raw_file_contents_string);
            return { ...default_configuration_record, ...parsed_configuration_record };
        }
    } catch (configuration_read_error) {
        // Fall back gracefully to default configuration
    }

    return default_configuration_record;
}

// ---------------------------------------------------------------------------
// DaVinci Resolve Utility Directory Resolution
// ---------------------------------------------------------------------------

// WHAT: Determines where DaVinci Resolve looks for Utility scripts.
// WHY: Utility scripts are executable from Workspace > Scripts > Utility in DaVinci Resolve.
function getDaVinciResolveUtilityScriptsDirectoryPath() {
    const current_operating_system_platform = process.platform;

    if (current_operating_system_platform === 'win32') {
        const system_program_data_directory = process.env.PROGRAMDATA || 'C:\\ProgramData';
        const system_shared_utility_path = path.join(
            system_program_data_directory,
            'Blackmagic Design',
            'DaVinci Resolve',
            'Fusion',
            'Scripts',
            'Utility'
        );

        const user_roaming_app_data_directory = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
        const user_specific_utility_path = path.join(
            user_roaming_app_data_directory,
            'Blackmagic Design',
            'DaVinci Resolve',
            'Support',
            'Fusion',
            'Scripts',
            'Utility'
        );

        if (fs.existsSync(path.dirname(system_shared_utility_path))) {
            return system_shared_utility_path;
        }
        return user_specific_utility_path;
    } else if (current_operating_system_platform === 'darwin') {
        const user_home_directory = process.env.HOME || '';
        return path.join(
            user_home_directory,
            'Library',
            'Application Support',
            'Blackmagic Design',
            'DaVinci Resolve',
            'Fusion',
            'Scripts',
            'Utility'
        );
    } else {
        const user_home_directory = process.env.HOME || '';
        return path.join(
            user_home_directory,
            '.local',
            'share',
            'DaVinciResolve',
            'Fusion',
            'Scripts',
            'Utility'
        );
    }
}

// ---------------------------------------------------------------------------
// DaVinci Resolve HTTP Loopback Bridge Client
// ---------------------------------------------------------------------------

// WHAT: Sends a JSON-RPC invocation over HTTP to resolve_bridge.py running inside DaVinci Resolve.
// WHY: Sub-50ms execution directly communicates with Resolve Free and Studio editions.
async function invokeDaVinciResolveBridgeRpc(
    remote_reference_identifier = 0,
    remote_attribute_name_string = 'GetProjectManager',
    invocation_arguments_collection = []
) {
    const bridge_server_url = `http://127.0.0.1:${DEFAULT_RESOLVER_BRIDGE_PORT}`;
    const payload_request_dictionary = {
        token: DEFAULT_RESOLVER_BRIDGE_TOKEN,
        ref: remote_reference_identifier,
        attr: remote_attribute_name_string,
        args: invocation_arguments_collection,
        kwargs: {}
    };

    const http_response = await fetch(bridge_server_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload_request_dictionary)
    });

    if (!http_response.ok) {
        throw new Error(`HTTP ${http_response.status} from DaVinci Resolve Bridge: ${http_response.statusText}`);
    }

    const response_payload_dictionary = await http_response.json();
    if (!response_payload_dictionary.ok) {
        throw new Error(response_payload_dictionary.error || 'Unknown DaVinci Resolve bridge execution error');
    }

    return response_payload_dictionary.value;
}

// WHAT: Checks the health status endpoint of the DaVinci Resolve loopback bridge.
// WHY: Verifies whether DaVinci Resolve is currently open and has resolve_bridge.py running.
async function checkDaVinciResolveConnectionStatus() {
    const destination_directory_path = getDaVinciResolveUtilityScriptsDirectoryPath();
    const destination_script_file_path = path.join(destination_directory_path, 'resolve_bridge.py');
    const is_script_installed_boolean = fs.existsSync(destination_script_file_path);

    try {
        const abort_controller_instance = new AbortController();
        const timeout_timer_identifier = setTimeout(() => abort_controller_instance.abort(), 2000);

        const ping_http_response = await fetch(`http://127.0.0.1:${DEFAULT_RESOLVER_BRIDGE_PORT}/status`, {
            method: 'GET',
            signal: abort_controller_instance.signal
        });
        clearTimeout(timeout_timer_identifier);

        if (!ping_http_response.ok) {
            return {
                is_installed: is_script_installed_boolean,
                installed_file_path: destination_script_file_path,
                is_online: false,
                error_message: `HTTP ${ping_http_response.status} from Resolve Bridge`
            };
        }

        const ping_response_data = await ping_http_response.json();
        return {
            is_installed: is_script_installed_boolean,
            installed_file_path: destination_script_file_path,
            is_online: true,
            application_name: ping_response_data.app,
            active_project_name: ping_response_data.project,
            active_timeline_name: ping_response_data.timeline,
        };
    } catch (connection_attempt_error) {
        return {
            is_installed: is_script_installed_boolean,
            installed_file_path: destination_script_file_path,
            is_online: false,
            error_message: connection_attempt_error instanceof Error ? connection_attempt_error.message : String(connection_attempt_error)
        };
    }
}

// WHAT: Installs the bundled resolve_bridge.py into DaVinci Resolve's Utility scripts folder.
// WHY: Automates setup so external agents can self-heal an uninstalled bridge script.
function installDaVinciResolveBridgeScript() {
    const destination_directory_path = getDaVinciResolveUtilityScriptsDirectoryPath();
    if (!fs.existsSync(destination_directory_path)) {
        fs.mkdirSync(destination_directory_path, { recursive: true });
    }

    const destination_script_file_path = path.join(destination_directory_path, 'resolve_bridge.py');
    const potential_source_paths_collection = [
        path.join(workspace_root_directory_path, 'bridge', 'resolve_bridge.py'),
        path.join(workspace_root_directory_path, 'scripts', 'resolve_bridge.py'),
    ];

    let found_source_path_string = '';
    for (const candidate_source_path of potential_source_paths_collection) {
        if (fs.existsSync(candidate_source_path)) {
            found_source_path_string = candidate_source_path;
            break;
        }
    }

    if (!found_source_path_string) {
        return {
            success: false,
            target_path: destination_script_file_path,
            error: 'Could not locate source resolve_bridge.py in workspace repository.'
        };
    }

    fs.copyFileSync(found_source_path_string, destination_script_file_path);
    return {
        success: true,
        target_path: destination_script_file_path
    };
}

// ---------------------------------------------------------------------------
// High-Level DaVinci Resolve Automation Helpers
// ---------------------------------------------------------------------------

// WHAT: Pushes markers directly to DaVinci Resolve's active timeline.
// WHY: Enables automated beat alignment, onset placement, and narrative notes.
async function pushMarkersToDaVinciResolveTimeline(markers_collection) {
    const project_manager_reference = await invokeDaVinciResolveBridgeRpc(0, 'GetProjectManager', []);
    if (!project_manager_reference || typeof project_manager_reference.__ref__ === 'undefined') {
        throw new Error('Could not access ProjectManager in DaVinci Resolve.');
    }

    const project_reference = await invokeDaVinciResolveBridgeRpc(project_manager_reference.__ref__, 'GetCurrentProject', []);
    if (!project_reference || typeof project_reference.__ref__ === 'undefined') {
        throw new Error('No project is currently open in DaVinci Resolve.');
    }

    const timeline_reference = await invokeDaVinciResolveBridgeRpc(project_reference.__ref__, 'GetCurrentTimeline', []);
    if (!timeline_reference || typeof timeline_reference.__ref__ === 'undefined') {
        throw new Error('No active timeline selected in DaVinci Resolve.');
    }

    const timeline_name_string = await invokeDaVinciResolveBridgeRpc(timeline_reference.__ref__, 'GetName', []);
    const frame_rate_setting_string = await invokeDaVinciResolveBridgeRpc(timeline_reference.__ref__, 'GetSetting', ['timelineFrameRate']);
    const timeline_frame_rate_number = parseFloat(frame_rate_setting_string) || 24;
    const start_frame_offset_string = await invokeDaVinciResolveBridgeRpc(timeline_reference.__ref__, 'GetStartFrame', []);
    const start_frame_offset_number = parseInt(start_frame_offset_string, 10) || 0;

    let successfully_placed_markers_count = 0;

    for (const marker_item of markers_collection) {
        const target_frame_number = start_frame_offset_number + (Number(marker_item.frame) || 0);

        let resolved_color_name_string = 'Blue';
        const lower_case_color_string = String(marker_item.color || '').toLowerCase();
        if (lower_case_color_string.includes('red')) resolved_color_name_string = 'Red';
        else if (lower_case_color_string.includes('yellow')) resolved_color_name_string = 'Yellow';
        else if (lower_case_color_string.includes('green')) resolved_color_name_string = 'Green';
        else if (lower_case_color_string.includes('cyan')) resolved_color_name_string = 'Cyan';
        else if (lower_case_color_string.includes('fuchsia') || lower_case_color_string.includes('magenta')) resolved_color_name_string = 'Fuchsia';
        else if (lower_case_color_string.includes('orange') || lower_case_color_string.includes('sand')) resolved_color_name_string = 'Sand';
        else if (lower_case_color_string.includes('purple')) resolved_color_name_string = 'Purple';

        const marker_duration_frames_number = Math.max(
            1,
            Math.round((Number(marker_item.duration_sec) || 0.05) * timeline_frame_rate_number)
        );

        const custom_note_payload_string = marker_item.note || marker_item.type || 'Beat';
        const custom_marker_metadata_json = JSON.stringify({
            type: marker_item.type || 'marker',
            timestamp: marker_item.timestamp || 0
        });

        const add_marker_result = await invokeDaVinciResolveBridgeRpc(
            timeline_reference.__ref__,
            'AddMarker',
            [
                target_frame_number,
                resolved_color_name_string,
                custom_note_payload_string,
                custom_marker_metadata_json,
                marker_duration_frames_number
            ]
        );

        if (add_marker_result) {
            successfully_placed_markers_count++;
        }
    }

    return {
        success: true,
        timeline_name: timeline_name_string,
        pushed_count: successfully_placed_markers_count
    };
}

// WHAT: Imports media files into DaVinci Resolve's active Media Pool.
// WHY: Prepares audio and video assets for timeline assembly.
async function importMediaIntoDaVinciResolveMediaPool(audio_file_path = '', video_file_paths_collection = []) {
    const project_manager_reference = await invokeDaVinciResolveBridgeRpc(0, 'GetProjectManager', []);
    const project_reference = await invokeDaVinciResolveBridgeRpc(project_manager_reference.__ref__, 'GetCurrentProject', []);
    if (!project_reference || typeof project_reference.__ref__ === 'undefined') {
        throw new Error('No project currently open in DaVinci Resolve.');
    }

    const media_pool_reference = await invokeDaVinciResolveBridgeRpc(project_reference.__ref__, 'GetMediaPool', []);
    if (!media_pool_reference || typeof media_pool_reference.__ref__ === 'undefined') {
        throw new Error('Could not access Media Pool in DaVinci Resolve.');
    }

    let audio_imported_boolean = false;
    if (audio_file_path && fs.existsSync(audio_file_path)) {
        const imported_audio_items = await invokeDaVinciResolveBridgeRpc(
            media_pool_reference.__ref__,
            'ImportMedia',
            [[audio_file_path]]
        );
        audio_imported_boolean = Boolean(imported_audio_items && imported_audio_items.length > 0);
    }

    const verified_existing_video_paths = video_file_paths_collection.filter((candidate_path) =>
        candidate_path && fs.existsSync(candidate_path)
    );

    let imported_video_clips_count = 0;
    if (verified_existing_video_paths.length > 0) {
        const imported_video_items = await invokeDaVinciResolveBridgeRpc(
            media_pool_reference.__ref__,
            'ImportMedia',
            [verified_existing_video_paths]
        );
        imported_video_clips_count = imported_video_items ? imported_video_items.length : 0;
    }

    return {
        success: true,
        audio_imported: audio_imported_boolean,
        imported_video_count: imported_video_clips_count
    };
}

// WHAT: Automatically creates or reconstructs a timeline with audio and video clips.
// WHY: Fully assembles an AI storyboard or rhythmic music video directly inside Resolve.
async function reconstructDaVinciResolveTimeline(
    project_name_string,
    audio_file_path_string = '',
    timeline_frame_rate_number = 24,
    timeline_clips_collection = []
) {
    const project_manager_reference = await invokeDaVinciResolveBridgeRpc(0, 'GetProjectManager', []);
    const project_reference = await invokeDaVinciResolveBridgeRpc(project_manager_reference.__ref__, 'GetCurrentProject', []);
    if (!project_reference || typeof project_reference.__ref__ === 'undefined') {
        throw new Error('No project open in DaVinci Resolve.');
    }

    const media_pool_reference = await invokeDaVinciResolveBridgeRpc(project_reference.__ref__, 'GetMediaPool', []);
    if (!media_pool_reference || typeof media_pool_reference.__ref__ === 'undefined') {
        throw new Error('Could not access Media Pool in DaVinci Resolve.');
    }

    let active_timeline_reference = await invokeDaVinciResolveBridgeRpc(project_reference.__ref__, 'GetCurrentTimeline', []);
    if (!active_timeline_reference || typeof active_timeline_reference.__ref__ === 'undefined') {
        const generated_timeline_name_string = `Assembled_${(project_name_string || 'Project').replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
        active_timeline_reference = await invokeDaVinciResolveBridgeRpc(
            media_pool_reference.__ref__,
            'CreateEmptyTimeline',
            [generated_timeline_name_string]
        );
    }

    const timeline_name_string = await invokeDaVinciResolveBridgeRpc(active_timeline_reference.__ref__, 'GetName', []);
    await invokeDaVinciResolveBridgeRpc(project_reference.__ref__, 'SetCurrentTimeline', [{ __ref__: active_timeline_reference.__ref__ }]);

    const start_frame_offset_string = await invokeDaVinciResolveBridgeRpc(active_timeline_reference.__ref__, 'GetStartFrame', []);
    const start_frame_offset_number = parseInt(start_frame_offset_string, 10) || 0;
    const effective_fps_number = timeline_frame_rate_number || 24;

    if (audio_file_path_string && fs.existsSync(audio_file_path_string)) {
        const audio_items_collection = await invokeDaVinciResolveBridgeRpc(media_pool_reference.__ref__, 'ImportMedia', [[audio_file_path_string]]);
        if (audio_items_collection && audio_items_collection.length > 0) {
            await invokeDaVinciResolveBridgeRpc(media_pool_reference.__ref__, 'AppendToTimeline', [[
                {
                    mediaPoolItem: { __ref__: audio_items_collection[0].__ref__ },
                    recordFrame: start_frame_offset_number,
                    mediaType: 2 // Audio
                }
            ]]);
        }
    }

    const unique_video_paths_collection = Array.from(
        new Set(
            timeline_clips_collection
                .map((clip_entry) => clip_entry.videoPath || clip_entry.path || '')
                .filter((candidate_path) => candidate_path && fs.existsSync(candidate_path))
        )
    );

    const video_path_to_item_dictionary = new Map();
    if (unique_video_paths_collection.length > 0) {
        const imported_pool_items = await invokeDaVinciResolveBridgeRpc(
            media_pool_reference.__ref__,
            'ImportMedia',
            [unique_video_paths_collection]
        );
        if (imported_pool_items) {
            for (let index = 0; index < imported_pool_items.length; index++) {
                video_path_to_item_dictionary.set(unique_video_paths_collection[index], imported_pool_items[index]);
            }
        }
    }

    let successfully_placed_clips_count = 0;
    for (const clip_item of timeline_clips_collection) {
        const clip_file_path = clip_item.videoPath || clip_item.path || '';
        const media_pool_item = video_path_to_item_dictionary.get(clip_file_path);
        if (!media_pool_item) continue;

        const start_record_frame_number = start_frame_offset_number + Math.round(Number(clip_item.startTime || 0) * effective_fps_number);
        const clip_duration_frames_number = Math.max(1, Math.round((Number(clip_item.endTime || 0) - Number(clip_item.startTime || 0)) * effective_fps_number));

        await invokeDaVinciResolveBridgeRpc(media_pool_reference.__ref__, 'AppendToTimeline', [[
            {
                mediaPoolItem: { __ref__: media_pool_item.__ref__ },
                startFrame: 0,
                endFrame: clip_duration_frames_number - 1,
                recordFrame: start_record_frame_number,
                mediaType: 1 // Video
            }
        ]]);
        successfully_placed_clips_count++;
    }

    return {
        success: true,
        timeline_name: timeline_name_string,
        placed_clips_count: successfully_placed_clips_count
    };
}

// ---------------------------------------------------------------------------
// Resolver Project & Storyboard Automation Helpers
// ---------------------------------------------------------------------------

// WHAT: Scans a directory for Resolver PRJ_ project bundles.
// WHY: Discovers projects and summarizes their metadata for AI agents.
function listResolverProjectsOnDisk(custom_directory_path = '') {
    const user_configuration = loadResolverUserConfiguration();
    const target_directory_path = custom_directory_path || user_configuration.projectOutputDir || path.join(workspace_root_directory_path, 'output');

    if (!fs.existsSync(target_directory_path)) {
        return [];
    }

    const directory_entries_collection = fs.readdirSync(target_directory_path, { withFileTypes: true });
    const discovered_projects_collection = [];

    for (const directory_entry of directory_entries_collection) {
        if (!directory_entry.isDirectory()) continue;

        const candidate_project_file_path = path.join(target_directory_path, directory_entry.name, 'project.json');
        if (fs.existsSync(candidate_project_file_path)) {
            try {
                const project_json_string = fs.readFileSync(candidate_project_file_path, 'utf8');
                const parsed_project_record = JSON.parse(project_json_string);
                discovered_projects_collection.push({
                    id: parsed_project_record.id || directory_entry.name,
                    name: parsed_project_record.name || directory_entry.name,
                    folderName: directory_entry.name,
                    projectFilePath: candidate_project_file_path,
                    audioPath: parsed_project_record.audioPath || '',
                    duration: parsed_project_record.duration || 0,
                    frameRate: parsed_project_record.frameRate || 24,
                    clipsCount: Array.isArray(parsed_project_record.clips) ? parsed_project_record.clips.length : 0,
                    markersCount: Array.isArray(parsed_project_record.markers) ? parsed_project_record.markers.length : 0,
                    updatedAt: parsed_project_record.updatedAt || ''
                });
            } catch (project_parsing_error) {
                // Ignore corrupt projects
            }
        }
    }

    return discovered_projects_collection;
}

// WHAT: Retrieves the full JSON contents of a specific Resolver project bundle.
// WHY: Provides complete context (clips, storyboard visual prompts, markers) to the agent.
function getResolverProjectDetails(project_identifier_string, custom_directory_path = '') {
    const user_configuration = loadResolverUserConfiguration();
    const target_directory_path = custom_directory_path || user_configuration.projectOutputDir || path.join(workspace_root_directory_path, 'output');

    if (!fs.existsSync(target_directory_path)) {
        throw new Error(`Projects directory does not exist: ${target_directory_path}`);
    }

    // Check direct bundle folder first
    const direct_bundle_path = path.join(target_directory_path, project_identifier_string, 'project.json');
    if (fs.existsSync(direct_bundle_path)) {
        return JSON.parse(fs.readFileSync(direct_bundle_path, 'utf8'));
    }

    const safe_name_bundle_path = path.join(target_directory_path, `PRJ_${project_identifier_string.replace(/[^a-zA-Z0-9-_]/g, '_')}`, 'project.json');
    if (fs.existsSync(safe_name_bundle_path)) {
        return JSON.parse(fs.readFileSync(safe_name_bundle_path, 'utf8'));
    }

    // Search all folders for matching project id or name
    const project_directory_entries_collection = fs.readdirSync(target_directory_path, { withFileTypes: true });
    for (const project_directory_entry of project_directory_entries_collection) {
        if (!project_directory_entry.isDirectory()) continue;
        const candidate_project_file_path = path.join(target_directory_path, project_directory_entry.name, 'project.json');
        if (fs.existsSync(candidate_project_file_path)) {
            try {
                const parsed_project_payload_record = JSON.parse(fs.readFileSync(candidate_project_file_path, 'utf8'));
                if (parsed_project_payload_record.id === project_identifier_string || parsed_project_payload_record.name === project_identifier_string) {
                    return parsed_project_payload_record;
                }
            } catch {
                // Ignore unparseable candidate project files
            }
        }
    }

    throw new Error(`Resolver project not found: "${project_identifier_string}"`);
}

// WHAT: Updates an existing project bundle or writes a modified project JSON to disk.
// WHY: Enables agents to persist AI expanded prompts, camera directions, and new storyboard cards.
function saveResolverProjectToDisk(project_payload_record, custom_directory_path = '') {
    const user_configuration = loadResolverUserConfiguration();
    const target_directory_path = custom_directory_path || user_configuration.projectOutputDir || path.join(workspace_root_directory_path, 'output');

    if (!fs.existsSync(target_directory_path)) {
        fs.mkdirSync(target_directory_path, { recursive: true });
    }

    const project_name_string = project_payload_record.name || 'Untitled_Project';
    const safe_folder_name_string = `PRJ_${project_name_string.replace(/[^a-zA-Z0-9-_]/g, '_')}`;
    const project_bundle_directory_path = path.join(target_directory_path, safe_folder_name_string);

    if (!fs.existsSync(project_bundle_directory_path)) {
        fs.mkdirSync(project_bundle_directory_path, { recursive: true });
    }

    project_payload_record.updatedAt = new Date().toISOString();
    const destination_project_json_path = path.join(project_bundle_directory_path, 'project.json');

    fs.writeFileSync(destination_project_json_path, JSON.stringify(project_payload_record, null, 2), 'utf8');

    return {
        success: true,
        projectPath: destination_project_json_path,
        projectId: project_payload_record.id || safe_folder_name_string
    };
}

// ---------------------------------------------------------------------------
// ComfyUI Integration Helpers
// ---------------------------------------------------------------------------

// WHAT: Pings the local ComfyUI server to check availability.
// WHY: Ensures AI generation workflows can be queued before sending requests.
async function checkComfyUiServerStatus(comfyui_base_url_string = DEFAULT_COMFYUI_SERVER_URL) {
    try {
        const abort_controller_instance = new AbortController();
        const timeout_timer = setTimeout(() => abort_controller_instance.abort(), 2000);

        const http_response = await fetch(`${comfyui_base_url_string}/system_stats`, {
            signal: abort_controller_instance.signal
        });
        clearTimeout(timeout_timer);

        if (http_response.ok) {
            const system_stats_record = await http_response.json();
            return {
                is_online: true,
                base_url: comfyui_base_url_string,
                devices: system_stats_record.devices || []
            };
        }
        return { is_online: false, base_url: comfyui_base_url_string, error: `HTTP ${http_response.status}` };
    } catch (network_error) {
        return {
            is_online: false,
            base_url: comfyui_base_url_string,
            error: network_error instanceof Error ? network_error.message : String(network_error)
        };
    }
}

// WHAT: Lists all ComfyUI workflow JSON files bundled in comfyui_workflows/.
// WHY: Lets AI agents discover ready-to-run pipelines (stems, Minimax, Qwen).
function listBundledComfyUiWorkflows() {
    const workflows_directory_path = path.join(workspace_root_directory_path, 'comfyui_workflows');
    if (!fs.existsSync(workflows_directory_path)) {
        return [];
    }

    const workflow_files_collection = fs.readdirSync(workflows_directory_path).filter((file_name) =>
        file_name.endsWith('.json')
    );

    return workflow_files_collection.map((file_name) => ({
        fileName: file_name,
        filePath: path.join(workflows_directory_path, file_name)
    }));
}

// ---------------------------------------------------------------------------
// Model Context Protocol Server Setup & Operational Instructions
// ---------------------------------------------------------------------------

// WHAT: Built-in operational instructions bundled directly with the Resolver MCP server.
// WHY: Informs connected LLM agents (Claude Desktop, Antigravity, Cursor) of execution order,
// safety rules, high-level tool preferences over raw RPC, and DaVinci marker conventions.
const RESOLVER_MCP_OPERATIONAL_INSTRUCTIONS = `
# Resolver & DaVinci Resolve MCP Operational Guidelines

You are connected to Resolver's native Model Context Protocol (MCP) server, which coordinates DaVinci Resolve, Resolver Storyboard & Project Management, and ComfyUI generation pipelines.

## 1. PRE-FLIGHT VERIFICATION & SAFE EXECUTION ORDER
- Always call 'resolve_get_status' before attempting timeline assembly or marker operations to ensure DaVinci Resolve is running and has an active project and timeline open.
- If DaVinci Resolve is disconnected, prompt the user to ensure Resolve is open and run 'Workspace > Scripts > Utility > resolve_bridge'.
- Call 'comfyui_get_status' before queueing AI workflows to verify that the local ComfyUI instance is online and has available GPU devices.

## 2. HIGH-LEVEL TOOLS VS. RAW RPC
- Prefer structured, high-level tools ('resolve_push_markers', 'resolve_reconstruct_timeline', 'resolve_import_media') over raw Python execution ('resolve_execute_rpc').
- Reserve 'resolve_execute_rpc' for custom scripting operations (e.g., Fairlight audio ducking, Fusion composition creation, or CDL grading adjustments).

## 3. TIMELINE ASSEMBLY & MARKER CONVENTIONS
- Media Pool imports must precede timeline placement: call 'resolve_import_media' before 'resolve_reconstruct_timeline'.
- Align with Resolver marker color conventions:
  * Green: Beat markers (regular musical rhythm pulses)
  * Yellow: Onset markers / musical downbeats / section intros
  * Cyan: Vocal cues and dialogue hitpoints
  * Purple: Energy bursts, drops, or loudness peaks
  * Red: Scene cuts, transition points, or director chapter breaks
- Always compute frames accurately from seconds: frame = Math.round(timestamp * timeline_fps).

## 4. MCP RESOURCES
- Consult 'resolver://schemas/project-bundle' to understand the project data structure before modifying project bundles.
- Consult 'resolver://resolve/marker-conventions' and 'resolver://resolve/rpc-cheatsheet' for DaVinci Resolve scripting details.
- Read workflow templates via 'resolver://comfyui/workflows/{name}' before initiating ComfyUI generation.
- Inspect 'resolver://projects/active' for a snapshot of the current storyboard without burning a tool call.
`.trim();

const mcp_server_instance = new Server(
    {
        name: 'resolver-mcp-server',
        version: '1.0.0',
    },
    {
        capabilities: {
            tools: {},
            resources: {},
        },
        instructions: RESOLVER_MCP_OPERATIONAL_INSTRUCTIONS,
    }
);

// ---------------------------------------------------------------------------
// Tool Catalog Specification
// ---------------------------------------------------------------------------

const REGISTERED_MCP_TOOLS_COLLECTION = [
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
                        required: ['frame'],
                        properties: {
                            frame: { type: 'number', description: 'Zero-indexed timeline frame relative to timeline start.' },
                            timestamp: { type: 'number', description: 'Timestamp in seconds.' },
                            color: { type: 'string', description: 'Resolve marker color (Blue, Cyan, Green, Yellow, Red, Fuchsia, Sand, Purple).' },
                            note: { type: 'string', description: 'Marker name or description text.' },
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
                        required: ['startTime', 'endTime'],
                        properties: {
                            videoPath: { type: 'string', description: 'Absolute path to video clip file.' },
                            path: { type: 'string', description: 'Alternative path property.' },
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
// Resource Catalog Specification & Handlers
// ---------------------------------------------------------------------------

// WHAT: Static reference schema defining the Resolver project bundle structure.
// WHY: Gives AI agents immediate visibility into project models without burning tool calls.
const RESOLVER_PROJECT_BUNDLE_JSON_SCHEMA = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'ResolverProjectBundle',
    type: 'object',
    required: ['id', 'name', 'duration', 'clips'],
    properties: {
        id: { type: 'string', description: 'Unique identifier for the project.' },
        name: { type: 'string', description: 'Display name of the project.' },
        audioPath: { type: 'string', description: 'Absolute path to the master audio track file.' },
        duration: { type: 'number', description: 'Total project audio duration in seconds.' },
        frameRate: { type: 'number', description: 'Timeline frames per second (e.g. 24, 30, 60).' },
        updatedAt: { type: 'string', description: 'ISO timestamp of last project update.' },
        clips: {
            type: 'array',
            items: {
                type: 'object',
                required: ['id', 'startTime', 'endTime'],
                properties: {
                    id: { type: 'string', description: 'Clip identifier.' },
                    prompt: { type: 'string', description: 'Visual prompt text for image/video generation.' },
                    actionNotes: { type: 'string', description: 'Narrative action notes and director cues.' },
                    cameraMovement: { type: 'string', description: 'Camera motion direction (e.g. Slow push-in, Dolly zoom).' },
                    startTime: { type: 'number', description: 'Start timestamp in seconds.' },
                    endTime: { type: 'number', description: 'End timestamp in seconds.' },
                    track: { type: 'number', description: 'Target video track index (1 or 2).' },
                    startImagePath: { type: 'string', description: 'Path to initial starting frame image.' },
                    endImagePath: { type: 'string', description: 'Path to ending frame image.' },
                    videoPath: { type: 'string', description: 'Path to rendered video asset.' },
                    status: { type: 'string', enum: ['pending', 'generating', 'completed', 'failed'] }
                }
            }
        },
        markers: {
            type: 'array',
            items: {
                type: 'object',
                required: ['frame', 'color'],
                properties: {
                    frame: { type: 'number', description: 'Zero-indexed frame number relative to timeline start.' },
                    timestamp: { type: 'number', description: 'Marker timestamp in seconds.' },
                    color: { type: 'string', description: 'Marker color (Green, Yellow, Cyan, Purple, Red, Blue, Sand, Fuchsia).' },
                    note: { type: 'string', description: 'Marker label or musical annotation.' },
                    type: { type: 'string', description: 'Marker category (beat, onset, loudness, chapter, action).' },
                    duration_sec: { type: 'number', description: 'Marker duration in seconds.' }
                }
            }
        },
        stems: {
            type: 'object',
            description: 'Separated audio stem file paths.',
            properties: {
                vocals: { type: 'string' },
                drums: { type: 'string' },
                bass: { type: 'string' },
                other: { type: 'string' }
            }
        }
    }
};

// WHAT: Documentation of timeline marker color conventions and frame alignment mathematics.
// WHY: Ensures AI agents choose the right colors and calculate frame positions accurately.
const DAVINCI_RESOLVE_MARKER_CONVENTIONS_DOCUMENTATION = `# DaVinci Resolve Timeline Marker Standards for Resolver

When pushing timeline markers to DaVinci Resolve via \`resolve_push_markers\` or creating beat-synced storyboard timelines, adhere to the following conventions:

## 1. Marker Color Palette
- **Green**: Beat Markers. Regular musical rhythm pulses detected by audio analysis engines (Essentia/Madmom).
- **Yellow**: Onset & Downbeat Markers. High-energy musical downbeats, drop hitpoints, and section introductions.
- **Cyan**: Vocal / Dialogue Cues. Lyric phrase start points, dialogue cues, and vocal lead-ins.
- **Purple**: Loudness / Energy Peaks. Significant RMS or spectral energy peaks suitable for dynamic visual transitions.
- **Red**: Scene Cuts / Section Transitions. Verse-to-chorus boundaries, bridge sections, or storyboard scene cuts.
- **Blue**: Action / Motion Hitpoints. Visual choreography cues (e.g. camera punch-in, lighting change).

## 2. Frame Alignment & Calculation
- Frame indices must always be integers relative to the timeline start (0-indexed).
- Mathematical conversion: \`frame = Math.round(timestamp_seconds * timeline_frame_rate)\`.
- Default timeline frame rate in Resolver is 24.0 FPS (SMPTE standard) unless customized in project settings.

## 3. Marker Duration
- Point markers (instantaneous hits): duration = 1 frame (or ~0.04 to 0.05 seconds).
- Section markers (phrases/chords): duration = span of musical phrase in seconds.
`;

// WHAT: Quick reference for remote DaVinci Resolve Python scripting API method calls.
// WHY: Educates AI agents on object hierarchies and available methods for \`resolve_execute_rpc\`.
const DAVINCI_RESOLVE_RPC_CHEATSHEET_DOCUMENTATION = `# DaVinci Resolve Remote RPC Cheatsheet for \`resolve_execute_rpc\`

Resolver exposes direct Python API execution against DaVinci Resolve through its loopback HTTP bridge (port 8878).

## Object Reference Hierarchy
- **Ref ID 0**: The live root \`Resolve\` application handle.
  - \`resolve.GetProjectManager()\` -> Returns ProjectManager reference.
  - \`resolve.OpenPage(pageName)\` -> Switches page ('edit', 'cut', 'fusion', 'color', 'fairlight', 'deliver').
  - \`resolve.GetVersionString()\` -> Returns DaVinci Resolve version string.

- **ProjectManager**:
  - \`project_manager.GetCurrentProject()\` -> Returns active Project reference.
  - \`project_manager.CreateProject(projectName)\` -> Creates and opens new project.
  - \`project_manager.SaveProject()\` -> Saves active project.

- **Project**:
  - \`project.GetCurrentTimeline()\` -> Returns active Timeline reference.
  - \`project.GetTimelineCount()\` -> Returns total number of timelines.
  - \`project.GetTimelineByIndex(timelineIndex)\` -> Returns Timeline by 1-based index.
  - \`project.GetMediaPool()\` -> Returns MediaPool reference.
  - \`project.GetName()\`, \`project.SetSetting(settingName, settingValue)\`

- **Timeline**:
  - \`timeline.GetName()\`, \`timeline.GetStartFrame()\`, \`timeline.GetEndFrame()\`
  - \`timeline.GetSetting('timelineFrameRate')\`
  - \`timeline.GetTrackCount('video')\`, \`timeline.GetTrackCount('audio')\`
  - \`timeline.AddMarker(frameId, color, name, note, duration, customData)\`
  - \`timeline.DeleteMarkerByFrame(frameId)\`
  - \`timeline.GetMarkers()\` -> Returns dictionary of all markers on the timeline.

- **MediaPool**:
  - \`media_pool.GetRootFolder()\`
  - \`media_pool.ImportMedia(filePathsList)\`
  - \`media_pool.AppendToTimeline(clipInfoList)\`
  - \`media_pool.CreateEmptyTimeline(timelineName)\`

## Example Invocations
\`\`\`json
{
  "reference_identifier": 0,
  "attribute_name": "OpenPage",
  "invocation_arguments": ["edit"]
}
\`\`\`
\`\`\`json
{
  "reference_identifier": 0,
  "attribute_name": "GetVersionString",
  "invocation_arguments": []
}
\`\`\`
`;

// WHAT: Compiles all available static and dynamic MCP resources exposed by Resolver.
// WHY: Allows external agents to inspect reference material, schemas, workflows, and active projects.
function getResolverMcpResourcesCatalog() {
    const catalog_resources_collection = [
        {
            uri: 'resolver://schemas/project-bundle',
            name: 'Resolver Project Bundle JSON Schema',
            description: 'JSON Schema definition for Resolver project and storyboard bundles.',
            mimeType: 'application/json'
        },
        {
            uri: 'resolver://resolve/marker-conventions',
            name: 'DaVinci Resolve Marker Standards',
            description: 'Timeline marker color coding and frame-alignment standards for DaVinci Resolve.',
            mimeType: 'text/markdown'
        },
        {
            uri: 'resolver://resolve/rpc-cheatsheet',
            name: 'DaVinci Resolve Python RPC Cheatsheet',
            description: 'Reference cheatsheet of available DaVinci Resolve scripting API methods.',
            mimeType: 'text/markdown'
        },
        {
            uri: 'resolver://projects/active',
            name: 'Active Resolver Storyboard Project',
            description: 'The most recently modified storyboard project bundle currently on disk.',
            mimeType: 'application/json'
        }
    ];

    // Discover bundled ComfyUI workflows dynamically
    const bundled_workflows_collection = listBundledComfyUiWorkflows();
    for (const workflow_record of bundled_workflows_collection) {
        catalog_resources_collection.push({
            uri: `resolver://comfyui/workflows/${workflow_record.fileName}`,
            name: `ComfyUI Workflow: ${workflow_record.fileName}`,
            description: `Bundled ComfyUI workflow JSON template (${workflow_record.fileName}).`,
            mimeType: 'application/json'
        });
    }

    return catalog_resources_collection;
}

// WHAT: Reads and returns the content of an MCP resource by URI.
// WHY: Fulfills agent requests for schemas, documentation, ComfyUI workflows, and active project state.
function readResolverMcpResource(resource_uri_string) {
    if (resource_uri_string === 'resolver://schemas/project-bundle') {
        return {
            uri: resource_uri_string,
            mimeType: 'application/json',
            text: JSON.stringify(RESOLVER_PROJECT_BUNDLE_JSON_SCHEMA, null, 2)
        };
    }

    if (resource_uri_string === 'resolver://resolve/marker-conventions') {
        return {
            uri: resource_uri_string,
            mimeType: 'text/markdown',
            text: DAVINCI_RESOLVE_MARKER_CONVENTIONS_DOCUMENTATION
        };
    }

    if (resource_uri_string === 'resolver://resolve/rpc-cheatsheet') {
        return {
            uri: resource_uri_string,
            mimeType: 'text/markdown',
            text: DAVINCI_RESOLVE_RPC_CHEATSHEET_DOCUMENTATION
        };
    }

    if (resource_uri_string === 'resolver://projects/active') {
        const discovered_projects_collection = listResolverProjectsOnDisk();
        if (discovered_projects_collection.length === 0) {
            return {
                uri: resource_uri_string,
                mimeType: 'application/json',
                text: JSON.stringify({
                    status: 'no_projects_found',
                    message: 'No Resolver project bundles discovered in project output directory.'
                }, null, 2)
            };
        }

        // Sort descending by updatedAt timestamp
        discovered_projects_collection.sort((first_project, second_project) => {
            const first_timestamp = new Date(first_project.updatedAt || 0).getTime();
            const second_timestamp = new Date(second_project.updatedAt || 0).getTime();
            return second_timestamp - first_timestamp;
        });

        const most_recent_project_identifier = discovered_projects_collection[0].id || discovered_projects_collection[0].name;
        const project_bundle_payload = getResolverProjectDetails(most_recent_project_identifier);

        return {
            uri: resource_uri_string,
            mimeType: 'application/json',
            text: JSON.stringify(project_bundle_payload, null, 2)
        };
    }

    if (resource_uri_string.startsWith('resolver://comfyui/workflows/')) {
        const workflow_file_name_string = resource_uri_string.replace('resolver://comfyui/workflows/', '');
        const target_workflow_file_path = path.join(workspace_root_directory_path, 'comfyui_workflows', workflow_file_name_string);

        if (!fs.existsSync(target_workflow_file_path)) {
            throw new Error(`ComfyUI workflow not found: "${workflow_file_name_string}"`);
        }

        const raw_workflow_contents_string = fs.readFileSync(target_workflow_file_path, 'utf8');
        return {
            uri: resource_uri_string,
            mimeType: 'application/json',
            text: raw_workflow_contents_string
        };
    }

    throw new Error(`Unrecognized MCP resource URI: "${resource_uri_string}"`);
}

// ---------------------------------------------------------------------------
// Resource Handlers
// ---------------------------------------------------------------------------

mcp_server_instance.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
        resources: getResolverMcpResourcesCatalog()
    };
});

mcp_server_instance.setRequestHandler(ReadResourceRequestSchema, async (incoming_request) => {
    const requested_resource_uri_string = String(incoming_request.params.uri);
    const read_resource_result_record = readResolverMcpResource(requested_resource_uri_string);

    return {
        contents: [read_resource_result_record]
    };
});

// ---------------------------------------------------------------------------
// Tool Handlers
// ---------------------------------------------------------------------------

mcp_server_instance.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: REGISTERED_MCP_TOOLS_COLLECTION
    };
});

mcp_server_instance.setRequestHandler(CallToolRequestSchema, async (incoming_request) => {
    const tool_name_string = incoming_request.params.name;
    const tool_arguments_dictionary = incoming_request.params.arguments || {};

    try {
        let execution_result_payload = null;

        switch (tool_name_string) {
            case 'resolve_get_status': {
                execution_result_payload = await checkDaVinciResolveConnectionStatus();
                break;
            }

            case 'resolve_install_bridge': {
                execution_result_payload = installDaVinciResolveBridgeScript();
                break;
            }

            case 'resolve_push_markers': {
                const markers_to_push = Array.isArray(tool_arguments_dictionary.markers)
                    ? tool_arguments_dictionary.markers
                    : [];
                execution_result_payload = await pushMarkersToDaVinciResolveTimeline(markers_to_push);
                break;
            }

            case 'resolve_import_media': {
                const audio_file_path = String(tool_arguments_dictionary.audio_file_path || '');
                const video_paths_array = Array.isArray(tool_arguments_dictionary.video_file_paths_collection)
                    ? tool_arguments_dictionary.video_file_paths_collection
                    : [];
                execution_result_payload = await importMediaIntoDaVinciResolveMediaPool(audio_file_path, video_paths_array);
                break;
            }

            case 'resolve_reconstruct_timeline': {
                execution_result_payload = await reconstructDaVinciResolveTimeline(
                    String(tool_arguments_dictionary.project_name || 'MCP_Timeline'),
                    String(tool_arguments_dictionary.audio_file_path || ''),
                    Number(tool_arguments_dictionary.timeline_frame_rate) || 24,
                    Array.isArray(tool_arguments_dictionary.timeline_clips_collection)
                        ? tool_arguments_dictionary.timeline_clips_collection
                        : []
                );
                break;
            }

            case 'resolve_execute_rpc': {
                execution_result_payload = await invokeDaVinciResolveBridgeRpc(
                    Number(tool_arguments_dictionary.reference_identifier) || 0,
                    String(tool_arguments_dictionary.attribute_name),
                    Array.isArray(tool_arguments_dictionary.invocation_arguments)
                        ? tool_arguments_dictionary.invocation_arguments
                        : []
                );
                break;
            }

            case 'resolver_list_projects': {
                execution_result_payload = listResolverProjectsOnDisk(
                    String(tool_arguments_dictionary.custom_projects_directory_path || '')
                );
                break;
            }

            case 'resolver_get_project': {
                execution_result_payload = getResolverProjectDetails(
                    String(tool_arguments_dictionary.project_identifier),
                    String(tool_arguments_dictionary.custom_projects_directory_path || '')
                );
                break;
            }

            case 'resolver_update_project': {
                execution_result_payload = saveResolverProjectToDisk(
                    tool_arguments_dictionary.project_data,
                    String(tool_arguments_dictionary.custom_projects_directory_path || '')
                );
                break;
            }

            case 'resolver_update_clip_prompt': {
                const project_data = getResolverProjectDetails(
                    String(tool_arguments_dictionary.project_identifier),
                    String(tool_arguments_dictionary.custom_projects_directory_path || '')
                );

                const target_clip_id = String(tool_arguments_dictionary.clip_identifier);
                let target_clip_found = false;

                if (Array.isArray(project_data.clips)) {
                    for (const clip_item of project_data.clips) {
                        if (clip_item.id === target_clip_id) {
                            if (tool_arguments_dictionary.prompt_text !== undefined) clip_item.promptText = String(tool_arguments_dictionary.prompt_text);
                            if (tool_arguments_dictionary.action_notes !== undefined) clip_item.actionNotes = String(tool_arguments_dictionary.action_notes);
                            if (tool_arguments_dictionary.camera_movement !== undefined) clip_item.cameraMovement = String(tool_arguments_dictionary.camera_movement);
                            if (tool_arguments_dictionary.duration_seconds !== undefined) {
                                const new_duration = Number(tool_arguments_dictionary.duration_seconds);
                                clip_item.endTime = clip_item.startTime + new_duration;
                            }
                            target_clip_found = true;
                            break;
                        }
                    }
                }

                if (!target_clip_found) {
                    throw new Error(`Clip ID "${target_clip_id}" not found in project "${tool_arguments_dictionary.project_identifier}".`);
                }

                saveResolverProjectToDisk(project_data, String(tool_arguments_dictionary.custom_projects_directory_path || ''));
                execution_result_payload = { success: true, updatedClipId: target_clip_id };
                break;
            }

            case 'resolver_add_clip': {
                const project_data = getResolverProjectDetails(
                    String(tool_arguments_dictionary.project_identifier),
                    String(tool_arguments_dictionary.custom_projects_directory_path || '')
                );

                if (!Array.isArray(project_data.clips)) {
                    project_data.clips = [];
                }

                const last_clip = project_data.clips[project_data.clips.length - 1];
                const start_timestamp = last_clip ? (Number(last_clip.endTime) || 0) : 0;
                const clip_duration = Number(tool_arguments_dictionary.duration_seconds) || 4.0;

                const new_clip_record = {
                    id: `clip_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                    promptText: String(tool_arguments_dictionary.prompt_text || ''),
                    actionNotes: String(tool_arguments_dictionary.action_notes || ''),
                    startTime: start_timestamp,
                    endTime: start_timestamp + clip_duration,
                    track: 1,
                    startImagePath: tool_arguments_dictionary.start_image_path || undefined,
                    endImagePath: tool_arguments_dictionary.end_image_path || undefined,
                    status: 'pending'
                };

                project_data.clips.push(new_clip_record);
                saveResolverProjectToDisk(project_data, String(tool_arguments_dictionary.custom_projects_directory_path || ''));

                execution_result_payload = {
                    success: true,
                    newClip: new_clip_record,
                    totalClips: project_data.clips.length
                };
                break;
            }

            case 'comfyui_get_status': {
                execution_result_payload = await checkComfyUiServerStatus(
                    String(tool_arguments_dictionary.comfyui_host_url || DEFAULT_COMFYUI_SERVER_URL)
                );
                break;
            }

            case 'comfyui_list_workflows': {
                execution_result_payload = listBundledComfyUiWorkflows();
                break;
            }

            default:
                throw new Error(`Unrecognized MCP tool invocation: "${tool_name_string}"`);
        }

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(execution_result_payload, null, 2)
                }
            ]
        };
    } catch (tool_execution_error) {
        const error_message_string = tool_execution_error instanceof Error
            ? tool_execution_error.message
            : String(tool_execution_error);

        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ error: error_message_string }, null, 2)
                }
            ]
        };
    }
});

// ---------------------------------------------------------------------------
// Server Startup
// ---------------------------------------------------------------------------

async function startResolverMcpServer() {
    const stdio_transport_instance = new StdioServerTransport();
    await mcp_server_instance.connect(stdio_transport_instance);
}

startResolverMcpServer().catch((startup_error) => {
    process.stderr.write(`Fatal MCP Server Startup Error: ${startup_error?.message || startup_error}\n`);
    process.exit(1);
});
