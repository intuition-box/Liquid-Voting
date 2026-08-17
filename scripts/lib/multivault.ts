/**
 * Minimal MultiVault ABI — the read surface from contracts/src/interfaces/IMultiVault.sol
 * plus the two creation writes, signatures per .agents/skills/intuition/operations/.
 */
export const multiVaultAbi = [
  {
    type: "function",
    name: "calculateAtomId",
    stateMutability: "pure",
    inputs: [{ name: "data", type: "bytes" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "calculateTripleId",
    stateMutability: "pure",
    inputs: [
      { name: "subjectId", type: "bytes32" },
      { name: "predicateId", type: "bytes32" },
      { name: "objectId", type: "bytes32" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "isTermCreated",
    stateMutability: "view",
    inputs: [{ name: "termId", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "getVaultType",
    stateMutability: "view",
    inputs: [{ name: "termId", type: "bytes32" }],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "getShares",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "termId", type: "bytes32" },
      { name: "curveId", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getBondingCurveConfig",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }, { type: "uint256" }],
  },
  {
    type: "function",
    name: "getAtomCost",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getTripleCost",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [
      { name: "receiver", type: "address" },
      { name: "termId", type: "bytes32" },
      { name: "curveId", type: "uint256" },
      { name: "minShares", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "createAtoms",
    stateMutability: "payable",
    inputs: [
      { name: "atomDatas", type: "bytes[]" },
      { name: "assets", type: "uint256[]" },
    ],
    outputs: [{ type: "bytes32[]" }],
  },
  {
    type: "function",
    name: "createTriples",
    stateMutability: "payable",
    inputs: [
      { name: "subjectIds", type: "bytes32[]" },
      { name: "predicateIds", type: "bytes32[]" },
      { name: "objectIds", type: "bytes32[]" },
      { name: "assets", type: "uint256[]" },
    ],
    outputs: [{ type: "bytes32[]" }],
  },
] as const;
