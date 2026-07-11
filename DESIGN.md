---
name: Resolver Dashboard
version: alpha
colors:
  bg-primary: "#0d0d0f"
  bg-secondary: "#141418"
  bg-tertiary: "#1a1a1f"
  bg-elevated: "#222228"
  accent-primary: "#6366f1"
  accent-secondary: "#8b5cf6"
  text-primary: "rgba(255, 255, 255, 0.95)"
  text-secondary: "rgba(255, 255, 255, 0.65)"
  text-muted: "rgba(255, 255, 255, 0.4)"
  border: "rgba(255, 255, 255, 0.08)"
  border-active: "rgba(99, 102, 241, 0.5)"
  success: "#10b981"
  warning: "#f59e0b"
  error: "#ef4444"
typography:
  fontFamily: "Inter, system-ui, -apple-system, sans-serif"
  fontSize: 1rem
  lineHeight: 1.5
  fontWeight: 400
rounded:
  xl: 12px
  sm: 8px
spacing:
  sidebar: 260px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
components:
  button-primary:
    backgroundColor: "linear-gradient(135deg, {colors.accent-primary}, {colors.accent-secondary})"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "12px 24px"
    typography:
      fontWeight: 600
  button-secondary:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "12px 24px"
  card:
    backgroundColor: "{colors.bg-secondary}"
    rounded: "{rounded.xl}"
    padding: "24px"
  sidebar-item:
    rounded: "{rounded.sm}"
    padding: "14px 16px"
    textColor: "{colors.text-secondary}"
---

## Overview
The Resolver Dashboard is a dark-themed, high-performance interface for video assembly, storyboard management, and workflow analysis. It uses a sleek, neon-accented aesthetic with deep blacks and vibrant purples/indigos to evoke a professional creative tool atmosphere.

## Colors
The palette is built on a layered dark foundation with high-contrast functional colors.
- **Backgrounds:** A tiered system from `#0d0d0f` (primary) to `#222228` (elevated) provides depth and separation.
- **Accents:** A gradient of Indigo (`#6366f1`) and Violet (`#8b5cf6`) drives primary actions and highlights active states.
- **Status:** Functional colors (Emerald, Amber, Rose) are used for success, warning, and error states, often with low-opacity backgrounds for badges.

## Typography
The system uses **Inter** for its neutral, highly legible characteristics, ensuring clarity in dense data views.
- **Headings:** Bold weights (700) and larger scales (up to 2rem) for module titles.
- **Hierarchy:** Reduced opacity (0.65 and 0.4) is used on text to create visual hierarchy without introducing new colors.

## Layout & Components
The interface follows a structured, consistent layout language.
- **Sidebar:** A fixed 260px navigation area with a dedicated header and footer.
- **Cards:** The primary container for information, utilizing a 12px border radius and 24px internal padding.
- **Spacing:** A standard 24px gap is used for grid layouts, with 32px padding for main content areas.
- **Interactions:** Buttons and sidebar items use smooth transitions (0.2s) and subtle hover transforms to feel responsive and premium.
