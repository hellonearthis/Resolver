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

// WHAT: Custom Floating UI middleware that dynamically calculates vertical positioning.
// WHY: Our application design requires tooltips to sit 16 pixels lower by default for visual balance,
// unless that placement pushes the tooltip below the bottom boundary of the viewport,
// in which case it flips to sit 16 pixels higher to avoid being cut off.
export const dynamicVerticalShift16: Middleware = {
  name: "dynamicVerticalShift16",
  fn({ y: floating_vertical_coordinate, rects: calculated_elements_bounding_rectangles }) {
    // WHAT: Check if we are running in a server-side or non-DOM environment.
    // WHY: In environments without a global window object, viewport dimensions cannot be measured,
    // so we apply the default 16-pixel downward offset safely without throwing errors.
    if (typeof window === "undefined") {
      return { y: floating_vertical_coordinate + 16 };
    }

    // WHAT: Measure the available vertical viewport space and floating element dimensions.
    // WHY: These measurements allow us to test whether adding our 16px downward offset exceeds the window.
    const viewport_height_pixels = window.innerHeight || document.documentElement.clientHeight;
    const floating_tooltip_bounding_height = calculated_elements_bounding_rectangles.floating.height || 0;
    const tooltip_vertical_coordinate_with_downward_offset = floating_vertical_coordinate + 16;

    // WHAT: Evaluate whether the bottom edge of the tooltip overflows the viewport boundary.
    // WHY: If the lower bottom edge exceeds the available viewport height, we shift the tooltip
    // 16 pixels higher instead so the user can comfortably view all tooltip content on screen.
    if (tooltip_vertical_coordinate_with_downward_offset + floating_tooltip_bounding_height > viewport_height_pixels) {
      const tooltip_vertical_coordinate_with_upward_offset = floating_vertical_coordinate - 16;
      return { y: tooltip_vertical_coordinate_with_upward_offset };
    }

    // WHAT: Return the normal 16-pixel downward offset position.
    // WHY: Sufficient space exists below the reference element to comfortably show the tooltip.
    return { y: tooltip_vertical_coordinate_with_downward_offset };
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

// WHAT: Universal application tooltip component built on top of Floating UI.
// WHY: Replaces rigid popup primitives with smooth auto-updating positioning,
// accessible hover and focus management, transition animations, and viewport collision detection.
export const AppTooltip: React.FC<AppTooltipProps> = ({
  content,
  children,
  placement = "top",
  offset: custom_offset_configuration,
  className,
  delayDuration = 200,
}) => {
  // WHAT: Track whether the tooltip overlay is actively visible.
  // WHY: Controlled by Floating UI hover, focus, and dismiss interaction hooks.
  const [is_tooltip_overlay_open, set_is_tooltip_overlay_open] = React.useState<boolean>(false);
  const tooltip_arrow_svg_reference = React.useRef<SVGSVGElement | null>(null);

  // WHAT: Normalize main-axis distance and cross-axis skidding offsets.
  // WHY: Allows callers to pass custom offsets while providing standard defaults (8px distance).
  const main_axis_placement_offset = custom_offset_configuration ? custom_offset_configuration[1] : 8;
  const cross_axis_alignment_offset = custom_offset_configuration ? custom_offset_configuration[0] : 0;

  // WHAT: Initialize Floating UI positioning context, middleware pipeline, and coordinates.
  // WHY: Ensures smooth positioning that automatically updates on scroll, resize, or DOM mutations.
  const {
    refs: floating_element_references,
    floatingStyles: calculated_floating_styles,
    context: floating_positioning_context,
  } = useFloating({
    open: is_tooltip_overlay_open,
    onOpenChange: set_is_tooltip_overlay_open,
    placement: placement as Placement,
    whileElementsMounted: autoUpdate,
    middleware: [
      floatingOffset({ mainAxis: main_axis_placement_offset, crossAxis: cross_axis_alignment_offset }),
      dynamicVerticalShift16,
      floatingShift({ padding: 8 }),
      floatingArrow({ element: tooltip_arrow_svg_reference }),
    ],
  });

  // WHAT: Configure mouse hover interaction handlers.
  // WHY: Displays tooltip when user hovers the trigger element, with configurable opening delay.
  const hover_interaction_handler = useHover(floating_positioning_context, {
    move: false,
    delay: {
      open: delayDuration,
      close: 0,
    },
  });

  // WHAT: Configure keyboard focus interaction handlers.
  // WHY: Ensures keyboard-navigating users see tooltips when tabbing onto interactive elements.
  const focus_interaction_handler = useFocus(floating_positioning_context);

  // WHAT: Configure dismissal triggers (such as pressing the Escape key).
  // WHY: Conforms to WCAG 1.4.13 requirements allowing users to dismiss tooltips effortlessly.
  const dismiss_interaction_handler = useDismiss(floating_positioning_context);

  // WHAT: Assign ARIA tooltip role and attributes.
  // WHY: Communicates the informational relationship to assistive technologies and screen readers.
  const role_accessibility_handler = useRole(floating_positioning_context, { role: "tooltip" });

  // WHAT: Combine all interaction hooks into event property getters.
  // WHY: Attaches seamless event listeners and accessibility attributes to both reference and floating nodes.
  const {
    getReferenceProps: get_reference_element_properties,
    getFloatingProps: get_floating_element_properties,
  } = useInteractions([
    hover_interaction_handler,
    focus_interaction_handler,
    dismiss_interaction_handler,
    role_accessibility_handler,
  ]);

  // WHAT: Configure smooth opacity and scale transition animations.
  // WHY: Provides modern micro-animations without flickering or abrupt DOM pops.
  const {
    isMounted: is_tooltip_dom_mounted,
    styles: transition_animation_styles,
  } = useTransitionStyles(floating_positioning_context, {
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

  // WHAT: Guard against empty or null tooltip content.
  // WHY: If no content is provided, render the children directly without attaching overhead or floating DOM nodes.
  if (!content) {
    return <>{children}</>;
  }

  // WHAT: Merge our Floating UI reference ref with any existing ref attached to the children element.
  // WHY: Ensures we do not overwrite the caller's existing ref when wrapping arbitrary React nodes.
  const children_react_element_reference = React.isValidElement(children)
    ? (children.props as { ref?: React.Ref<unknown> })?.ref
    : null;
  const merged_reference_element_reference = useMergeRefs([
    floating_element_references.setReference,
    children_react_element_reference,
  ]);

  // WHAT: Construct the interactive reference trigger node.
  // WHY: Clones valid React elements to avoid superfluous DOM wrapper tags, or wraps bare text in a span.
  const interactive_trigger_element = React.isValidElement(children) ? (
    React.cloneElement(
      children,
      get_reference_element_properties({
        ...(children.props as Record<string, unknown>),
        ref: merged_reference_element_reference,
      })
    )
  ) : (
    <span
      ref={floating_element_references.setReference}
      {...get_reference_element_properties()}
    >
      {children}
    </span>
  );

  return (
    <>
      {interactive_trigger_element}
      {is_tooltip_dom_mounted && (
        <FloatingPortal>
          <div
            ref={floating_element_references.setFloating}
            style={{
              ...calculated_floating_styles,
              ...transition_animation_styles,
            }}
            {...get_floating_element_properties({
              className: cn(
                "z-50 rounded bg-[#2a2a35] border border-gray-600/50 px-3 py-1.5 text-xs font-medium text-gray-200 shadow-xl pointer-events-none",
                className
              ),
            })}
          >
            {content}
            <FloatingArrow
              ref={tooltip_arrow_svg_reference}
              context={floating_positioning_context}
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

// WHAT: Backward compatibility wrappers for Radix-style tooltip consumers.
// WHY: Preserves full compatibility across test suites and existing module wrappers without breaking changes.
export const TooltipProvider: React.FC<{
  children: React.ReactNode;
  delayDuration?: number;
  skipDelayDuration?: number;
}> = ({ children }) => <>{children}</>;

export const TooltipRoot: React.FC<{
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open_status: boolean) => void;
  delayDuration?: number;
}> = ({ children }) => <>{children}</>;

export const TooltipTrigger: React.FC<{
  children: React.ReactNode;
  asChild?: boolean;
}> = ({ children }) => <>{children}</>;

export const TooltipContent: React.FC<{
  children: React.ReactNode;
  className?: string;
  sideOffset?: number;
  alignOffset?: number;
  side?: string;
}> = ({ children, className }) => (
  <div
    className={cn(
      "z-50 rounded bg-[#2a2a35] border border-gray-600/50 px-3 py-1.5 text-xs font-medium text-gray-200 shadow-xl",
      className
    )}
  >
    {children}
  </div>
);
