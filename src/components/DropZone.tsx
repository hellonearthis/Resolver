import React, { useCallback } from 'react';

export interface FileWithPath extends File {
    path?: string;
}

interface ElectronWebUtilsGlobal {
    getPathForFile: (file: File) => string;
}

interface NodeFsModule {
    readFileSync: (file_path: string) => Uint8Array;
}

interface NodePathModule {
    basename: (file_path: string) => string;
}

interface ElectronRuntimeBridge {
    ipcRenderer?: {
        invoke: (channel_name: string, ...arguments_list: unknown[]) => Promise<string | null>;
    };
}

interface ExtendedWindowDropZone {
    electronWebUtils?: ElectronWebUtilsGlobal;
    process?: { versions?: { electron?: string } };
    require?: (module_name: string) => unknown;
}

interface DropZoneProps {
    onFilesDropped: (dropped_files: FileWithPath[]) => void;
    accept: string;
    label: string;
    defaultAudioPath?: string;
}

// WHAT: Safely retrieves Node/Electron modules at runtime if executing in desktop environment.
// WHY: Prevents Vite web bundler crashes and SSR import failures while providing native features in Electron.
const getExtendedWindow = (): ExtendedWindowDropZone => window as unknown as ExtendedWindowDropZone;

const getElectronModule = (): ElectronRuntimeBridge | null => {
    const extended_window = getExtendedWindow();
    return extended_window.require ? (extended_window.require('electron') as ElectronRuntimeBridge) : null;
};

const getFsModule = (): NodeFsModule | null => {
    const extended_window = getExtendedWindow();
    return extended_window.require ? (extended_window.require('fs') as NodeFsModule) : null;
};

const getPathModule = (): NodePathModule | null => {
    const extended_window = getExtendedWindow();
    return extended_window.require ? (extended_window.require('path') as NodePathModule) : null;
};

// WHAT: Drag-and-drop file ingest target with native Electron file path resolution.
// WHY: In web browsers, HTML5 File objects conceal local disk paths for security; in Electron desktop,
// webUtils.getPathForFile restores the real filesystem path necessary for FFmpeg and DaVinci Resolve.
const DropZone: React.FC<DropZoneProps> = ({ 
    onFilesDropped, 
    accept, 
    label, 
    defaultAudioPath 
}) => {
    // WHAT: Inspects incoming File objects and resolves absolute filesystem paths using Electron webUtils.
    // WHY: Downstream media pipelines (Demucs, Essentia, FFmpeg) require absolute OS paths, not browser Blobs.
    const resolveFilePaths = (files_to_resolve: FileWithPath[]): FileWithPath[] => {
        const extended_window = getExtendedWindow();
        const web_utils_bridge = extended_window.electronWebUtils;

        if (web_utils_bridge) {
            files_to_resolve.forEach(file_item => {
                if (!file_item.path) {
                    try {
                        const resolved_disk_path = web_utils_bridge.getPathForFile(file_item);
                        if (resolved_disk_path) {
                            try {
                                file_item.path = resolved_disk_path;
                            } catch (assignment_error) {
                                console.warn("DropZone: Simple assignment failed, complying...", assignment_error);
                            }
                        }
                    } catch (resolution_error) {
                        console.warn("DropZone: Failed to resolve path for", file_item.name, resolution_error);
                    }
                }
            });
        }
        return files_to_resolve;
    };

    const handleDrop = useCallback(
        (drag_event: React.DragEvent<HTMLDivElement>) => {
            drag_event.preventDefault();
            drag_event.stopPropagation();

            let extracted_files: FileWithPath[] = Array.from(drag_event.dataTransfer.files) as FileWithPath[];

            // Resolve real disk paths via webUtils
            extracted_files = resolveFilePaths(extracted_files);

            // Filter files matching MIME or extension criteria
            const target_mime_category = accept.replace('/*', '/');
            const accepted_audio_extensions = ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'wma', 'aiff'];
            const accepted_video_extensions = ['mp4', 'mov', 'avi', 'mkv', 'webm'];

            const validated_files = extracted_files.filter(file_candidate => {
                const is_mime_match = file_candidate.type.startsWith(target_mime_category) || accept === '*';
                if (is_mime_match) return true;

                const file_extension_suffix = file_candidate.name.split('.').pop()?.toLowerCase();
                if (accept.startsWith('audio/')) {
                    return accepted_audio_extensions.includes(file_extension_suffix || '');
                }
                if (accept.startsWith('video/')) {
                    return accepted_video_extensions.includes(file_extension_suffix || '');
                }
                return false;
            });

            if (validated_files.length > 0) {
                onFilesDropped(validated_files);
            }
        },
        [onFilesDropped, accept]
    );

    const handleDragOver = useCallback((drag_over_event: React.DragEvent<HTMLDivElement>) => {
        drag_over_event.preventDefault();
        drag_over_event.stopPropagation();
    }, []);

    const handleChange = (input_change_event: React.ChangeEvent<HTMLInputElement>) => {
        if (input_change_event.target.files) {
            let selected_files: FileWithPath[] = Array.from(input_change_event.target.files) as FileWithPath[];
            selected_files = resolveFilePaths(selected_files);
            onFilesDropped(selected_files);
        }
    };

    const handleClick = useCallback(async () => {
        const electron_module = getElectronModule();
        const ipc_renderer_instance = electron_module?.ipcRenderer;
        const node_fs_module = getFsModule();
        const node_path_module = getPathModule();

        // Use Electron native dialog when available and a default path exists
        if (ipc_renderer_instance && defaultAudioPath) {
            try {
                const selected_file_path: string | null = await ipc_renderer_instance.invoke('open-audio-dialog', defaultAudioPath);
                if (selected_file_path && node_fs_module && node_path_module) {
                    const audio_buffer = node_fs_module.readFileSync(selected_file_path);
                    const audio_filename = node_path_module.basename(selected_file_path);
                    const audio_blob = new Blob([audio_buffer.buffer as ArrayBuffer]);
                    const audio_file: FileWithPath = new File([audio_blob], audio_filename, { type: 'audio/mpeg' });
                    audio_file.path = selected_file_path;

                    onFilesDropped([audio_file]);
                }
            } catch (native_dialog_error) {
                console.error('Electron dialog failed:', native_dialog_error);
                // Fall back to browser file input
                document.getElementById(`file-input-${label}`)?.click();
            }
        } else {
            document.getElementById(`file-input-${label}`)?.click();
        }
    }, [defaultAudioPath, label, onFilesDropped]);

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
                onChange={handleChange}
                style={{ display: 'none' }}
            />
            <div className="drop-zone-content">
                <span className="drop-icon">📁</span>
                <p className="drop-label">{label}</p>
                <p className="drop-hint">Click or drag & drop files here</p>
            </div>
        </div>
    );
};

export default DropZone;
