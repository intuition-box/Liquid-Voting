#!/usr/bin/env python3
"""Generate docs/scope-check.excalidraw — how a delegation's scope is checked against the graph.

The companion to delegation-flow: that one shows who signs and who executes, this one
shows the question the enforcer actually asks, hop by hop, and why the answer has to come
from live vault state rather than from anything the redeemer said.
"""
import json

ELS = []
_id = [0]
TS = 1756400000000

INK = "#1e1e1e"
DIM = "#5c5f66"
OK = "#2b8a3e"
BAD = "#c92a2a"
CHAIN = "#e5dbff"   # on-chain contracts
OURS = "#ffd8a8"    # the enforcer we wrote
CLIENT = "#d0ebff"  # client-side discovery
VAULT = "#d3f9d8"   # the MultiVault, the authority on the graph


def nid():
    _id[0] += 1
    return f"el{_id[0]:04d}"


def common(**kw):
    base = {
        "id": nid(), "angle": 0, "strokeColor": INK, "backgroundColor": "transparent",
        "fillStyle": "solid", "strokeWidth": 1, "strokeStyle": "solid", "roughness": 1,
        "opacity": 100, "groupIds": [], "frameId": None, "roundness": None,
        "seed": _id[0] * 7919 + 13, "version": 1, "versionNonce": _id[0] * 104729 + 7,
        "isDeleted": False, "boundElements": None, "updated": TS, "link": None, "locked": False,
    }
    base.update(kw)
    return base


def rect(x, y, w, h, bg, stroke=INK, opacity=100, dashed=False, rounded=True):
    e = common(type="rectangle", x=x, y=y, width=w, height=h, backgroundColor=bg,
               strokeColor=stroke, opacity=opacity,
               strokeStyle="dashed" if dashed else "solid",
               roundness={"type": 3} if rounded else None)
    ELS.append(e)
    return e


def text(x, y, s, size=16, family=2, align="left", color=INK):
    lines = s.split("\n")
    lh = 1.25
    w = max(len(l) for l in lines) * size * 0.6 + 4
    h = len(lines) * size * lh
    e = common(type="text", x=x, y=y, width=w, height=h, text=s, fontSize=size,
               fontFamily=family, textAlign=align, verticalAlign="top",
               containerId=None, originalText=s, autoResize=True, lineHeight=lh,
               strokeColor=color)
    ELS.append(e)
    return e


def ctext(cx, y, s, size=16, family=2, color=INK):
    lines = s.split("\n")
    w = max(len(l) for l in lines) * size * 0.6 + 4
    return text(cx - w / 2, y, s, size=size, family=family, align="center", color=color)


def box(x, y, w, s, bg, size=13, color=INK, pad=10, stroke=INK, dashed=False):
    lines = s.split("\n")
    h = len(lines) * size * 1.25 + 2 * pad
    rect(x, y, w, h, bg, stroke=stroke, dashed=dashed)
    ctext(x + w / 2, y + pad, s, size=size, color=color)
    return h


def arrow(x1, y1, x2, y2, color=INK, dashed=False, width=1, head="arrow"):
    e = common(type="arrow", x=x1, y=y1, width=abs(x2 - x1), height=abs(y2 - y1),
               points=[[0, 0], [x2 - x1, y2 - y1]],
               lastCommittedPoint=None, startBinding=None, endBinding=None,
               startArrowhead=None, endArrowhead=head, strokeColor=color,
               strokeStyle="dashed" if dashed else "solid", strokeWidth=width,
               elbowed=False)
    ELS.append(e)
    return e


# ── Title ────────────────────────────────────────────────────────────────────────
text(60, 40, "How a delegation's scope is checked against the graph", size=28)
text(60, 82, "Discovery is client-side because the MultiVault has no reverse index; verification is on-chain because the witness is untrusted.  (ADR 0003)",
     size=14, color=DIM)

# ── Signed terms, the fixed half ─────────────────────────────────────────────────
text(60, 150, "1 · What was signed, once", size=18)
box(60, 185, 420,
    "caveat terms — immutable from the moment they are signed\n\n"
    "rootDomainId   treasury          the delegated domain\n"
    "predicateId    is a sub-domain of\n"
    "maxDepth       5                 hop cap\n"
    "attestor       curator           whose stake counts",
    OURS, size=13)

text(520, 150, "2 · What the redeemer supplies, per vote", size=18)
box(520, 185, 430,
    "caveat.args — a path witness, outside the signed hash\n\n"
    "[ micro-grants, builder-grants, grants, treasury ]\n\n"
    "Outside the hash on purpose: that is what lets a\n"
    "delegation signed yesterday cover a domain minted today.",
    CLIENT, size=13)

