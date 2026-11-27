// The Pieces of the stack: each one's identity once, read from piece-manifest.ts. Pure data
// access; imports nothing but the manifest.
import { type PieceEntry, pieceManifest } from "./piece-manifest.ts";

// Every Piece of the stack a Project may remove with pnpm piece-remove. A Piece is an entry of
// pieceManifest, so adding one is pnpm piece-add (docs/agents/pieces.md).
export type Piece = keyof typeof pieceManifest;

export const pieceNames = Object.keys(pieceManifest) as Piece[];

export const pieceIsKnown = (name: string): name is Piece =>
	(pieceNames as readonly string[]).includes(name);

// Each Piece's identity: its packages, its folder and the Pieces that must go first. Typed as one
// shape, so a lookup by any Piece type-checks.
type PieceIdentity = Omit<PieceEntry, "after"> & { after?: readonly Piece[] };
export const pieces: Record<Piece, PieceIdentity> = pieceManifest;

// What tells a Piece is in a Project: its folder, else its first package.
export const pieceSign = (piece: Piece): string =>
	pieces[piece].folder ?? pieces[piece].packages[0] ?? "";
