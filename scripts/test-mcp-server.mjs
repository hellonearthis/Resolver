#!/usr/bin/env node
/**
 * scripts/test-mcp-server.mjs
 * 
 * WHAT:
 *   Comprehensive test suite verifying Resolver's Model Context Protocol (MCP) server.
 *   Tests stdio handshake, server-level instructions, resource listing, resource reading,
 *   tool discovery, and tool execution.
 * 
 * WHY:
 *   Prevents regressions across MCP SDK updates, ensures new resources and tools stay
 *   functional, and validates that external AI clients (Claude Desktop, Antigravity, Cursor)
 *   receive expected capabilities.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const current_module_file_path = fileURLToPath(import.meta.url);
const current_scripts_directory_path = path.dirname(current_module_file_path);
const workspace_root_directory_path = path.resolve(current_scripts_directory_path, '..');
const mcp_server_script_file_path = path.join(current_scripts_directory_path, 'resolver-mcp-server.mjs');

// WHAT: Executes full client-server lifecycle and verifies protocol primitives.
// WHY: Ensures both tools and resources capabilities operate flawlessly.
async function executeResolverMcpServerVerification() {
    process.stdout.write('⚡ Starting Resolver MCP Server Automated Verification...\n');

    // WHAT: Initializing stdio transport to launch the standalone MCP server process.
    // WHY: Replicates the exact invocation method used by Claude Desktop and Cursor.
    const stdio_client_transport_instance = new StdioClientTransport({
        command: 'node',
        args: [mcp_server_script_file_path],
    });

    const mcp_test_client_instance = new Client(
        {
            name: 'resolver-automated-test-client',
            version: '1.0.0',
        },
        {
            capabilities: {},
        }
    );

    await mcp_test_client_instance.connect(stdio_client_transport_instance);
    process.stdout.write('  ✓ Stdio connection and initialization handshake established.\n');

    // 1. Verify Built-in Instructions
    const received_server_instructions_string = mcp_test_client_instance.getInstructions();
    if (!received_server_instructions_string || !received_server_instructions_string.includes('Resolver & DaVinci Resolve MCP Operational Guidelines')) {
        throw new Error('Server instructions were missing or corrupted in initialization handshake.');
    }
    process.stdout.write('  ✓ Built-in agent operational instructions verified in handshake.\n');

    // 2. Verify Resources Listing
    const list_resources_response_record = await mcp_test_client_instance.listResources();
    const discovered_resources_collection = list_resources_response_record.resources || [];
    if (discovered_resources_collection.length === 0) {
        throw new Error('Expected registered resources, but server returned an empty catalog.');
    }
    process.stdout.write(`  ✓ Discovered ${discovered_resources_collection.length} MCP resources (schemas, references, active project, workflows).\n`);

    // 3. Verify Reading Marker Conventions Markdown Resource
    const marker_conventions_resource = await mcp_test_client_instance.readResource({
        uri: 'resolver://resolve/marker-conventions'
    });
    if (!marker_conventions_resource.contents?.[0]?.text?.includes('Beat Markers')) {
        throw new Error('Marker conventions resource content validation failed.');
    }
    process.stdout.write('  ✓ Resource read verified: resolver://resolve/marker-conventions (text/markdown).\n');

    // 4. Verify Reading Project Bundle Schema Resource
    const project_schema_resource = await mcp_test_client_instance.readResource({
        uri: 'resolver://schemas/project-bundle'
    });
    const parsed_project_schema_payload = JSON.parse(project_schema_resource.contents[0].text);
    if (parsed_project_schema_payload.title !== 'ResolverProjectBundle') {
        throw new Error('Project bundle schema validation failed.');
    }
    process.stdout.write('  ✓ Resource read verified: resolver://schemas/project-bundle (application/json).\n');

    // 5. Verify Reading Active Project Resource
    const active_project_resource = await mcp_test_client_instance.readResource({
        uri: 'resolver://projects/active'
    });
    JSON.parse(active_project_resource.contents[0].text);
    process.stdout.write('  ✓ Resource read verified: resolver://projects/active (dynamic project snapshot).\n');

    // 6. Verify Reading ComfyUI Workflows Resource
    const candidate_workflow_resource = discovered_resources_collection.find((resource_item) =>
        resource_item.uri.startsWith('resolver://comfyui/workflows/')
    );
    if (candidate_workflow_resource) {
        const read_workflow_resource = await mcp_test_client_instance.readResource({
            uri: candidate_workflow_resource.uri
        });
        JSON.parse(read_workflow_resource.contents[0].text);
        process.stdout.write(`  ✓ Resource read verified: ${candidate_workflow_resource.uri} (valid JSON workflow).\n`);
    }

    // 7. Verify Tools Catalog
    const list_tools_response_record = await mcp_test_client_instance.listTools();
    const discovered_tools_collection = list_tools_response_record.tools || [];
    if (discovered_tools_collection.length !== 13) {
        throw new Error(`Expected 13 registered tools, but received ${discovered_tools_collection.length}.`);
    }
    process.stdout.write(`  ✓ Tool catalog verified: all 13 tools registered and operational.\n`);

    // 8. Verify Tool Invocation (comfyui_list_workflows)
    const tool_invocation_response = await mcp_test_client_instance.callTool({
        name: 'comfyui_list_workflows',
        arguments: {},
    });
    if (tool_invocation_response.isError) {
        throw new Error('Tool invocation failed with error response.');
    }
    process.stdout.write('  ✓ Tool call verified: comfyui_list_workflows executed cleanly.\n');

    await mcp_test_client_instance.close();
    process.stdout.write('🎉 All Resolver MCP Server Verifications Passed Successfully!\n');
}

executeResolverMcpServerVerification().catch((verification_error) => {
    process.stderr.write(`❌ MCP Verification Failed: ${verification_error?.message || verification_error}\n`);
    process.exit(1);
});
