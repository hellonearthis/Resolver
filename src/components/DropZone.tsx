import React, { useCallback } from 'react';

interface DropZoneProps {
    onFilesDropped: (files: File[]) => void;
    accept: string;
    label: string;
    defaultAudioPath?: string;
}

// Lazy load Electron dependencies to avoid top-level require issues in tests/browser
const getElectron = () => (window.require ? window.require('electron') : null);
const getFs = () => (window.require ? window.require('fs') : null);
const getPath = () => (window.require ? window.require('path') : null);

const DropZone: React.FC<DropZoneProps> = ({ onFilesDropped, accept, label, defaultAudioPath }) => {
    // Helper to resolve paths for a list of files
    const resolvePaths = (files: File[]): File[] => {
        // use window.electronWebUtils exposed by preload
        const webUtils = (window as any).electronWebUtils;

        console.log("DropZone: Resolving paths. webUtils available:", !!webUtils);

        if (webUtils) {
            files.forEach(f => {
                // If path is missing, try to resolve it
                if (!(f as any).path) {
                    try {
                        const p = webUtils.getPathForFile(f);
                        if (p) {
                            // Simple assignment as recommended
                            try {
                                (f as any).path = p;
                            } catch (e) {
                                console.warn("DropZone: Simple assignment failed, complying...", e);
                            }
                            console.log("DropZone: Resolved path:", p);
                        }
                    } catch (err) {
                        console.warn("DropZone: Failed to resolve path for", f.name, err);
                    }
                }
            });
        }
        return files;
    };

    const handleDrop = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.stopPropagation();

            console.log("DropZone v2.2: Drop Event");
            console.log("Electron version:", (window as any).process?.versions?.electron);
            console.log("webUtils present:", !!(window as any).electronWebUtils);

            let allFiles = Array.from(e.dataTransfer.files);

            // Resolve paths
            allFiles = resolvePaths(allFiles);

            // Filter
            const acceptType = accept.replace('/*', '/');
            const filtered = allFiles.filter(f => {
                const mimeMatch = f.type.startsWith(acceptType) || accept === '*';
                if (mimeMatch) return true;
                const ext = f.name.split('.').pop()?.toLowerCase();
                if (accept.startsWith('audio/')) return ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'wma', 'aiff'].includes(ext || '');
                if (accept.startsWith('video/')) return ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext || '');
                return false;
            });

            console.log("DropZone: Accepted files:", filtered.length);

            if (filtered.length > 0) {
                onFilesDropped(filtered);
            }
        },
        [onFilesDropped, accept]
    );

    const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            let files = Array.from(e.target.files);
            // Also resolve paths for input selection!
            files = resolvePaths(files);
            onFilesDropped(files);
        }
    };

    const handleClick = useCallback(async () => {
        const electron = getElectron();
        const ipcRenderer = electron ? electron.ipcRenderer : null;
        const fs = getFs();
        const nodePath = getPath();

        // Use Electron native dialog when available and a default path exists
        if (ipcRenderer && defaultAudioPath) {
            try {
                const filePath: string | null = await ipcRenderer.invoke('open-audio-dialog', defaultAudioPath);
                if (filePath && fs && nodePath) {
                    const buffer = fs.readFileSync(filePath);
                    const fileName = nodePath.basename(filePath);
                    const blob = new Blob([buffer]);
                    const file = new File([blob], fileName, { type: 'audio/mpeg' });
                    // Set path directly
                    (file as any).path = filePath;

                    onFilesDropped([file]);
                }
            } catch (err) {
                console.error('Electron dialog failed:', err);
                // Fall back to browser file input
                document.getElementById(`file-input-${label}`)?.click();
            }
        } else {
            document.getElementById(`file-input-${label}`)?.click();
        }
    }, [defaultAudioPath, label, onFilesDropped]);

    // Helper for rendering check
    const electron = getElectron();
    const hasIpc = !!(electron?.ipcRenderer);

    return (
        <div
            className="drop-zone"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={handleClick}
        >
            <input
                type="file"
                id={`file-input-${label}`}
                multiple
                accept={accept}
                style={{ display: 'none' }}
                onChange={handleChange}
            />
            <div className="drop-zone-icon">📁</div>
            <p className="drop-zone-text">{label}</p>
            {defaultAudioPath && !hasIpc && (
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Looking for: {defaultAudioPath.split(/[/\\]/).pop()}
                </p>
            )}
        </div>
    );
};

export default DropZone;
