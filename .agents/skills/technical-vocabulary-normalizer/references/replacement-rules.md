# Replacement Rules & Mapping Guidelines

This document provides guidance on mapping identified fuzzy or retired terms to standard, precise technical terminology based on their structural role.

## Standard Mappings

| Retired Term | Category | Proposed Alternatives | Contextual Guidance |
| :--- | :--- | :--- | :--- |
| `magic` | Metaphorical | `algorithmic`, `heuristic`, `rule-based` | Detail the actual calculation or rule structure instead of hand-waving. |
| `helper` | Vague | `parser`, `validator`, `serializer`, `factory` | Name the class/function based on the exact single responsibility it executes. |
| `wrapper` | Vague | `adapter`, `decorator`, `facade`, `proxy` | Map to standard Gang of Four structural design patterns matching the wrapper's design. |
| `seamless` | Metaphorical | `automated`, `integrated`, `synchronized` | Clarify the integration mechanism (e.g., "automatically syncs database states via CDC"). |
| `blackbox` | Metaphorical | `encapsulated module`, `closed-source service` | Describe the interface boundaries and why the internals are private. |
| `leverage` | Overloaded | `utilize`, `call`, `invoke`, `incorporate` | Use the exact operation action performed (e.g. "invokes the database connection pool"). |
| `robust` | Marketing | `fault-tolerant`, `redundant`, `exception-safe` | Specify the exact resilience mechanism (e.g., "implements exponential backoff retries"). |
| `scalable` | Marketing | `horizontally scaled`, `stateless`, `load-balanced` | Define the scale metrics and architecture type (e.g. "stateless auto-scaling groups"). |

## Mapping Process

1. **Analyze Responsibility**: Determine what the component actually *does* (e.g. parse, format, route).
2. **Apply Design Patterns**: Look for industry-standard design patterns (e.g., Factory, Adapter, Strategy) that describe the mechanism.
3. **Specify Constraints**: Quantify vague adjectives (e.g., instead of "highly performant", write "maintains latencies under 50ms at 10k RPS").
4. **Preserve Context**: Ensure the proposed replacement aligns with local variable names and workspace conventions.
