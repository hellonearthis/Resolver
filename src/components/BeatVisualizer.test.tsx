import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Mock WaveSurfer — it requires a real DOM with canvas support
// ---------------------------------------------------------------------------

const mockWaveSurferInstance = {
    load: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
    playPause: vi.fn(),
    getDuration: vi.fn(() => 120),
    getCurrentTime: vi.fn(() => 0),
    zoom: vi.fn(),
};

vi.mock('wavesurfer.js', () => ({
    default: {
        create: vi.fn(() => mockWaveSurferInstance),
    },
}));

import BeatVisualizer from './BeatVisualizer';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BeatVisualizer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows placeholder when no audioUrl is provided', () => {
        render(<BeatVisualizer audioUrl={null} beats={[]} />);
        expect(screen.getByText('Drop an audio file to see the waveform')).toBeInTheDocument();
    });

    it('creates WaveSurfer instance when audioUrl is provided', () => {
        render(<BeatVisualizer audioUrl="blob:http://test/audio" beats={[1.0, 2.0]} />);

        expect(mockWaveSurferInstance.load).toHaveBeenCalledWith('blob:http://test/audio');
    });

    it('renders play button when audio is loaded', () => {
        render(<BeatVisualizer audioUrl="blob:http://test/audio" beats={[]} />);

        // The play button has ▶ text
        const playBtn = screen.getByText('▶');
        expect(playBtn).toBeInTheDocument();
    });

    it('renders zoom controls', () => {
        render(<BeatVisualizer audioUrl="blob:http://test/audio" beats={[]} />);

        expect(screen.getByTitle('Zoom in')).toBeInTheDocument();
        expect(screen.getByTitle('Zoom out (fit all)')).toBeInTheDocument();
        expect(screen.getByTitle('Fit all')).toBeInTheDocument();
    });

    it('renders marker toggle button', () => {
        render(<BeatVisualizer audioUrl="blob:http://test/audio" beats={[]} />);

        const markerBtn = screen.getByTitle('Toggle beat markers');
        expect(markerBtn).toBeInTheDocument();
        expect(markerBtn.textContent).toContain('Markers');
    });

    it('shows beat count when beats are provided', () => {
        render(<BeatVisualizer audioUrl="blob:http://test/audio" beats={[1, 2, 3, 4, 5]} />);

        expect(screen.getByText('5')).toBeInTheDocument();
        expect(screen.getByText('beats')).toBeInTheDocument();
    });

    it('cleans up WaveSurfer on unmount', () => {
        const { unmount } = render(
            <BeatVisualizer audioUrl="blob:http://test/audio" beats={[]} />
        );

        unmount();

        expect(mockWaveSurferInstance.destroy).toHaveBeenCalledTimes(1);
    });

    it('shows time display as 0:00 initially', () => {
        render(<BeatVisualizer audioUrl="blob:http://test/audio" beats={[]} />);

        // Should show 0:00 for current time
        const timeDisplays = screen.getAllByText('0:00');
        expect(timeDisplays.length).toBeGreaterThanOrEqual(1);
    });
});
