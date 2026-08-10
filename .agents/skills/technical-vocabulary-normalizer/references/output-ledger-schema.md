# Output Ledger Schema

This document specifies the schema layout for the Terminology Ledger (represented in JSON format) to log audit decisions, replaced terms, and confidence mappings.

## JSON Schema Specification

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "TerminologyLedger",
  "description": "Ledger cataloging replaced terms and their normalized technical replacements.",
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "file_path": {
        "type": "string",
        "description": "Path to the audited file relative to workspace root."
      },
      "line_number": {
        "type": "integer",
        "description": "The 1-indexed line number containing the term."
      },
      "term": {
        "type": "string",
        "description": "The exact fuzzy, metaphorical, or retired term identified."
      },
      "category": {
        "type": "string",
        "enum": [
          "Poetic/Metaphorical",
          "Private/Jargon",
          "Overloaded/Ambiguous",
          "Vague/Undefined",
          "Marketing/Hype",
          "Ambiguous Mechanisms"
        ],
        "description": "Category classification based on the Fuzzy-Term Taxonomy."
      },
      "context_snippet": {
        "type": "string",
        "description": "The surrounding code or text context containing the term."
      },
      "replacement": {
        "type": "string",
        "description": "The proposed precise technical term replacement."
      },
      "reasoning": {
        "type": "string",
        "description": "Rationale for choosing this replacement."
      },
      "confidence": {
        "type": "number",
        "minimum": 0.0,
        "maximum": 1.0,
        "description": "Confidence level in this replacement mapping (0.0 to 1.0)."
      }
    },
    "required": [
      "file_path",
      "line_number",
      "term",
      "category",
      "context_snippet",
      "replacement",
      "confidence"
    ]
  }
}
```

## Markdown Audit Table Equivalent
When scripts output markdown reports directly in consoles or logs, they must match the following table layout:

| Location | Term | Category | Context Snippet | Replacement | Confidence |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `path/to/file.md:L12` | `magic sauce` | `Poetic/Metaphorical` | `...contains the magic sauce to parse...` | `parsing heuristics` | `0.9` |
