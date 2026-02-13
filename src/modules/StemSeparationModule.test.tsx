import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StemSeparationModule from './StemSeparationModule';
import { BeatProject } from '../hooks/useProjectStorage';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock ComfyService
const mockCheckComfyConnection = vi.fn();
const mockQueuePrompt = vi.fn();

vi.mock('../services/comfyService', () => ({
    checkComfyConnection: () => mockCheckComfyConnection(),
    queuePrompt: (prompt: any) => mockQueuePrompt(prompt),
}));

// Mock Electron IPC
const mockInvoke = vi.fn();
const mockIpcRenderer = {
    invoke: mockInvoke,
};

// Mock window.require
(window as any).require = vi.fn((moduleName) => {
    if (moduleName === 'electron') {
        return { ipcRenderer: mockIpcRenderer };
    }
    if (moduleName === 'path') {
        return {
            basename: (p: string) => p.split(/[\\/]/).pop(),
            extname: (p: string) => '.' + p.split('.').pop(),
        };
    }
    return {};
});

// Mock DropZone (simple version for testing)
vi.mock('../components/DropZone', () => ({
    default: ({ onFilesDropped }: { onFilesDropped: (files: File[]) => void }) => (
        <div data-testid="drop-zone">
            <input
                type="file"
                data-testid="file-input"
                onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                        onFilesDropped([e.target.files[0]]);
                    }
                }}
            />
            Drop Audio File Here
        </div>
    ),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StemSeparationModule', () => {
    const mockOnCreateProject = vi.fn();
    const mockOnUpdateProject = vi.fn();
    const mockOnAnalyzeStem = vi.fn();

    const mockProject: BeatProject = {
        id: 'test-project-1',
        name: 'Test Project',
        audioPath: '/path/to/audio.mp3',
        audioFileName: 'audio.mp3',
        frameRate: 24,
        stemType: 'master',
        stems: [],
        createdAt: '2023-01-01',
        updatedAt: '2023-01-01'
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockCheckComfyConnection.mockResolvedValue(true);
        mockInvoke.mockImplementation((channel, args) => {
            if (channel === 'load-default-workflow') {
                return Promise.resolve({
                    success: true,
                    workflow: {
                        '10': { class_type: 'LoadAudio', inputs: { audio: '' } },
                        '20': { class_type: 'SaveAudio', inputs: { filename_prefix: 'prefix' } }
                    }
                });
            }
            if (channel === 'select-folder') {
                return Promise.resolve('/path/to/output');
            }
            return Promise.resolve({ success: false });
        });
    });

    it('renders and checks connection', async () => {
        render(
            <StemSeparationModule
                onCreateProject={mockOnCreateProject}
                onUpdateProject={mockOnUpdateProject}
                onAnalyzeStem={mockOnAnalyzeStem}
            />
        );

        expect(screen.getByText('🎵 Stem Separation (ComfyUI)')).toBeInTheDocument();

        await waitFor(() => {
            expect(mockCheckComfyConnection).toHaveBeenCalled();
            expect(screen.getByText(/ComfyUI: Connected/)).toBeInTheDocument();
        });
    });

    it('loads workflow on mount', async () => {
        render(
            <StemSeparationModule
                onCreateProject={mockOnCreateProject}
                onUpdateProject={mockOnUpdateProject}
                onAnalyzeStem={mockOnAnalyzeStem}
            />
        );

        await waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith('load-default-workflow');
            expect(screen.getByText(/Workflow: Loaded/)).toBeInTheDocument();
        });
    });

    it('creates project on file drop if no active project', async () => {
        render(
            <StemSeparationModule
                onCreateProject={mockOnCreateProject}
                onUpdateProject={mockOnUpdateProject}
                onAnalyzeStem={mockOnAnalyzeStem}
            />
        );

        const file = new File(['dummy content'], 'song.mp3', { type: 'audio/mpeg' });
        // @ts-ignore
        file.path = '/path/to/song.mp3';

        const input = screen.getByTestId('file-input');
        fireEvent.change(input, { target: { files: [file] } });

        await waitFor(() => {
            expect(mockOnCreateProject).toHaveBeenCalledWith(file);
        });

        expect(screen.getByText('Selected:')).toBeInTheDocument();
        expect(screen.getByText('/path/to/song.mp3')).toBeInTheDocument();
    });

    it('updates output folder via IPC', async () => {
        render(
            <StemSeparationModule
                onCreateProject={mockOnCreateProject}
                onUpdateProject={mockOnUpdateProject}
                onAnalyzeStem={mockOnAnalyzeStem}
            />
        );

        const folderBtn = screen.getByText('Output Folder');
        fireEvent.click(folderBtn);

        await waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith('select-folder');
            expect(screen.getByText('/path/to/output')).toBeInTheDocument();
        });
    });

    it('runs separation and saves stems to project', async () => {
        mockQueuePrompt.mockResolvedValue({ prompt_id: '12345' });

        render(
            <StemSeparationModule
                activeProject={mockProject}
                onCreateProject={mockOnCreateProject}
                onUpdateProject={mockOnUpdateProject}
                onAnalyzeStem={mockOnAnalyzeStem}
                mockProcessDuration={0}
            />
        );

        // Wait for setup
        await waitFor(() => expect(screen.getByText(/ComfyUI: Connected/)).toBeInTheDocument());
        await waitFor(() => expect(screen.getByText(/Workflow: Loaded/)).toBeInTheDocument());

        // Set output folder
        const folderBtn = screen.getByText('Output Folder');
        fireEvent.click(folderBtn);
        await waitFor(() => screen.getByText('/path/to/output'));

        // Click Run
        const runBtn = screen.getByText('🚀 Separate Stems');
        fireEvent.click(runBtn);

        expect(mockQueuePrompt).toHaveBeenCalled();

        // Wait for completion (timeout 0 means it should be fast)
        await waitFor(() => {
            expect(screen.getByText('Separation Complete! (Mocked)')).toBeInTheDocument();
        });

        // Check if stems were added to project
        expect(mockOnUpdateProject).toHaveBeenCalledWith(
            'test-project-1',
            expect.objectContaining({
                stems: expect.arrayContaining([
                    expect.objectContaining({ type: 'Drums' }),
                    expect.objectContaining({ type: 'Bass' }),
                ])
            })
        );
    });
});
