# A function never edits its inputs: rule A30

Status: accepted, 2026-11-21

Code could take its inputs by reference and change them, or return a new value and leave the caller's alone. Nate prefers the functional shape: a function that changes a parameter is hard to troubleshoot, because an error shows only the state after it. Architecture rule A30 fails a function that assigns to a property of a parameter, deletes one, calls push, pop, shift, unshift, splice, sort, reverse, fill or copyWithin on a parameter or its property, or passes it to `Object.assign`; Map and Set methods are not listed. A change that must happen (a Node server's setters, an OpenTelemetry attribute object, the memory transaction's commit) says why in a one-line `// mutates: <why, 3+ words>` above it.
