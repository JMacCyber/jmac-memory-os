---
name: sqlite-is-the-database
type: decision
description: Alpha stores its data in SQLite, one writer
effective_from: 2026-09-21
source: migration completed 2026-09-21
supersedes: postgres-is-the-database
---

Alpha runs on SQLite with WAL enabled. One writer process, readers unlimited.

Moved off PostgreSQL because concurrent writes turned out to be one service,
not three. Measured: peak 4 writes per second.

Related: [[ships-on-fridays]]
