/**
 * Project Storage Hook
 * 
 * Persists beat extraction projects with audio paths and associated CSV files.
 * Uses localStorage for browser persistence.
 */

import { useState, useEffect, useCallback } from 'react';

// Helper to format arrays of numbers on a single line instead of expanded
const stringifyWithCompactArrays = (obj: any): string => {
    const jsonStr = JSON.stringify(obj, null, 2);
    // Find arrays that contain only numbers, commas, and whitespace
    return jsonStr.replace(
        /\[\s*([\d\s.,+\-eE]+)\s*\]/g,
        (match, inside) => {
            // Verify it's genuinely a list of numbers to avoid matching random text
            if (/^[ \n\r\t\d.,+\-eE]+$/.test(inside)) {
                return `[ ${inside.replace(/\s+/g, ' ').trim()} ]`;
            }
            return match;
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
    audioPath: string;
    audioFileName: string;
    csvPath?: string;
    frameRate: number;
    bpm?: number;
    beatCount?: number;
    stemType: string;
    stems?: { type: string; path: string; beats?: number[]; markers?: ProjectMarker[]; color?: string }[]; // New field for separated stems
    outputDir?: string; // Path to save the project JSON
    algorithm?: string;
    enableLoudness?: boolean;
    markers?: ProjectMarker[];
    clips?: any[]; // Video assembler timeline clips
    segments?: any[]; // Video assembler timeline segments
    sections?: any[]; // Video assembler timeline sections
    createdAt: string;
    updatedAt: string;
}



export function useProjectStorage() {
    const [projects, setProjects] = useState<BeatProject[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);

    const refreshProjects = useCallback(async (customPath?: string) => {
        try {
            // @ts-ignore
            const ipcRenderer = window.require ? window.require('electron').ipcRenderer : window.ipcRenderer;
            if (!ipcRenderer) return;

            // 1. Get the path to scan
            let scanPath = customPath;
            if (!scanPath) {
                const configRes = await ipcRenderer.invoke('get-config');
                if (configRes.success && configRes.config.projectOutputDir) {
                    scanPath = configRes.config.projectOutputDir;
                }
            }

            if (!scanPath) {
                console.log('[useProjectStorage] No scan path found in config.');
                setIsLoaded(true);
                return;
            }

            console.log(`[useProjectStorage] Scanning for projects in: ${scanPath}`);
            // 2. Scan the folder
            const scanRes = await ipcRenderer.invoke('scan-projects-folder', scanPath);
            if (scanRes.success) {
                setProjects(scanRes.projects);
            }
        } catch (e) {
            console.error('Failed to refresh projects:', e);
        }
        setIsLoaded(true);
    }, []);

    // Load projects on mount
    useEffect(() => {
        refreshProjects();
    }, [refreshProjects]);

    const saveProjectFile = (project: BeatProject): BeatProject => {
        let currentOutputDir = project.outputDir;

        // Fallback to audio path directory if outputDir is not set
        if (!currentOutputDir && project.audioPath) {
            try {
                // @ts-ignore
                const path = window.require('path');
                currentOutputDir = path.dirname(project.audioPath);
            } catch (e) {
                // ignore
            }
        }

        if (!currentOutputDir) return project;

        try {
            // @ts-ignore
            const fs = window.require('fs');
            // @ts-ignore
            const path = window.require('path');

            const safeProjectName = project.name.replace(/[^a-zA-Z0-9-_]/g, '_');
            const bundleName = `PRJ_${safeProjectName}`; // The standardized prefix for project bundles

            // Normalize path to prevent trailing slashes from breaking basename (recursive nesting fix)
            const normalizedOutputDir = currentOutputDir.replace(/[\\/]+$/, '');
            const dirBasename = path.basename(normalizedOutputDir);

            // Determine if outputDir already IS the per-project bundle folder
            // Use startsWith('PRJ_') to prevent infinite nesting if the project name gets slightly altered
            const isAlreadyBundle = dirBasename.startsWith('PRJ_') || dirBasename === safeProjectName;
            const bundleDirectory = isAlreadyBundle
                ? normalizedOutputDir
                : path.join(normalizedOutputDir, bundleName);

            // Create bundle directory if it doesn't exist
            if (!fs.existsSync(bundleDirectory)) {
                fs.mkdirSync(bundleDirectory, { recursive: true });
            }

            // Save standard project metadata file
            const filePath = path.join(bundleDirectory, 'project.json');

            // Update outputDir to point to the project subfolder
            const updatedProject = { ...project, outputDir: bundleDirectory };
            fs.writeFileSync(filePath, stringifyWithCompactArrays(updatedProject));
            console.log('Saved project bundle to:', filePath);
            return updatedProject;
        } catch (e) {
            console.error('Failed to save project JSON file:', e);
            return project;
        }
    };

    const saveProject = useCallback((project: Omit<BeatProject, 'id' | 'createdAt' | 'updatedAt'>) => {
        const now = new Date().toISOString();
        const newProject: BeatProject = {
            ...project,
            id: `project-${Date.now()}`,
            createdAt: now,
            updatedAt: now,
        };

        // Save to file immediately and get the updated project with the resolved PRJ folder path
        const finalProject = saveProjectFile(newProject);

        setProjects(prev => {
            const updated = [finalProject, ...prev];
            return updated;
        });

        return finalProject;
    }, []);

    const updateProject = useCallback((id: string, updates: Partial<BeatProject>) => {
        console.log(`[useProjectStorage] updateProject called for ${id}`, Object.keys(updates));
        setProjects(prev => prev.map(p => {
            if (p.id === id) {
                const updatedProject = { ...p, ...updates, updatedAt: new Date().toISOString() };
                // Save to file and use the returned object with resolved outputDir
                const finalProject = saveProjectFile(updatedProject);
                return finalProject;
            }
            return p;
        }));
    }, []);

    const deleteProject = useCallback((id: string) => {
        setProjects(prev => {
            const project = prev.find(p => p.id === id);
            if (project && project.outputDir) {
                try {
                    // @ts-ignore
                    const fs = window.require('fs');
                    // @ts-ignore
                    const path = window.require('path');
                    const filePath = path.join(project.outputDir, 'project.json');
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                        console.log('[useProjectStorage] Deleted project file:', filePath);
                    }
                } catch (e) {
                    console.error('Failed to delete project file:', e);
                }
            }
            return prev.filter(p => p.id !== id);
        });
    }, []);

    const getProject = useCallback((id: string) => {
        return projects.find(p => p.id === id);
    }, [projects]);

    const exportAllProjects = useCallback(async () => {
        let successCount = 0;
        let failCount = 0;
        const details: string[] = [];

        try {
            // @ts-ignore
            const fs = window.require('fs');
            // @ts-ignore
            const path = window.require('path');

            for (const project of projects) {
                try {
                    let targetDir = project.outputDir;

                    // Fallback if no outputDir set
                    if (!targetDir && project.audioPath) {
                        const audioDir = path.dirname(project.audioPath);
                        targetDir = path.join(audioDir, 'Stems');
                    }

                    if (targetDir) {
                        if (!fs.existsSync(targetDir)) {
                            fs.mkdirSync(targetDir, { recursive: true });
                        }

                        const filePath = path.join(targetDir, 'project.json');

                        fs.writeFileSync(filePath, stringifyWithCompactArrays(project));
                        successCount++;
                    } else {
                        failCount++;
                        details.push(`Skipped "${project.name}": No valid output path`);
                    }
                } catch (e) {
                    failCount++;
                    details.push(`Failed "${project.name}": ${e}`);
                }
            }
        } catch (e) {
            console.error('Batch export failed:', e);
            return { success: 0, failed: projects.length, details: ['System error'] };
        }

        return { success: successCount, failed: failCount, details };
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
