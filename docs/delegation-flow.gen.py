#!/usr/bin/env python3
"""Generate docs/delegation-flow.excalidraw — the Phase 3 signature/execution flow."""
import json

ELS = []
_id = [0]
TS = 1755500000000

def nid():
    _id[0] += 1
    return f"el{_id[0]:04d}"

def common(**kw):
    base = {
        "id": nid(), "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent",
        "fillStyle": "solid", "strokeWidth": 1, "strokeStyle": "solid", "roughness": 1,
        "opacity": 100, "groupIds": [], "frameId": None, "roundness": None,
        "seed": _id[0] * 7919 + 13, "version": 1, "versionNonce": _id[0] * 104729 + 7,
        "isDeleted": False, "boundElements": None, "updated": TS, "link": None, "locked": False,
    }
    base.update(kw)
    return base

def rect(x, y, w, h, bg, stroke="#1e1e1e", opacity=100, dashed=False, rounded=True):
    e = common(type="rectangle", x=x, y=y, width=w, height=h, backgroundColor=bg,
               strokeColor=stroke, opacity=opacity,
               strokeStyle="dashed" if dashed else "solid",
               roundness={"type": 3} if rounded else None)
    ELS.append(e)
    return e

def text(x, y, s, size=16, family=2, align="left", color="#1e1e1e", bold=False):
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

def ctext(cx, y, s, size=16, family=2, color="#1e1e1e"):
    lines = s.split("\n")
    w = max(len(l) for l in lines) * size * 0.6 + 4
    return text(cx - w / 2, y, s, size=size, family=family, align="center", color=color)

def box(cx, y, w, s, bg, size=14, family=2, color="#1e1e1e", pad=10):
    lines = s.split("\n")
    h = len(lines) * size * 1.25 + 2 * pad
    rect(cx - w / 2, y, w, h, bg)
    ctext(cx, y + pad, s, size=size, family=family, color=color)
    return y + h

def arrow(x1, y1, x2, y2, color="#1e1e1e", dashed=False, width=1):
    e = common(type="arrow", x=x1, y=y1, width=abs(x2 - x1), height=abs(y2 - y1),
               points=[[0, 0], [x2 - x1, y2 - y1]],
               lastCommittedPoint=None, startBinding=None, endBinding=None,
               startArrowhead=None, endArrowhead="arrow", strokeColor=color,
               strokeStyle="dashed" if dashed else "solid", strokeWidth=width,
               elbowed=False)
    ELS.append(e)
    return e

def step(x1, x2, y, label, color="#1e1e1e", size=13, dashed=False, width=1):
    """Horizontal message arrow with a label above its midpoint."""
    arrow(x1, y, x2, y, color=color, dashed=dashed, width=width)
    ctext((x1 + x2) / 2, y - 8 - size * 1.25 * len(label.split("\n")), label, size=size, family=2, color=color)

# ── Lanes ────────────────────────────────────────────────────────────────────────
LANES = [
    ("Voter\nowner EOA", 150, "#eeeeee"),
    ("Voter SA\nHybridDeleGator", 350, "#d0ebff"),
    ("Delegate\nowner EOA", 550, "#eeeeee"),
    ("Delegate SA\nHybridDeleGator", 750, "#d0ebff"),
    ("Executor SA\nHybridDeleGator", 950, "#d0ebff"),
    ("EntryPoint v0.7\nERC-4337", 1160, "#e5dbff"),
    ("DelegationManager\nERC-7710", 1380, "#e5dbff"),
    ("GraphDomainCaveat\nEnforcer (ours)", 1610, "#ffd8a8"),
    ("Intuition MultiVault\nknowledge graph", 1840, "#c3fae8"),
    ("MockGovernor", 2040, "#e5dbff"),
]
X = {i: cx for i, (_, cx, _) in enumerate(LANES)}
TOP, BOTTOM = 170, 2005

