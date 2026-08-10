#!/usr/bin/env python3
import os
import re
import sys
import json
import argparse
import fnmatch

MAPPINGS = {
    'magic sauce': {
        'category': 'Poetic/Metaphorical',
        'replacements': ['algorithmic logic', 'proprietary heuristics'],
        'confidence': 0.9
    },
    'secret sauce': {
        'category': 'Private/Jargon',
        'replacements': ['proprietary algorithm', 'domain-specific heuristic'],
        'confidence': 0.8
    },
    'black box': {
        'category': 'Poetic/Metaphorical',
        'replacements': ['encapsulated module', 'closed-source service'],
        'confidence': 0.8
    },
    'out of the box': {
        'category': 'Marketing/Hype',
        'replacements': ['default', 'built-in', 'preconfigured'],
        'confidence': 0.8
    },
    'the blob': {
        'category': 'Private/Jargon',
        'replacements': ['monolithic data object', 'unstructured aggregate'],
        'confidence': 0.7
    },
    'custom stuff': {
        'category': 'Vague/Undefined',
        'replacements': ['project-specific configuration', 'custom implementation'],
        'confidence': 0.5
    },
    'talks to': {
        'category': 'Ambiguous Mechanisms',
        'replacements': ['sends requests to', 'calls via REST/gRPC', 'publishes messages to'],
        'confidence': 0.7
    },
    'syncs with': {
        'category': 'Ambiguous Mechanisms',
        'replacements': ['replicates state via', 'polls for changes from', 'streams updates from'],
        'confidence': 0.7
    },
    'magic': {
        'category': 'Poetic/Metaphorical',
        'replacements': ['algorithmic', 'heuristic', 'rule-based'],
        'confidence': 0.8
    },
    'helper': {
        'category': 'Vague/Undefined',
        'replacements': ['parser', 'validator', 'serializer', 'service'],
        'confidence': 0.5
    },
    'wrapper': {
        'category': 'Vague/Undefined',
        'replacements': ['adapter', 'decorator', 'facade', 'proxy'],
        'confidence': 0.6
    },
    'seamless': {
        'category': 'Poetic/Metaphorical',
        'replacements': ['automated', 'integrated', 'synchronized'],
        'confidence': 0.7
    },
    'blackbox': {
        'category': 'Poetic/Metaphorical',
        'replacements': ['encapsulated module', 'closed-source service'],
        'confidence': 0.8
    },
    'leverage': {
        'category': 'Overloaded/Ambiguous',
        'replacements': ['utilize', 'call', 'invoke', 'incorporate'],
        'confidence': 0.7
    },
    'robust': {
        'category': 'Marketing/Hype',
        'replacements': ['fault-tolerant', 'redundant', 'exception-safe'],
        'confidence': 0.6
    },
    'scalable': {
        'category': 'Marketing/Hype',
        'replacements': ['horizontally scaled', 'stateless', 'load-balanced'],
        'confidence': 0.6
    },
    'flexible': {
        'category': 'Marketing/Hype',
        'replacements': ['configurable', 'customizable', 'extensible'],
        'confidence': 0.5
    },
    'intelligent': {
        'category': 'Marketing/Hype',
        'replacements': ['rule-based', 'automated', 'data-driven'],
        'confidence': 0.5
    },
    'smart': {
        'category': 'Marketing/Hype',
        'replacements': ['rule-based', 'automated', 'data-driven'],
        'confidence': 0.5
    },
    'engine': {
        'category': 'Overloaded/Ambiguous',
        'replacements': ['processor', 'orchestrator', 'pipeline'],
        'confidence': 0.5
    },
    'platform': {
        'category': 'Overloaded/Ambiguous',
        'replacements': ['framework', 'service suite', 'infrastructure'],
        'confidence': 0.4
    },
    'infrastructure': {
        'category': 'Overloaded/Ambiguous',
        'replacements': ['host environment', 'deployment stack'],
        'confidence': 0.4
    },
    'handshake': {
        'category': 'Poetic/Metaphorical',
        'replacements': ['negotiation', 'synchronization', 'auth flow'],
        'confidence': 0.6
    },
    'synergy': {
        'category': 'Marketing/Hype',
        'replacements': ['coordination', 'integration', 'collaboration'],
        'confidence': 0.7
    },
    'frictionless': {
        'category': 'Marketing/Hype',
        'replacements': ['automated', 'direct', 'optimized'],
        'confidence': 0.7
    },
    'optimal': {
        'category': 'Marketing/Hype',
        'replacements': ['efficient', 'maximized', 'tuned'],
        'confidence': 0.5
    },
    'efficient': {
        'category': 'Marketing/Hype',
        'replacements': ['optimized', 'low-latency', 'resource-efficient'],
        'confidence': 0.5
    },
    'stuff': {
        'category': 'Vague/Undefined',
        'replacements': ['attributes', 'parameters', 'data properties'],
        'confidence': 0.4
    },
    'thing': {
        'category': 'Vague/Undefined',
        'replacements': ['entity', 'component', 'object'],
        'confidence': 0.4
    },
    'util': {
        'category': 'Vague/Undefined',
        'replacements': ['utility function', 'helper library'],
        'confidence': 0.5
    },
    'stores': {
        'category': 'Ambiguous Mechanisms',
        'replacements': ['persists to disk via', 'writes to database', 'caches in memory'],
        'confidence': 0.5
    }
}

