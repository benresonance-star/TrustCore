# ADR-014: Archive logical model before container binding

Status: accepted.

Trust Core defines and verifies a deterministic logical archive entry set before
binding it to ZIP64. This separates canonical records, checksums, path safety and
reference validation from parser-specific security behavior. ZIP64 assembly and
malicious-container defenses remain mandatory at checkpoint 0.2B; an entry set
alone is not a `.trustarchive` portability proof.
