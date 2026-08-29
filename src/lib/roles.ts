/**
 * The three demo identities.
 *
 * Their own module because both sides need them: the panels and the CLI scripts. Keeping
 * them in demo-config would drag `import.meta.glob` into anything Node runs, which is
 * exactly why the list used to be written out in four places instead.
 */
export type Role = "voter" | "delegate" | "executor";

/** In the order every list of them is written. */
export const ROLES: Role[] = ["voter", "delegate", "executor"];

/** The short name each identity carries in the UI. */
export const ROLE_LABELS: Record<Role, string> = { voter: "A", delegate: "B", executor: "C" };

/** One colour per identity, so a role reads the same everywhere it appears. */
export const ROLE_CLASS: Record<Role, string> = { voter: "role-a", delegate: "role-b", executor: "role-c" };
