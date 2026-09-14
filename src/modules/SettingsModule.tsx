import React, { useState, useEffect, useCallback } from 'react';
import { AppTooltip } from '../components/ui/Tooltip';
import type { DiscoveredGgufModel } from '../../electron/llamaServerClient';

interface SettingsModuleProps {
    onSave?: () => void;
}

const SettingsModule: React.FC<SettingsModuleProps> = ({ onSave }) => {
    const [comfyOutputDir, setComfyOutputDir] = useState<string>('');
    const [projectOutputDir, setProjectOutputDir] = useState<string>('');
    const [statusMessage, setStatusMessage] = useState<string>('');

    // LLM Settings
    const [llmProvider, setLlmProvider] = useState<'llama-server' | 'vino'>('llama-server');
    const [llamaServerUrl, setLlamaServerUrl] = useState<string>('http://localhost:8080');
    const [llmMaxTokens, setLlmMaxTokens] = useState<number>(128);
    const [llmTemperature, setLlmTemperature] = useState<number>(0.7);
    const [llmTopP, setLlmTopP] = useState<number>(0.9);
    const [llmTopK, setLlmTopK] = useState<number>(50);
    const [llmRepetitionPenalty, setLlmRepetitionPenalty] = useState<number>(1.5);

    // GGUF Model Management & Process Control State
    const [llamaModelsDir, setLlamaModelsDir] = useState<string>('');
    const [availableGgufModelsList, setAvailableGgufModelsList] = useState<DiscoveredGgufModel[]>([]);
    const [selectedGgufModelPath, setSelectedGgufModelPath] = useState<string>('');
    const [isScanningModelsActive, setIsScanningModelsActive] = useState<boolean>(false);
    const [isSwitchingModelActive, setIsSwitchingModelActive] = useState<boolean>(false);
    const [switchModelStatusMessage, setSwitchModelStatusMessage] = useState<string>('');
    const [llamaContextSize, setLlamaContextSize] = useState<number>(8192);
    const [llamaGpuLayers, setLlamaGpuLayers] = useState<number>(99);
    const [isBenchmarkingActive, setIsBenchmarkingActive] = useState<boolean>(false);
    const [benchmarkResult, setBenchmarkResult] = useState<{
        model_name: string;
        duration_seconds: string;
        tokens_generated: number;
        tokens_per_second: string;
        context_size: number;
        gpu_layers: number;
        generated_text: string;
    } | null>(null);

    // Dynamic Connection Testing & Diagnostics State
    const [diagnosticInformation, setDiagnosticInformation] = useState<{
        connection_status: 'online' | 'offline';
        resolved_endpoint_url: string | null;
        active_model_name: string | null;
        multimodal_vision_supported: boolean;
        diagnostic_message: string;
    } | null>(null);
    const [isTestingConnectionActive, setIsTestingConnectionActive] = useState<boolean>(false);

    // WHAT: Scans a designated directory tree for all downloadable/installed .gguf models.
    // WHY: Populates the model selection dropdown and auto-detects multimodal projector files.
    const scanModels = useCallback(async (directory_override_path?: string) => {
        try {
            setIsScanningModelsActive(true);
            const electron_runtime = (window as unknown as { require?: (module_name: string) => { ipcRenderer: { invoke: (channel_name: string, ...parameters_list: unknown[]) => Promise<{ success: boolean; models?: DiscoveredGgufModel[]; scanPath?: string; error?: string }> } } });
            const ipc_renderer_instance = electron_runtime.require ? electron_runtime.require('electron').ipcRenderer : null;
            if (!ipc_renderer_instance) return;

            const scan_result = await ipc_renderer_instance.invoke('llm-scan-models', directory_override_path || llamaModelsDir || undefined);
            if (scan_result.success && scan_result.models) {
                setAvailableGgufModelsList(scan_result.models);
                if (scan_result.scanPath && !llamaModelsDir) {
                    setLlamaModelsDir(scan_result.scanPath);
                }
                if (scan_result.models.length > 0) {
                    setSelectedGgufModelPath(current_selected_path => {
                        if (current_selected_path && scan_result.models!.some(candidate_model => candidate_model.file_path === current_selected_path)) {
                            return current_selected_path;
                        }
                        const qwen_match = scan_result.models!.find(candidate_model => candidate_model.model_name.toLowerCase().includes('qwen3.5-9b'));
                        return qwen_match ? qwen_match.file_path : scan_result.models![0].file_path;
                    });
                }
            }
        } catch (scanning_error) {
            console.error("Failed to scan models directory:", scanning_error);
        } finally {
            setIsScanningModelsActive(false);
        }
    }, [llamaModelsDir]);

    // WHAT: Loads persisted configuration from the Electron main process store.
    // WHY: Populates the settings UI with saved directory paths and AI generation parameters on mount.
    const loadConfig = useCallback(async () => {
        try {
            const electron_runtime = (window as unknown as { require?: (module_name: string) => { ipcRenderer: { invoke: (channel: string, ...args: unknown[]) => Promise<{ success: boolean; config?: Record<string, unknown> }> } } });
            const ipc_renderer_instance = electron_runtime.require ? electron_runtime.require('electron').ipcRenderer : null;
            if (!ipc_renderer_instance) return;

            const configuration_response = await ipc_renderer_instance.invoke('get-config');
            if (configuration_response.success && configuration_response.config) {
                const stored_configuration = configuration_response.config;
                if (typeof stored_configuration.comfyOutputDir === 'string') setComfyOutputDir(stored_configuration.comfyOutputDir);
                if (typeof stored_configuration.projectOutputDir === 'string') setProjectOutputDir(stored_configuration.projectOutputDir);
                if (stored_configuration.llmProvider === 'llama-server' || stored_configuration.llmProvider === 'vino') {
                    setLlmProvider(stored_configuration.llmProvider);
                } else if (stored_configuration.llmProvider === 'lmstudio') {
                    setLlmProvider('llama-server');
                }
                if (typeof stored_configuration.llamaServerUrl === 'string') {
                    setLlamaServerUrl(stored_configuration.llamaServerUrl);
                } else if (typeof stored_configuration.lmStudioUrl === 'string') {
                    setLlamaServerUrl('http://localhost:8080');
                }
                if (typeof stored_configuration.llamaModelsDir === 'string') {
                    setLlamaModelsDir(stored_configuration.llamaModelsDir);
                }
                if (typeof stored_configuration.selectedLlamaModelPath === 'string') {
                    setSelectedGgufModelPath(stored_configuration.selectedLlamaModelPath);
                }
                if (typeof stored_configuration.llmMaxTokens === 'number') setLlmMaxTokens(stored_configuration.llmMaxTokens);
                if (typeof stored_configuration.llmTemperature === 'number') setLlmTemperature(stored_configuration.llmTemperature);
                if (typeof stored_configuration.llmTopP === 'number') setLlmTopP(stored_configuration.llmTopP);
                if (typeof stored_configuration.llmTopK === 'number') setLlmTopK(stored_configuration.llmTopK);
                if (typeof stored_configuration.llmRepetitionPenalty === 'number') setLlmRepetitionPenalty(stored_configuration.llmRepetitionPenalty);
                if (typeof stored_configuration.llamaContextSize === 'number') setLlamaContextSize(stored_configuration.llamaContextSize);
                if (typeof stored_configuration.llamaGpuLayers === 'number') setLlamaGpuLayers(stored_configuration.llamaGpuLayers);

                // Auto-scan models using configured or default path
                scanModels(typeof stored_configuration.llamaModelsDir === 'string' ? stored_configuration.llamaModelsDir : undefined);
            }
        } catch (configuration_loading_error) {
            console.error("Failed to load global configuration:", configuration_loading_error);
        }
    }, [scanModels]);

    // WHAT: Trigger configuration loading asynchronously when the Settings module mounts.
    // WHY: Wrapping in a microtask queue avoids synchronous cascading renders in the React 19 effect lifecycle.
    useEffect(() => {
        let is_component_mounted = true;
        Promise.resolve().then(() => {
            if (is_component_mounted) {
                loadConfig();
            }
        });
        return () => {
            is_component_mounted = false;
        };
    }, [loadConfig]);

    // WHAT: Persists user-modified settings to the Electron store on disk.
    // WHY: Keeps paths and model parameters synchronized across app restarts.
    const handleSave = async () => {
        try {
            const electron_runtime = (window as unknown as { require?: (module_name: string) => { ipcRenderer: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } } });
            const ipc_renderer_instance = electron_runtime.require ? electron_runtime.require('electron').ipcRenderer : null;
            if (ipc_renderer_instance) {
                await ipc_renderer_instance.invoke('save-config', {
                    comfyOutputDir,
                    projectOutputDir,
                    llmProvider,
                    llamaServerUrl,
                    llamaModelsDir,
                    selectedLlamaModelPath: selectedGgufModelPath,
                    llamaContextSize,
                    llamaGpuLayers,
                    llmMaxTokens,
                    llmTemperature,
                    llmTopP,
                    llmTopK,
                    llmRepetitionPenalty
                });
                setStatusMessage('Settings saved successfully!');
                if (onSave) onSave();
                setTimeout(() => setStatusMessage(''), 3000);
            }
        } catch (configuration_saving_error) {
            console.error("Failed to save global configuration:", configuration_saving_error);
            setStatusMessage('Error saving settings.');
        }
    };

    // WHAT: Switches the active llama-server model by terminating the process and spawning the selected GGUF.
    // WHY: Enables 1-click model switching with automated mmproj vision projector pairing from the UI.
    const handleSwitchModel = async () => {
        if (!selectedGgufModelPath) return;
        setIsSwitchingModelActive(true);
        setSwitchModelStatusMessage('Stopping current server and launching selected model...');
        try {
            const electron_runtime = (window as unknown as { require?: (module_name: string) => { ipcRenderer: { invoke: (channel_name: string, ...parameters_list: unknown[]) => Promise<{ success: boolean; diagnostic?: { connection_status: 'online' | 'offline'; resolved_endpoint_url: string | null; discovered_model_metadata: { model_identifier: string; model_aliases_list: string[] } | null; multimodal_vision_supported: boolean; diagnostic_message: string }; error?: string }> } } });
            const ipc_renderer_instance = electron_runtime.require ? electron_runtime.require('electron').ipcRenderer : null;
            if (!ipc_renderer_instance) return;

            const selected_model_record = availableGgufModelsList.find(candidate_model => candidate_model.file_path === selectedGgufModelPath);
            const paired_projector_path = selected_model_record?.paired_multimodal_projector_path || undefined;

            const switch_response = await ipc_renderer_instance.invoke('llm-switch-model', {
                modelPath: selectedGgufModelPath,
                mmprojPath: paired_projector_path,
                port: 8080,
                contextSize: llamaContextSize,
                gpuLayers: llamaGpuLayers
            });

            if (switch_response.success && switch_response.diagnostic) {
                const diagnostic_record = switch_response.diagnostic;
                setDiagnosticInformation({
                    connection_status: diagnostic_record.connection_status,
                    resolved_endpoint_url: diagnostic_record.resolved_endpoint_url,
                    active_model_name: diagnostic_record.discovered_model_metadata?.model_aliases_list?.[0] || diagnostic_record.discovered_model_metadata?.model_identifier || null,
                    multimodal_vision_supported: diagnostic_record.multimodal_vision_supported,
                    diagnostic_message: diagnostic_record.diagnostic_message
                });
                setSwitchModelStatusMessage(`Successfully running ${selected_model_record?.model_name || 'selected model'}!`);
                setTimeout(() => setSwitchModelStatusMessage(''), 4000);
            } else {
                setSwitchModelStatusMessage(`Failed to switch: ${switch_response.error || 'Server did not respond'}`);
            }
        } catch (switching_error) {
            setSwitchModelStatusMessage(`Error: ${switching_error instanceof Error ? switching_error.message : String(switching_error)}`);
        } finally {
            setIsSwitchingModelActive(false);
        }
    };

    // WHAT: Runs a standardized prompt benchmark on the currently active llama-server model.
    // WHY: Allows the user to directly evaluate tokens/sec, response quality, and latency between models.
    const handleRunBenchmark = async () => {
        setIsBenchmarkingActive(true);
        setBenchmarkResult(null);
        try {
            const electron_runtime = (window as unknown as { require?: (module_name: string) => { ipcRenderer: { invoke: (channel_name: string) => Promise<{ success: boolean; model_name?: string; duration_seconds?: string; tokens_generated?: number; tokens_per_second?: string; context_size?: number; gpu_layers?: number; generated_text?: string; error?: string }> } } });
            const ipc_renderer_instance = electron_runtime.require ? electron_runtime.require('electron').ipcRenderer : null;
            if (!ipc_renderer_instance) return;

            const benchmark_response = await ipc_renderer_instance.invoke('llm-benchmark');
            if (benchmark_response.success && benchmark_response.model_name) {
                setBenchmarkResult({
                    model_name: benchmark_response.model_name,
                    duration_seconds: benchmark_response.duration_seconds || '0',
                    tokens_generated: benchmark_response.tokens_generated || 0,
                    tokens_per_second: benchmark_response.tokens_per_second || '0',
                    context_size: benchmark_response.context_size || llamaContextSize,
                    gpu_layers: benchmark_response.gpu_layers !== undefined ? benchmark_response.gpu_layers : llamaGpuLayers,
                    generated_text: benchmark_response.generated_text || ''
                });
            } else {
                setSwitchModelStatusMessage(`Benchmark failed: ${benchmark_response.error || 'Server error'}`);
            }
        } catch (benchmark_error) {
            setSwitchModelStatusMessage(`Benchmark error: ${benchmark_error instanceof Error ? benchmark_error.message : String(benchmark_error)}`);
        } finally {
            setIsBenchmarkingActive(false);
        }
    };

    // WHAT: Terminates any active llama-server.exe process.
    // WHY: Releases VRAM and CPU/GPU resources when AI processing is not required.
    const handleStopServer = async () => {
        try {
            const electron_runtime = (window as unknown as { require?: (module_name: string) => { ipcRenderer: { invoke: (channel_name: string) => Promise<{ success: boolean; message?: string }> } } });
            const ipc_renderer_instance = electron_runtime.require ? electron_runtime.require('electron').ipcRenderer : null;
            if (!ipc_renderer_instance) return;

            await ipc_renderer_instance.invoke('llm-stop-server');
            setDiagnosticInformation({
                connection_status: 'offline',
                resolved_endpoint_url: null,
                active_model_name: null,
                multimodal_vision_supported: false,
                diagnostic_message: 'llama-server has been stopped.'
            });
            setSwitchModelStatusMessage('Server stopped successfully.');
            setTimeout(() => setSwitchModelStatusMessage(''), 3000);
        } catch (stopping_error) {
            console.error('Failed to stop server:', stopping_error);
        }
    };

    // WHAT: Launches native OS directory picker dialog via Electron IPC.
    // WHY: Guarantees valid absolute directory paths without requiring manual typing.
    const handleSelectFolder = async (path_update_setter: (selected_path: string) => void) => {
        try {
            const electron_runtime = (window as unknown as { require?: (module_name: string) => { ipcRenderer: { invoke: (channel: string) => Promise<string | null> } } });
            const ipc_renderer_instance = electron_runtime.require ? electron_runtime.require('electron').ipcRenderer : null;
            if (!ipc_renderer_instance) return;
            const selected_folder_path = await ipc_renderer_instance.invoke('select-folder');
            if (selected_folder_path) path_update_setter(selected_folder_path);
        } catch (folder_selection_error) {
            console.error('Failed to select folder via dialog:', folder_selection_error);
        }
    };

    return (
        <div className="module-container">
            <div className="module-header">
                <h2 className="module-title">⚙️ Settings</h2>
                <p className="module-description">
                    Configure global application settings.
                </p>
            </div>

            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">ComfyUI Integration</h3>
                </div>

                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-400 mb-2">
                        ComfyUI Output Folder (Source)
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={comfyOutputDir}
                            onChange={(e) => setComfyOutputDir(e.target.value)}
                            className="flex-1 w-full bg-gray-800 p-2 rounded text-sm text-gray-300 border border-gray-700 font-mono"
                            placeholder="C:\ComfyUI\output"
                        />
                        <button
                            onClick={() => handleSelectFolder(setComfyOutputDir)}
                            className="btn bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded"
                        >
                            Browse
                        </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                        The folder where ComfyUI saves generated audio files (e.g. Vocals_*.mp3).
                    </p>
                </div>
            </div>

            <div className="card mt-4">
                <div className="card-header">
                    <h3 className="card-title">Defaults</h3>
                </div>

                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-400 mb-2">
                        Default Project Output Folder
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={projectOutputDir}
                            onChange={(e) => setProjectOutputDir(e.target.value)}
                            className="flex-1 w-full bg-gray-800 p-2 rounded text-sm text-gray-300 border border-gray-700 font-mono"
                            placeholder="Default folder for new projects"
                        />
                        <button
                            onClick={() => handleSelectFolder(setProjectOutputDir)}
                            className="btn bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded"
                        >
                            Browse
                        </button>
                    </div>
                </div>
            </div>

            <div className="card mt-4">
                <div className="card-header flex justify-between items-center">
                    <div>
                        <h3 className="card-title text-purple-400">🤖 AI Generation Engine</h3>
                        <p className="text-[11px] text-gray-400 mt-0.5">Local LLM for prompt expansion and visual image descriptions</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <AppTooltip content="llama-server (Recommended): Unified inference for prompt expansion and vision image description with zero model swapping latency" placement="top">
                            <button 
                                onClick={() => setLlmProvider('llama-server')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${llmProvider === 'llama-server' ? 'bg-amber-600/30 text-amber-300 ring-2 ring-amber-500 scale-105 shadow-md shadow-amber-950/30' : 'bg-gray-800 text-gray-400 opacity-60 hover:opacity-100'}`}
                            >
                                <span className="text-base">🦙</span>
                                <span>llama-server</span>
                                <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1 py-0.5 rounded font-mono font-bold uppercase">Default</span>
                            </button>
                        </AppTooltip>
                        <AppTooltip content="Intel OpenVINO NPU (Legacy / Text-Only fallback using Gemma 3)" placement="top">
                            <button 
                                onClick={() => setLlmProvider('vino')}
                                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${llmProvider === 'vino' ? 'bg-purple-600/30 text-purple-300 ring-2 ring-purple-500' : 'bg-gray-800 text-gray-500 opacity-40 hover:opacity-80'}`}
                            >
                                <span className="text-base">🍷</span>
                                <span className="text-[11px]">Vino (NPU)</span>
                            </button>
                        </AppTooltip>
                    </div>
                </div>

                <div className="p-1 space-y-6">
                    {/* Provider Selection Info */}
                    <div className="bg-black/20 p-3 rounded-lg border border-gray-700/30">
                        <p className="text-xs text-gray-400">
                            {llmProvider === 'vino' 
                                ? "Using local Intel NPU (Vino) for expansion. Note: Gemma 3 is text-only; image descriptions will require ComfyUI." 
                                : "Using unified local llama-server on port 8080. A single persistent model (e.g. Qwen 3.5) handles both prompt expansion and instant vision image descriptions with zero model-swapping latency."}
                        </p>
                    </div>

                    {llmProvider === 'llama-server' && (
                        <div className="space-y-3 bg-gray-900/50 p-3.5 rounded-lg border border-gray-800">
                            <div className="space-y-1.5">
                                <label className="block text-sm font-medium text-gray-300">llama-server URL</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={llamaServerUrl}
                                        onChange={(e) => setLlamaServerUrl(e.target.value)}
                                        className="flex-1 bg-gray-900 border border-gray-700 rounded p-2 text-sm text-amber-300 font-mono focus:border-amber-500 focus:outline-none"
                                        placeholder="http://localhost:8080"
                                    />
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            setIsTestingConnectionActive(true);
                                            try {
                                                const electron_runtime = (window as unknown as { require?: (module_name: string) => { ipcRenderer: { invoke: (channel_name: string, ...parameters_list: unknown[]) => Promise<{ success: boolean; diagnostic?: { connection_status: 'online' | 'offline'; resolved_endpoint_url: string | null; discovered_model_metadata: { model_identifier: string; model_aliases_list: string[] } | null; multimodal_vision_supported: boolean; diagnostic_message: string } }> } } });
                                                const ipc_renderer_instance = electron_runtime.require ? electron_runtime.require('electron').ipcRenderer : null;
                                                if (ipc_renderer_instance) {
                                                    const connection_test_result = await ipc_renderer_instance.invoke('llm-test-connection', llamaServerUrl);
                                                    if (connection_test_result.success && connection_test_result.diagnostic) {
                                                        const diagnostic_record = connection_test_result.diagnostic;
                                                        setDiagnosticInformation({
                                                            connection_status: diagnostic_record.connection_status,
                                                            resolved_endpoint_url: diagnostic_record.resolved_endpoint_url,
                                                            active_model_name: diagnostic_record.discovered_model_metadata?.model_aliases_list?.[0] || diagnostic_record.discovered_model_metadata?.model_identifier || null,
                                                            multimodal_vision_supported: diagnostic_record.multimodal_vision_supported,
                                                            diagnostic_message: diagnostic_record.diagnostic_message
                                                        });
                                                    }
                                                }
                                            } catch (connection_test_error) {
                                                console.error("Test connection failed:", connection_test_error);
                                            } finally {
                                                setIsTestingConnectionActive(false);
                                            }
                                        }}
                                        disabled={isTestingConnectionActive}
                                        className={`px-3 py-2 text-xs font-semibold rounded bg-amber-600/30 hover:bg-amber-600 text-amber-300 hover:text-white border border-amber-500/30 transition-all flex items-center gap-1.5 ${isTestingConnectionActive ? 'opacity-50 cursor-wait' : ''}`}
                                    >
                                        {isTestingConnectionActive ? 'Testing...' : '⚡ Test Connection'}
                                    </button>
                                </div>
                            </div>

                            {/* Live Diagnostic Status Display */}
                            {diagnosticInformation && (
                                <div className={`p-2.5 rounded text-xs border flex flex-col gap-1 ${
                                    diagnosticInformation.connection_status === 'online'
                                        ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-300'
                                        : 'bg-rose-950/40 border-rose-700/50 text-rose-300'
                                }`}>
                                    <div className="flex items-center justify-between">
                                        <span className="font-bold flex items-center gap-1.5">
                                            {diagnosticInformation.connection_status === 'online' ? '🟢 Online' : '🔴 Offline'}
                                            {diagnosticInformation.active_model_name && (
                                                <span className="text-gray-200 font-mono text-[11px] bg-black/40 px-1.5 py-0.5 rounded border border-emerald-600/40">
                                                    {diagnosticInformation.active_model_name}
                                                </span>
                                            )}
                                        </span>
                                        {diagnosticInformation.connection_status === 'online' && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/40 border border-gray-700 font-mono">
                                                {diagnosticInformation.multimodal_vision_supported ? '👁️ Multimodal / Vision' : '📝 Text Only'}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[11px] opacity-90">{diagnosticInformation.diagnostic_message}</p>
                                </div>
                            )}

                            {/* Model Selection & Server Process Management */}
                            <div className="pt-3 border-t border-gray-800 space-y-3">
                                <div className="flex items-center justify-between">
                                    <label className="block text-xs font-bold uppercase tracking-wider text-amber-400">
                                        🦙 Local GGUF Model Management
                                    </label>
                                    <span className="text-[11px] text-gray-400">
                                        {availableGgufModelsList.length} {availableGgufModelsList.length === 1 ? 'model' : 'models'} found
                                    </span>
                                </div>

                                {/* Model Directory Picker */}
                                <div className="space-y-1">
                                    <label className="block text-xs text-gray-400">Models Storage Directory</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={llamaModelsDir}
                                            onChange={(e) => setLlamaModelsDir(e.target.value)}
                                            placeholder="Folder containing .gguf models"
                                            className="flex-1 bg-gray-900 border border-gray-700 rounded p-2 text-xs text-gray-200 font-mono focus:border-amber-500 focus:outline-none"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleSelectFolder((selected_directory_path) => {
                                                setLlamaModelsDir(selected_directory_path);
                                                scanModels(selected_directory_path);
                                            })}
                                            className="px-3 py-2 text-xs font-semibold rounded bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 transition-all"
                                        >
                                            Browse
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => scanModels(llamaModelsDir)}
                                            disabled={isScanningModelsActive}
                                            className={`px-3 py-2 text-xs font-semibold rounded bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 border border-amber-500/30 transition-all flex items-center gap-1.5 ${isScanningModelsActive ? 'opacity-50 cursor-wait' : ''}`}
                                        >
                                            {isScanningModelsActive ? '🔄 Scanning...' : '🔄 Scan'}
                                        </button>
                                    </div>
                                </div>

                                {/* Model Dropdown */}
                                <div className="space-y-1">
                                    <label className="block text-xs text-gray-400">Select Model to Run</label>
                                    <select
                                        value={selectedGgufModelPath}
                                        onChange={(e) => setSelectedGgufModelPath(e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-xs text-amber-200 font-mono focus:border-amber-500 focus:outline-none cursor-pointer"
                                    >
                                        {availableGgufModelsList.length === 0 ? (
                                            <option value="">No .gguf models found in directory</option>
                                        ) : (
                                            availableGgufModelsList.map((model_item) => (
                                                <option key={model_item.file_path} value={model_item.file_path}>
                                                    {model_item.model_name} ({model_item.file_size_formatted}) {model_item.supports_multimodal_vision ? '👁️ Vision' : ''}
                                                </option>
                                            ))
                                        )}
                                    </select>
                                </div>

                                {/* Selected Model Details */}
                                {selectedGgufModelPath && (() => {
                                    const active_model_info = availableGgufModelsList.find(candidate => candidate.file_path === selectedGgufModelPath);
                                    if (!active_model_info) return null;
                                    return (
                                        <div className="bg-black/30 p-2.5 rounded text-xs border border-gray-800 space-y-1 font-mono text-gray-400">
                                            <div className="flex justify-between items-center text-gray-300">
                                                <span className="font-semibold text-amber-300">{active_model_info.model_name}</span>
                                                <span className="text-[10px] bg-gray-800 px-1.5 py-0.5 rounded text-gray-300">{active_model_info.file_size_formatted}</span>
                                            </div>
                                            <div className="text-[11px] truncate text-gray-500" title={active_model_info.file_path}>
                                                📄 {active_model_info.file_path}
                                            </div>
                                            <div className="text-[11px] flex items-center gap-1.5">
                                                {active_model_info.supports_multimodal_vision ? (
                                                    <span className="text-emerald-400 flex items-center gap-1">
                                                        👁️ Vision projector: <span className="text-gray-400 truncate max-w-[320px] inline-block align-bottom" title={active_model_info.paired_multimodal_projector_path || ''}>{active_model_info.paired_multimodal_projector_path?.split(/[\\/]/).pop()}</span>
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-500 italic">📝 Text-only model (no mmproj projector found)</span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Context Window & GPU Offload Layer Sliders */}
                                <div className="grid grid-cols-2 gap-3 pt-1">
                                    <div className="space-y-1">
                                        <div className="flex justify-between items-center">
                                            <label className="text-[11px] font-semibold text-gray-300">Context Window (-c)</label>
                                            <span className="text-[10px] font-mono text-amber-400 font-bold">{llamaContextSize} tokens</span>
                                        </div>
                                        <select
                                            value={llamaContextSize}
                                            onChange={(e) => setLlamaContextSize(Number(e.target.value))}
                                            className="w-full bg-gray-900 border border-gray-700 rounded p-1.5 text-xs text-amber-200 font-mono focus:border-amber-500 focus:outline-none"
                                        >
                                            <option value={4096}>4096 (4K - Compact)</option>
                                            <option value={8192}>8192 (8K - Standard)</option>
                                            <option value={16384}>16384 (16K - Recommended for Vision)</option>
                                            <option value={32768}>32768 (32K - Deep Context)</option>
                                        </select>
                                        <p className="text-[10px] text-gray-500 leading-tight">
                                            👁️ Vision decoding requires ample context to parse visual image tokens alongside cinematic prompts.
                                        </p>
                                    </div>

                                    <div className="space-y-1">
                                        <div className="flex justify-between items-center">
                                            <label className="text-[11px] font-semibold text-gray-300">GPU Layers (-ngl)</label>
                                            <span className="text-[10px] font-mono text-amber-400 font-bold">{llamaGpuLayers === 99 ? '99 (All in VRAM)' : `${llamaGpuLayers} layers`}</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="99"
                                            step="1"
                                            value={llamaGpuLayers}
                                            onChange={(e) => setLlamaGpuLayers(Number(e.target.value))}
                                            className="w-full accent-amber-500 cursor-pointer h-2"
                                        />
                                        <p className="text-[10px] text-gray-500 leading-tight">
                                            Set 99 for 9B models. For 27B models (e.g. Qwen 3.8 27B), lower to 35–50 to split with RAM and prevent OOM.
                                        </p>
                                    </div>
                                </div>

                                {/* Action Buttons & Status */}
                                <div className="flex items-center gap-2 pt-1">
                                    <button
                                        type="button"
                                        onClick={handleSwitchModel}
                                        disabled={isSwitchingModelActive || !selectedGgufModelPath}
                                        className={`flex-1 py-2 px-3 rounded text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow ${
                                            isSwitchingModelActive || !selectedGgufModelPath
                                                ? 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700'
                                                : 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/30 hover:scale-[1.01]'
                                        }`}
                                    >
                                        {isSwitchingModelActive ? '⏳ Launching Server...' : '▶️ Launch / Switch Model'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleRunBenchmark}
                                        disabled={isBenchmarkingActive || isSwitchingModelActive}
                                        className={`py-2 px-3 rounded text-xs font-bold transition-all flex items-center gap-1.5 border ${
                                            isBenchmarkingActive
                                                ? 'bg-indigo-900/40 text-indigo-400 border-indigo-700/40 animate-pulse'
                                                : 'bg-indigo-950/50 hover:bg-indigo-900/70 text-indigo-300 border-indigo-700/50 hover:scale-[1.01]'
                                        }`}
                                        title="Run standardized cinematic prompt benchmark on currently active model"
                                    >
                                        {isBenchmarkingActive ? '🧪 Benchmarking...' : '🧪 Test / Benchmark'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleStopServer}
                                        disabled={isSwitchingModelActive || isBenchmarkingActive}
                                        className="py-2 px-3 rounded text-xs font-bold bg-rose-900/30 hover:bg-rose-900/50 text-rose-300 border border-rose-800/50 transition-all flex items-center gap-1"
                                    >
                                        ⏹️ Stop Server
                                    </button>
                                </div>

                                {benchmarkResult && (
                                    <div className="p-3 rounded text-xs bg-indigo-950/30 border border-indigo-700/40 text-indigo-200 space-y-2">
                                        <div className="flex justify-between items-center border-b border-indigo-800/40 pb-1.5">
                                            <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                                                📊 Benchmark: <span className="font-mono text-white text-[11px]">{benchmarkResult.model_name}</span>
                                            </span>
                                            <div className="flex items-center gap-2">
                                                <span className="bg-emerald-900/50 border border-emerald-700/60 text-emerald-300 px-2 py-0.5 rounded font-mono font-bold text-[11px]">
                                                    ⚡ {benchmarkResult.tokens_per_second} tok/sec
                                                </span>
                                                <span className="bg-black/50 border border-indigo-800/50 text-indigo-300 px-2 py-0.5 rounded font-mono text-[11px]">
                                                    ⏱️ {benchmarkResult.duration_seconds}s ({benchmarkResult.tokens_generated} toks)
                                                </span>
                                            </div>
                                        </div>
                                        <div className="text-[10px] font-mono text-gray-400 flex gap-4">
                                            <span>Context: <strong className="text-gray-200">{benchmarkResult.context_size}</strong></span>
                                            <span>GPU Layers: <strong className="text-gray-200">{benchmarkResult.gpu_layers}</strong></span>
                                        </div>
                                        <div className="bg-black/50 p-2 rounded text-[11px] font-mono text-gray-300 max-h-24 overflow-y-auto border border-gray-800 leading-relaxed select-text">
                                            {benchmarkResult.generated_text}
                                        </div>
                                    </div>
                                )}

                                {switchModelStatusMessage && (
                                    <div className="p-2 rounded text-xs bg-amber-950/40 border border-amber-700/50 text-amber-200 flex items-center gap-2">
                                        {isSwitchingModelActive && <span className="animate-spin text-amber-400">🌀</span>}
                                        <span>{switchModelStatusMessage}</span>
                                    </div>
                                )}

                                {/* VRAM Management Callout */}
                                <div className="bg-emerald-950/20 border border-emerald-800/40 p-2.5 rounded text-[11px] text-emerald-300 flex items-start gap-2">
                                    <span className="text-sm">🛡️</span>
                                    <div>
                                        <span className="font-semibold text-emerald-200">Smart VRAM Optimization Active: </span>
                                        <span>llama-server is automatically unloaded before ComfyUI video renders to prevent GPU memory collisions. It stays unloaded while the video queue runs, and auto-restarts on demand when you request prompt expansion or vision descriptions.</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <div className="flex justify-between">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Max New Tokens</label>
                                <span className="text-xs font-mono text-purple-400">{llmMaxTokens}</span>
                            </div>
                            <input 
                                type="range" min="32" max="512" step="32" 
                                value={llmMaxTokens} onChange={(e) => setLlmMaxTokens(Number(e.target.value))}
                                className="w-full accent-purple-500"
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Temperature</label>
                                <span className="text-xs font-mono text-purple-400">{llmTemperature.toFixed(2)}</span>
                            </div>
                            <input 
                                type="range" min="0" max="2" step="0.05" 
                                value={llmTemperature} onChange={(e) => setLlmTemperature(Number(e.target.value))}
                                className="w-full accent-purple-500"
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Top P</label>
                                <span className="text-xs font-mono text-purple-400">{llmTopP.toFixed(2)}</span>
                            </div>
                            <input 
                                type="range" min="0" max="1" step="0.05" 
                                value={llmTopP} onChange={(e) => setLlmTopP(Number(e.target.value))}
                                className="w-full accent-purple-500"
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Repetition Penalty</label>
                                <span className="text-xs font-mono text-purple-400">{llmRepetitionPenalty.toFixed(2)}</span>
                            </div>
                            <input 
                                type="range" min="1" max="2" step="0.05" 
                                value={llmRepetitionPenalty} onChange={(e) => setLlmRepetitionPenalty(Number(e.target.value))}
                                className="w-full accent-purple-500"
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className="card mt-4">
                <div className="card-header">
                    <h3 className="card-title">Media Tools</h3>
                </div>

                <div className="mb-4 flex flex-col gap-2">
                    <p className="text-sm text-gray-400">
                        Extract audio from a video file without re-encoding to prepare it for stem separation or ComfyUI.
                    </p>
                    <div>
                        <button
                            onClick={async () => {
                                setStatusMessage('Select a video file...');
                                try {
                                    const electron_runtime = (window as unknown as { require?: (module_name: string) => { ipcRenderer: { invoke: (channel: string) => Promise<{ canceled?: boolean; success?: boolean; path?: string; error?: string }> } } });
                                    const ipc_renderer_instance = electron_runtime.require ? electron_runtime.require('electron').ipcRenderer : null;
                                    if (!ipc_renderer_instance) return;
                                    const extraction_response = await ipc_renderer_instance.invoke('extract-audio-from-video');
                                    if (extraction_response.canceled) {
                                        setStatusMessage('Audio extraction canceled.');
                                    } else if (extraction_response.success) {
                                        setStatusMessage(`Audio successfully saved to: ${extraction_response.path}`);
                                    } else {
                                        setStatusMessage(`Extraction failed: ${extraction_response.error}`);
                                    }
                                } catch (extraction_runtime_error) {
                                    const error_message = extraction_runtime_error instanceof Error ? extraction_runtime_error.message : String(extraction_runtime_error);
                                    setStatusMessage(`Error: ${error_message}`);
                                }
                                setTimeout(() => setStatusMessage(''), 5000);
                            }}
                            className="btn bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded font-bold text-white shadow"
                        >
                            Extract Audio from Video
                        </button>
                    </div>
                </div>
            </div>

            <div className="mt-6 flex items-center gap-4">
                <button
                    onClick={handleSave}
                    className="btn bg-purple-600 hover:bg-purple-500 px-6 py-2 rounded font-bold text-white shadow-lg"
                >
                    Save Settings
                </button>
                {statusMessage && (
                    <span className={`text-sm ${statusMessage.includes('Error') ? 'text-red-400' : 'text-green-400'}`}>
                        {statusMessage}
                    </span>
                )}
            </div>
        </div>
    );
};

export default SettingsModule;