DEFAULT_RETIRED_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'references',
    'retired-terms-default.txt'
)

def load_retired_terms(retired_terms_path=None):
    path = retired_terms_path or DEFAULT_RETIRED_PATH
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            terms = [line.strip().lower() for line in f if line.strip()]
            # Sort longer terms first to match multi-word phrases correctly
            return sorted(list(set(terms)), key=len, reverse=True)
    return sorted(list(MAPPINGS.keys()), key=len, reverse=True)

def _strip_code_constructs(line):
    """Remove fenced code block markers, inline code, and blockquote prefixes."""
    # Strip blockquote prefix
    stripped = re.sub(r'^(\s*>\s*)+', '', line)
    # Strip inline code spans
    stripped = re.sub(r'`[^`]*`', '', stripped)
    return stripped

def _deduplicate_by_span(matches):
    """Remove matches whose character spans are fully contained within a longer match."""
    if not matches:
        return matches
    # Sort by span start, then by span length descending (longer first)
    sorted_matches = sorted(matches, key=lambda m: (m['_start'], -(m['_end'] - m['_start'])))
    deduplicated = []
    for match in sorted_matches:
        # Check if this match's span overlaps with any already-kept match
        is_subsumed = False
        for kept in deduplicated:
            # If the current match's span is fully within a kept match's span, skip it
            if match['_start'] >= kept['_start'] and match['_end'] <= kept['_end']:
                is_subsumed = True
                break
        if not is_subsumed:
            deduplicated.append(match)
    return deduplicated

def audit_text(text, filename="stdin", retired_terms=None, skip_code_blocks=False):
    if retired_terms is None:
        retired_terms = load_retired_terms()
        
    findings = []
    lines = text.splitlines()
    in_fenced_block = False
    
    for idx, line in enumerate(lines, 1):
        # Track fenced code blocks when --skip-code-blocks is enabled
        if skip_code_blocks:
            if re.match(r'^\s*```', line):
                in_fenced_block = not in_fenced_block
                continue
            if in_fenced_block:
                continue
        
        # Determine which text to scan
        scan_line = _strip_code_constructs(line) if skip_code_blocks else line
        
        # Collect all matches for this line with their character spans
        line_matches = []
        
        # Scan each retired term in the line
        for term in retired_terms:
            # Word boundary check for multi-word or single-word terms
            pattern = re.compile(r'\b' + re.escape(term) + r'\b', re.IGNORECASE)
            matches = pattern.finditer(scan_line)
            for m in matches:
                start, end = m.span()
                # Snippet formatting
                snippet = line.strip()
                
                # Fetch mappings data or build defaults
                mapping = MAPPINGS.get(term.lower(), {
                    'category': 'Vague/Undefined',
                    'replacements': ['custom implementation details'],
                    'confidence': 0.5
                })
                
                line_matches.append({
                    'file_path': filename,
                    'line_number': idx,
                    'term': m.group(0),
                    'category': mapping['category'],
                    'context_snippet': snippet,
                    'replacement': ', '.join(mapping['replacements']),
                    'confidence': mapping['confidence'],
                    '_start': start,
                    '_end': end
                })
        
        # Deduplicate overlapping spans (longer match wins)
        line_matches = _deduplicate_by_span(line_matches)
        
        # Strip internal span fields before adding to findings
        for match in line_matches:
            del match['_start']
            del match['_end']
            findings.append(match)
                
    return findings

