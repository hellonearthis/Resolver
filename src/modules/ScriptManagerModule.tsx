import { useState, useEffect, useCallback } from 'react';

// Helper to get IPC renderer (allows mocking in tests)
const getIpcRenderer = () => {
    if ((window as any).require) {
        return (window as any).require('electron').ipcRenderer;
    }
    return null;
};

interface ScriptFile {
    name: string;
    path: string;
    size: number;
    mtime: string | Date; // Date string or object from IPC
}

export default function ScriptManagerModule() {
    const [scripts, setScripts] = useState<ScriptFile[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [resolvePath] = useState('C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve\\Fusion\\Scripts\\Comp\\'); // Just a display string

    const ipcRenderer = getIpcRenderer();

    const loadScripts = useCallback(async () => {
        let isMounted = true;
        if (!ipcRenderer) {
            setStatus('Script Manager requires the Electron app.');
            return;
        }

        setIsLoading(true);
        try {
            const result = await ipcRenderer.invoke('list-resolve-scripts');
            if (isMounted) {
                // Ensure mtime is a Date object
                const processed = result.map((f: any) => ({
                    ...f,
                    mtime: new Date(f.mtime)
                }));
                setScripts(processed);
                setStatus('');
            }
        } catch (err) {
            if (isMounted) {
                console.error('Failed to list scripts:', err);
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
            const result = await ipcRenderer.invoke('rename-resolve-script', { oldPath, newName });
            if (result.success) {
                setStatus(`Renamed to ${newName}`);
                loadScripts();
            } else {
                setStatus(`Failed to rename: ${result.error}`);
            }
        } catch (err) {
            console.error('Failed to rename script:', err);
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
        } catch (err) {
            console.error('Failed to open script:', err);
            setStatus('Error opening script.');
        }
    };

    const handleDelete = async (scriptPath: string, scriptName: string) => {
        if (!confirm(`Are you sure you want to delete "${scriptName}"?`)) {
            return;
        }

        if (!ipcRenderer) return;

        try {
            const result = await ipcRenderer.invoke('delete-resolve-script', scriptPath);
            if (result.success) {
                setStatus(`Deleted ${scriptName}`);
                loadScripts(); // Refresh list
            } else {
                setStatus(`Failed to delete: ${result.error}`);
            }
        } catch (err) {
            console.error('Failed to delete script:', err);
            setStatus('Error deleting script.');
        }
    };

    useEffect(() => {
        const cleanup = loadScripts(); // loadScripts now returns a promise that resolves to a cleanup function (or void)
        return () => {
            cleanup.then(c => c && c());
        };
    }, [loadScripts]);

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

                <p style={{
                    fontFamily: 'monospace',
                    background: 'var(--bg-tertiary)',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                    marginBottom: '20px',
                    overflowWrap: 'break-word'
                }}>
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
                                        <td style={{ padding: '12px 8px', fontWeight: 500 }}>
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
