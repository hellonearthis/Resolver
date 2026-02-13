import { render, screen, fireEvent, cleanup, createEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to define globals BEFORE importing the component because it uses top-level require
const mockGetPathForFile = vi.fn();
const mockWebUtils = {
    getPathForFile: mockGetPathForFile
};

const mockElectron = {
    webUtils: mockWebUtils,
    ipcRenderer: { invoke: vi.fn(), send: vi.fn(), on: vi.fn() }
};

// Setup global require immediately, before imports
window.require = (module: string) => {
    if (module === 'electron') return mockElectron;
    if (module === 'fs') return {};
    if (module === 'path') return { basename: (p: string) => p, join: (...args: string[]) => args.join('/') };
    return {};
};

// Also put it on window explicit (as the component might check window.require)
(window as any).electronWebUtils = mockWebUtils;

describe('DropZone', () => {
    let DropZone: any;

    beforeEach(async () => {
        // Reset modules and re-import to ensure clean state if needed
        vi.resetModules();
        const mod = await import('./DropZone');
        DropZone = mod.default;
        mockGetPathForFile.mockReset();
    });

    afterEach(() => {
        cleanup();
    });

    it('renders label', () => {
        render(<DropZone onFilesDropped={vi.fn()} accept="audio/*" label="Test Drop" />);
        expect(screen.getByText('Test Drop')).toBeTruthy();
    });

    it('resolves file path using webUtils on drop', async () => {
        const onFilesDropped = vi.fn();
        render(<DropZone onFilesDropped={onFilesDropped} accept="audio/*" label="Test Drop" />);

        const file = new File(['dummy content'], 'test.mp3', { type: 'audio/mpeg' });
        // Needs to be configurable for defineProperty to work inside the component
        Object.defineProperty(file, 'path', { value: '', writable: true, configurable: true });
        mockGetPathForFile.mockReturnValue('/abs/path/to/test.mp3');

        const dropZone = screen.getByText('Test Drop').closest('div');

        const dropEvent = createEvent.drop(dropZone!);
        Object.defineProperty(dropEvent, 'dataTransfer', {
            value: {
                files: [file],
                types: ['Files']
            }
        });

        fireEvent(dropZone!, dropEvent);

        expect(mockGetPathForFile).toHaveBeenCalled();
        expect(onFilesDropped).toHaveBeenCalled();

        const droppedFiles = onFilesDropped.mock.calls[0][0];
        // Log to help debug if it fails
        console.log('Dropped file path:', droppedFiles[0].path);

        expect(droppedFiles[0].path).toBe('/abs/path/to/test.mp3');
    });
});
