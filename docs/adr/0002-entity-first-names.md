# Name every export entity first

Status: accepted, 2026-11-04

Every exported function in baseline and its Projects reads generic to specific: scope, subject, then action or qualifier (`invoiceCreate`, `postgresPoolCreate`), never verb first (`createInvoice`). A factory ends in `Create`, a predicate in `Is`, `Has` or `Can`, and a file is named after its main export in kebab case. We chose it over verb first because baseline already followed it in 237 of 241 exports, it groups related names in autocomplete and file lists, and an agent's verb-first habit is caught by architecture rule A23 instead of by review. React hooks, components, React Router's framework exports and a library's own names keep their usual form.