# ── Phase bands (drawn first = background) ──────────────────────────────────────
BANDS = [
    (185, 400, "#f8f9fa", "T0 · SETUP — onchain, once"),
    (415, 810, "#fff9db", "T1 · SIGNATURES — offline, zero transactions (EIP-712)"),
    (825, 1740, "#e7f5ff", "T2 · REDEMPTION — one transaction, self-bundled (no bundler on 13579)"),
    (1755, 2000, "#ffe3e3", "T3 · REVOCATION — native, zero custom code"),
]
for y0, y1, bg, label in BANDS:
    rect(40, y0, 2120, y1 - y0, bg, stroke="#ced4da", opacity=45, rounded=False)
    text(56, y0 + 8, label, size=17, family=2, bold=True, color="#495057")

# Title
text(56, 20, "ERC-7710 Liquid Democracy POC — signature & execution flow (Intuition testnet 13579)", size=24, family=2)
text(56, 56, "voter ➜ delegate ➜ executor · domain scope resolved from the knowledge graph · everything below ran live", size=14, family=2, color="#868e96")

# Lane headers + lifelines
for name, cx, bg in LANES:
    lines = name.split("\n")
    w = max(150, max(len(l) for l in lines) * 15 * 0.62 + 20)
    rect(cx - w / 2, 92, w, 62, bg)
    ctext(cx, 92 + (62 - len(lines) * 15 * 1.25) / 2, name, size=15, family=2)
    e = common(type="line", x=cx, y=TOP, width=0, height=BOTTOM - TOP,
               points=[[0, 0], [0, BOTTOM - TOP]], lastCommittedPoint=None,
               startBinding=None, endBinding=None, startArrowhead=None, endArrowhead=None,
               strokeColor="#adb5bd", strokeStyle="dashed", strokeWidth=1, elbowed=False)
    ELS.append(e)

# ── T0 · Setup ──────────────────────────────────────────────────────────────────
box(650, 230, 620,
    "3 × HybridDeleGator deployed via SimpleFactory (CREATE2, canonical v1.3.0)\n"
    "each owned by its EOA — funded in tTRUST (self-paid gas)", "#d0ebff")
box(1840, 215, 470,
    "org attestor stakes 0.01 tTRUST on each edge\n"
    "getShares(attestor, tripleId, curve) > 0  ⇒  ATTESTED  (ADR-B)\n"
    "graph: branding→design · UX→design · logo→branding\n"
    "predicate: “is a sub-domain of” · legal stays unlinked", "#c3fae8", family=3, size=13)

# ── T1 · Signatures ─────────────────────────────────────────────────────────────
d1y = box(560, 470, 500,
    "DELEGATION 1   voter SA ➜ delegate SA\n"
    "authority: ROOT_AUTHORITY\n"
    "caveat: GraphDomainCaveatEnforcer\n"
    "terms  { root=design · predicate=is-a-sub-domain-of\n"
    "         maxDepth=3 · expiry=0 · attestor=org }\n"
    "salt: timestamp     args: ∅  — NOT signed", "#fff3bf", family=3, size=13)
arrow(X[0], 452, 312, 500)
ctext(X[0] + 85, 408, "signTypedData\nEIP-712 · domain =\nDelegationManager · chainId 13579", size=12)

d2y = box(860, d1y + 40, 500,
    "DELEGATION 2   delegate SA ➜ executor SA\n"
    "authority: keccak(DELEGATION 1)  ← chain link\n"
    "caveat: same enforcer, terms { root=UX … }\n"
    "= NARROWING: both levels must pass (ADR-E)", "#fff3bf", family=3, size=13)
arrow(X[2], d1y + 62, 612, d1y + 92)
ctext(X[2] + 80, d1y + 30, "signTypedData (EIP-712)", size=12)

box(1730, 470, 560,
    "SIGNED & IMMUTABLE: terms (the scope)\n"
    "NOT SIGNED: args — the path witness, supplied by the\n"
    "redeemer at redemption and verified on-chain hop by hop (ADR-A)\n"
    "checked after signing: offchain hash == manager.getDelegationHash ✓\n"
    "delegator SA isValidSignature == 0x1626ba7e (EIP-1271) ✓", "#e9fac8", family=3, size=13)

