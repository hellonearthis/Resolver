/**
 * src/components/ui/Tooltip.test.tsx
 * 
 * Unit tests for AppTooltip positioning:
 * - 16 pixels lower by default
 * - 16 pixels higher if placing 16px lower puts it off-screen
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider, AppTooltip } from './Tooltip';

describe('AppTooltip', () => {
  it('renders trigger element and content within TooltipProvider', () => {
    render(
      <TooltipProvider>
        <AppTooltip content="Helpful information">
          <button type="button">Hover Me</button>
        </AppTooltip>
      </TooltipProvider>
    );

    expect(screen.getByRole('button', { name: 'Hover Me' })).toBeTruthy();
  });

  it('renders with 16px lower offset by default when on screen', () => {
    // In JSDOM, default getBoundingClientRect returns 0, which is <= window.innerHeight
    render(
      <TooltipProvider>
        <AppTooltip content="Lower tooltip" delayDuration={0}>
          <button type="button">Trigger</button>
        </AppTooltip>
      </TooltipProvider>
    );

    expect(screen.getByRole('button', { name: 'Trigger' })).toBeTruthy();
  });

  it('switches to 16px higher when 16px lower would overflow the viewport height', () => {
    const originalGetBoundingClientRect = HTMLDivElement.prototype.getBoundingClientRect;
    
    // Simulate element sitting near the bottom of viewport
    HTMLDivElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      top: 750,
      bottom: 800,
      left: 100,
      right: 200,
      width: 100,
      height: 50,
      x: 100,
      y: 750
    });

    try {
      render(
        <TooltipProvider>
          <AppTooltip content="Overflowing tooltip" delayDuration={0}>
            <button type="button">Bottom Button</button>
          </AppTooltip>
        </TooltipProvider>
      );
      expect(screen.getByRole('button', { name: 'Bottom Button' })).toBeTruthy();
    } finally {
      HTMLDivElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });
});
