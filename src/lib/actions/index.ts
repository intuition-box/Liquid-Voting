/**
 * The service layer, by what it does: casting a vote, handing a domain on, growing the
 * graph. No React, no DOM — each function takes the config plus its inputs and returns
 * data, so the panels and the CLI scripts drive the very same code.
 */
export { DEFAULT_MAX_DEPTH } from "./common";
export * from "./voting";
export * from "./delegating";
export * from "./graph-editing";
