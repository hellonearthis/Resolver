#!/usr/bin/env python3
import os
import sys
import argparse

# Ensure audit_terms is importable regardless of CWD
_script_dir = os.path.dirname(os.path.abspath(__file__))
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

from audit_terms import load_retired_terms, scan_path, audit_text

def main():
    parser = argparse.ArgumentParser(description="Validate files or stdin to ensure no fuzzy/retired terms are present.")
    parser.add_argument('--path', type=str, help="Path to file or directory to validate. Reads stdin if not provided or set to '-'.")
    parser.add_argument('--exclude', nargs='+', type=str, default=[], help="Glob patterns for files/directories to exclude (e.g., 'node_modules/*' 'vendor/*').")
    parser.add_argument('--retired-terms', type=str, dest='retired_terms', help="Path to a custom retired terms file. Defaults to references/retired-terms-default.txt.")
    args = parser.parse_args()
    
    retired_terms = load_retired_terms(args.retired_terms)
    
    if not args.path or args.path == '-':
        text = sys.stdin.read()
        findings = audit_text(text, "stdin", retired_terms)
    else:
        if not os.path.exists(args.path):
            sys.stderr.write(f"Error: Path {args.path} does not exist.\n")
            sys.exit(1)
        findings = scan_path(args.path, retired_terms, args.exclude)
        
    if findings:
        sys.stderr.write(f"VALIDATION FAILED: Found {len(findings)} fuzzy/retired term occurrences:\n\n")
        for f in findings:
            location = f"{os.path.basename(f['file_path'])}:L{f['line_number']}" if f['file_path'] != "stdin" else f"stdin:L{f['line_number']}"
            sys.stderr.write(f"  [{location}] Term '{f['term']}' (Category: {f['category']})\n")
            sys.stderr.write(f"    Line snippet: \"{f['context_snippet'].strip()}\"\n")
            sys.stderr.write(f"    Suggested alternatives: {f['replacement']}\n\n")
        sys.exit(1)
    else:
        print("VALIDATION PASSED: No fuzzy, metaphorical, or retired terms identified.")
        sys.exit(0)

if __name__ == '__main__':
    main()
