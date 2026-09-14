/**
 * src/services/mcpClientTest.test.ts
 * 
 * WHAT:
 *   Unit tests validating Model Context Protocol (MCP) tool schemas,
 *   tool definitions, and client configuration generators.
 * 
 * WHY:
 *   Ensures that all tools exposed to external AI models (Claude Desktop,
 *   Antigravity, Cursor, LangChain) adhere to MCP 2024-11-05 specifications
 *   with well-formed JSON schemas, valid parameter definitions, and robust structure.
 */

import { describe, it, expect } from 'vitest';
import {
    REGISTERED_MCP_TOOLS_DEFINITIONS,
    generateMcpClientConfigurations
} from '../../electron/mcpBridge';

describe('Model Context Protocol (MCP) Tool Specifications', () => {
    it('registers all 13 required tools for DaVinci Resolve, Resolver, and ComfyUI', () => {
        // WHAT: Verifying the tool catalog contains the full expected suite.
        // WHY: External agents depend on exact tool names for tool calling.
        const registered_tool_names_collection = REGISTERED_MCP_TOOLS_DEFINITIONS.map(
            (tool_definition) => tool_definition.name
        );

        expect(REGISTERED_MCP_TOOLS_DEFINITIONS.length).toBe(13);
        expect(registered_tool_names_collection).toContain('resolve_get_status');
        expect(registered_tool_names_collection).toContain('resolve_install_bridge');
        expect(registered_tool_names_collection).toContain('resolve_push_markers');
        expect(registered_tool_names_collection).toContain('resolve_import_media');
        expect(registered_tool_names_collection).toContain('resolve_reconstruct_timeline');
        expect(registered_tool_names_collection).toContain('resolve_execute_rpc');
        expect(registered_tool_names_collection).toContain('resolver_list_projects');
        expect(registered_tool_names_collection).toContain('resolver_get_project');
        expect(registered_tool_names_collection).toContain('resolver_update_project');
        expect(registered_tool_names_collection).toContain('resolver_update_clip_prompt');
        expect(registered_tool_names_collection).toContain('resolver_add_clip');
        expect(registered_tool_names_collection).toContain('comfyui_get_status');
        expect(registered_tool_names_collection).toContain('comfyui_list_workflows');
    });

    it('ensures each tool has non-empty description and object inputSchema', () => {
        // WHAT: Auditing each tool definition against MCP standards.
        // WHY: LLM tool pickers require clear semantic descriptions and type schemas.
        for (const tool_definition_item of REGISTERED_MCP_TOOLS_DEFINITIONS) {
            expect(tool_definition_item.name).toBeTruthy();
            expect(tool_definition_item.description.length).toBeGreaterThan(15);
            expect(tool_definition_item.inputSchema.type).toBe('object');
            expect(typeof tool_definition_item.inputSchema.properties).toBe('object');
        }
    });

    it('validates resolve_push_markers inputSchema requires markers array', () => {
        // WHAT: Checking parameter validation schema for marker insertion.
        // WHY: Guarantees AI models provide structured marker lists with frame offsets.
        const push_markers_tool = REGISTERED_MCP_TOOLS_DEFINITIONS.find(
            (candidate_tool) => candidate_tool.name === 'resolve_push_markers'
        );

        expect(push_markers_tool).toBeDefined();
        expect(push_markers_tool?.inputSchema.required).toContain('markers');
        expect(push_markers_tool?.inputSchema.properties.markers.type).toBe('array');
    });

    it('validates resolve_reconstruct_timeline inputSchema requires project_name and clips', () => {
        // WHAT: Checking schema requirements for timeline reconstruction.
        // WHY: Timeline builder needs project title and clip list to assemble media.
        const reconstruct_timeline_tool = REGISTERED_MCP_TOOLS_DEFINITIONS.find(
            (candidate_tool) => candidate_tool.name === 'resolve_reconstruct_timeline'
        );

        expect(reconstruct_timeline_tool).toBeDefined();
        expect(reconstruct_timeline_tool?.inputSchema.required).toContain('project_name');
        expect(reconstruct_timeline_tool?.inputSchema.required).toContain('timeline_clips_collection');
    });

    it('validates resolver_update_clip_prompt requires project_identifier and clip_identifier', () => {
        // WHAT: Checking schema requirements for storyboard shot prompt editing.
        // WHY: Pinpoints exact clip inside a project to update AI director notes.
        const update_clip_tool = REGISTERED_MCP_TOOLS_DEFINITIONS.find(
            (candidate_tool) => candidate_tool.name === 'resolver_update_clip_prompt'
        );

        expect(update_clip_tool).toBeDefined();
        expect(update_clip_tool?.inputSchema.required).toContain('project_identifier');
        expect(update_clip_tool?.inputSchema.required).toContain('clip_identifier');
    });
});

describe('MCP Client Configuration Generators', () => {
    it('generates valid JSON configurations for Claude Desktop, Antigravity, and Cursor', () => {
        // WHAT: Testing 1-click configuration generation output.
        // WHY: Users copy/paste this JSON directly into client settings files.
        const client_configurations_result = generateMcpClientConfigurations();

        // Claude Desktop
        const parsed_claude_configuration = JSON.parse(client_configurations_result.claude_desktop_configuration_json);
        expect(parsed_claude_configuration.mcpServers.resolver).toBeDefined();
        expect(parsed_claude_configuration.mcpServers.resolver.command).toBe('node');
        expect(parsed_claude_configuration.mcpServers.resolver.args[0]).toContain('resolver-mcp-server.mjs');

        // Antigravity
        const parsed_antigravity_configuration = JSON.parse(client_configurations_result.antigravity_configuration_json);
        expect(parsed_antigravity_configuration.mcpServers.resolver).toBeDefined();

        // Cursor
        const parsed_cursor_configuration = JSON.parse(client_configurations_result.cursor_configuration_json);
        expect(parsed_cursor_configuration.mcpServers.resolver).toBeDefined();

        // CLI Snippet
        expect(client_configurations_result.command_line_test_snippet).toContain('resolver-mcp-server.mjs');
    });
});
