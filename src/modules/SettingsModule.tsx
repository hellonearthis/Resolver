import React, { useState, useEffect } from 'react';
import { AppTooltip } from '../components/ui/Tooltip';


interface SettingsModuleProps {
    onSave?: () => void;
}

const SettingsModule: React.FC<SettingsModuleProps> = ({ onSave }) => {
    const [comfyOutputDir, setComfyOutputDir] = useState<string>('');
    const [projectOutputDir, setProjectOutputDir] = useState<string>('');
    const [statusMessage, setStatusMessage] = useState<string>('');

    // LLM Settings
    const [llmProvider, setLlmProvider] = useState<'lmstudio' | 'vino'>('lmstudio');
    const [lmStudioUrl, setLmStudioUrl] = useState<string>('http://localhost:1234');
    const [llmMaxTokens, setLlmMaxTokens] = useState<number>(128);
    const [llmTemperature, setLlmTemperature] = useState<number>(0.7);
    const [llmTopP, setLlmTopP] = useState<number>(0.9);
    const [llmTopK, setLlmTopK] = useState<number>(50);
    const [llmRepetitionPenalty, setLlmRepetitionPenalty] = useState<number>(1.5);

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            // @ts-ignore
            const ipcRenderer = window.require ? window.require('electron').ipcRenderer : window.ipcRenderer;
            if (!ipcRenderer) return;

            const res = await ipcRenderer.invoke('get-config');
            if (res.success && res.config) {
                if (res.config.comfyOutputDir) setComfyOutputDir(res.config.comfyOutputDir);
                if (res.config.projectOutputDir) setProjectOutputDir(res.config.projectOutputDir);
                if (res.config.llmProvider) setLlmProvider(res.config.llmProvider);
                if (res.config.lmStudioUrl) setLmStudioUrl(res.config.lmStudioUrl);
                if (res.config.llmMaxTokens) setLlmMaxTokens(res.config.llmMaxTokens);
                if (res.config.llmTemperature) setLlmTemperature(res.config.llmTemperature);
                if (res.config.llmTopP) setLlmTopP(res.config.llmTopP);
                if (res.config.llmTopK) setLlmTopK(res.config.llmTopK);
                if (res.config.llmRepetitionPenalty) setLlmRepetitionPenalty(res.config.llmRepetitionPenalty);
            }
        } catch (e) {
            console.error("Failed to load config", e);
        }
    };

    const handleSave = async () => {
        try {
            // @ts-ignore
            const ipcRenderer = window.require ? window.require('electron').ipcRenderer : window.ipcRenderer;
            if (ipcRenderer) {
                await ipcRenderer.invoke('save-config', {
                    comfyOutputDir,
                    projectOutputDir,
                    llmProvider,
                    lmStudioUrl,
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
        } catch (e) {
            console.error("Failed to save config", e);
            setStatusMessage('Error saving settings.');
        }
    };

    const handleSelectFolder = async (setter: (path: string) => void) => {
        try {
            // @ts-ignore
            const ipcRenderer = window.require ? window.require('electron').ipcRenderer : window.ipcRenderer;
            if (!ipcRenderer) return;
            const path = await ipcRenderer.invoke('select-folder');
            if (path) setter(path);
        } catch (err) {
            console.error('Failed to select folder:', err);
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
                    <h3 className="card-title text-purple-400">🤖 AI Generation (LTX Rewording)</h3>
                    <div className="flex gap-3">
                        <AppTooltip content={llmProvider === 'vino' ? "Vino (Intel NPU) is currently ACTIVE" : "Click to select Intel OpenVino NPU"} placement="top">
                            <button 
                                onClick={() => setLlmProvider('vino')}
                                className={`text-xl p-2 rounded-lg transition-all ${llmProvider === 'vino' ? 'bg-purple-600/30 ring-2 ring-purple-500 scale-110' : 'bg-gray-800 opacity-40 hover:opacity-100'}`}
                            >
                                🍷
                            </button>
                        </AppTooltip>
                        <AppTooltip content={llmProvider === 'lmstudio' ? "LM Studio is currently ACTIVE" : "Click to select LM Studio"} placement="top">
                            <button 
                                onClick={() => setLlmProvider('lmstudio')}
                                className={`text-xl p-2 rounded-lg transition-all ${llmProvider === 'lmstudio' ? 'bg-blue-600/30 ring-2 ring-blue-500 scale-110' : 'bg-gray-800 opacity-40 hover:opacity-100'}`}
                            >
                                🏢
                            </button>
                        </AppTooltip>
                    </div>
                </div>

                <div className="p-1 space-y-6">
                    {/* Provider Selection Info */}
                    <div className="bg-black/20 p-3 rounded-lg border border-gray-700/30">
                        <p className="text-xs text-gray-400 italic">
                            {llmProvider === 'vino' 
                                ? "Using local Intel NPU (Vino) for expansion. Ensure Gemma 3 is installed in the vino/ folder." 
                                : "Using LM Studio API for expansion. Ensure your local server is running."}
                        </p>
                    </div>

                    {llmProvider === 'lmstudio' && (
                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-300">LM Studio Server URL</label>
                            <input
                                type="text"
                                value={lmStudioUrl}
                                onChange={(e) => setLmStudioUrl(e.target.value)}
                                className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm text-blue-300 font-mono"
                                placeholder="http://localhost:1234"
                            />
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
