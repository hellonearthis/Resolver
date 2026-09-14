/**
 * Project Storage Hook
 * 
 * Persists beat extraction projects with audio paths and associated CSV files.
 * Uses localStorage and filesystem project bundles for desktop persistence.
 */

import { useState, useEffect, useCallback } from 'react';
import type { StoryboardAsset } from '../types/storyboard';
import type { VideoClip } from '../types/assembler';
import type { MusicSection } from '../types/sections';

// WHAT: Custom duck-typed interfaces for Electron IPC and Node filesystem access in the renderer.
// WHY: Avoids `@ts-ignore` and loose `any` casts while supporting both desktop Electron runtime and web preview.
interface NodeFsModule {
    existsSync: (file_path: string) => boolean;
    mkdirSync: (directory_path: string, options?: { recursive?: boolean }) => void;
    writeFileSync: (file_path: string, data: string) => void;
    unlinkSync: (file_path: string) => void;
}

interface NodePathModule {
    dirname: (file_path: string) => string;
    basename: (file_path: string) => string;
    join: (...path_segments: string[]) => string;
}

interface ElectronIpcRenderer {
    invoke: (channel: string, ...arguments_list: unknown[]) => Promise<unknown>;
}

interface WindowWithElectronModules {
    require?: (module_name: string) => unknown;
    ipcRenderer?: ElectronIpcRenderer;
}

const electron_window = window as unknown as WindowWithElectronModules;

const getFsModule = (): NodeFsModule | null => {
    try {
        return electron_window.require ? (electron_window.require('fs') as NodeFsModule) : null;
    } catch {
        return null;
    }
};

const getPathModule = (): NodePathModule | null => {
    try {
        return electron_window.require ? (electron_window.require('path') as NodePathModule) : null;
    } catch {
        return null;
    }
};

const getIpcRenderer = (): ElectronIpcRenderer | null => {
    try {
        if (electron_window.require) {
            const electron_module = electron_window.require('electron') as { ipcRenderer?: ElectronIpcRenderer } | null;
            return electron_module?.ipcRenderer ?? null;
        }
        return electron_window.ipcRenderer ?? null;
    } catch {
        return null;
    }
};

// WHAT: Serializes a JavaScript object into indented JSON while compacting pure number arrays into single lines.
// WHY: Projects contain long beat marker timestamp arrays (thousands of numbers). Standard 2-space indentation
// creates massive 10,000+ line JSON files that are difficult to inspect and slow down editor performance.
const stringifyWithCompactArrays = (raw_project_object: unknown): string => {
    const standard_json_string = JSON.stringify(raw_project_object, null, 2);
    // Find arrays that contain only numbers, commas, and whitespace
    return standard_json_string.replace(
        /\[\s*([\d\s.,+\-eE]+)\s*\]/g,
        (full_array_match, matched_array_inner_content) => {
            // Verify it's genuinely a list of numbers to avoid matching random text
            if (/^[ \n\r\t\d.,+\-eE]+$/.test(matched_array_inner_content)) {
                return `[ ${matched_array_inner_content.replace(/\s+/g, ' ').trim()} ]`;
            }
            return full_array_match;
        }
    );
};

export interface ProjectMarker {
    timestamp: number;
    frame: number;
    color: string;
    note: string;
    type: 'beat' | 'onset' | 'loudness';
    duration_sec: number;
}

export interface BeatProject {
    id: string;
    name: string;
    audioPath?: string;
    audioFileName?: string;
    csvPath?: string;
    frameRate: number;
    duration?: number; // Total project/audio duration in seconds
    bpm?: number;
    beatCount?: number;
    stemType: string;
    stems?: { type: string; path: string; beats?: number[]; markers?: ProjectMarker[]; color?: string }[];
    outputDir?: string; // Path to save the project JSON
    algorithm?: string;
    enableLoudness?: boolean;
    markers?: ProjectMarker[];
    segments?: unknown[]; // Video assembler timeline segments
    sections?: MusicSection[]; // Video assembler timeline musical sections (Verse, Chorus, etc.)
    videoPath?: string; // Absolute path to the source video file (not copied)
    videoDuration?: number; // Video duration in seconds
    videoFps?: number; // Video frame rate
    
    // Unified Timeline & Storyboard Data
    clips?: VideoClip[]; // Holds video and storyboard metadata
    elementTray?: StoryboardAsset[];
    animaticEnabled?: boolean;

    createdAt: string;
    updatedAt: string;
}

