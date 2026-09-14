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

interface TestWindowWithGlobals {
    require?: (module_name: string) => unknown;
    electronWebUtils?: typeof mockWebUtils;
}

// Setup global require immediately, before imports
const test_window = window as unknown as TestWindowWithGlobals;
test_window.require = (module_name: string) => {
    if (module_name === 'electron') return mockElectron;
    if (module_name === 'fs') return {};
    if (module_name === 'path') return { 
        basename: (file_path: string) => file_path, 
        join: (...path_segments: string[]) => path_segments.join('/') 
    };
    return {};
};

// Also put it on window explicit (as the component might check window.require)
test_window.electronWebUtils = mockWebUtils;

describe('DropZone', () => {
    let DropZoneComponent: typeof import('./DropZone').default;

    beforeEach(async () => {
        // Reset modules and re-import to ensure clean state if needed
        vi.resetModules();
        const drop_zone_module = await import('./DropZone');
        DropZoneComponent = drop_zone_module.default;
        mockGetPathForFile.mockReset();
    });

    afterEach(() => {
        cleanup();
    });

    it('renders label', () => {
        render(<DropZoneComponent onFilesDropped={vi.fn()} accept="audio/*" label="Test Drop" />);
        expect(screen.getByText('Test Drop')).toBeTruthy();
    });

    it('resolves file path using webUtils on drop', async () => {
        const onFilesDroppedMock = vi.fn();
        render(<DropZoneComponent onFilesDropped={onFilesDroppedMock} accept="audio/*" label="Test Drop" />);

        const sample_audio_file = new File(['dummy content'], 'test.mp3', { type: 'audio/mpeg' });
        // Needs to be configurable for defineProperty to work inside the component
        Object.defineProperty(sample_audio_file, 'path', { value: '', writable: true, configurable: true });
        mockGetPathForFile.mockReturnValue('/abs/path/to/test.mp3');

        const drop_zone_container = screen.getByText('Test Drop').closest('div');

        const drop_event_instance = createEvent.drop(drop_zone_container!);
        Object.defineProperty(drop_event_instance, 'dataTransfer', {
            value: {
                files: [sample_audio_file],
                types: ['Files']
            }
        });

        fireEvent(drop_zone_container!, drop_event_instance);

        expect(mockGetPathForFile).toHaveBeenCalled();
        expect(onFilesDroppedMock).toHaveBeenCalled();

        const received_dropped_files = onFilesDroppedMock.mock.calls[0][0];
        // Log to help debug if it fails
        console.log('Dropped file path:', received_dropped_files[0].path);

        expect(received_dropped_files[0].path).toBe('/abs/path/to/test.mp3');
    });
});
