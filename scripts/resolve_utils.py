#!/usr/bin/env python
"""
Shared utilities for DaVinci Resolve scripting.

Provides:
  - get_resolve()   → connected Resolve instance (or sys.exit on failure)
  - VALID_COLORS    → set of marker colour names accepted by the Resolve API
"""

import sys
import os
import platform


# ---------------------------------------------------------------------------
# Valid marker colours in DaVinci Resolve
# ---------------------------------------------------------------------------

VALID_COLORS = {
    "Blue", "Cyan", "Green", "Yellow", "Red", "Pink",
    "Purple", "Fuchsia", "Rose", "Lavender", "Sky",
    "Mint", "Lemon", "Sand", "Cocoa", "Cream",
}


# ---------------------------------------------------------------------------
# Resolve connection
# ---------------------------------------------------------------------------

def _get_module_paths():
    """Return platform-specific search paths for the Resolve scripting module."""
    if platform.system() == "Windows":
        programdata = os.environ.get("PROGRAMDATA", r"C:\ProgramData")
        return [
            os.path.join(programdata, "Blackmagic Design", "DaVinci Resolve",
                         "Support", "Developer", "Scripting", "Modules"),
            r"C:\Program Files\Blackmagic Design\DaVinci Resolve"
            r"\Developer\Scripting\Modules",
        ]
    elif platform.system() == "Darwin":
        return [
            "/Library/Application Support/Blackmagic Design"
            "/DaVinci Resolve/Developer/Scripting/Modules",
        ]
    else:  # Linux
        return ["/opt/resolve/Developer/Scripting/Modules"]


def get_resolve():
    """
    Connect to a running DaVinci Resolve instance.

    Attempts to import DaVinciResolveScript from the standard locations.
    Calls sys.exit(1) with an informative message on failure.

    Returns:
        The Resolve scripting object.
    """
    dvr_script = None

    # First, try a direct import (works if PYTHONPATH is set correctly)
    try:
        import DaVinciResolveScript as dvr_script  # noqa: N811
    except ImportError:
        pass

    # Fallback: search platform-specific paths
    if dvr_script is None:
        for p in _get_module_paths():
            if os.path.exists(p) and p not in sys.path:
                sys.path.insert(0, p)
                try:
                    import DaVinciResolveScript as dvr_script  # noqa: N811
                    break
                except ImportError:
                    continue

    if dvr_script is None:
        print("ERROR: Could not find DaVinci Resolve Scripting Modules.")
        print("Please ensure 'External Scripting Using' is set to 'Local'")
        print("in Resolve Preferences and PYTHONPATH includes the Modules dir.")
        sys.exit(1)

    resolve = dvr_script.scriptapp("Resolve")
    if not resolve:
        print("ERROR: Could not connect to DaVinci Resolve.")
        print("Make sure Resolve is running and External Scripting is set to 'Local'.")
        sys.exit(1)

    return resolve