def scan_path(target_path, retired_terms, exclude_patterns=None, skip_code_blocks=False):
    findings = []
    if os.path.isfile(target_path):
        # Check file-level exclusions
        if exclude_patterns and _is_excluded(target_path, exclude_patterns):
            return findings
        try:
            with open(target_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            findings.extend(audit_text(content, target_path, retired_terms, skip_code_blocks))
        except Exception as e:
            sys.stderr.write(f"Error reading file {target_path}: {e}\n")
    elif os.path.isdir(target_path):
        for root, dirs, files in os.walk(target_path):
            # Skip all hidden directories (starting with '.')
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            
            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in ['.md', '.txt', '.py', '.js', '.json', '.ts', '.html']:
                    full_path = os.path.join(root, file)
                    if exclude_patterns and _is_excluded(full_path, exclude_patterns):
                        continue
                    findings.extend(scan_path(full_path, retired_terms, exclude_patterns, skip_code_blocks))
    return findings

def _is_excluded(filepath, exclude_patterns):
    """Check if a filepath matches any of the exclude glob patterns."""
    for pattern in exclude_patterns:
        if fnmatch.fnmatch(filepath, pattern) or fnmatch.fnmatch(os.path.basename(filepath), pattern):
            return True
    return False

def main():
    parser = argparse.ArgumentParser(description="Audit codebase files or stdin for fuzzy/retired terminology.")
    parser.add_argument('--path', type=str, help="Path to file or directory to scan. Reads stdin if not provided or set to '-'.")
    parser.add_argument('--json', action='store_true', help="Output findings in JSON format instead of a Markdown table.")
    parser.add_argument('--ledger', type=str, help="Optional output JSON path to save the terminology ledger.")
    parser.add_argument('--exclude', nargs='+', type=str, default=[], help="Glob patterns for files/directories to exclude (e.g., 'node_modules/*' 'vendor/*').")
    parser.add_argument('--retired-terms', type=str, dest='retired_terms', help="Path to a custom retired terms file. Defaults to references/retired-terms-default.txt.")
    parser.add_argument('--skip-code-blocks', action='store_true', dest='skip_code_blocks', help="Skip fenced code blocks, inline code, and blockquote prefixes when scanning.")
    
    args = parser.parse_args()
    retired_terms = load_retired_terms(args.retired_terms)
    
    if not args.path or args.path == '-':
        text = sys.stdin.read()
        findings = audit_text(text, "stdin", retired_terms, args.skip_code_blocks)
    else:
        if not os.path.exists(args.path):
            sys.stderr.write(f"Error: Path {args.path} does not exist.\n")
            sys.exit(1)
        findings = scan_path(args.path, retired_terms, args.exclude, args.skip_code_blocks)
        
    if args.ledger:
        try:
            with open(args.ledger, 'w', encoding='utf-8') as lf:
                json.dump(findings, lf, indent=2)
        except Exception as e:
            sys.stderr.write(f"Failed to write ledger to {args.ledger}: {e}\n")
            
    if args.json:
        print(json.dumps(findings, indent=2))
    else:
        if not findings:
            print("PASSED: No fuzzy, metaphorical, or retired terms identified.")
        else:
            print("| Location | Term | Category | Context Snippet | Proposed Replacement | Confidence |")
            print("| :--- | :--- | :--- | :--- | :--- | :--- |")
            for f in findings:
                # Escape markdown table characters
                snippet = f['context_snippet'].replace('|', '\\|')
                location = f"{os.path.basename(f['file_path'])}:L{f['line_number']}" if f['file_path'] != "stdin" else f"stdin:L{f['line_number']}"
                print(f"| `{location}` | `{f['term']}` | {f['category']} | `{snippet}` | `{f['replacement']}` | {f['confidence']} |")

if __name__ == '__main__':
    main()
