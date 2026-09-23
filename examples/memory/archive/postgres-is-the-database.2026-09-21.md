---
name: postgres-is-the-database
type: decision
description: Alpha stores its data in PostgreSQL 16
effective_from: 2026-03-04
effective_to: 2026-09-21
superseded_by: sqlite-is-the-database
source: decision in the 2026-03-04 architecture call
---

Alpha runs on PostgreSQL 16, hosted on the primary VM, not managed.

Chosen over SQLite because three services were expected to write concurrently.
