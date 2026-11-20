# No translations in the Template until a Project needs a second language

Status: accepted, 2026-11-14

No Project needs a second language, and translation cannot be a removable piece, because it touches every UI string. Waiting is safe: Problem bodies carry an error `type`, not text, so every word a person reads already lives in the UI. When a Project needs it, it adds i18next with react-i18next and remix-i18next as a recipe inside `src/ui/` only, not as a Package (hiding i18next would rebuild its typed keys) and not as a piece; check remix-i18next against the current React Router on that day.
