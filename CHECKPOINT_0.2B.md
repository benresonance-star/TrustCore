# Checkpoint 0.2B — hardened ZIP64 container

Release 0.2B binds the deterministic 0.2A logical archive to a real
`.trustarchive` ZIP64 container.

## Implemented in source

- deterministic ZIP64 writing with stable entry order and timestamps;
- strict central-directory and local-header ambiguity checks;
- CRC/signature and overlapping-entry checks during extraction;
- path traversal, absolute path, drive path and backslash rejection;
- duplicate, directory, encrypted, symbolic-link and unsupported-compression
  rejection;
- compressed-container, entry, total expansion and compression-ratio limits;
- extracted-size verification;
- logical SHA-256 verification remains mandatory after container parsing;
- Ivan's Diary and WeSketch round-trip through the same container and verifier.

## Candidate status

Source tests prove small deterministic fixtures and constructed negative cases.
They do not prove multi-gigabyte ZIP64 behavior, parser behavior across operating
systems, fuzz resistance, streaming memory bounds or live import safety.

## PC/Docker acceptance gate

- create and read a ZIP64 archive crossing a classic ZIP size/count boundary;
- run the malicious-container corpus, including duplicate/ambiguous headers,
  overlap, symlink, encryption, traversal and decompression bombs;
- measure peak memory and confirm bounded streaming behavior;
- export Ivan's Diary and WeSketch from live PostgreSQL/MinIO;
- verify with a process independent of the Trust API;
- retain the report against the exact clean commit.

Checkpoint 0.2C may implement dry-run import planning in source. Release 0.2 is
not complete until 0.2D reconstructs clean stores after source destruction.
