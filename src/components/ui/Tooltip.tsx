import * as React from "react";
import {
  useFloating,
  autoUpdate,
  offset as floatingOffset,
  shift as floatingShift,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  useInteractions,
  FloatingPortal,
  FloatingArrow,
  arrow as floatingArrow,
  useTransitionStyles,
  useMergeRefs,
  type Middleware,
  type Placement,
} from "@floating-ui/react";
import { cn } from "../../utils/cn";

/**
 * Custom Floating UI middleware:
 * Shifts tooltip 16px lower relative to its base position,
 * UNLESS that puts the tooltip off-screen at the bottom of the viewport,
 * in which case it shifts 16px higher instead.
 */
export const dynamicVerticalShift16: Middleware = {
  name: "dynamicVerticalShift16",
  fn({ y, rects }) {
    if (typeof window === "undefined") {
      return { y: y + 16 };
    }
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const floatingHeight = rects.floating.height || 0;
    const lowerY = y + 16;

    // Check if 16px lower causes tooltip to exceed viewport bottom
    if (lowerY + floatingHeight > viewportHeight) {
      return { y: y - 16 };
    }
    return { y: lowerY };
  },
};

export interface AppTooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  placement?: "top" | "right" | "bottom" | "left";
  offset?: [number, number]; // [skidding / crossAxis, distance / mainAxis]
  className?: string;
  delayDuration?: number;
}

export const AppTooltip: React.FC<AppTooltipProps> = ({
  content,
  children,
  placement = "top",
  offset: customOffset,
  className,
  delayDuration = 200,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const arrowRef = React.useRef<SVGSVGElement | null>(null);

  const mainAxisOffset = customOffset ? customOffset[1] : 8;
  const crossAxisOffset = customOffset ? customOffset[0] : 0;

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: placement as Placement,
    whileElementsMounted: autoUpdate,
    middleware: [
      floatingOffset({ mainAxis: mainAxisOffset, crossAxis: crossAxisOffset }),
      dynamicVerticalShift16,
      floatingShift({ padding: 8 }),
      floatingArrow({ element: arrowRef }),
    ],
  });

  const hover = useHover(context, {
    move: false,
    delay: {
      open: delayDuration,
      close: 0,
    },
  });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "tooltip" });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
    role,
  ]);

  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: 120,
    initial: {
      opacity: 0,
      transform: "scale(0.96)",
    },
    open: {
      opacity: 1,
      transform: "scale(1)",
    },
    close: {
      opacity: 0,
      transform: "scale(0.96)",
    },
  });

  if (!content) {
    return <>{children}</>;
  }

  // Safely merge reference ref with any existing ref on children
  const childrenRef = React.isValidElement(children)
    ? (children.props as { ref?: React.Ref<unknown> })?.ref
    : null;
  const mergedReferenceRef = useMergeRefs([refs.setReference, childrenRef]);

  const trigger = React.isValidElement(children) ? (
    React.cloneElement(
      children,
      getReferenceProps({
        ...(children.props as Record<string, unknown>),
        ref: mergedReferenceRef,
      })
    )
  ) : (
    <span ref={refs.setReference} {...getReferenceProps()}>
      {children}
    </span>
  );

  return (
    <>
      {trigger}
      {isMounted && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{
              ...floatingStyles,
              ...transitionStyles,
            }}
            {...getFloatingProps({
              className: cn(
                "z-50 rounded bg-[#2a2a35] border border-gray-600/50 px-3 py-1.5 text-xs font-medium text-gray-200 shadow-xl pointer-events-none",
                className
              ),
            })}
          >
            {content}
            <FloatingArrow
              ref={arrowRef}
              context={context}
              className="fill-[#2a2a35]"
              width={10}
              height={5}
            />
          </div>
        </FloatingPortal>
      )}
    </>
  );
};

// Backward compatibility wrappers for Radix-style usage
export const TooltipProvider: React.FC<{ children: React.ReactNode; delayDuration?: number; skipDelayDuration?: number }> = ({ children }) => <>{children}</>;
export const TooltipRoot: React.FC<{ children: React.ReactNode; open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; delayDuration?: number }> = ({ children }) => <>{children}</>;
export const TooltipTrigger: React.FC<{ children: React.ReactNode; asChild?: boolean }> = ({ children }) => <>{children}</>;
export const TooltipContent: React.FC<{ children: React.ReactNode; className?: string; sideOffset?: number; alignOffset?: number; side?: string }> = ({ children, className }) => (
  <div className={cn("z-50 rounded bg-[#2a2a35] border border-gray-600/50 px-3 py-1.5 text-xs font-medium text-gray-200 shadow-xl", className)}>
    {children}
  </div>
);
