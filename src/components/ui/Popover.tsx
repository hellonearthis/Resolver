import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { cn } from "./Tooltip"

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-auto outline-none rounded-lg bg-[#11111e] border border-indigo-500/30 text-gray-200 shadow-xl",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export interface AppPopoverProps {
  content: React.ReactNode;
  children: React.ReactNode;
  placement?: "top" | "right" | "bottom" | "left";
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  className?: string;
  triggerAsChild?: boolean;
}

export const AppPopover: React.FC<AppPopoverProps> = ({ 
  content, 
  children, 
  placement = "bottom",
  onOpenChange,
  open,
  className,
  triggerAsChild = true
}) => {
  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger asChild={triggerAsChild}>
        {children}
      </PopoverTrigger>
      <PopoverContent side={placement} sideOffset={8} className={className}>
        {content}
      </PopoverContent>
    </Popover>
  );
};

export { Popover, PopoverTrigger, PopoverContent }
