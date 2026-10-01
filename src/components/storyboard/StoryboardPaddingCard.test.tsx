/**
 * src/components/storyboard/StoryboardPaddingCard.test.tsx
 * 
 * Component tests for StoryboardPaddingCard (slot adding card):
 * - Default duration fill click
 * - Custom duration input and Enter key submission
 * - Non-positive duration filtering
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import StoryboardPaddingCard from './StoryboardPaddingCard';

describe('StoryboardPaddingCard', () => {
    it('renders time interval and calls onAdd with default 6.0 duration when clicked', () => {
        const onAddMock = vi.fn();

        render(
            <TooltipProvider>
                <StoryboardPaddingCard startTime={10.0} duration={3.4} onAdd={onAddMock} />
            </TooltipProvider>
        );

        // Verify timing text
        expect(screen.getByText(/0:10\.00.*0:13\.40/)).toBeTruthy();
        expect(screen.getByText((_, element) => element?.textContent?.replace(/\s+/g, '') === '3.4s')).toBeTruthy();

        // Click card
        const cardSlot = screen.getByText('Empty Slot');
        fireEvent.click(cardSlot);

        expect(onAddMock).toHaveBeenCalledWith(10.0, 6.0);
    });

    it('submits customized duration on Enter key press', () => {
        const onAddMock = vi.fn();

        render(
            <TooltipProvider>
                <StoryboardPaddingCard startTime={5.0} duration={4.0} onAdd={onAddMock} />
            </TooltipProvider>
        );

        const input = screen.getByTitle('Target duration in seconds');
        fireEvent.change(input, { target: { value: '3.5' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(onAddMock).toHaveBeenCalledWith(5.0, 3.5);
    });

    it('ignores invalid or non-positive duration values', () => {
        const onAddMock = vi.fn();

        render(
            <TooltipProvider>
                <StoryboardPaddingCard startTime={5.0} duration={4.0} onAdd={onAddMock} />
            </TooltipProvider>
        );

        const input = screen.getByTitle('Target duration in seconds');
        fireEvent.change(input, { target: { value: '-2.0' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(onAddMock).not.toHaveBeenCalled();
    });
});
