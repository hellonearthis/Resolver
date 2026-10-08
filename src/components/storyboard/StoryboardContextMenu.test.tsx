/**
 * src/components/storyboard/StoryboardContextMenu.test.tsx
 * 
 * Unit tests for StoryboardContextMenu:
 * - Rendering card info and duration
 * - Quick divide presets (2, 3, 4 parts)
 * - Custom division stepper
 * - Musical beat division and interval options (2, 4, 6, 8, 16 beats)
 * - Snapping 4-part cuts to musical beats
 * - Action callbacks (duplicate, mute, delete, close)
 * - Escape key dismissal
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StoryboardContextMenu, {
    calculateBeatIntervalCutPoints,
    calculateSnappedBeatCutPoints,
    BEAT_INTERVALS
} from './StoryboardContextMenu';
import type { VideoClip } from '../../types/assembler';

describe('StoryboardContextMenu Math Helpers', () => {
    describe('calculateBeatIntervalCutPoints', () => {
        const beats = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0];

        it('cuts every 2 beats', () => {
            const cuts = calculateBeatIntervalCutPoints(0.5, 9.5, 2, beats);
            // index 1 (1.5), index 3 (2.5), index 5 (3.5)...
            expect(cuts).toEqual([1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5]);
        });

        it('cuts every 4 beats', () => {
            const cuts = calculateBeatIntervalCutPoints(0.5, 9.5, 4, beats);
            // index 3 (2.5), index 7 (4.5), index 11 (6.5), index 15 (8.5)
            expect(cuts).toEqual([2.5, 4.5, 6.5, 8.5]);
        });

        it('cuts every 6 beats', () => {
            const cuts = calculateBeatIntervalCutPoints(0.5, 9.5, 6, beats);
            // index 5 (3.5), index 11 (6.5)
            expect(cuts).toEqual([3.5, 6.5]);
        });

        it('cuts every 8 beats', () => {
            const cuts = calculateBeatIntervalCutPoints(0.5, 9.5, 8, beats);
            // index 7 (4.5), index 15 (8.5)
            expect(cuts).toEqual([4.5, 8.5]);
        });

        it('cuts every 16 beats', () => {
            const cuts = calculateBeatIntervalCutPoints(0.5, 9.5, 16, beats);
            // index 15 (8.5)
            expect(cuts).toEqual([8.5]);
        });

        it('returns empty array if card does not have enough beats for the requested interval', () => {
            const fewBeats = [1.0, 2.0, 3.0];
            const cuts = calculateBeatIntervalCutPoints(0.5, 4.0, 4, fewBeats);
            expect(cuts).toEqual([]);
        });
    });

    describe('calculateSnappedBeatCutPoints', () => {
        it('snaps a 4-part divide onto the closest musical beats', () => {
            // Card from 0.0 to 8.0 (ideal cuts: 2.0, 4.0, 6.0)
            const beats = [0.5, 1.0, 1.95, 2.5, 3.0, 4.05, 5.0, 5.95, 7.0];
            const cuts = calculateSnappedBeatCutPoints(0.0, 8.0, 4, beats);

            expect(cuts.length).toBe(3);
            expect(cuts[0]).toBe(1.95);
            expect(cuts[1]).toBe(4.05);
            expect(cuts[2]).toBe(5.95);
        });

        it('guarantees strictly ordered distinct cut points', () => {
            const beats = [1.0, 2.0, 3.0, 4.0, 5.0];
            const cuts = calculateSnappedBeatCutPoints(0.0, 6.0, 4, beats);

            expect(cuts.length).toBe(3);
            expect(cuts[0]).toBeLessThan(cuts[1]);
            expect(cuts[1]).toBeLessThan(cuts[2]);
        });

        it('falls back to ideal targets when not enough beats are available', () => {
            const fewBeats = [2.0];
            const cuts = calculateSnappedBeatCutPoints(0.0, 8.0, 4, fewBeats);

            expect(cuts).toEqual([2.0, 4.0, 6.0]);
        });
    });
});

describe('StoryboardContextMenu', () => {
    const mockCard: VideoClip = {
        id: 'card-test-1',
        startTime: 2.0,
        duration: 4.0,
        endTime: 6.0,
        track: 1,
        status: 'pending',
        source: 'main',
        label: 'Shot 2',
        sceneNumber: '1',
        shotLetter: 'A',
        notes: { action: 'Wide neon alley', dialogue: '', sound: '' }
    };

    it('renders the context menu with card label, duration, and frame info', () => {
        const onCloseMock = vi.fn();
        const onDivideMock = vi.fn();

        render(
            <StoryboardContextMenu
                card={mockCard}
                position={{ x: 100, y: 100 }}
                onClose={onCloseMock}
                onDivide={onDivideMock}
                frameRate={24}
            />
        );

        expect(screen.getByText('Divide Shot 2')).toBeTruthy();
        expect(screen.getByText('4.00s')).toBeTruthy();
        expect(screen.getByText(/96 frames @ 24fps/)).toBeTruthy();
    });

    it('triggers onDivide with 2 when clicking 2 Parts without beats', () => {
        const onCloseMock = vi.fn();
        const onDivideMock = vi.fn();

        render(
            <StoryboardContextMenu
                card={mockCard}
                position={{ x: 100, y: 100 }}
                onClose={onCloseMock}
                onDivide={onDivideMock}
            />
        );

        const btn2 = screen.getByText('2 Parts');
        fireEvent.click(btn2);

        expect(onDivideMock).toHaveBeenCalledWith(mockCard, 2);
        expect(onCloseMock).toHaveBeenCalled();
    });

    it('triggers onDivide with 3 when clicking 3 Parts without beats', () => {
        const onCloseMock = vi.fn();
        const onDivideMock = vi.fn();

        render(
            <StoryboardContextMenu
                card={mockCard}
                position={{ x: 100, y: 100 }}
                onClose={onCloseMock}
                onDivide={onDivideMock}
            />
        );

        const btn3 = screen.getByText('3 Parts');
        fireEvent.click(btn3);

        expect(onDivideMock).toHaveBeenCalledWith(mockCard, 3);
        expect(onCloseMock).toHaveBeenCalled();
    });

    it('triggers onDivide with 4 when clicking 4 Parts without beats', () => {
        const onCloseMock = vi.fn();
        const onDivideMock = vi.fn();

        render(
            <StoryboardContextMenu
                card={mockCard}
                position={{ x: 100, y: 100 }}
                onClose={onCloseMock}
                onDivide={onDivideMock}
            />
        );

        const btn4 = screen.getByText('4 Parts');
        fireEvent.click(btn4);

        expect(onDivideMock).toHaveBeenCalledWith(mockCard, 4);
        expect(onCloseMock).toHaveBeenCalled();
    });

    it('snaps 4 Parts quick divide to musical beats when snapToBeats is active', () => {
        const onCloseMock = vi.fn();
        const onDivideMock = vi.fn();
        // Card is 2.0 to 6.0 (duration 4.0). Ideal targets: 3.0, 4.0, 5.0.
        // Beats at 2.9, 3.95, 5.05
        const beats = [2.9, 3.95, 5.05];

        render(
            <StoryboardContextMenu
                card={mockCard}
                position={{ x: 100, y: 100 }}
                onClose={onCloseMock}
                onDivide={onDivideMock}
                beatTimestamps={beats}
            />
        );

        const btn4 = screen.getByText('4 Parts');
        fireEvent.click(btn4);

        // Should call onDivide with snapped cut points!
        expect(onDivideMock).toHaveBeenCalledWith(mockCard, 4, [2.9, 3.95, 5.05]);
        expect(onCloseMock).toHaveBeenCalled();
    });

    it('allows unchecking snap to beats to divide by equal frames instead', () => {
        const onCloseMock = vi.fn();
        const onDivideMock = vi.fn();
        const beats = [2.9, 3.95, 5.05];

        render(
            <StoryboardContextMenu
                card={mockCard}
                position={{ x: 100, y: 100 }}
                onClose={onCloseMock}
                onDivide={onDivideMock}
                beatTimestamps={beats}
            />
        );

        // Uncheck the snap checkbox
        const checkbox = screen.getByRole('checkbox');
        fireEvent.click(checkbox);

        const btn4 = screen.getByText('4 Parts');
        fireEvent.click(btn4);

        // Should now call onDivide without custom beat cut points
        expect(onDivideMock).toHaveBeenCalledWith(mockCard, 4);
        expect(onCloseMock).toHaveBeenCalled();
    });

    it('allows custom division with stepper and divide button', () => {
        const onCloseMock = vi.fn();
        const onDivideMock = vi.fn();

        render(
            <StoryboardContextMenu
                card={mockCard}
                position={{ x: 100, y: 100 }}
                onClose={onCloseMock}
                onDivide={onDivideMock}
            />
        );

        // Click '+' button twice: 2 -> 3 -> 4
        const plusButton = screen.getByText('+');
        fireEvent.click(plusButton);
        fireEvent.click(plusButton);

        const divideButton = screen.getByRole('button', { name: /Divide/i });
        fireEvent.click(divideButton);

        expect(onDivideMock).toHaveBeenCalledWith(mockCard, 4);
        expect(onCloseMock).toHaveBeenCalled();
    });

    it('renders musical beat divide option and allows dividing at all beats', () => {
        const onCloseMock = vi.fn();
        const onDivideMock = vi.fn();
        const onDivideAtBeatsMock = vi.fn();
        const beats = [3.0, 4.0, 5.0];

        render(
            <StoryboardContextMenu
                card={mockCard}
                position={{ x: 100, y: 100 }}
                onClose={onCloseMock}
                onDivide={onDivideMock}
                onDivideAtBeats={onDivideAtBeatsMock}
                beatTimestamps={beats}
            />
        );

        expect(screen.getByText('Divide at Musical Beats')).toBeTruthy();
        expect(screen.getByText('4 cuts')).toBeTruthy();

        fireEvent.click(screen.getByText('Divide at Musical Beats'));
        expect(onDivideAtBeatsMock).toHaveBeenCalledWith(mockCard, beats);
        expect(onCloseMock).toHaveBeenCalled();
    });

    it('renders 2, 4, 6, 8, 16 beats options and divides by 4 beats interval', () => {
        const onCloseMock = vi.fn();
        const onDivideMock = vi.fn();
        const onDivideAtBeatsMock = vi.fn();
        // 9 beats in card from 2.0 to 8.0: 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5
        const beats = [2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5];
        const eightSecCard: VideoClip = {
            ...mockCard,
            startTime: 2.0,
            endTime: 8.0,
            duration: 6.0
        };

        render(
            <StoryboardContextMenu
                card={eightSecCard}
                position={{ x: 100, y: 100 }}
                onClose={onCloseMock}
                onDivide={onDivideMock}
                onDivideAtBeats={onDivideAtBeatsMock}
                beatTimestamps={beats}
            />
        );

        // Check that interval buttons are present
        expect(screen.getByText('2 Beats')).toBeTruthy();
        expect(screen.getByText('4 Beats')).toBeTruthy();
        expect(screen.getByText('6 Beats')).toBeTruthy();
        expect(screen.getByText('8 Beats')).toBeTruthy();
        expect(screen.getByText('16 Beats')).toBeTruthy();

        // Click '4 Beats' interval
        const fourBeatsBtn = screen.getByText('4 Beats').closest('button')!;
        fireEvent.click(fourBeatsBtn);

        // Index 3 (4.0) and Index 7 (6.0)
        expect(onDivideAtBeatsMock).toHaveBeenCalledWith(eightSecCard, [4.0, 6.0]);
        expect(onCloseMock).toHaveBeenCalled();
    });

    it('triggers onDuplicate, onToggleMute, and onDelete callbacks', () => {
        const onCloseMock = vi.fn();
        const onDivideMock = vi.fn();
        const onDuplicateMock = vi.fn();
        const onToggleMuteMock = vi.fn();
        const onDeleteMock = vi.fn();

        const { unmount } = render(
            <StoryboardContextMenu
                card={mockCard}
                position={{ x: 100, y: 100 }}
                onClose={onCloseMock}
                onDivide={onDivideMock}
                onDuplicate={onDuplicateMock}
                onToggleMute={onToggleMuteMock}
                onDelete={onDeleteMock}
            />
        );

        fireEvent.click(screen.getByTitle('Duplicate this shot'));
        expect(onDuplicateMock).toHaveBeenCalledWith(mockCard);

        fireEvent.click(screen.getByTitle('Toggle Alternate/Mute take'));
        expect(onToggleMuteMock).toHaveBeenCalledWith(mockCard);

        fireEvent.click(screen.getByTitle('Delete this shot'));
        expect(onDeleteMock).toHaveBeenCalledWith(mockCard.id);
        unmount();
    });

    it('closes on Escape key press', () => {
        const onCloseMock = vi.fn();

        render(
            <StoryboardContextMenu
                card={mockCard}
                position={{ x: 100, y: 100 }}
                onClose={onCloseMock}
                onDivide={vi.fn()}
            />
        );

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onCloseMock).toHaveBeenCalled();
    });
});
