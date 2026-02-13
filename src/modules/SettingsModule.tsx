import React, { useState, useEffect } from 'react';
import './SettingsModule.css';


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

                <div className="settings-input-group">
                    <label className="settings-label">
                        ComfyUI Output Folder (Source)
                    </label>
                    <div className="settings-input-row">
                        <input
                            type="text"
                            value={comfyOutputDir}
                            onChange={(e) => setComfyOutputDir(e.target.value)}
                            className="settings-input"
                            placeholder="C:\ComfyUI\output"
                        />
                        <button
                            onClick={() => handleSelectFolder(setComfyOutputDir)}
                            className="settings-browse-btn"
                        >
                            Browse
                        </button>
                    </div>
                    <p className="settings-help-text">
                        The folder where ComfyUI saves generated audio files (e.g. Vocals_*.mp3).
                    </p>
                </div>
            </div>

            <div className="card mt-4">
                <div className="card-header">
                    <h3 className="card-title">Defaults</h3>
                </div>

                <div className="settings-input-group">
                    <label className="settings-label">
                        Default Project Output Folder
                    </label>
                    <div className="settings-input-row">
                        <input
                            type="text"
                            value={projectOutputDir}
                            onChange={(e) => setProjectOutputDir(e.target.value)}
                            className="settings-input"
                            placeholder="Default folder for new projects"
                        />
                        <button
                            onClick={() => handleSelectFolder(setProjectOutputDir)}
                            className="settings-browse-btn"
                        >
                            Browse
                        </button>
                    </div>
                </div>
            </div>

            <div className="settings-actions">
                <button
                    onClick={handleSave}
                    className="settings-save-btn"
                >
                    Save Settings
                </button>
                {statusMessage && (
                    <span className={`settings-status ${statusMessage.includes('Error') ? 'settings-status-error' : 'settings-status-success'}`}>
                        {statusMessage}
                    </span>
                )}
            </div>
        </div>
    );
};

export default SettingsModule;
