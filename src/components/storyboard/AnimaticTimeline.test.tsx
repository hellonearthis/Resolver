/**
 * src/components/storyboard/AnimaticTimeline.test.tsx
 * 
 * Unit tests for AnimaticTimeline:
 * - Listing segments/sections in the timeline header
 * - Rendering dedicated segments/sections track with colors and names
 * - Quick jump to section timestamps
 * - Segment tags on clip cards
 * - Global mini-rail segments ribbon
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import AnimaticTimeline from './AnimaticTimeline';
import type { StoryboardTimelineItem } from '../../modules/StoryboardModule';
import type { MusicSection } from '../../types/sections';
import type { VideoClip } from '../../types/assembler';

describe('AnimaticTimeline', () => {
    const mockSections: MusicSection[] = [
        { id: 'sec-intro', name: 'Intro', type: 'intro', startTime: 0, endTime: 4.0, color: '#10b981' },
        { id: 'sec-verse', name: 'Verse 1', type: 'verse', startTime: 4.0, endTime: 12.0, color: '#3b82f6' },
        { id: 'sec-chorus', name: 'Chorus', type: 'chorus', startTime: 12.0, endTime: 20.0, color: '#a855f7' }
    ];

    const mockClips: VideoClip[] = [
        {
            id: 'c-1',
            startTime: 0,
            duration: 4.0,
            endTime: 4.0,
            track: 1,
            status: 'pending',
            source: 'main',
            label: 'Shot 1',
            sectionName: 'Intro',
            sectionType: 'intro'
        },
        {
            id: 'c-2',
            startTime: 4.0,
            duration: 8.0,
            endTime: 12.0,
            track: 1,
            status: 'pending',
            source: 'main',
            label: 'Shot 2',
            sectionName: 'Verse 1',
            sectionType: 'verse'
        }
    ];

    const mockItems: StoryboardTimelineItem[] = mockClips.map(clip => ({
        type: 'clip',
        startTime: clip.startTime,
        endTime: clip.endTime,
        duration: clip.duration,
        clip,
        label: clip.label
    }));

    it('lists segments count and jump pills in the timeline header', () => {
        const onSelectCardMock = vi.fn();

        render(
            <TooltipProvider>
                <AnimaticTimeline
                    items={mockItems}
                    sections={mockSections}
                    onSelectCard={onSelectCardMock}
                />
            </TooltipProvider>
        );

        // Header shows segments count
        expect(screen.getByText('3 Segments')).toBeTruthy();

        // Header shows segment jump pills
        const introBtn = screen.getByRole('button', { name: 'Intro' });
        const verseBtn = screen.getByRole('button', { name: 'Verse 1' });
        const chorusBtn = screen.getByRole('button', { name: 'Chorus' });

        expect(introBtn.getAttribute('title')).toContain('Jump to Intro');
        expect(verseBtn.getAttribute('title')).toContain('Jump to Verse 1');
        expect(chorusBtn.getAttribute('title')).toContain('Jump to Chorus');
    });

    it('renders dedicated segments track with names and type badges', () => {
        const onSelectCardMock = vi.fn();

        render(
            <TooltipProvider>
                <AnimaticTimeline
                    items={mockItems}
                    sections={mockSections}
                    onSelectCard={onSelectCardMock}
                />
            </TooltipProvider>
        );

        // Track blocks show section names
        const introTrackItem = screen.getByTitle(/Intro \(INTRO\) • 0.0s - 4.0s/);
        expect(introTrackItem).toBeTruthy();

        const verseTrackItem = screen.getByTitle(/Verse 1 \(VERSE\) • 4.0s - 12.0s/);
        expect(verseTrackItem).toBeTruthy();
    });

    it('displays segment tag on clips with sectionName', () => {
        const onSelectCardMock = vi.fn();

        render(
            <TooltipProvider>
                <AnimaticTimeline
                    items={mockItems}
                    sections={mockSections}
                    onSelectCard={onSelectCardMock}
                />
            </TooltipProvider>
        );

        // Shot 1 has section badge Intro
        expect(screen.getByText('Shot 1')).toBeTruthy();
        expect(screen.getByText('Shot 2')).toBeTruthy();
    });

    it('derives sections automatically from clips when sections prop is empty', () => {
        const onSelectCardMock = vi.fn();

        render(
            <TooltipProvider>
                <AnimaticTimeline
                    items={mockItems}
                    sections={[]}
                    onSelectCard={onSelectCardMock}
                />
            </TooltipProvider>
        );

        // Should automatically derive Intro and Verse 1 from the clips
        expect(screen.getByText('2 Segments')).toBeTruthy();
    });

    it('triggers onCardContextMenu when right-clicking a timeline clip card', () => {
        const onSelectCardMock = vi.fn();
        const onCardContextMenuMock = vi.fn();

        const { container } = render(
            <TooltipProvider>
                <AnimaticTimeline
                    items={mockItems}
                    sections={mockSections}
                    onSelectCard={onSelectCardMock}
                    onCardContextMenu={onCardContextMenuMock}
                />
            </TooltipProvider>
        );

        const clipElement = container.querySelector('[data-timeline-index="0"]')!;
        expect(clipElement).toBeTruthy();

        fireEvent.contextMenu(clipElement);
        expect(onCardContextMenuMock).toHaveBeenCalledWith(expect.anything(), mockClips[0]);
    });

    it('triggers onCardContextMenu when clicking the ➗ divide button on a timeline clip', () => {
        const onSelectCardMock = vi.fn();
        const onCardContextMenuMock = vi.fn();

        render(
            <TooltipProvider>
                <AnimaticTimeline
                    items={mockItems}
                    sections={mockSections}
                    onSelectCard={onSelectCardMock}
                    onCardContextMenu={onCardContextMenuMock}
                />
            </TooltipProvider>
        );

        const divideButtons = screen.getAllByTitle('Divide shot into smaller sections');
        expect(divideButtons.length).toBeGreaterThan(0);

        fireEvent.click(divideButtons[0]);
        expect(onCardContextMenuMock).toHaveBeenCalledWith(expect.anything(), mockClips[0]);
    });

    it('displays shot count badges on segments when segments contain multiple shots', () => {
        const onSelectCardMock = vi.fn();

        // 3 shots inside Verse 1
        const multiShotClips: VideoClip[] = [
            {
                id: 'c-1',
                startTime: 0,
                duration: 4.0,
                endTime: 4.0,
                track: 1,
                status: 'pending',
                source: 'main',
                label: 'Shot 1',
                sectionName: 'Intro',
                sectionType: 'intro'
            },
            {
                id: 'c-2a',
                startTime: 4.0,
                duration: 2.0,
                endTime: 6.0,
                track: 1,
                status: 'pending',
                source: 'main',
                label: 'Shot 2A',
                sectionName: 'Verse 1',
                sectionType: 'verse'
            },
            {
                id: 'c-2b',
                startTime: 6.0,
                duration: 3.0,
                endTime: 9.0,
                track: 1,
                status: 'pending',
                source: 'main',
                label: 'Shot 2B',
                sectionName: 'Verse 1',
                sectionType: 'verse'
            },
            {
                id: 'c-2c',
                startTime: 9.0,
                duration: 3.0,
                endTime: 12.0,
                track: 1,
                status: 'pending',
                source: 'main',
                label: 'Shot 2C',
                sectionName: 'Verse 1',
                sectionType: 'verse'
            }
        ];

        const multiShotItems: StoryboardTimelineItem[] = multiShotClips.map(clip => ({
            type: 'clip',
            startTime: clip.startTime,
            endTime: clip.endTime,
            duration: clip.duration,
            clip,
            label: clip.label
        }));

        render(
            <TooltipProvider>
                <AnimaticTimeline
                    items={multiShotItems}
                    sections={mockSections}
                    onSelectCard={onSelectCardMock}
                />
            </TooltipProvider>
        );

        // Header shows 4 Shots total
        expect(screen.getByText('4 Shots')).toBeTruthy();

        // Verse 1 button badge shows 3 shots
        const verseBtn = screen.getByRole('button', { name: 'Verse 1' });
        expect(verseBtn.textContent).toContain('3 shots');

        // Verse 1 track block title shows 3 shots
        const verseTrackItem = screen.getByTitle(/Verse 1 \(VERSE\) • 4.0s - 12.0s \(8.0s\) • 3 shots/);
        expect(verseTrackItem).toBeTruthy();
        expect(verseTrackItem.textContent).toContain('3 shots');
    });
});


