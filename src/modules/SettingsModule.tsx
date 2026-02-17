import React, { useState, useEffect } from 'react';


const SettingsModule: React.FC = () => {
    const [comfyOutputDir, setComfyOutputDir] = useState<string>('');
    const [projectOutputDir, setProjectOutputDir] = useState<string>('');
    const [statusMessage, setStatusMessage] = useState<string>('');

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            // @ts-ignore
            const ipcRenderer = window.require ? window.require('electron').ipcRenderer : window.ipcRenderer;
            if (!ipcRenderer) return;

            const res = await ipcRenderer.invoke('get-config');
            if (res.success) {
                if (res.config.comfyOutputDir) setComfyOutputDir(res.config.comfyOutputDir);
                if (res.config.projectOutputDir) setProjectOutputDir(res.config.projectOutputDir);
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
                    projectOutputDir
                });
                setStatusMessage('Settings saved successfully!');
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
