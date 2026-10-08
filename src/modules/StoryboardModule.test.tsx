/**
 * src/modules/StoryboardModule.test.tsx
 * 
 * Component tests for StoryboardModule section outline grouping and Fountain integration.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import StoryboardModule from './StoryboardModule';
import type { BeatProject } from '../hooks/useProjectStorage';
import type { VideoClip } from '../types/assembler';
import type { MusicSection } from '../types/sections';
import { computeCardGenerativeFingerprint } from '../services/revisionDiffService';

describe('StoryboardModule', () => {
    const mockSections: MusicSection[] = [
        { id: 'sec-1', name: 'Verse 1', type: 'verse', startTime: 0, endTime: 4.0, color: '#3b82f6' },
        { id: 'sec-2', name: 'Chorus', type: 'chorus', startTime: 4.0, endTime: 8.0, color: '#a855f7' },
        { id: 'sec-3', name: 'Bridge', type: 'bridge', startTime: 8.0, endTime: 12.0, color: '#f59e0b' },
    ];

    const mockClips: VideoClip[] = [
        {
            id: 'card-1',
            startTime: 0,
            duration: 4.0,
            endTime: 4.0,
            track: 1,
            status: 'pending',
            source: 'main',
            label: 'Shot 1',
            sceneNumber: '1',
            shotLetter: 'A',
            sectionId: 'sec-1',
            sectionName: 'Verse 1',
            sectionType: 'verse',
            notes: { action: 'Rain-soaked cyan pavement.', dialogue: 'Singing in the rain', sound: '' }
        },
        {
            id: 'card-2',
            startTime: 4.0,
            duration: 4.0,
            endTime: 8.0,
            track: 2,
            status: 'pending',
            source: 'main',
            label: 'Shot 2',
            sceneNumber: '2',
            shotLetter: 'A',
            sectionId: 'sec-2',
            sectionName: 'Chorus',
            sectionType: 'chorus',
            notes: { action: 'High energy strobe lights.', dialogue: 'Ignite the horizon!', sound: '' }
        },
        {
            id: 'card-3',
            startTime: 8.0,
            duration: 4.0,
            endTime: 12.0,
            track: 1,
            status: 'pending',
            source: 'main',
            label: 'Shot 3',
            sceneNumber: '3',
            shotLetter: 'A',
            sectionId: 'sec-3',
            sectionName: 'Bridge',
            sectionType: 'bridge',
            notes: { action: 'Solitary figure in amber light.', dialogue: 'Until morning breaks', sound: '' }
        }
    ];

    const mockProject: BeatProject = {
        id: 'proj-fountain-test',
        name: 'Neon Horizon Music Video',
        duration: 12.0,
        frameRate: 24,
        stemType: 'vocals',
        sections: mockSections,
        clips: mockClips,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    it('renders section outline headers grouping the cards under 3 sections', () => {
        const handleUpdate = vi.fn();

        const { unmount } = render(
            <TooltipProvider>
                <StoryboardModule
                    activeProject={mockProject}
                    projects={[mockProject]}
                    onUpdateProject={handleUpdate}
                />
            </TooltipProvider>
        );

        // Verify Toolbar elements
        expect(screen.getByText('📑 Outline')).toBeTruthy();
        expect(screen.getByText('🔲 Grid')).toBeTruthy();
        expect(screen.getByRole('button', { name: /Import Fountain/ })).toBeTruthy();

        // Verify 3 section headers are displayed in Outline view
        expect(screen.getByRole('heading', { level: 3, name: 'Verse 1' })).toBeTruthy();
        expect(screen.getByRole('heading', { level: 3, name: 'Chorus' })).toBeTruthy();
        expect(screen.getByRole('heading', { level: 3, name: 'Bridge' })).toBeTruthy();

        // Verify storyboard animatic timeline lists segments
        expect(screen.getByText(/3 Segments/)).toBeTruthy();

        // Verify block length indicators appear for sections
        expect(screen.getAllByText('Length:').length).toBe(3);
        expect(screen.getAllByText('4.00s').length).toBe(3);

        // Verify shot action prompts appear
        expect(screen.getByDisplayValue('Rain-soaked cyan pavement.')).toBeTruthy();
        expect(screen.getByDisplayValue('High energy strobe lights.')).toBeTruthy();
        expect(screen.getByDisplayValue('Solitary figure in amber light.')).toBeTruthy();

        // Verify Outline view renders cards in full-width vertical list wrappers
        const shot1Textarea = screen.getByDisplayValue('Rain-soaked cyan pavement.');
        const cardRoot = shot1Textarea.closest('.group');
        const cardOuterWrapper = cardRoot?.parentElement;
        expect(cardOuterWrapper?.className).toContain('w-full');
        const sectionListContainer = cardOuterWrapper?.parentElement;
        expect(sectionListContainer?.className).toContain('flex-col');

        unmount();
    });

    it('switches to flat grid view when Grid toggle is clicked and renders all cards plus trailing Add Shot card', () => {
        const handleUpdate = vi.fn();

        const { unmount } = render(
            <TooltipProvider>
                <StoryboardModule
                    activeProject={mockProject}
                    projects={[mockProject]}
                    onUpdateProject={handleUpdate}
                />
            </TooltipProvider>
        );

        const gridButton = screen.getByText('🔲 Grid');
        fireEvent.click(gridButton);

        // In flat grid view, section outline headers are hidden
        expect(screen.queryByRole('heading', { level: 3, name: 'Verse 1' })).toBeNull();
        expect(screen.queryByRole('heading', { level: 3, name: 'Chorus' })).toBeNull();

        // All storyboard cards remain rendered in the flat grid
        expect(screen.getByDisplayValue('Rain-soaked cyan pavement.')).toBeTruthy();
        expect(screen.getByDisplayValue('High energy strobe lights.')).toBeTruthy();
        expect(screen.getByDisplayValue('Solitary figure in amber light.')).toBeTruthy();

        // Trailing Add Shot card is present
        expect(screen.getByText('Add Shot 4')).toBeTruthy();

        unmount();
    });

    it('renders informative empty state with Add First Shot button when in Grid view with 0 shots and no sections', () => {
        const handleUpdate = vi.fn();
        const emptyProject: BeatProject = {
            ...mockProject,
            sections: [],
            clips: []
        };

        const { unmount } = render(
            <TooltipProvider>
                <StoryboardModule
                    activeProject={emptyProject}
                    projects={[emptyProject]}
                    onUpdateProject={handleUpdate}
                />
            </TooltipProvider>
        );

        const gridButton = screen.getByText('🔲 Grid');
        fireEvent.click(gridButton);

        // Empty state is visible
        expect(screen.getByText('No Storyboard Shots Yet')).toBeTruthy();
        expect(screen.getByRole('button', { name: /Add First Shot/ })).toBeTruthy();
        expect(screen.getAllByRole('button', { name: /Import Fountain/ }).length).toBe(2);

        // Clicking Add First Shot appends a shot
        fireEvent.click(screen.getByRole('button', { name: /Add First Shot/ }));
        expect(handleUpdate).toHaveBeenCalledWith(
            'proj-fountain-test',
            expect.objectContaining({
                clips: expect.arrayContaining([
                    expect.objectContaining({ label: 'Shot 1' })
                ])
            })
        );

        unmount();
    });

    it('renders section cards in Grid view when project has sections but no initial clips', () => {
        const handleUpdate = vi.fn();
        const sectionOnlyProject: BeatProject = {
            ...mockProject,
            clips: []
        };

        const { unmount } = render(
            <TooltipProvider>
                <StoryboardModule
                    activeProject={sectionOnlyProject}
                    projects={[sectionOnlyProject]}
                    onUpdateProject={handleUpdate}
                />
            </TooltipProvider>
        );

        const gridButton = screen.getByText('🔲 Grid');
        fireEvent.click(gridButton);

        // Section cards are visible in the flat grid
        expect(screen.getAllByDisplayValue(/Verse 1/).length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByDisplayValue(/Chorus/).length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByDisplayValue(/Bridge/).length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Add Shot 4')).toBeTruthy();

        // Populate button is in toolbar
        expect(screen.getByRole('button', { name: /Populate from Sections/ })).toBeTruthy();

        unmount();
    });

    it('displays revision badges and selectively queues only new or changed shots', async () => {
        const onGenerateVideoMock = vi.fn().mockResolvedValue(undefined);
        const onUpdateProjectMock = vi.fn();

        // Prepare 3 cards with distinct revision states:
        // card-1: clean (has video, matching fingerprint)
        // card-2: changed (has video, different prompt than last render)
        // card-3: new (no video, no baseline)
        const cleanCard: VideoClip = {
            ...mockClips[0],
            id: 'card-1',
            videoPath: 'C:\\Resolver\\output\\shot1.mp4',
            status: 'done'
        };
        cleanCard.lastRenderedFingerprint = computeCardGenerativeFingerprint(cleanCard);

        const revisionClips: VideoClip[] = [
            cleanCard,
            {
                ...mockClips[1],
                id: 'card-2',
                videoPath: 'C:\\Resolver\\output\\shot2.mp4',
                status: 'done',
                lastRenderedFingerprint: 'fp-old-stale' // Mismatches current prompt -> changed!
            },
            {
                ...mockClips[2],
                id: 'card-3',
                videoPath: undefined,
                status: 'pending',
                lastRenderedFingerprint: undefined // Never rendered -> new!
            }
        ];

        const testProject: BeatProject = {
            ...mockProject,
            clips: revisionClips
        };

        const { unmount } = render(
            <TooltipProvider>
                <StoryboardModule
                    activeProject={testProject}
                    projects={[testProject]}
                    onUpdateProject={onUpdateProjectMock}
                    onGenerateVideo={onGenerateVideoMock}
                />
            </TooltipProvider>
        );

        // Verify Toolbar has Push Markers and Queue Changed buttons
        expect(screen.getByRole('button', { name: /Push Markers/ })).toBeTruthy();
        const queueChangedBtn = screen.getByRole('button', { name: /Queue Changed \(2\)/ });
        expect(queueChangedBtn).toBeTruthy();

        // Verify revision badges appear on the cards
        expect(screen.getByText('🟡 Changed')).toBeTruthy();
        expect(screen.getByText('🔵 New')).toBeTruthy();

        // Clicking Queue Changed should queue card-2 and card-3, skipping clean card-1!
        fireEvent.click(queueChangedBtn);

        await waitFor(() => {
            expect(onGenerateVideoMock).toHaveBeenCalledTimes(2);
        });
        expect(onGenerateVideoMock).toHaveBeenCalledWith('card-2');
        expect(onGenerateVideoMock).toHaveBeenCalledWith('card-3');
        expect(onGenerateVideoMock).not.toHaveBeenCalledWith('card-1');

        unmount();
    });

    it('opens context menu on right click and divides card into smaller sections', async () => {
        const onUpdateProjectMock = vi.fn();

        const { unmount } = render(
            <TooltipProvider>
                <StoryboardModule
                    activeProject={mockProject}
                    projects={[mockProject]}
                    onUpdateProject={onUpdateProjectMock}
                />
            </TooltipProvider>
        );

        // Find the input showing "Shot 1"
        const shot1Input = screen.getByDisplayValue('Shot 1');
        const cardElement = shot1Input.closest('div[style*="overflow: hidden"]') || shot1Input;

        // Right-click on the card
        fireEvent.contextMenu(cardElement, { clientX: 200, clientY: 200 });

        // Popup should appear with divide options
        expect(screen.getByText('Divide Shot 1')).toBeTruthy();
        expect(screen.getByText('Quick Divide Presets')).toBeTruthy();

        // Click "2 Parts" to divide
        const twoPartsBtn = screen.getByText('2 Parts');
        fireEvent.click(twoPartsBtn);

        // Verify onUpdateProject was called with replacement clips
        expect(onUpdateProjectMock).toHaveBeenCalled();
        const updateCall = onUpdateProjectMock.mock.calls[0];
        expect(updateCall[0]).toBe('proj-fountain-test');
        expect(updateCall[1].clips).toBeDefined();

        const updatedClips = updateCall[1].clips as VideoClip[];
        // Original 3 clips -> card 1 divided into 2 = 4 clips total
        expect(updatedClips.length).toBe(4);
        expect(updatedClips[0].label).toBe('Shot 1A');
        expect(updatedClips[1].label).toBe('Shot 1B');
        expect(updatedClips[0].startTime).toBe(0);
        expect(updatedClips[0].endTime).toBeCloseTo(2.0, 1);
        expect(updatedClips[1].startTime).toBeCloseTo(2.0, 1);
        expect(updatedClips[1].endTime).toBeCloseTo(4.0, 1);

        unmount();
    });

    it('divides card into 4 parts snapped to musical beats when beats exist', async () => {
        const onUpdateProjectMock = vi.fn();
        const projectWithBeats: BeatProject = {
            ...mockProject,
            markers: [
                { id: 'b-1', timestamp: 0.95, label: 'Beat 1', type: 'beat' },
                { id: 'b-2', timestamp: 2.05, label: 'Beat 2', type: 'beat' },
                { id: 'b-3', timestamp: 3.02, label: 'Beat 3', type: 'beat' }
            ]
        };

        const { unmount } = render(
            <TooltipProvider>
                <StoryboardModule
                    activeProject={projectWithBeats}
                    projects={[projectWithBeats]}
                    onUpdateProject={onUpdateProjectMock}
                />
            </TooltipProvider>
        );

        const shot1Input = screen.getByDisplayValue('Shot 1');
        const cardElement = shot1Input.closest('div[style*="overflow: hidden"]') || shot1Input;

        fireEvent.contextMenu(cardElement, { clientX: 200, clientY: 200 });

        expect(screen.getByText('Snap cuts to musical beats')).toBeTruthy();
        expect(screen.getByText('3 beats')).toBeTruthy();

        // Click "4 Parts"
        const fourPartsBtn = screen.getByText('4 Parts');
        fireEvent.click(fourPartsBtn);

        expect(onUpdateProjectMock).toHaveBeenCalled();
        const updateCall = onUpdateProjectMock.mock.calls[0];
        const updatedClips = updateCall[1].clips as VideoClip[];

        // Shot 1 divided into 4 pieces
        expect(updatedClips.length).toBe(6); // 4 new + card-2 + card-3
        expect(updatedClips[0].label).toBe('Shot 1A');
        expect(updatedClips[1].label).toBe('Shot 1B');
        expect(updatedClips[2].label).toBe('Shot 1C');
        expect(updatedClips[3].label).toBe('Shot 1D');

        // Snapped cuts at 0.95, 2.05, 3.02
        expect(updatedClips[0].startTime).toBe(0);
        expect(updatedClips[0].endTime).toBeCloseTo(0.95, 2);
        expect(updatedClips[1].startTime).toBeCloseTo(0.95, 2);
        expect(updatedClips[1].endTime).toBeCloseTo(2.05, 2);
        expect(updatedClips[2].startTime).toBeCloseTo(2.05, 2);
        expect(updatedClips[2].endTime).toBeCloseTo(3.02, 2);
        expect(updatedClips[3].startTime).toBeCloseTo(3.02, 2);
        expect(updatedClips[3].endTime).toBe(4.0);

        unmount();
    });
});


