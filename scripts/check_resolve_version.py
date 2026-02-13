"""
DaVinci Resolve Version Checker

Detects whether DaVinci Resolve Studio (paid) or Free is running.
The Free version does not support external scripting via the API,
so this script helps users diagnose connectivity issues.

Usage:
    python check_resolve_version.py
"""

import sys


def check_resolve_version():
    try:
        import DaVinciResolveScript as dvr_script
    except ImportError:
        return (
            "Error: DaVinciResolveScript module not found.\n"
            "Make sure PYTHONPATH includes the Resolve scripting modules folder.\n"
            "  Windows: %PROGRAMDATA%\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer\\Scripting\\Modules\\\n"
        )

    # Try to connect to the running Resolve instance
    resolve = dvr_script.scriptapp("Resolve")

    if resolve is None:
        return (
            "Connection Failed.\n"
            "This usually means one of:\n"
            "  1. DaVinci Resolve is not running\n"
            "  2. You are running DaVinci Resolve FREE (external scripting is Studio-only)\n"
            "  3. External Scripting is not enabled (Preferences > System > General > External Scripting = Local)\n"
        )

    # Connected — check the product name
    product_name = resolve.GetProductName()
    version = resolve.GetVersionString() if hasattr(resolve, 'GetVersionString') else 'unknown'

    return f"Success: Connected to {product_name} (v{version})"


if __name__ == '__main__':
    result = check_resolve_version()
    print(result)

    # Exit with error code if not connected
    if result.startswith("Success"):
        sys.exit(0)
    else:
        sys.exit(1)
