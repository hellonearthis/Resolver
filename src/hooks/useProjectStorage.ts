/**
 * Project Storage Hook
 * 
 * Persists beat extraction projects with audio paths and associated CSV files.
 * Uses localStorage for browser persistence.
 */

import { useState, useEffect, useCallback } from 'react';

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
    stems?: { type: string; path: string; beats?: number[]; color?: string }[]; // New field for separated stems
    outputDir?: string; // Path to save the project JSON
    algorithm?: string;
    enableOnsets?: boolean;
    enableLoudness?: boolean;
    markers?: ProjectMarker[];
    clips?: any[]; // Video assembler timeline clips
    createdAt: string;
    updatedAt: string;
}

const STORAGE_KEY = 'resolve-tools-projects';

export function useProjectStorage() {
    const [projects, setProjects] = useState<BeatProject[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);

    // Load projects from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                setProjects(JSON.parse(stored));
            }
        } catch (e) {
            console.warn('Failed to load projects from storage:', e);
        }
        setIsLoaded(true);
    }, []);

    // Save to localStorage whenever projects change
    useEffect(() => {
        if (isLoaded) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
            } catch (e) {
                console.warn('Failed to save projects to storage:', e);
            }
        }
    }, [projects, isLoaded]);

    const saveProjectFile = (project: BeatProject): BeatProject => {
        if (!project.outputDir) return project;

        try {
            // @ts-ignore
            const fs = window.require('fs');
            // @ts-ignore
            const path = window.require('path');

            const safeName = project.name.replace(/[^a-zA-Z0-9-_]/g, '_');
            const folderName = `PRJ_${safeName}`;

            // Determine if outputDir already IS the per-project folder
            // (i.e. it already ends with the folderName). If so, don't nest again.
            const dirBasename = path.basename(project.outputDir);
            const projectFolder = (dirBasename === folderName || dirBasename === safeName)
                ? project.outputDir
                : path.join(project.outputDir, folderName);

            if (!fs.existsSync(projectFolder)) {
                fs.mkdirSync(projectFolder, { recursive: true });
            }

            const filePath = path.join(projectFolder, `${safeName}_data.json`);

            // Update outputDir to point to the project subfolder
            const updatedProject = { ...project, outputDir: projectFolder };
            fs.writeFileSync(filePath, JSON.stringify(updatedProject, null, 2));
            console.log('Saved project to:', filePath);
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
        setProjects(prev => {
            const updated = [newProject, ...prev];
            return updated;
        });

        // Save to file immediately
        saveProjectFile(newProject);

        return newProject;
    }, []);

    const updateProject = useCallback((id: string, updates: Partial<BeatProject>) => {
        console.log(`[useProjectStorage] updateProject called for ${id}`, Object.keys(updates));
        setProjects(prev => prev.map(p => {
            if (p.id === id) {
                const updatedProject = { ...p, ...updates, updatedAt: new Date().toISOString() };
                // Save to file if outputDir is present (either in updates or existing)
                saveProjectFile(updatedProject);
                return updatedProject;
            }
            return p;
        }));
    }, []);

    const deleteProject = useCallback((id: string) => {
        setProjects(prev => prev.filter(p => p.id !== id));
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

                        // Sanitize filename
                        const safeName = project.name.replace(/[^a-zA-Z0-9-_]/g, '_');
                        const filePath = path.join(targetDir, `${safeName}_data.json`);

                        fs.writeFileSync(filePath, JSON.stringify(project, null, 2));
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
        exportAllProjects,
    };
}

export default useProjectStorage;
