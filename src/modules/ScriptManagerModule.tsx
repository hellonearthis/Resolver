import { useState, useEffect, useCallback } from 'react';

interface ElectronRuntimeBridge {
    require?: (module_name: string) => {
        ipcRenderer?: {
            invoke: <T = unknown>(channel: string, ...arguments_list: unknown[]) => Promise<T>;
        };
        dirname?: (file_path: string) => string;
    };
}

// Helper to get IPC renderer (allows mocking in tests)
const getIpcRenderer = () => {
    const electron_runtime = window as unknown as ElectronRuntimeBridge;
    if (electron_runtime.require) {
        return electron_runtime.require('electron')?.ipcRenderer ?? null;
    }
    return null;
};

interface ScriptFile {
    name: string;
    path: string;
    size: number;
    mtime: string | Date; // Date string or object from IPC
}

interface BridgeStatusInfo {
    is_installed: boolean;
    installed_file_path: string;
    is_online: boolean;
    application_name?: string;
    active_project_name?: string | null;
    active_timeline_name?: string | null;
    timeline_frame_rate?: number;
    error_message?: string;
}

export default function ScriptManagerModule() {
    const [scripts, setScripts] = useState<ScriptFile[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [resolvePath] = useState('C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve\\Fusion\\Scripts\\Comp\\'); // Just a display string

    // DaVinci Resolve HTTP Loopback Bridge State
    const [bridgeStatus, setBridgeStatus] = useState<BridgeStatusInfo | null>(null);
    const [isCheckingBridge, setIsCheckingBridge] = useState(false);
    const [isInstallingBridge, setIsInstallingBridge] = useState(false);
    const [bridgeMessage, setBridgeMessage] = useState('');

    const ipcRenderer = getIpcRenderer();

    const loadScripts = useCallback(async () => {
        let isMounted = true;
        if (!ipcRenderer) {
            setStatus('Script Manager requires the Electron app.');
            return;
        }

        setIsLoading(true);
        try {
            const result = await ipcRenderer.invoke<ScriptFile[]>('list-resolve-scripts');
            if (isMounted) {
                // Ensure mtime is a Date object
                const processed = (result || []).map((script_file_item: ScriptFile) => ({
                    ...script_file_item,
                    mtime: new Date(script_file_item.mtime)
                }));
                setScripts(processed);
                setStatus('');
            }
        } catch (caught_error) {
            if (isMounted) {
                console.error('Failed to list scripts:', caught_error);
                setStatus('Failed to load scripts.');
            }
        } finally {
            if (isMounted) {
                setIsLoading(false);
            }
        }
        return () => { isMounted = false; };
    }, [ipcRenderer]);

    const [renamingScript, setRenamingScript] = useState<{ path: string, name: string } | null>(null);
    const [renameValue, setRenameValue] = useState('');

    const startRename = (script: ScriptFile) => {
        setRenamingScript({ path: script.path, name: script.name });
        setRenameValue(script.name);
    };

    const confirmRename = async () => {
        if (!renamingScript || !ipcRenderer) return;

        const oldPath = renamingScript.path;
        const newName = renameValue.trim();

        if (!newName || newName === renamingScript.name) {
            setRenamingScript(null);
            return;
        }

        try {
            const result = await ipcRenderer.invoke<{ success: boolean; error?: string }>('rename-resolve-script', { oldPath, newName });
            if (result.success) {
                setStatus(`Renamed to ${newName}`);
                loadScripts();
            } else {
                setStatus(`Failed to rename: ${result.error}`);
            }
        } catch (caught_error) {
            console.error('Failed to rename script:', caught_error);
            setStatus('Error renaming script.');
        } finally {
            setRenamingScript(null);
        }
    };

    // Removed old handleRename in favor of startRename/confirmRename interaction

    const handleEdit = async (scriptPath: string) => {
        if (!ipcRenderer) return;
        try {
            await ipcRenderer.invoke('edit-resolve-script', scriptPath);
            setStatus('Opened script in Notepad');
        } catch (caught_error) {
            console.error('Failed to open script:', caught_error);
            setStatus('Error opening script.');
        }
    };

    const handleDelete = async (scriptPath: string, scriptName: string) => {
        if (!confirm(`Are you sure you want to delete "${scriptName}"?`)) {
            return;
        }

        if (!ipcRenderer) return;

        try {
            const result = await ipcRenderer.invoke<{ success: boolean; error?: string }>('delete-resolve-script', scriptPath);
            if (result.success) {
                setStatus(`Deleted ${scriptName}`);
                loadScripts(); // Refresh list
            } else {
                setStatus(`Failed to delete: ${result.error}`);
            }
        } catch (caught_error) {
            console.error('Failed to delete script:', caught_error);
            setStatus('Error deleting script.');
        }
    };

    const handleOpenFolder = async (scriptPath: string) => {
        if (!ipcRenderer) return;
        try {
            const electron_runtime = window as unknown as ElectronRuntimeBridge;
            const target_directory = electron_runtime.require ? electron_runtime.require('path')?.dirname?.(scriptPath) : null;
            if (target_directory) {
                await ipcRenderer.invoke('open-folder', target_directory);
            }
        } catch (error_instance) {
            console.error('Failed to open folder:', error_instance);
            setStatus('Error opening folder.');
        }
    };

    const handleOpenParentFolder = async (dirPath: string) => {
        if (!ipcRenderer) return;
        try {
            await ipcRenderer.invoke('open-folder', dirPath);
        } catch (caught_error) {
            console.error('Failed to open folder:', caught_error);
            setStatus('Error opening folder.');
        }
    };

    // WHAT: Query the live connection and installation state of the Resolve Bridge.
    // WHY: Updates the connection badge and informs user whether Resolve is ready.
    const checkBridgeStatus = useCallback(async () => {
        if (!ipcRenderer) return;
        setIsCheckingBridge(true);
        try {
            const statusResult = await ipcRenderer.invoke<BridgeStatusInfo>('resolve-bridge-status');
            if (statusResult && typeof statusResult === 'object' && 'is_installed' in statusResult) {
                setBridgeStatus(statusResult);
            }
        } catch (bridgeError) {
            console.error('Failed to check bridge status:', bridgeError);
        } finally {
            setIsCheckingBridge(false);
        }
    }, [ipcRenderer]);

    // WHAT: Installs resolve_bridge.py into Resolve's Utility scripts directory.
    // WHY: One-click setup without requiring manual navigation in Windows Explorer.
    const handleInstallBridge = async () => {
        if (!ipcRenderer) return;
        setIsInstallingBridge(true);
        setBridgeMessage('');
        try {
            const installResult = await ipcRenderer.invoke<{ success: boolean; error?: string }>('resolve-bridge-install');
            if (installResult.success) {
                setBridgeMessage('Bridge script installed successfully into DaVinci Resolve Utility folder!');
                await checkBridgeStatus();
            } else {
                setBridgeMessage(`Failed to install bridge: ${installResult.error}`);
            }
        } catch (installError: unknown) {
            setBridgeMessage(`Error installing bridge: ${installError instanceof Error ? installError.message : String(installError)}`);
        } finally {
            setIsInstallingBridge(false);
        }
    };

    useEffect(() => {
        const cleanup = loadScripts(); 
        checkBridgeStatus();
        return () => {
            cleanup.then(cleanup_callback => cleanup_callback && cleanup_callback());
        };
    }, [loadScripts, checkBridgeStatus]);

    // Format bytes to KB/MB
    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    // Format date
    const formatDate = (date: Date) => {
        return date.toLocaleString();
    };

    if (!ipcRenderer) {
        return (
            <div className="module-container">
                <div className="module-header">
                    <h2 className="module-title">📜 Script Manager</h2>
                    <p className="module-description">Manage your generated Resolve scripts.</p>
                </div>
                <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
                    <p>This feature requires the application to be running in Electron mode.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="module-container">
            <div className="module-header">
                <h2 className="module-title">📜 Script Manager</h2>
                <p className="module-description">
                    Manage generated markers scripts in DaVinci Resolve's folder.
                </p>
            </div>

            {/* DaVinci Resolve HTTP Bridge Section */}
            <div className="card" style={{ marginBottom: '24px' }}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <h3 className="card-title" style={{ margin: 0 }}>⚡ DaVinci Resolve Bridge (Direct Control)</h3>
                        {bridgeStatus?.is_online ? (
                            <span style={{
                                backgroundColor: 'rgba(34, 197, 94, 0.2)',
                                color: '#4ade80',
                                border: '1px solid rgba(34, 197, 94, 0.4)',
                                padding: '3px 10px',
                                borderRadius: '12px',
                                fontSize: '0.75rem',
                                fontWeight: 'bold',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                            }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#4ade80', display: 'inline-block' }}></span>
                                Connected
                            </span>
                        ) : (
                            <span style={{
                                backgroundColor: 'rgba(239, 68, 68, 0.2)',
                                color: '#f87171',
                                border: '1px solid rgba(239, 68, 68, 0.4)',
                                padding: '3px 10px',
                                borderRadius: '12px',
                                fontSize: '0.75rem',
                                fontWeight: 'bold',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                            }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#f87171', display: 'inline-block' }}></span>
                                Offline
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            className="btn btn-secondary"
                            onClick={checkBridgeStatus}
                            disabled={isCheckingBridge}
                            style={{ fontSize: '0.85rem', padding: '4px 12px' }}
                        >
                            {isCheckingBridge ? 'Checking...' : '🔄 Test Connection'}
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={handleInstallBridge}
                            disabled={isInstallingBridge}
                            style={{ fontSize: '0.85rem', padding: '4px 12px' }}
                        >
                            {isInstallingBridge ? 'Installing...' : bridgeStatus?.is_installed ? '⚡ Re-install Script' : '⚡ Install Bridge Script'}
                        </button>
                    </div>
                </div>

                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '8px 0 16px' }}>
                    Enables instant real-time sync with DaVinci Resolve Free &amp; Studio without exporting manual Python scripts.
                </p>

                {bridgeMessage && (
                    <div style={{
                        padding: '10px 14px',
                        background: bridgeMessage.includes('Failed') || bridgeMessage.includes('Error') ? 'rgba(255, 100, 100, 0.1)' : 'rgba(100, 255, 100, 0.1)',
                        borderLeft: `3px solid ${bridgeMessage.includes('Failed') || bridgeMessage.includes('Error') ? 'var(--error)' : 'var(--success)'}`,
                        marginBottom: '16px',
                        borderRadius: '4px',
                        fontSize: '0.85rem'
                    }}>
                        {bridgeMessage}
                    </div>
                )}

                {bridgeStatus?.is_online ? (
                    <div style={{
                        background: 'rgba(34, 197, 94, 0.05)',
                        border: '1px solid rgba(34, 197, 94, 0.2)',
                        borderRadius: '6px',
                        padding: '12px 16px',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: '12px',
                        fontSize: '0.85rem'
                    }}>
                        <div>
                            <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Active Project</span>
                            <span style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>{bridgeStatus.active_project_name || 'None open'}</span>
                        </div>
                        <div>
                            <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current Timeline</span>
                            <span style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>{bridgeStatus.active_timeline_name || 'None selected'}</span>
                        </div>
                        <div>
                            <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Connection</span>
                            <span style={{ fontWeight: 'bold', color: '#4ade80' }}>127.0.0.1:8878 (Live HTTP)</span>
                        </div>
                    </div>
                ) : (
                    <div style={{
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        padding: '14px 16px',
                        fontSize: '0.85rem'
                    }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '8px', color: 'var(--text-primary)' }}>
                            Quick Setup Guide:
                        </div>
                        <ol style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                            <li>
                                {bridgeStatus?.is_installed ? (
                                    <span style={{ color: '#4ade80' }}>✅ Bridge script is installed in Resolve's Utility scripts folder.</span>
                                ) : (
                                    <span>Click <b>"Install Bridge Script"</b> above to copy <code>resolve_bridge.py</code> to Resolve's Utility folder.</span>
                                )}
                            </li>
                            <li>Open <b>DaVinci Resolve</b> and open or create any project.</li>
                            <li>From DaVinci Resolve's menu: go to <b>Workspace ▸ Scripts ▸ Utility ▸ resolve_bridge</b>.</li>
                            <li>Click <b>"Test Connection"</b> above. Once online, live marker pushing and timeline building are enabled!</li>
                        </ol>
                    </div>
                )}
            </div>

            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">Resolve Scripts Folder</h3>
                    <button
                        className="btn btn-secondary"
                        onClick={loadScripts}
                        disabled={isLoading}
                        style={{ fontSize: '0.9rem', padding: '4px 12px' }}
                    >
                        🔄 Refresh
                    </button>
                </div>

                <p 
                    onClick={() => handleOpenParentFolder(resolvePath)}
                    style={{
                        fontFamily: 'monospace',
                        background: 'var(--bg-tertiary)',
                        padding: '8px 12px',
                        borderRadius: '4px',
                        fontSize: '0.85rem',
                        color: 'var(--text-secondary)',
                        marginBottom: '20px',
                        overflowWrap: 'break-word',
                        cursor: 'pointer',
                        border: '1px solid transparent',
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                    onMouseOut={(e) => (e.currentTarget.style.borderColor = 'transparent')}
                    title="Click to open folder in explorer"
                >
                    {resolvePath}
                </p>

                {status && (
                    <div style={{
                        padding: '10px',
                        background: status.includes('Failed') || status.includes('Error') ? 'rgba(255, 100, 100, 0.1)' : 'rgba(100, 255, 100, 0.1)',
                        borderLeft: `3px solid ${status.includes('Failed') || status.includes('Error') ? 'var(--error)' : 'var(--success)'}`,
                        marginBottom: '16px',
                        borderRadius: '4px'
                    }}>
                        {status}
                    </div>
                )}

                {scripts.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                        <p>No scripts found.</p>
                        <p style={{ fontSize: '0.9rem', marginTop: '8px' }}>
                            Generate scripts using the <b>Beat Extraction</b> module.
                        </p>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                                    <th style={{ padding: '12px 8px', color: 'var(--text-secondary)' }}>Name</th>
                                    <th style={{ padding: '12px 8px', color: 'var(--text-secondary)' }}>Size</th>
                                    <th style={{ padding: '12px 8px', color: 'var(--text-secondary)' }}>Date Modified</th>
                                    <th style={{ padding: '12px 8px', color: 'var(--text-secondary)', textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {scripts.map((script) => (
                                    <tr key={script.name} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                        <td 
                                            style={{ padding: '12px 8px', fontWeight: 500, cursor: 'pointer' }}
                                            onClick={() => handleOpenFolder(script.path)}
                                            title="Click to open folder"
                                        >
                                            {script.name}
                                        </td>
                                        <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>
                                            {formatSize(script.size)}
                                        </td>
                                        <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>
                                            {formatDate(script.mtime as Date)}
                                        </td>
                                        <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                                            <button
                                                onClick={() => handleEdit(script.path)}
                                                style={{
                                                    background: 'none',
                                                    border: '1px solid var(--text-secondary)',
                                                    color: 'var(--text-secondary)',
                                                    padding: '4px 8px',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer',
                                                    fontSize: '0.8rem',
                                                    marginRight: '8px',
                                                }}
                                                title="Edit in Notepad"
                                            >
                                                ✏️ Edit
                                            </button>
                                            <button
                                                onClick={() => startRename(script)}
                                                style={{
                                                    background: 'none',
                                                    border: '1px solid var(--text-secondary)',
                                                    color: 'var(--text-secondary)',
                                                    padding: '4px 8px',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer',
                                                    fontSize: '0.8rem',
                                                    marginRight: '8px',
                                                }}
                                                title="Rename script"
                                            >
                                                🔤 Rename
                                            </button>
                                            <button
                                                onClick={() => handleDelete(script.path, script.name)}
                                                style={{
                                                    background: 'none',
                                                    border: '1px solid var(--error)',
                                                    color: 'var(--error)',
                                                    padding: '4px 8px',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer',
                                                    fontSize: '0.8rem',
                                                    opacity: 0.8
                                                }}
                                                title="Delete this script"
                                                onMouseOver={(e) => (e.currentTarget.style.opacity = '1')}
                                                onMouseOut={(e) => (e.currentTarget.style.opacity = '0.8')}
                                            >
                                                🗑️ Delete
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Simple Rename Modal */}
            {renamingScript && (
                <div style={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.7)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000
                }}>
                    <div className="card" style={{ width: '400px', maxWidth: '90%' }}>
                        <h3 className="card-title" style={{ marginBottom: '16px' }}>Rename Script</h3>
                        <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') confirmRename();
                                if (e.key === 'Escape') setRenamingScript(null);
                            }}
                            autoFocus
                            style={{
                                width: '100%',
                                padding: '10px',
                                marginBottom: '20px',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color)',
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-primary)'
                            }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <button
                                className="btn btn-secondary"
                                onClick={() => setRenamingScript(null)}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={confirmRename}
                            >
                                Rename
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
