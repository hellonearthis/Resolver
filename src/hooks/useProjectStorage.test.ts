import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProjectStorage, type BeatProject } from './useProjectStorage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockProject = {
    name: 'Test Song',
    audioPath: '/path/to/audio.mp3',
    audioFileName: 'audio.mp3',
    frameRate: 24,
    bpm: 120,
    beatCount: 100,
    stemType: 'beat',
};

// ---------------------------------------------------------------------------
// Provide a working localStorage mock (jsdom's is incomplete)
// ---------------------------------------------------------------------------

const storageMap = new Map<string, string>();

const localStorageMock = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => { storageMap.set(key, value); },
    removeItem: (key: string) => { storageMap.delete(key); },
    clear: () => { storageMap.clear(); },
    get length() { return storageMap.size; },
    key: (i: number) => [...storageMap.keys()][i] ?? null,
};

describe('useProjectStorage', () => {
    beforeEach(() => {
        storageMap.clear();
        vi.stubGlobal('localStorage', localStorageMock);
        vi.restoreAllMocks();
    });

    it('starts with an empty project list', () => {
        const { result } = renderHook(() => useProjectStorage());
        expect(result.current.projects).toEqual([]);
        expect(result.current.isLoaded).toBe(true);
    });

    // -----------------------------------------------------------------------
    // saveProject
    // -----------------------------------------------------------------------
    describe('saveProject', () => {
        it('creates a project with generated id and timestamps', () => {
            const { result } = renderHook(() => useProjectStorage());

            let newProject: BeatProject;
            act(() => {
                newProject = result.current.saveProject(mockProject);
            });

            expect(newProject!.id).toMatch(/^project-/);
            expect(newProject!.name).toBe('Test Song');
            expect(newProject!.createdAt).toBeTruthy();
            expect(newProject!.updatedAt).toBeTruthy();
            expect(result.current.projects).toHaveLength(1);
        });

        it('prepends new projects (most recent first)', () => {
            const { result } = renderHook(() => useProjectStorage());

            act(() => {
                result.current.saveProject({ ...mockProject, name: 'First' });
            });
            act(() => {
                result.current.saveProject({ ...mockProject, name: 'Second' });
            });

            expect(result.current.projects[0].name).toBe('Second');
            expect(result.current.projects[1].name).toBe('First');
        });
    });

    // -----------------------------------------------------------------------
    // updateProject
    // -----------------------------------------------------------------------
    describe('updateProject', () => {
        it('merges partial updates and bumps updatedAt', async () => {
            const { result } = renderHook(() => useProjectStorage());

            let id: string;
            act(() => {
                const p = result.current.saveProject(mockProject);
                id = p.id;
            });

            const originalUpdatedAt = result.current.projects[0].updatedAt;

            // Small delay to ensure timestamp differs
            await new Promise(r => setTimeout(r, 10));

            act(() => {
                result.current.updateProject(id!, { bpm: 140, beatCount: 200 });
            });

            const updated = result.current.projects[0];
            expect(updated.bpm).toBe(140);
            expect(updated.beatCount).toBe(200);
            expect(updated.name).toBe('Test Song'); // unchanged
            expect(updated.updatedAt).not.toBe(originalUpdatedAt);
        });
    });

    // -----------------------------------------------------------------------
    // deleteProject
    // -----------------------------------------------------------------------
    describe('deleteProject', () => {
        it('removes a project by id', () => {
            const { result } = renderHook(() => useProjectStorage());

            let id: string;
            act(() => {
                const p = result.current.saveProject(mockProject);
                id = p.id;
            });

            expect(result.current.projects).toHaveLength(1);

            act(() => {
                result.current.deleteProject(id!);
            });

            expect(result.current.projects).toHaveLength(0);
        });
    });

    // -----------------------------------------------------------------------
    // getProject
    // -----------------------------------------------------------------------
    describe('getProject', () => {
        it('retrieves a project by id', () => {
            const { result } = renderHook(() => useProjectStorage());

            let id: string;
            act(() => {
                const p = result.current.saveProject(mockProject);
                id = p.id;
            });

            const found = result.current.getProject(id!);
            expect(found?.name).toBe('Test Song');
        });

        it('returns undefined for unknown id', () => {
            const { result } = renderHook(() => useProjectStorage());
            expect(result.current.getProject('nonexistent')).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------------
    // localStorage persistence
    // -----------------------------------------------------------------------
    describe('persistence', () => {
        it('persists projects to localStorage', () => {
            const { result } = renderHook(() => useProjectStorage());

            act(() => {
                result.current.saveProject(mockProject);
            });

            const stored = JSON.parse(localStorage.getItem('resolve-tools-projects') || '[]');
            expect(stored).toHaveLength(1);
            expect(stored[0].name).toBe('Test Song');
        });

        it('loads projects from localStorage on mount', () => {
            const existing: BeatProject[] = [{
                id: 'project-existing',
                name: 'Existing',
                audioPath: '/path',
                audioFileName: 'file.mp3',
                frameRate: 30,
                stemType: 'kick',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }];

            localStorage.setItem('resolve-tools-projects', JSON.stringify(existing));

            const { result } = renderHook(() => useProjectStorage());
            expect(result.current.projects).toHaveLength(1);
            expect(result.current.projects[0].name).toBe('Existing');
        });

        it('handles corrupted localStorage gracefully', () => {
            localStorage.setItem('resolve-tools-projects', 'not-valid-json{{{');

            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
            const { result } = renderHook(() => useProjectStorage());

            expect(result.current.projects).toEqual([]);
            expect(result.current.isLoaded).toBe(true);
            consoleSpy.mockRestore();
        });
    });
});
