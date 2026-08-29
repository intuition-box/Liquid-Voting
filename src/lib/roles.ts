/**
 * The three demo identities.
 *
 * Their own module because both sides need them: the panels and the CLI scripts. Keeping
 * them in app-config would drag `import.meta.glob` into anything Node runs, which is
 * exactly why the list used to be written out in four places instead.
 *
 * A, B and C rather than voter/delegate/executor: those names fixed a role that stopped
 * being fixed once voices were split out. B is a delegate of A and a delegator to C at
 * the same time, and any account can be either. The letters name who, not what they do —
 * which also means a role is its own label, so there is no lookup table for the names.
 */
export type Role = "A" | "B" | "C";

/** In the order every list of them is written. */
export const ROLES: Role[] = ["A", "B", "C"];

/** One colour per identity, so a role reads the same everywhere it appears. */
export const ROLE_CLASS: Record<Role, string> = { A: "role-a", B: "role-b", C: "role-c" };