// WHAT: Hook managing persistence, discovery, and mutation of BeatProjects on disk.
// WHY: Decouples UI modules from direct filesystem manipulation and standardizes the PRJ_ bundle structure.
export function useProjectStorage() {
    const [projects, setProjects] = useState<BeatProject[]>([]);
    const [isLoaded, setIsLoaded] = useState(() => !getIpcRenderer());

    // WHAT: Scans the configured projects directory for project bundles via Electron IPC.
    // WHY: Populates the project selection drawer on application boot or after directory reconfigurations.
    const refreshProjects = useCallback(async (custom_directory_path?: string) => {
        const ipc_renderer_instance = getIpcRenderer();
        if (!ipc_renderer_instance) {
            setIsLoaded(true);
            return;
        }

        try {
            // 1. Get the path to scan
            let directory_path_to_scan = custom_directory_path;
            if (!directory_path_to_scan) {
                const configuration_result = (await ipc_renderer_instance.invoke('get-config')) as { success: boolean; config?: { projectOutputDir?: string } };
                if (configuration_result?.success && configuration_result?.config?.projectOutputDir) {
                    directory_path_to_scan = configuration_result.config.projectOutputDir;
                }
            }

            if (!directory_path_to_scan) {
                console.log('[useProjectStorage] No scan path found in config.');
                return;
            }

            console.log(`[useProjectStorage] Scanning for projects in: ${directory_path_to_scan}`);
            // 2. Scan the folder
            const scan_result = (await ipc_renderer_instance.invoke('scan-projects-folder', directory_path_to_scan)) as { success: boolean; projects?: BeatProject[] };
            if (scan_result?.success && Array.isArray(scan_result?.projects)) {
                setProjects(scan_result.projects);
            }
        } catch (error_instance) {
            console.error('Failed to refresh projects:', error_instance);
        } finally {
            setIsLoaded(true);
        }
    }, []);

    // Load projects on mount
    useEffect(() => {
        if (getIpcRenderer()) {
            refreshProjects();
        }
    }, [refreshProjects]);

    // WHAT: Persists a BeatProject to a self-contained bundle directory (`PRJ_<SafeName>/project.json`).
    // WHY: Organizing projects into standardized bundle directories prevents loose JSON collisions and keeps
    // exported stems, storyboard cards, and cache files localized to their parent project.
    const saveProjectFile = (project_to_save: BeatProject): BeatProject => {
        let current_output_directory_path = project_to_save.outputDir;

        // Fallback to audio path directory if outputDir is not set
        if (!current_output_directory_path && project_to_save.audioPath) {
            try {
                const node_path_instance = getPathModule();
                if (node_path_instance) {
                    current_output_directory_path = node_path_instance.dirname(project_to_save.audioPath);
                }
            } catch {
                // ignore
            }
        }

        if (!current_output_directory_path) return project_to_save;

        try {
            const node_fs_instance = getFsModule();
            const node_path_instance = getPathModule();
            if (!node_fs_instance || !node_path_instance) return project_to_save;

            const safe_project_name = project_to_save.name.replace(/[^a-zA-Z0-9-_]/g, '_');
            const bundle_folder_name = `PRJ_${safe_project_name}`;

            // Normalize path to prevent trailing slashes from breaking basename (recursive nesting fix)
            const normalized_output_directory = current_output_directory_path.replace(/[\\/]+$/, '');
            const directory_base_name = node_path_instance.basename(normalized_output_directory);

            // Determine if outputDir already IS the per-project bundle folder
            // Use startsWith('PRJ_') to prevent infinite nesting if the project name gets slightly altered
            const is_already_bundle_directory = directory_base_name.startsWith('PRJ_') || 
                                              directory_base_name === safe_project_name || 
                                              normalized_output_directory.includes('PRJ_');
            const target_bundle_directory = is_already_bundle_directory
                ? normalized_output_directory
                : node_path_instance.join(normalized_output_directory, bundle_folder_name);

            // Create bundle directory if it doesn't exist
            if (!node_fs_instance.existsSync(target_bundle_directory)) {
                node_fs_instance.mkdirSync(target_bundle_directory, { recursive: true });
            }

            // Save standard project metadata file
            const project_file_path = node_path_instance.join(target_bundle_directory, 'project.json');

            // Update outputDir to point to the project subfolder
            const updated_project_bundle = { ...project_to_save, outputDir: target_bundle_directory };
            node_fs_instance.writeFileSync(project_file_path, stringifyWithCompactArrays(updated_project_bundle));
            console.log('Saved project bundle to:', project_file_path);
            return updated_project_bundle;
        } catch (error_instance) {
            console.error('Failed to save project JSON file:', error_instance);
            return project_to_save;
        }
    };

    // WHAT: Creates a new project with a unique identifier and timestamp, then writes it to disk.
    // WHY: Ensures every new project immediately gains persistent storage identity.
    const saveProject = useCallback((initial_project_data: Omit<BeatProject, 'id' | 'createdAt' | 'updatedAt'>) => {
        const current_iso_timestamp = new Date().toISOString();
        const newly_created_project: BeatProject = {
            ...initial_project_data,
            id: `project-${Date.now()}`,
            createdAt: current_iso_timestamp,
            updatedAt: current_iso_timestamp,
        };

        // Save to file immediately and get the updated project with the resolved PRJ folder path
        const finalized_saved_project = saveProjectFile(newly_created_project);

        setProjects(previous_projects_list => [finalized_saved_project, ...previous_projects_list]);

        return finalized_saved_project;
    }, []);

    // WHAT: Updates an existing project by ID with partial data and writes changes to disk.
    // WHY: Synchronizes React timeline and storyboard edits with the local `project.json` file.
    const updateProject = useCallback((
        project_identifier_to_update: string, 
        project_updates_payload: Partial<BeatProject> | ((previous_project: BeatProject) => Partial<BeatProject>)
    ) => {
        console.log(`[useProjectStorage] updateProject called for ${project_identifier_to_update}`);
        setProjects(previous_projects_list => previous_projects_list.map(candidate_project => {
            if (candidate_project.id === project_identifier_to_update) {
                const applied_updates = typeof project_updates_payload === 'function' 
                    ? project_updates_payload(candidate_project) 
                    : project_updates_payload;
                const merged_updated_project = { 
                    ...candidate_project, 
                    ...applied_updates, 
                    updatedAt: new Date().toISOString() 
                };
                return saveProjectFile(merged_updated_project);
            }
            return candidate_project;
        }));
    }, []);

    // WHAT: Deletes a project from active React state and removes its project.json file from the filesystem.
    // WHY: Cleans up orphaned configuration files when a user permanently removes a project.
    const deleteProject = useCallback((project_identifier_to_delete: string) => {
        setProjects(previous_projects_list => {
            const project_to_delete = previous_projects_list.find(candidate => candidate.id === project_identifier_to_delete);
            if (project_to_delete && project_to_delete.outputDir) {
                try {
                    const node_fs_instance = getFsModule();
                    const node_path_instance = getPathModule();
                    if (node_fs_instance && node_path_instance) {
                        const target_file_path = node_path_instance.join(project_to_delete.outputDir, 'project.json');
                        if (node_fs_instance.existsSync(target_file_path)) {
                            node_fs_instance.unlinkSync(target_file_path);
                            console.log('[useProjectStorage] Deleted project file:', target_file_path);
                        }
                    }
                } catch (error_instance) {
                    console.error('Failed to delete project file:', error_instance);
                }
            }
            return previous_projects_list.filter(candidate => candidate.id !== project_identifier_to_delete);
        });
    }, []);

    // WHAT: Retrieves a project directly from active state by its unique identifier.
    // WHY: Used by route controllers and detail modals to inspect selected project metadata.
    const getProject = useCallback((project_identifier: string) => {
        return projects.find(candidate_project => candidate_project.id === project_identifier);
    }, [projects]);

    // WHAT: Forces batch re-export of all in-memory projects to their disk locations.
    // WHY: Useful during schema migrations or when recovering unsaved workspace state.
    const exportAllProjects = useCallback(async () => {
        let successful_projects_count = 0;
        let failed_projects_count = 0;
        const export_detail_messages: string[] = [];

        try {
            const node_fs_instance = getFsModule();
            const node_path_instance = getPathModule();
            if (!node_fs_instance || !node_path_instance) {
                return { success: 0, failed: projects.length, details: ['Filesystem not available'] };
            }

            for (const current_project of projects) {
                try {
                    let target_export_directory = current_project.outputDir;

                    // Fallback if no outputDir set
                    if (!target_export_directory && current_project.audioPath) {
                        const audio_parent_directory = node_path_instance.dirname(current_project.audioPath);
                        target_export_directory = node_path_instance.join(audio_parent_directory, 'Stems');
                    }

                    if (target_export_directory) {
                        if (!node_fs_instance.existsSync(target_export_directory)) {
                            node_fs_instance.mkdirSync(target_export_directory, { recursive: true });
                        }

                        const target_file_path = node_path_instance.join(target_export_directory, 'project.json');
                        node_fs_instance.writeFileSync(target_file_path, stringifyWithCompactArrays(current_project));
                        successful_projects_count++;
                    } else {
                        failed_projects_count++;
                        export_detail_messages.push(`Skipped "${current_project.name}": No valid output path`);
                    }
                } catch (error_instance) {
                    failed_projects_count++;
                    export_detail_messages.push(`Failed "${current_project.name}": ${error_instance}`);
                }
            }
        } catch (error_instance) {
            console.error('Batch export failed:', error_instance);
            return { success: 0, failed: projects.length, details: ['System error'] };
        }

        return { 
            success: successful_projects_count, 
            failed: failed_projects_count, 
            details: export_detail_messages 
        };
    }, [projects]);

    return {
        projects,
        isLoaded,
        saveProject,
        updateProject,
        deleteProject,
        getProject,
        refreshProjects,
        exportAllProjects,
    };
}

export default useProjectStorage;