# ── The check ────────────────────────────────────────────────────────────────────
text(60, 360, "3 · What the enforcer checks, per delegation in the chain", size=18)
text(60, 388, "beforeHook — per delegation, not once per redemption. That is what makes narrowing emergent (ADR 0007).",
     size=13, color=DIM)

y = 425
gates = [
    ("Execution shape", "target = the bound governor, selector = castVoteFor,\nand `voter` in the calldata must be the redeemer", "InvalidTarget · InvalidSelector · VoterIsNotRedeemer"),
    ("Which domain?", "vote calldata carries a proposal id, not a domain —\nso the domain is read back: governor.proposalDomain(id)", "UnresolvedProposalDomain"),
    ("Witness shape", "non-empty, and hops ≤ maxDepth\n(which also bounds the loop below)", "EmptyPath · PathTooLong"),
    ("Both endpoints", "path[0] = the proposal's domain\npath[last] = the delegated domain", "PathStartMismatch · PathEndMismatch"),
]
for name, body, errs in gates:
    rect(60, y, 200, 62, "#f8f9fa")
    ctext(160, y + 20, name, size=14)
    text(280, y + 8, body, size=13)
    text(280, y + 44, errs, size=11, color=BAD)
    y += 76

text(60, y + 8, "The two endpoints are the anchor: one is fixed by the governor, the other by the signature.", size=13, color=DIM)
text(60, y + 28, "A redeemer cannot invent a path — only choose which real one to present.", size=13, color=DIM)

# ── Hop by hop ───────────────────────────────────────────────────────────────────
hy = y + 80
text(60, hy, "4 · Then every hop, against live vault state", size=18)

path = ["micro-grants", "builder-grants", "grants", "treasury"]
x = 60
node_w = 150
for i, label in enumerate(path):
    box(x, hy + 45, node_w, label, VAULT if i in (0, len(path) - 1) else "#f8f9fa", size=13)
    if i < len(path) - 1:
        arrow(x + node_w + 6, hy + 62, x + node_w + 44, hy + 62)
    x += node_w + 50

text(60, hy + 105, "path[0] — the proposal's domain", size=11, color=DIM)
text(660, hy + 105, "path[last] — what was delegated", size=11, color=DIM)

qy = hy + 145
box(60, qy, 890,
    "for each consecutive pair:   tripleId = MultiVault.calculateTripleId(child, predicate, parent)\n\n"
    "①  getVaultType(tripleId) == 1 ?          a positive triple — not an atom, not a counter-triple\n"
    "                                            (the vault REVERTS for a term never created — caught, becomes NotATriple)\n"
    "②  getShares(attestor, tripleId) > 0 ?    the attestor holds a position on this edge",
    CHAIN, size=13)

text(60, qy + 130, "① NotATriple      ② NotAttested", size=13, color=BAD)
text(360, qy + 130, "The witness is never believed. It says where to look; every claim is recomputed.", size=13, color=DIM)

# ── Why stake ────────────────────────────────────────────────────────────────────
wy = qy + 175
box(60, wy, 430,
    "Why stake, and not existence  (ADR 0004)\n\n"
    "Minting is permissionless: anyone can create\n"
    "`events — is a sub-domain of — treasury`\n"
    "for a fraction of a cent. If existence were enough,\n"
    "widening someone's delegation would cost that much.",
    "#fff5f5", size=13, stroke=BAD)

box(520, wy, 430,
    "Whose stake is a signed field\n\n"
    "an org address  →  institutional curation\n"
    "address(0)      →  resolves to the delegator, so every\n"
    "                    level reads the graph through its own\n"
    "                    signer's view of it",
    "#fff9db", size=13)

# ── The two properties ───────────────────────────────────────────────────────────
py = wy + 150
text(60, py, "5 · What follows from checking live state", size=18)

box(60, py + 40, 430,
    "Widening — nothing is stored\n\n"
    "Stake a new edge under treasury and every delegation\n"
    "scoped there covers it immediately. No redeploy, no new\n"
    "signature: the next check simply reads a graph that moved.",
    "#ebfbee", size=13, stroke=OK)

box(520, py + 40, 430,
    "Narrowing — nobody coded it\n\n"
    "beforeHook runs per level, so a vote through A→B (treasury)\n"
    "and B→C (grants) needs a valid witness for each. The\n"
    "intersection is the narrowing — it falls out of the hook.",
    "#ebfbee", size=13, stroke=OK)

out = {
    "type": "excalidraw", "version": 2, "source": "https://excalidraw.com",
    "elements": ELS,
    "appState": {"gridSize": None, "viewBackgroundColor": "#ffffff"},
    "files": {},
}
with open("docs/scope-check.excalidraw", "w") as f:
    json.dump(out, f, indent=2)
print(f"docs/scope-check.excalidraw — {len(ELS)} elements")
