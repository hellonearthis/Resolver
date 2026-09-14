import React, { useState, useEffect } from 'react';
import DropZone from '../components/DropZone';
import CollapsibleCard from '../components/CollapsibleCard';

// WHAT: Callback props for the WorkflowAnalyzerModule.
// WHY: Allows the parent container to display status banners or toast notifications when
// workflows are parsed or encountered an error.
interface WorkflowAnalyzerModuleProps {
    onStatusChange?: (status_message: string) => void;
}

// WHAT: Structured representation of a parsed ComfyUI workflow node.
// WHY: Standardizes both ComfyUI web format and ComfyUI API prompt graph nodes into a uniform view.
interface ParsedNode {
    id: string;
    type: string;
    title: string;
    inputs: Record<string, unknown>;
    isInput: boolean;
    isOutput: boolean;
}

// WHAT: Description of a discovered local JSON workflow file on disk.
// WHY: Displayed in the sidebar to enable quick loading of templates or test workflows.
interface SavedWorkflow {
    name: string;
    path: string;
}

// WHAT: Minimal duck-typed interface for Node.js fs and path in Electron environment.
// WHY: Avoids strict Node import errors in client Vite build while allowing native filesystem access in desktop runtime.
interface NodeFsModule {
    existsSync: (file_path: string) => boolean;
    readdirSync: (directory_path: string) => string[];
    readFileSync: (file_path: string, encoding: string) => string;
}

interface NodePathModule {
    resolve: (relative_path: string) => string;
    join: (...path_segments: string[]) => string;
}

interface ElectronWindowExtended {
    require?: (module_name: string) => unknown;
}

const electron_window = window as unknown as ElectronWindowExtended;
const node_fs_module: NodeFsModule | null = electron_window.require ? (electron_window.require('fs') as NodeFsModule) : null;
const node_path_module: NodePathModule | null = electron_window.require ? (electron_window.require('path') as NodePathModule) : null;

// WHAT: Raw node definition inside ComfyUI API prompt graphs or web export JSON files.
// WHY: Provides type-safe access to class_type, _meta titles, and inputs.
interface ComfyWorkflowRawNode {
    id?: string;
    class_type?: string;
    _meta?: {
        title?: string;
    };
    inputs?: Record<string, unknown>;
}

