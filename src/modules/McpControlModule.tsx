/**
 * src/modules/McpControlModule.tsx
 * 
 * WHAT:
 *   Model Context Protocol (MCP) Control Center dashboard module for Resolver.
 *   Provides server health telemetry, 1-click AI client configuration generators
 *   (Claude Desktop, Antigravity, Cursor), an interactive tool explorer with manual
 *   execution testing, and a real-time agent activity feed.
 * 
 * WHY:
 *   Empowers users to easily connect external AI models to Resolver and DaVinci Resolve,
 *   inspect tool schemas, monitor agent invocations, and debug tool executions directly
 *   within the desktop application.
 */

import { useState, useEffect, useCallback } from 'react';

interface ElectronIpcModule {
    require?: (module_name: string) => {
        ipcRenderer?: {
            invoke: <T = unknown>(channel_name: string, ...arguments_collection: unknown[]) => Promise<T>;
            on: (channel_name: string, listener_callback: (...arguments_collection: unknown[]) => void) => void;
            removeListener: (channel_name: string, listener_callback: (...arguments_collection: unknown[]) => void) => void;
        };
    };
}

const getElectronIpcRenderer = () => {
    const electron_runtime = window as unknown as ElectronIpcModule;
    if (electron_runtime.require) {
        return electron_runtime.require('electron')?.ipcRenderer ?? null;
    }
    return null;
};

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

interface McpControlModuleProps {
    onStatusChange?: (status_message: string) => void;
}

