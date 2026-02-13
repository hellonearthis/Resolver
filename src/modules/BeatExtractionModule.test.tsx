import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mock heavy dependencies so the component renders in jsdom
// ---------------------------------------------------------------------------

// Mock essentiaService (avoid loading WASM)
vi.mock('../services/essentiaService', () => ({
    analyzeBeats: vi.fn(),
    analyzeOnsets: vi.fn(),
    analyzeLoudness: vi.fn(),
}));

// Mock BeatVisualizer (depends on WaveSurfer which needs a real DOM + canvas)
vi.mock('../components/BeatVisualizer', () => ({
    default: ({ audioUrl, beats }: { audioUrl: string | null; beats: number[] }) => (
        <div data-testid="beat-visualizer">
            {audioUrl ? `Loaded (${beats.length} beats)` : 'No audio'}
        </div>
    ),
}));

// Mock useProjectStorage
vi.mock('../hooks/useProjectStorage', () => ({
    useProjectStorage: () => ({
        projects: [],
        isLoaded: true,
        saveProject: vi.fn(() => ({ id: 'test-id' })),
        updateProject: vi.fn(),
        deleteProject: vi.fn(),
        getProject: vi.fn(),
    }),
}));

import BeatExtractionModule from './BeatExtractionModule';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BeatExtractionModule', () => {
    it('renders without crashing', () => {
        render(<BeatExtractionModule />);
        expect(screen.getByText('🎵 Beat Extraction')).toBeInTheDocument();
    });

    it('shows the audio drop zone', () => {
        render(<BeatExtractionModule />);
        expect(screen.getByText('Drop MP3 or WAV here')).toBeInTheDocument();
    });

    it('defaults to multifeature algorithm', () => {
        render(<BeatExtractionModule />);
        const multiBtn = screen.getByText('MultiFeature (accurate)');
        expect(multiBtn.className).toContain('btn-primary');
    });

    it('defaults to 24 fps frame rate', () => {
        render(<BeatExtractionModule />);
        const input = screen.getByDisplayValue('24');
        expect(input).toBeInTheDocument();
    });

    it('displays frame rate quick-select buttons', () => {
        render(<BeatExtractionModule />);
        for (const fps of [24, 25, 30, 60]) {
            expect(screen.getByText(String(fps))).toBeInTheDocument();
        }
    });

    it('shows stem color mapping buttons', () => {
        render(<BeatExtractionModule />);
        expect(screen.getByText(/beat → Blue/i)).toBeInTheDocument();
        expect(screen.getByText(/kick → Red/i)).toBeInTheDocument();
    });

    it('has export button disabled when no markers exist', () => {
        render(<BeatExtractionModule />);
        const exportBtn = screen.getByText('📥 Export CSV');
        expect(exportBtn).toBeDisabled();
    });

    it('has save project button disabled when no markers exist', () => {
        render(<BeatExtractionModule />);
        const saveBtn = screen.getByRole('button', { name: /Save Project/i });
        expect(saveBtn).toBeDisabled();
    });

    it('shows onset and loudness checkboxes', () => {
        render(<BeatExtractionModule />);
        expect(screen.getByText('Onset Detection')).toBeInTheDocument();
        expect(screen.getByText('Loudness Regions')).toBeInTheDocument();
    });

    it('switches algorithm when degara button is clicked', async () => {
        render(<BeatExtractionModule />);
        const degaraBtn = screen.getByText('Degara (fast)');

        await userEvent.click(degaraBtn);

        expect(degaraBtn.className).toContain('btn-primary');
    });

    it('shows the Reprocess button', () => {
        render(<BeatExtractionModule />);
        expect(screen.getByText('🔄 Reprocess')).toBeInTheDocument();
    });

    it('has Reprocess button disabled when no audio is loaded', () => {
        render(<BeatExtractionModule />);
        const btn = screen.getByText('🔄 Reprocess');
        expect(btn).toBeDisabled();
    });
});
