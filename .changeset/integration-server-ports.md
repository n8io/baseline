---
"app": patch
---

Integration tests no longer fail now and then because a production server exits at startup. Each Vitest worker now takes the ports for the servers it starts from its own block below the kernel's ephemeral range. Before, it asked the kernel for a free port and released it, and another process could take that port before the server bound it. A server that exits before it is ready now fails the test with its exit code, signal, stdout and stderr, and the server under test logs at `fatal`, so its crash log is in that report.
