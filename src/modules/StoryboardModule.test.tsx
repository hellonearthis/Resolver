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
        expect(screen.getByText('Verse 1')).toBeTruthy();
        expect(screen.getByText('Chorus')).toBeTruthy();
        expect(screen.getByText('Bridge')).toBeTruthy();

        // Verify shot action prompts appear
        expect(screen.getByDisplayValue('Rain-soaked cyan pavement.')).toBeTruthy();
        expect(screen.getByDisplayValue('High energy strobe lights.')).toBeTruthy();
        expect(screen.getByDisplayValue('Solitary figure in amber light.')).toBeTruthy();

        unmount();
    });

    it('switches to flat grid view when Grid toggle is clicked', () => {
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

        // In flat grid view, section headers are hidden
        expect(screen.queryByText('Verse 1')).toBeNull();
        expect(screen.queryByText('Chorus')).toBeNull();

        // But cards remain rendered
        expect(screen.getByDisplayValue('Rain-soaked cyan pavement.')).toBeTruthy();

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
});
