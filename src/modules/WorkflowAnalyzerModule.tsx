import React, { useState, useEffect } from 'react';
import DropZone from '../components/DropZone';
import CollapsibleCard from '../components/CollapsibleCard';

interface WorkflowAnalyzerModuleProps {
    onStatusChange?: (msg: string) => void;
}

interface ParsedNode {
    id: string;
    type: string;
    title: string;
    inputs: Record<string, any>;
    isInput: boolean;
    isOutput: boolean;
}

interface SavedWorkflow {
    name: string;
    path: string;
}

// Access Node.js APIs via Electron's nodeIntegration
const fs = (window as any).require ? (window as any).require('fs') : null;
const nodePath = (window as any).require ? (window as any).require('path') : null;

const WorkflowAnalyzerModule: React.FC<WorkflowAnalyzerModuleProps> = ({ onStatusChange }) => {
    const [fileName, setFileName] = useState<string | null>(null);
    const [rawNodes, setRawNodes] = useState<ParsedNode[]>([]);
    const [inputNodes, setInputNodes] = useState<ParsedNode[]>([]);
    const [outputNodes, setOutputNodes] = useState<ParsedNode[]>([]);
    const [savedWorkflows, setSavedWorkflows] = useState<SavedWorkflow[]>([]);

    useEffect(() => {
        if (!fs || !nodePath) return;
        try {
            // Try ./workflows first, fall back to ./comfyui_workflows
            let dir = nodePath.resolve('./workflows');
            if (!fs.existsSync(dir)) {
                dir = nodePath.resolve('./comfyui_workflows');
            }
            if (fs.existsSync(dir)) {
                const files: string[] = fs.readdirSync(dir);
                const jsonFiles = files
                    .filter((f) => f.endsWith('.json'))
                    .map((f) => ({ name: f.replace('.json', ''), path: nodePath.join(dir, f) }));
                setSavedWorkflows(jsonFiles);
            }
        } catch (err) {
            console.warn('Failed to read workflows directory:', err);
        }
    }, []);

    const parseJsonContent = (text: string, sourceName: string) => {
        let data: any;
        try {
            data = JSON.parse(text);
        } catch {
            if (onStatusChange) onStatusChange('Error parsing JSON. Is it a valid ComfyUI API export?');
            return;
        }

        let nodesObj = data;
        if (data.nodes && Array.isArray(data.nodes)) {
            if (onStatusChange) onStatusChange('Warning: This looks like a ComfyUI Web format (not API export). Results may be incomplete.');
            nodesObj = {};
            data.nodes.forEach((n: any) => { nodesObj[n.id ?? Object.keys(nodesObj).length] = n; });
        }

        const parsedNodes: ParsedNode[] = [];
        const inputs: ParsedNode[] = [];
        const outputs: ParsedNode[] = [];

        for (const [key, node] of Object.entries(nodesObj)) {
            const type = (node as any).class_type || 'Unknown';
            const metaTitle: string = (node as any)._meta?.title || type;
            const titleLower = metaTitle.toLowerCase();
            const isInput = titleLower.includes('[input]');
            const isOutput = titleLower.includes('[output]');

            const pNode: ParsedNode = {
                id: key,
                type,
                title: metaTitle,
                inputs: (node as any).inputs || {},
                isInput,
                isOutput,
            };

            parsedNodes.push(pNode);
            if (isInput) inputs.push(pNode);
            if (isOutput) outputs.push(pNode);
        }

        setRawNodes(parsedNodes);
        setInputNodes(inputs);
        setOutputNodes(outputs);
        setFileName(sourceName);

        if (onStatusChange) onStatusChange(`Parsed "${sourceName}" — ${inputs.length} inputs, ${outputs.length} outputs, ${parsedNodes.length} total nodes.`);
    };

    const handleFileDrop = async (file: File) => {
        try {
            const text = await file.text();
            parseJsonContent(text, file.name);
        } catch (err) {
            if (onStatusChange) onStatusChange(`Failed to read dropped file: ${err}`);
        }
    };

    const handleLoadSavedWorkflow = (wf: SavedWorkflow) => {
        if (!fs) return;
        try {
            const text: string = fs.readFileSync(wf.path, 'utf8');
            parseJsonContent(text, wf.name + '.json');
        } catch (err) {
            if (onStatusChange) onStatusChange(`Failed to read ${wf.name}: ${err}`);
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
                            onFilesDropped={(files: File[]) => handleFileDrop(files[0])}
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
                                {savedWorkflows.map(wf => (
                                    <button
                                        key={wf.path}
                                        onClick={() => handleLoadSavedWorkflow(wf)}
                                        title={wf.path}
                                        className={`text-left px-3 py-2 text-xs rounded transition-colors ${fileName === wf.name + '.json'
                                                ? 'bg-indigo-600/30 text-indigo-200 border border-indigo-500/40'
                                                : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-transparent'
                                            }`}
                                    >
                                        📄 {wf.name}
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
                                    {inputNodes.map(node => (
                                        <div key={node.id} className="bg-indigo-900/20 border border-indigo-700/30 p-3 rounded-lg">
                                            <div className="flex justify-between items-start mb-1">
                                                <h4 className="font-bold text-indigo-300 text-sm">{node.title}</h4>
                                                <span className="text-[10px] bg-indigo-950 px-1.5 py-0.5 rounded text-indigo-400 font-mono ml-2 shrink-0">#{node.id}</span>
                                            </div>
                                            <p className="text-xs text-indigo-200/60 font-mono mb-2">{node.type}</p>
                                            {Object.keys(node.inputs).length > 0 && (
                                                <ul className="text-xs text-indigo-100/70 list-disc list-inside space-y-0.5 ml-1">
                                                    {Object.entries(node.inputs).map(([k, v]) => (
                                                        <li key={k} title={String(v)}>
                                                            <span className="font-medium">{k}</span>:{' '}
                                                            {typeof v === 'object' ? '[linked]' : String(v).substring(0, 50)}
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
                                    {outputNodes.map(node => (
                                        <div key={node.id} className="bg-green-900/20 border border-green-700/30 p-3 rounded-lg">
                                            <div className="flex justify-between items-start mb-1">
                                                <h4 className="font-bold text-green-300 text-sm">{node.title}</h4>
                                                <span className="text-[10px] bg-green-950 px-1.5 py-0.5 rounded text-green-400 font-mono ml-2 shrink-0">#{node.id}</span>
                                            </div>
                                            <p className="text-xs text-green-200/60 font-mono">{node.type}</p>
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
                                    {rawNodes.map(node => (
                                        <tr key={node.id} className="border-b border-gray-800/60 hover:bg-white/5 transition-colors">
                                            <td className="p-2 font-mono text-gray-500 text-xs">{node.id}</td>
                                            <td className="p-2 text-gray-200">{node.title}</td>
                                            <td className="p-2 text-gray-400 text-xs font-mono">{node.type}</td>
                                            <td className="p-2 text-right">
                                                <div className="flex justify-end gap-1">
                                                    {node.isInput && <span className="bg-indigo-900 text-indigo-200 text-[10px] px-1.5 py-0.5 rounded">INPUT</span>}
                                                    {node.isOutput && <span className="bg-green-900 text-green-200 text-[10px] px-1.5 py-0.5 rounded">OUTPUT</span>}
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