# ── T2 · Redemption ─────────────────────────────────────────────────────────────
y = 880
box(950, y - 20, 420,
    "client-side: compute the witness from the graph index\n"
    "path = [UX, design]  → caveat args", "#d0ebff", size=13)
y += 90
step(X[4], X[5], y, "userOp { callData: redeemDelegations(…) } signed by executor owner (ECDSA)\nsubmitted by a funded EOA:  EntryPoint.handleOps([op])  — ERC-4337, self-bundled")
y += 85
step(X[5], X[4], y, "validateUserOp → owner ECDSA check · SA prepays gas in tTRUST")
y += 85
step(X[4], X[6], y, "execute → redeemDelegations( contexts=[D2, D1] (leaf→root),\nmode=SingleDefault (ERC-7579), execution=propose(UX, …) )")
y += 60
box(1380, y, 480,
    "DelegationManager checks:\n"
    "· EIP-1271 signature of each delegator SA\n"
    "· delegation not disabled (revocation)\n"
    "· authority chain: D2.authority == keccak(D1)", "#e5dbff", size=13, family=3)
y += 130
step(X[6], X[7], y, "beforeHook(D2.terms root=UX, args=[UX]) → exact match, 0 hop ✓")
y += 75
step(X[6], X[7], y, "beforeHook(D1.terms root=design, args=[UX, design]) → 1 hop to verify")
y += 75
step(X[7], X[8], y, "calculateTripleId(UX, predicate, design)\ngetVaultType(id) == 1  (never isTriple — counter-triple attack, ADR-C)\ngetShares(attestor, id, curve) > 0  (ADR-B)")
y += 85
step(X[6], X[1], y, "executeFromExecutor(mode, execution) — the ROOT delegator executes")
y += 85
step(X[1], X[9], y, "propose(UX, …)  →  ProposalCreated( proposer = VOTER SA )")
y += 30
box(1150, y, 560,
    "the proposal is recorded IN THE VOTER'S NAME —\nthat is liquid democracy through the delegation chain", "#b2f2bb", size=14)

# ── T3 · Revocation ─────────────────────────────────────────────────────────────
ry = 1830
step(X[0], X[1], ry, "user op signed\nby voter owner", size=12)
step(X[1], X[6], ry + 55, "disableDelegation(DELEGATION 1) — via EntryPoint, same self-bundled path")
box(850, ry + 90, 640,
    "whole downstream chain is dead — executor AND delegate now revert\n"
    "CannotUseADisabledDelegation  (framework-native — we wrote zero code for revocation)", "#ffc9c9", size=13, family=3)

# ── Legend / footer ─────────────────────────────────────────────────────────────
box(1080, 2030, 2000,
    "standards:  EIP-712 typed signatures · EIP-1271 contract signature validation · ERC-4337 account abstraction (EntryPoint v0.7)"
    " · ERC-7710 delegations & caveat enforcers · ERC-7579 execution encoding · CREATE2 deterministic deployments", "#e5dbff", size=13)
text(60, 2110,
     "live on 13579:  GraphDomainCaveatEnforcer 0x97874e29cE2b98afF21d1dCad03348ac8A16739b · MockGovernor 0xE9F0B082Ac97518b41E6aA5f0aEb75BD26d8484E"
     " · DelegationManager 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3 · MultiVault 0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91",
     size=12, family=3, color="#868e96")

doc = {
    "type": "excalidraw",
    "version": 2,
    "source": "liquid-demo-phase3",
    "elements": ELS,
    "appState": {"viewBackgroundColor": "#ffffff", "gridSize": None},
    "files": {},
}
out = "/home/max/Project/Liquid-Demo/docs/delegation-flow.excalidraw"
with open(out, "w") as f:
    json.dump(doc, f, indent=1)
print(f"{out}: {len(ELS)} elements")