const WorkflowAnalyzerModule: React.FC<WorkflowAnalyzerModuleProps> = ({ onStatusChange }) => {
    const [fileName, setFileName] = useState<string | null>(null);
    const [rawNodes, setRawNodes] = useState<ParsedNode[]>([]);
    const [inputNodes, setInputNodes] = useState<ParsedNode[]>([]);
    const [outputNodes, setOutputNodes] = useState<ParsedNode[]>([]);
    const [savedWorkflows, setSavedWorkflows] = useState<SavedWorkflow[]>([]);

    // WHAT: Scan local filesystem for pre-existing ComfyUI workflows on mount.
    // WHY: Enables users to quickly pick existing templates without manually dragging them in each time.
    useEffect(() => {
        if (!node_fs_module || !node_path_module) return;
        try {
            // Try ./workflows first, fall back to ./comfyui_workflows
            let target_workflow_directory_path = node_path_module.resolve('./workflows');
            if (!node_fs_module.existsSync(target_workflow_directory_path)) {
                target_workflow_directory_path = node_path_module.resolve('./comfyui_workflows');
            }
            if (node_fs_module.existsSync(target_workflow_directory_path)) {
                const workflow_file_names: string[] = node_fs_module.readdirSync(target_workflow_directory_path);
                const saved_workflow_entries: SavedWorkflow[] = workflow_file_names
                    .filter((file_name) => file_name.endsWith('.json'))
                    .map((file_name) => ({
                        name: file_name.replace('.json', ''),
                        path: node_path_module!.join(target_workflow_directory_path, file_name),
                    }));

                Promise.resolve().then(() => {
                    setSavedWorkflows(saved_workflow_entries);
                });
            }
        } catch (error_instance) {
            console.warn('Failed to read workflows directory:', error_instance);
        }
    }, []);

    // WHAT: Parses ComfyUI workflow JSON strings into categorized input, output, and processing nodes.
    // WHY: ComfyUI exports have two distinct shapes: Web GUI format (has a .nodes array) and API prompt format
    // (keyed dictionary of node objects). This normalizer unifies both formats and tags inputs/outputs.
    const parseJsonContent = (workflow_file_text_content: string, source_name: string) => {
        let parsed_workflow_json_data: unknown;
        try {
            parsed_workflow_json_data = JSON.parse(workflow_file_text_content);
        } catch {
            if (onStatusChange) onStatusChange('Error parsing JSON. Is it a valid ComfyUI API export?');
            return;
        }

        if (typeof parsed_workflow_json_data !== 'object' || parsed_workflow_json_data === null) {
            if (onStatusChange) onStatusChange('Invalid JSON content: Root must be an object.');
            return;
        }

        let workflow_nodes_record: Record<string, ComfyWorkflowRawNode> = parsed_workflow_json_data as Record<string, ComfyWorkflowRawNode>;

        // Handle ComfyUI Web format (which stores nodes in a .nodes array instead of top-level keys)
        const possible_web_format = parsed_workflow_json_data as { nodes?: ComfyWorkflowRawNode[] };
        if (Array.isArray(possible_web_format.nodes)) {
            if (onStatusChange) onStatusChange('Warning: This looks like a ComfyUI Web format (not API export). Results may be incomplete.');
            workflow_nodes_record = {};
            possible_web_format.nodes.forEach((workflow_node_item, fallback_index) => {
                const node_key = workflow_node_item.id ?? String(fallback_index);
                workflow_nodes_record[node_key] = workflow_node_item;
            });
        }

        const parsed_nodes_list: ParsedNode[] = [];
        const detected_inputs_list: ParsedNode[] = [];
        const detected_outputs_list: ParsedNode[] = [];

        for (const [node_identifier, node_definition] of Object.entries(workflow_nodes_record)) {
            const class_type_identifier = node_definition.class_type || 'Unknown';
            const metadata_title_string: string = node_definition._meta?.title || class_type_identifier;
            const lower_cased_title = metadata_title_string.toLowerCase();
            const is_input_node = lower_cased_title.includes('[input]');
            const is_output_node = lower_cased_title.includes('[output]');

            const parsed_workflow_node: ParsedNode = {
                id: node_identifier,
                type: class_type_identifier,
                title: metadata_title_string,
                inputs: node_definition.inputs || {},
                isInput: is_input_node,
                isOutput: is_output_node,
            };

            parsed_nodes_list.push(parsed_workflow_node);
            if (is_input_node) detected_inputs_list.push(parsed_workflow_node);
            if (is_output_node) detected_outputs_list.push(parsed_workflow_node);
        }

        setRawNodes(parsed_nodes_list);
        setInputNodes(detected_inputs_list);
        setOutputNodes(detected_outputs_list);
        setFileName(source_name);

        if (onStatusChange) {
            onStatusChange(`Parsed "${source_name}" — ${detected_inputs_list.length} inputs, ${detected_outputs_list.length} outputs, ${parsed_nodes_list.length} total nodes.`);
        }
    };

    // WHAT: Handles drag-and-drop workflow file ingestion.
    // WHY: Provides frictionless workflow loading without file pickers.
    const handleFileDrop = async (dropped_workflow_file: File) => {
        try {
            const workflow_text = await dropped_workflow_file.text();
            parseJsonContent(workflow_text, dropped_workflow_file.name);
        } catch (error_instance) {
            if (onStatusChange) onStatusChange(`Failed to read dropped file: ${error_instance}`);
        }
    };

    // WHAT: Reads a saved workflow JSON file from local disk.
    // WHY: Enables clicking sidebar workflow items to inspect their node structure.
    const handleLoadSavedWorkflow = (saved_workflow: SavedWorkflow) => {
        if (!node_fs_module) return;
        try {
            const workflow_text: string = node_fs_module.readFileSync(saved_workflow.path, 'utf8');
            parseJsonContent(workflow_text, saved_workflow.name + '.json');
        } catch (error_instance) {
            if (onStatusChange) onStatusChange(`Failed to read ${saved_workflow.name}: ${error_instance}`);
        }
    };

    return (
        <div className="module-container">
            <div className="module-header">
                <h2 className="module-title">🔀 Workflow Analyzer</h2>
                <p className="module-description text-gray-400">
                    Load a ComfyUI API JSON workflow. Nodes with <code>[input]</code> or <code>[output]</code> in their title will be detected automatically.
                </p>
            </div>

            {/* Top row: drop zone + local files sidebar */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <div className="lg:col-span-3">
                    <CollapsibleCard title="Load Workflow" defaultOpen={true}>
                        <DropZone
                            onFilesDropped={(dropped_files_list: File[]) => handleFileDrop(dropped_files_list[0])}
                            accept=".json,application/json"
                            label={fileName ? `✅ Loaded: ${fileName}` : 'Drop ComfyUI API JSON File Here'}
                        />
                    </CollapsibleCard>
                </div>

                <div className="lg:col-span-1">
                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-4 flex flex-col gap-2 h-full">
                        <h3 className="text-sm font-bold text-gray-300 mb-1 border-b border-gray-700 pb-2">📂 Local Workflows</h3>
                        {savedWorkflows.length > 0 ? (
                            <div className="flex flex-col gap-1 overflow-y-auto max-h-56 scrollbar">
                                {savedWorkflows.map(saved_workflow => (
                                    <button
                                        key={saved_workflow.path}
                                        onClick={() => handleLoadSavedWorkflow(saved_workflow)}
                                        title={saved_workflow.path}
                                        className={`text-left px-3 py-2 text-xs rounded transition-colors ${fileName === saved_workflow.name + '.json'
                                                ? 'bg-indigo-600/30 text-indigo-200 border border-indigo-500/40'
                                                : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-transparent'
                                            }`}
                                    >
                                        📄 {saved_workflow.name}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-gray-500 italic mt-2">No <code>.json</code> files found in <code>./workflows</code></p>
                        )}
                    </div>
                </div>
            </div>

            {/* Analysis results */}
            {rawNodes.length > 0 && (
                <div className="mt-6 flex flex-col gap-6">

                    {/* Input + Output side-by-side */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                        {/* INPUTS */}
                        <CollapsibleCard title={`Inputs (${inputNodes.length})`} defaultOpen={true}>
                            {inputNodes.length === 0 ? (
                                <p className="text-gray-500 text-sm italic">No nodes tagged <code>[input]</code>.</p>
                            ) : (
                                <div className="flex flex-col gap-3">
                                    {inputNodes.map(parsed_input_node => (
                                        <div key={parsed_input_node.id} className="bg-indigo-900/20 border border-indigo-700/30 p-3 rounded-lg">
                                            <div className="flex justify-between items-start mb-1">
                                                <h4 className="font-bold text-indigo-300 text-sm">{parsed_input_node.title}</h4>
                                                <span className="text-[10px] bg-indigo-950 px-1.5 py-0.5 rounded text-indigo-400 font-mono ml-2 shrink-0">#{parsed_input_node.id}</span>
                                            </div>
                                            <p className="text-xs text-indigo-200/60 font-mono mb-2">{parsed_input_node.type}</p>
                                            {Object.keys(parsed_input_node.inputs).length > 0 && (
                                                <ul className="text-xs text-indigo-100/70 list-disc list-inside space-y-0.5 ml-1">
                                                    {Object.entries(parsed_input_node.inputs).map(([input_property_name, input_property_value]) => (
                                                        <li key={input_property_name} title={String(input_property_value)}>
                                                            <span className="font-medium">{input_property_name}</span>:{' '}
                                                            {typeof input_property_value === 'object' ? '[linked]' : String(input_property_value).substring(0, 50)}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CollapsibleCard>

                        {/* OUTPUTS */}
                        <CollapsibleCard title={`Outputs (${outputNodes.length})`} defaultOpen={true}>
                            {outputNodes.length === 0 ? (
                                <p className="text-gray-500 text-sm italic">No nodes tagged <code>[output]</code>.</p>
                            ) : (
                                <div className="flex flex-col gap-3">
                                    {outputNodes.map(parsed_output_node => (
                                        <div key={parsed_output_node.id} className="bg-green-900/20 border border-green-700/30 p-3 rounded-lg">
                                            <div className="flex justify-between items-start mb-1">
                                                <h4 className="font-bold text-green-300 text-sm">{parsed_output_node.title}</h4>
                                                <span className="text-[10px] bg-green-950 px-1.5 py-0.5 rounded text-green-400 font-mono ml-2 shrink-0">#{parsed_output_node.id}</span>
                                            </div>
                                            <p className="text-xs text-green-200/60 font-mono">{parsed_output_node.type}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CollapsibleCard>
                    </div>

                    {/* ALL NODES TABLE */}
                    <CollapsibleCard title={`All Nodes (${rawNodes.length})`} defaultOpen={false}>
                        <div className="max-h-96 overflow-y-auto scrollbar">
                            <table className="w-full text-left text-sm border-collapse">
                                <thead className="sticky top-0 bg-[var(--bg-secondary)] z-10">
                                    <tr>
                                        <th className="p-2 border-b border-gray-700 text-gray-400 font-medium">ID</th>
                                        <th className="p-2 border-b border-gray-700 text-gray-400 font-medium">Title</th>
                                        <th className="p-2 border-b border-gray-700 text-gray-400 font-medium">Class</th>
                                        <th className="p-2 border-b border-gray-700 text-gray-400 font-medium text-right">Tags</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rawNodes.map(table_row_node => (
                                        <tr key={table_row_node.id} className="border-b border-gray-800/60 hover:bg-white/5 transition-colors">
                                            <td className="p-2 font-mono text-gray-500 text-xs">{table_row_node.id}</td>
                                            <td className="p-2 text-gray-200">{table_row_node.title}</td>
                                            <td className="p-2 text-gray-400 text-xs font-mono">{table_row_node.type}</td>
                                            <td className="p-2 text-right">
                                                <div className="flex justify-end gap-1">
                                                    {table_row_node.isInput && <span className="bg-indigo-900 text-indigo-200 text-[10px] px-1.5 py-0.5 rounded">INPUT</span>}
                                                    {table_row_node.isOutput && <span className="bg-green-900 text-green-200 text-[10px] px-1.5 py-0.5 rounded">OUTPUT</span>}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </CollapsibleCard>

                </div>
            )}
        </div>
    );
};

export default WorkflowAnalyzerModule;

