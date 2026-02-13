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
    stems?: { type: string; path: string }[]; // New field for separated stems
    algorithm?: string;
    enableOnsets?: boolean;
    enableLoudness?: boolean;
    markers?: ProjectMarker[];
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

    const saveProject = useCallback((project: Omit<BeatProject, 'id' | 'createdAt' | 'updatedAt'>) => {
        const now = new Date().toISOString();
        const newProject: BeatProject = {
            ...project,
            id: `project-${Date.now()}`,
            createdAt: now,
            updatedAt: now,
        };
        setProjects(prev => [newProject, ...prev]);
        return newProject;
    }, []);

    const updateProject = useCallback((id: string, updates: Partial<BeatProject>) => {
        setProjects(prev => prev.map(p =>
            p.id === id
                ? { ...p, ...updates, updatedAt: new Date().toISOString() }
                : p
        ));
    }, []);

    const deleteProject = useCallback((id: string) => {
        setProjects(prev => prev.filter(p => p.id !== id));
    }, []);

    const getProject = useCallback((id: string) => {
        return projects.find(p => p.id === id);
    }, [projects]);

    return {
        projects,
        isLoaded,
        saveProject,
        updateProject,
        deleteProject,
        getProject,
    };
}

export default useProjectStorage;