export default function McpControlModule({ onStatusChange }: McpControlModuleProps) {
    // -----------------------------------------------------------------------
    // State Management
    // -----------------------------------------------------------------------

    const [mcp_server_status, setMcpServerStatus] = useState<McpStatusResponse | null>(null);
    const [client_configurations, setClientConfigurations] = useState<McpClientConfigurationsResponse | null>(null);
    const [registered_tools_collection, setRegisteredToolsCollection] = useState<McpToolDefinition[]>([]);
    const [activity_log_entries_collection, setActivityLogEntriesCollection] = useState<McpActivityLogEntry[]>([]);

    const [is_refreshing_status, setIsRefreshingStatus] = useState<boolean>(false);
    const [is_installing_bridge, setIsInstallingBridge] = useState<boolean>(false);
    const [selected_client_tab, setSelectedClientTab] = useState<'claude' | 'antigravity' | 'cursor' | 'cli'>('claude');
    const [copied_notification_text, setCopiedNotificationText] = useState<string>('');

    const [tool_filter_query_string, setToolFilterQueryString] = useState<string>('');
    const [selected_active_tool, setSelectedActiveTool] = useState<McpToolDefinition | null>(null);
    const [tool_arguments_input_json, setToolArgumentsInputJson] = useState<string>('{}');
    const [is_executing_tool, setIsExecutingTool] = useState<boolean>(false);
    const [tool_execution_output_text, setToolExecutionOutputText] = useState<string>('');

    const ipc_renderer_instance = getElectronIpcRenderer();

    // -----------------------------------------------------------------------
    // Data Loading & Handlers
    // -----------------------------------------------------------------------

    // WHAT: Fetches live MCP server telemetry and tool definitions.
    // WHY: Updates UI cards with fresh DaVinci Resolve connection status and tool counts.
    const refreshMcpData = useCallback(async () => {
        if (!ipc_renderer_instance) return;

        setIsRefreshingStatus(true);
        try {
            const status_result = await ipc_renderer_instance.invoke<McpStatusResponse>('mcp-get-status');
            setMcpServerStatus(status_result);

            const configs_result = await ipc_renderer_instance.invoke<McpClientConfigurationsResponse>('mcp-get-client-config');
            setClientConfigurations(configs_result);

            const tools_result = await ipc_renderer_instance.invoke<McpToolDefinition[]>('mcp-get-tools');
            setRegisteredToolsCollection(tools_result || []);

            if (onStatusChange) {
                onStatusChange('MCP Control telemetry refreshed.');
            }
        } catch (data_fetch_error: unknown) {
            console.error('Failed to load MCP status:', data_fetch_error);
        } finally {
            setIsRefreshingStatus(false);
        }
    }, [ipc_renderer_instance, onStatusChange]);

    // Initial mount loading & activity stream listener
    useEffect(() => {
        refreshMcpData();

        if (ipc_renderer_instance) {
            const handleIncomingActivityEvent = (_event: unknown, incoming_activity: unknown) => {
                const typed_activity = incoming_activity as McpActivityLogEntry;
                setActivityLogEntriesCollection((previous_entries) => [typed_activity, ...previous_entries.slice(0, 49)]);
            };

            ipc_renderer_instance.on('mcp-activity-event', handleIncomingActivityEvent);

            return () => {
                ipc_renderer_instance.removeListener('mcp-activity-event', handleIncomingActivityEvent);
            };
        }
    }, [ipc_renderer_instance, refreshMcpData]);

    // WHAT: Copies configuration snippets to the system clipboard with temporary visual feedback.
    // WHY: Provides frictionless one-click setup for Claude Desktop, Antigravity, and Cursor.
    const copyToClipboard = async (target_text_to_copy: string, success_label_string: string) => {
        try {
            await navigator.clipboard.writeText(target_text_to_copy);
            setCopiedNotificationText(success_label_string);
            setTimeout(() => setCopiedNotificationText(''), 2500);
        } catch (clipboard_error) {
            console.error('Failed to copy text to clipboard:', clipboard_error);
        }
    };

    // WHAT: Installs the resolve_bridge.py script into DaVinci Resolve's Utility scripts directory.
    // WHY: Enables one-click onboarding if DaVinci Resolve is not yet configured with the bridge.
    const handleInstallBridgeScript = async () => {
        if (!ipc_renderer_instance) return;

        setIsInstallingBridge(true);
        try {
            const installation_result = await ipc_renderer_instance.invoke<{ success: boolean; target_path: string; error?: string }>('resolve-bridge-install');
            if (installation_result.success) {
                if (onStatusChange) {
                    onStatusChange(`Bridge script installed to ${installation_result.target_path}`);
                }
                await refreshMcpData();
            } else {
                alert(`Bridge installation failed: ${installation_result.error}`);
            }
        } catch (installation_error: unknown) {
            console.error('Bridge install failed:', installation_error);
        } finally {
            setIsInstallingBridge(false);
        }
    };

    // WHAT: Selects a tool from the catalog to inspect and test.
    // WHY: Pre-populates the JSON parameter template with placeholder schema values.
    const handleSelectToolForTesting = (target_tool: McpToolDefinition) => {
        setSelectedActiveTool(target_tool);
        setToolExecutionOutputText('');

        // Generate sample parameters object based on schema
        const sample_parameters_dictionary: Record<string, unknown> = {};
        if (target_tool.inputSchema && target_tool.inputSchema.properties) {
            for (const property_name of Object.keys(target_tool.inputSchema.properties)) {
                const property_definition = target_tool.inputSchema.properties[property_name];
                if (property_definition.type === 'string') {
                    sample_parameters_dictionary[property_name] = '';
                } else if (property_definition.type === 'number') {
                    sample_parameters_dictionary[property_name] = 0;
                } else if (property_definition.type === 'array') {
                    sample_parameters_dictionary[property_name] = [];
                } else if (property_definition.type === 'object') {
                    sample_parameters_dictionary[property_name] = {};
                }
            }
        }

        setToolArgumentsInputJson(JSON.stringify(sample_parameters_dictionary, null, 2));
    };

    // WHAT: Executes the selected MCP tool inside the Electron backend and records the output.
    // WHY: Allows interactive validation of tools before handing them over to external agents.
    const handleExecuteActiveTool = async () => {
        if (!ipc_renderer_instance || !selected_active_tool) return;

        setIsExecutingTool(true);
        setToolExecutionOutputText('Executing tool...');

        try {
            let parsed_arguments_dictionary: Record<string, unknown> = {};
            if (tool_arguments_input_json.trim()) {
                parsed_arguments_dictionary = JSON.parse(tool_arguments_input_json);
            }

            const execution_response = await ipc_renderer_instance.invoke<{ success: boolean; result?: unknown; error?: string }>(
                'mcp-execute-tool',
                {
                    tool_name: selected_active_tool.name,
                    tool_arguments: parsed_arguments_dictionary
                }
            );

            if (execution_response.success) {
                setToolExecutionOutputText(JSON.stringify(execution_response.result, null, 2));
            } else {
                setToolExecutionOutputText(`Error: ${execution_response.error || 'Unknown execution error'}`);
            }
        } catch (execution_error: unknown) {
            const error_message_string = execution_error instanceof Error ? execution_error.message : String(execution_error);
            setToolExecutionOutputText(`Failed to execute: ${error_message_string}`);
        } finally {
            setIsExecutingTool(false);
        }
    };

    // Filter tools by search query
    const filtered_tools_collection = registered_tools_collection.filter((tool_item) => {
        const query_text = tool_filter_query_string.toLowerCase();
        return (
            tool_item.name.toLowerCase().includes(query_text) ||
            tool_item.description.toLowerCase().includes(query_text)
        );
    });

    // -----------------------------------------------------------------------
    // Render Helpers
    // -----------------------------------------------------------------------

    const renderActiveConfigCode = () => {
        if (!client_configurations) return <div className="text-gray-500">Loading configurations...</div>;

        switch (selected_client_tab) {
            case 'claude':
                return (
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-xs text-gray-400 font-mono">
                                📍 Path: {client_configurations.claude_desktop_config_file_path}
                            </span>
                            <button
                                className="btn btn-primary text-xs py-1 px-3"
                                onClick={() => copyToClipboard(client_configurations.claude_desktop_configuration_json, 'Copied Claude Config!')}
                            >
                                📋 Copy Configuration
                            </button>
                        </div>
                        <pre className="bg-[#0f0f13] border border-gray-800 p-3 rounded text-xs text-indigo-300 font-mono overflow-x-auto">
                            {client_configurations.claude_desktop_configuration_json}
                        </pre>
                    </div>
                );

            case 'antigravity':
                return (
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-xs text-gray-400 font-mono">
                                📍 Antigravity config: Add under <code>mcpServers</code> in <code>.gemini/config/mcp_config.json</code>
                            </span>
                            <button
                                className="btn btn-primary text-xs py-1 px-3"
                                onClick={() => copyToClipboard(client_configurations.antigravity_configuration_json, 'Copied Antigravity Config!')}
                            >
                                📋 Copy Configuration
                            </button>
                        </div>
                        <pre className="bg-[#0f0f13] border border-gray-800 p-3 rounded text-xs text-emerald-300 font-mono overflow-x-auto">
                            {client_configurations.antigravity_configuration_json}
                        </pre>
                    </div>
                );

            case 'cursor':
                return (
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-xs text-gray-400 font-mono">
                                📍 Cursor config: Add under <code>mcpServers</code> in <code>.cursor/mcp.json</code>
                            </span>
                            <button
                                className="btn btn-primary text-xs py-1 px-3"
                                onClick={() => copyToClipboard(client_configurations.cursor_configuration_json, 'Copied Cursor Config!')}
                            >
                                📋 Copy Configuration
                            </button>
                        </div>
                        <pre className="bg-[#0f0f13] border border-gray-800 p-3 rounded text-xs text-purple-300 font-mono overflow-x-auto">
                            {client_configurations.cursor_configuration_json}
                        </pre>
                    </div>
                );

            case 'cli':
                return (
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-xs text-gray-400 font-mono">
                                📍 Run standalone stdio server directly in terminal:
                            </span>
                            <button
                                className="btn btn-primary text-xs py-1 px-3"
                                onClick={() => copyToClipboard(client_configurations.command_line_test_snippet, 'Copied CLI Command!')}
                            >
                                📋 Copy Command
                            </button>
                        </div>
                        <pre className="bg-[#0f0f13] border border-gray-800 p-3 rounded text-xs text-amber-300 font-mono overflow-x-auto">
                            {client_configurations.command_line_test_snippet}
                        </pre>
                    </div>
                );
        }
    };

    return (
        <div className="p-6 max-w-7xl mx-auto flex flex-col gap-6 text-gray-200">
            {/* Header */}
            <div className="flex justify-between items-center flex-wrap gap-4 border-b border-gray-800 pb-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2 text-white">
                        <span className="text-indigo-400">⚡</span> Model Context Protocol (MCP) Control
                    </h1>
                    <p className="text-sm text-gray-400 mt-1">
                        Connect external AI agents (Claude Desktop, Antigravity, Cursor, LangChain) directly to DaVinci Resolve and Resolver.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        className="btn btn-secondary flex items-center gap-1.5 text-xs py-2 px-3"
                        onClick={refreshMcpData}
                        disabled={is_refreshing_status}
                    >
                        <span>🔄</span> {is_refreshing_status ? 'Checking...' : 'Refresh Telemetry'}
                    </button>
                    <button
                        className="btn btn-primary flex items-center gap-1.5 text-xs py-2 px-3"
                        onClick={handleInstallBridgeScript}
                        disabled={is_installing_bridge}
                    >
                        <span>⚡</span> {is_installing_bridge ? 'Installing...' : 'Install Resolve Bridge'}
                    </button>
                </div>
            </div>

            {copied_notification_text && (
                <div className="bg-emerald-950/70 border border-emerald-600/50 text-emerald-200 px-4 py-2 rounded-md text-xs font-semibold flex items-center gap-2 shadow-lg animate-fade-in">
                    <span>✅</span> {copied_notification_text}
                </div>
            )}

            {/* Status Telemetry Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Card 1: MCP Server Status */}
                <div className="bg-[#141418] border border-gray-800/80 rounded-xl p-4 flex flex-col justify-between">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold">MCP Server</span>
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-950 text-emerald-400 border border-emerald-800">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                            Ready (Stdio)
                        </span>
                    </div>
                    <div className="text-sm font-semibold text-gray-200 mt-1">
                        {mcp_server_status?.registered_tools_count || 13} Tools Available
                    </div>
                    <div className="text-xs text-gray-400 mt-2 font-mono truncate" title={mcp_server_status?.server_script_path}>
                        scripts/resolver-mcp-server.mjs
                    </div>
                </div>

                {/* Card 2: DaVinci Resolve Bridge Status */}
                <div className="bg-[#141418] border border-gray-800/80 rounded-xl p-4 flex flex-col justify-between">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold">DaVinci Resolve Bridge</span>
                        {mcp_server_status?.davinci_resolve_bridge_online ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-950 text-emerald-400 border border-emerald-800">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                Connected (8878)
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-950 text-amber-400 border border-amber-800">
                                <span>⚠️</span> Offline
                            </span>
                        )}
                    </div>
                    <div className="text-sm font-semibold text-gray-200 mt-1 truncate">
                        Project: {mcp_server_status?.davinci_resolve_active_project || 'None active'}
                    </div>
                    <div className="text-xs text-gray-400 mt-2 truncate">
                        Timeline: {mcp_server_status?.davinci_resolve_active_timeline || 'None selected'}
                    </div>
                </div>

                {/* Card 3: Project Storage Location */}
                <div className="bg-[#141418] border border-gray-800/80 rounded-xl p-4 flex flex-col justify-between">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold">Project Storage</span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-950 text-indigo-300 border border-indigo-800">
                            PRJ_ Bundles
                        </span>
                    </div>
                    <div className="text-sm font-semibold text-gray-200 mt-1 truncate" title={mcp_server_status?.project_output_directory_path}>
                        {mcp_server_status?.project_output_directory_path ? mcp_server_status.project_output_directory_path.split(/[\\/]/).pop() : 'output'}
                    </div>
                    <div className="text-xs text-gray-400 mt-2 font-mono truncate" title={mcp_server_status?.project_output_directory_path}>
                        {mcp_server_status?.project_output_directory_path || 'Scanning root...'}
                    </div>
                </div>
            </div>

            {/* AI Assistant Client Configuration Section */}
            <div className="bg-[#141418] border border-gray-800/80 rounded-xl p-5">
                <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
                    <div>
                        <h2 className="text-base font-bold text-white flex items-center gap-2">
                            <span>🤖</span> 1-Click AI Client Configuration
                        </h2>
                        <p className="text-xs text-gray-400 mt-0.5">
                            Copy this configuration snippet into your AI desktop client to enable DaVinci Resolve &amp; Resolver tools.
                        </p>
                    </div>

                    {/* Tabs */}
                    <div className="flex bg-[#0f0f13] p-1 rounded-lg border border-gray-800 text-xs">
                        <button
                            className={`px-3 py-1 rounded-md transition-colors ${selected_client_tab === 'claude' ? 'bg-indigo-600 text-white font-medium shadow' : 'text-gray-400 hover:text-gray-200'}`}
                            onClick={() => setSelectedClientTab('claude')}
                        >
                            Claude Desktop
                        </button>
                        <button
                            className={`px-3 py-1 rounded-md transition-colors ${selected_client_tab === 'antigravity' ? 'bg-indigo-600 text-white font-medium shadow' : 'text-gray-400 hover:text-gray-200'}`}
                            onClick={() => setSelectedClientTab('antigravity')}
                        >
                            Antigravity
                        </button>
                        <button
                            className={`px-3 py-1 rounded-md transition-colors ${selected_client_tab === 'cursor' ? 'bg-indigo-600 text-white font-medium shadow' : 'text-gray-400 hover:text-gray-200'}`}
                            onClick={() => setSelectedClientTab('cursor')}
                        >
                            Cursor
                        </button>
                        <button
                            className={`px-3 py-1 rounded-md transition-colors ${selected_client_tab === 'cli' ? 'bg-indigo-600 text-white font-medium shadow' : 'text-gray-400 hover:text-gray-200'}`}
                            onClick={() => setSelectedClientTab('cli')}
                        >
                            Terminal / CLI
                        </button>
                    </div>
                </div>

                {renderActiveConfigCode()}
            </div>

            {/* Interactive Tool Catalog & Tester */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left: Tool Catalog */}
                <div className="bg-[#141418] border border-gray-800/80 rounded-xl p-5 flex flex-col h-[520px]">
                    <div className="flex justify-between items-center mb-3">
                        <h2 className="text-base font-bold text-white flex items-center gap-2">
                            <span>🛠️</span> Registered Tools Catalog ({filtered_tools_collection.length})
                        </h2>
                    </div>

                    <div className="mb-3">
                        <input
                            type="text"
                            placeholder="Search tools by name or purpose..."
                            value={tool_filter_query_string}
                            onChange={(e) => setToolFilterQueryString(e.target.value)}
                            className="w-full bg-[#0f0f13] border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                        />
                    </div>

                    <div className="overflow-y-auto flex-1 pr-1 space-y-2.5 custom-scrollbar">
                        {filtered_tools_collection.length === 0 ? (
                            <div className="text-center py-10 text-xs text-gray-500">
                                No tools match &quot;{tool_filter_query_string}&quot;
                            </div>
                        ) : (
                            filtered_tools_collection.map((tool_item) => (
                                <div
                                    key={tool_item.name}
                                    onClick={() => handleSelectToolForTesting(tool_item)}
                                    className={`p-3 rounded-lg border transition-all cursor-pointer ${selected_active_tool?.name === tool_item.name
                                        ? 'bg-indigo-950/40 border-indigo-500/80 shadow-md'
                                        : 'bg-[#18181f] border-gray-800/80 hover:border-gray-700'
                                        }`}
                                >
                                    <div className="flex justify-between items-center">
                                        <span className="font-mono text-xs font-bold text-indigo-300">
                                            {tool_item.name}
                                        </span>
                                        <span className="text-[10px] text-gray-400 bg-gray-900 px-2 py-0.5 rounded border border-gray-800">
                                            {tool_item.name.startsWith('resolve_') ? 'DaVinci Resolve' : tool_item.name.startsWith('comfyui_') ? 'ComfyUI' : 'Resolver'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-400 mt-1.5 line-clamp-2 leading-relaxed">
                                        {tool_item.description}
                                    </p>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Right: Interactive Tool Tester */}
                <div className="bg-[#141418] border border-gray-800/80 rounded-xl p-5 flex flex-col h-[520px]">
                    <div className="flex justify-between items-center mb-3">
                        <h2 className="text-base font-bold text-white flex items-center gap-2">
                            <span>🧪</span> Interactive Tool Tester
                        </h2>
                        {selected_active_tool && (
                            <span className="font-mono text-xs text-indigo-400 font-bold bg-indigo-950/60 px-2.5 py-1 rounded border border-indigo-800/50">
                                {selected_active_tool.name}
                            </span>
                        )}
                    </div>

                    {selected_active_tool ? (
                        <div className="flex flex-col flex-1 gap-3 overflow-hidden">
                            <p className="text-xs text-gray-300">
                                {selected_active_tool.description}
                            </p>

                            <div className="flex flex-col flex-1 min-h-0">
                                <label className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider mb-1">
                                    Parameters (JSON Arguments)
                                </label>
                                <textarea
                                    value={tool_arguments_input_json}
                                    onChange={(e) => setToolArgumentsInputJson(e.target.value)}
                                    className="w-full flex-1 bg-[#0f0f13] border border-gray-800 rounded-lg p-2.5 text-xs text-gray-200 font-mono resize-none focus:outline-none focus:border-indigo-500 custom-scrollbar"
                                />
                            </div>

                            <div className="flex justify-end gap-2">
                                <button
                                    className="btn btn-primary text-xs py-1.5 px-4 flex items-center gap-1.5"
                                    onClick={handleExecuteActiveTool}
                                    disabled={is_executing_tool}
                                >
                                    <span>⚡</span> {is_executing_tool ? 'Executing...' : 'Run Tool'}
                                </button>
                            </div>

                            {tool_execution_output_text && (
                                <div className="flex flex-col max-h-[140px] overflow-hidden border-t border-gray-800 pt-2">
                                    <label className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider mb-1">
                                        Execution Output
                                    </label>
                                    <pre className="bg-[#0b0b0e] border border-gray-800/80 p-2.5 rounded text-xs font-mono text-emerald-300 overflow-y-auto flex-1 custom-scrollbar">
                                        {tool_execution_output_text}
                                    </pre>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-500 text-xs p-6">
                            <span className="text-3xl mb-2 opacity-50">👈</span>
                            Select any tool from the catalog on the left to inspect its input schema and test execution.
                        </div>
                    )}
                </div>
            </div>

            {/* Live Agent Activity Feed */}
            <div className="bg-[#141418] border border-gray-800/80 rounded-xl p-5">
                <div className="flex justify-between items-center mb-3">
                    <div>
                        <h2 className="text-base font-bold text-white flex items-center gap-2">
                            <span>📡</span> Live Agent Activity Log
                        </h2>
                        <p className="text-xs text-gray-400 mt-0.5">
                            Real-time stream of tool calls triggered by external AI agents or interactive tests.
                        </p>
                    </div>

                    {activity_log_entries_collection.length > 0 && (
                        <button
                            className="btn btn-secondary text-xs py-1 px-3"
                            onClick={() => setActivityLogEntriesCollection([])}
                        >
                            Clear Activity Log
                        </button>
                    )}
                </div>

                {activity_log_entries_collection.length === 0 ? (
                    <div className="text-center py-8 text-xs text-gray-500 border border-dashed border-gray-800/80 rounded-lg">
                        Waiting for tool invocations from AI agents or interactive tests...
                    </div>
                ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-1">
                        {activity_log_entries_collection.map((activity_item) => (
                            <div
                                key={activity_item.identifier}
                                className={`p-3 rounded-lg border text-xs flex flex-col gap-1.5 ${activity_item.success
                                    ? 'bg-emerald-950/20 border-emerald-900/50'
                                    : 'bg-rose-950/20 border-rose-900/50'
                                    }`}
                            >
                                <div className="flex justify-between items-center flex-wrap gap-2">
                                    <div className="flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full ${activity_item.success ? 'bg-emerald-400' : 'bg-rose-400'}`}></span>
                                        <span className="font-mono font-bold text-white">{activity_item.tool_name}</span>
                                        <span className="text-gray-400 text-[11px] font-mono">({activity_item.execution_duration_milliseconds}ms)</span>
                                    </div>
                                    <span className="text-gray-500 text-[11px]">{activity_item.timestamp}</span>
                                </div>

                                <div className="text-gray-300 font-mono text-[11px] bg-[#0d0d10] p-1.5 rounded truncate">
                                    {activity_item.result_summary}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
