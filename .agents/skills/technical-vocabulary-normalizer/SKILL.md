---
name: technical-vocabulary-normalizer
description: "Normalize fuzzy, poetic, or informal terminology in architecture ideations into precise, standard technical vocabulary."
---

# Technical Vocabulary Normalizer

Rather than telling ChatGPT to stop with the fuzzy poetic terminology in our architecture ideations and making it 'a thing', this skill is created for taking fuzzy vocabulary from LLM chat ideations turned into architecture and making terms and loose values technical and meaningful based on the context of the chat/architecture.

## Role
You are the Technical Vocabulary Normalizer. Your job is to translate fuzzy, poetic, or overloaded LLM ideation language into precise, concrete, and project-specific software architecture terminology.

## Scope Guardrails
**CRITICAL**: Do NOT alter the underlying architectural design, logic, or components. Your sole responsibility is to normalize the *words describing the architecture*, not the architecture itself.

## Operating Modes
When invoked, operate in one of the following modes based on the user's request:
* **Audit Mode**: Read the context, identify fuzzy terms using the references, and output the `AuditTable`. Make NO changes to the text.
* **Edit Mode**: Require explicit Human-in-the-Loop (HITL) approval from the user on the Audit Table. Once approved, replace fuzzy terms with technical equivalents. Preserve original quotes as evidence where helpful.
* **Validate Mode**: Scan existing documentation against `retired-terms-default.txt` (or run `validate_terms.py`) to flag regressions.

## Pre-Audit Steps
Before performing any audit, edit, or validation, you **MUST**:
1. Read `references/fuzzy-term-taxonomy.md` to load the current term categories and classification criteria.
2. Read `references/replacement-rules.md` to load the standard term mappings and contextual guidance.
3. Read `references/retired-terms-default.txt` to load the current retired terms list.

These references are your source of truth for identifying and replacing terms. Do not rely on memory or assumptions.

## Workflow Overview

```mermaid
flowchart TD
    User["User request: audit or normalize unclear terminology"] --> Trigger["Skill trigger: technical vocabulary normalization"]
    Trigger --> Core["SKILL.md: core operating workflow"]
    
    Core --> PreAudit["Pre-Audit: Read References (Taxonomy, Rules, Retired Terms)"]
    PreAudit --> Modes["Operating modes"]
    Modes --> Audit["Audit only"]
    Modes --> Edit["Edit mode"]
    Modes --> Validate["Validation mode"]
    
    Core --> Context["Read target context"]
    Context --> Detect["Identify fuzzy, private, overloaded, or undefined terms"]
    Detect --> Taxonomy["Classify issue type using fuzzy-term taxonomy"]
    Taxonomy --> Meaning["Infer concrete system meaning"]
    Meaning --> Normalize["Propose precise technical wording"]
    Normalize --> LocalCheck["Check project-local vocabulary and meaning"]
    LocalCheck --> Evidence["Produce evidence-backed output"]
    
    Evidence --> AuditTable["Audit table: location, term, category, context snippet, replacement, confidence"]
    Evidence --> Ledger["Optional term ledger entry"]
    
    Core --> Resources["Bundled resources"]
    Resources --> TaxonomyRef["references/fuzzy-term-taxonomy.md"]
    Resources --> RulesRef["references/replacement-rules.md"]
    Resources --> LedgerRef["references/output-ledger-schema.md"]
    Resources --> RetiredList["references/retired-terms-default.txt"]
    Resources --> AuditScript["scripts/audit_terms.py"]
    Resources --> ValidateScript["scripts/validate_terms.py"]
    
    RetiredList --> CandidateRule["Retired terms are starter candidates, not global bans"]
    CandidateRule --> LocalCheck
    
    AuditScript --> FirstPass["First-pass candidate scan"]
    ValidateScript --> RetiredScan["Retired-term validation scan"]
    
    Edit --> Apply["Apply consistent replacements when requested"]
    Apply --> Preserve["Preserve quoted source evidence"]
    Preserve --> Revalidate["Re-scan for ambiguity or retired terms"]
    
    Validate --> Revalidate
    Revalidate --> Result["Public, precise, reusable terminology"]
``` 