import { createContext } from "react";

/**
 * The request's CSP nonce, for an inline script a component renders itself. entry.server.tsx
 * provides it. In the browser it is undefined: the server-rendered script has already run.
 */
export const CspNonce = createContext<string | undefined>(undefined);
