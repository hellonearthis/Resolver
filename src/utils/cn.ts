import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// WHAT: Merges Tailwind CSS class names with conditional expression resolution.
// WHY: Prevents CSS cascade conflicts by ensuring latter class declarations cleanly override earlier ones.
export function cn(...class_name_inputs: ClassValue[]): string {
    return twMerge(clsx(class_name_inputs));
}
