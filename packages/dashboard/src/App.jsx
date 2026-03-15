import { ethers } from "ethers";
import { useState, useEffect, useCallback, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
// EDMA L2 Dashboard — Full Contract Interaction Console
// Chain 741 · PoV Settlement Layer · All 12 Contracts
// ═══════════════════════════════════════════════════════════════════════════════

const DEPLOYED = {
  OneClaimLedger: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  AttestorRegistry: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  PoVGate: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  EDSD: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  FeeRouter: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
  EDMBurner: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
  SettlementController: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
  EMT: "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853",
  ETT: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
  CertificateNFT: "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318",
  ParameterStore: "0x610178dA211FEF7D417bC0e6FeD39F05609AD788",
  RevocationManager: "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e",
};

const ACCOUNTS = [
  { name: "Deployer", key: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", addr: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" },
  { name: "User 1", key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", addr: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
  { name: "User 2", key: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", addr: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" },
];

// ─── Contract Group Definitions ───────────────────────────────────────────────
const CONTRACT_GROUPS = [
  {
    id: "pov", label: "PoV Layer", icon: "🔐",
    contracts: [
      {
        name: "PoVGate", addr: DEPLOYED.PoVGate,
        fns: [
          { name: "setSchema", type: "write", inputs: [
            { name: "schemaId", type: "bytes32" }, { name: "requiredRoles", type: "bytes32[]" },
            { name: "minAttestations", type: "uint256" }, { name: "freshnessWindowSeconds", type: "uint256" },
            { name: "requiresFunding", type: "bool" }
          ]},
          { name: "setSettlementController", type: "write", inputs: [{ name: "_sc", type: "address" }] },
          { name: "isGatePassValid", type: "read", inputs: [{ name: "gatePassId", type: "bytes32" }], outputs: ["bool"] },
          { name: "consumeGatePass", type: "write", inputs: [{ name: "gatePassId", type: "bytes32" }] },
          { name: "admin", type: "read", inputs: [], outputs: ["address"] },
          { name: "DOMAIN_SEPARATOR", type: "read", inputs: [], outputs: ["bytes32"] },
        ]
      },
      {
        name: "OneClaimLedger", addr: DEPLOYED.OneClaimLedger,
        fns: [
          { name: "isAvailable", type: "read", inputs: [{ name: "uniquenessKey", type: "bytes32" }], outputs: ["bool"] },
          { name: "getClaim", type: "read", inputs: [{ name: "uniquenessKey", type: "bytes32" }], outputs: ["tuple"] },
          { name: "setPoVGate", type: "write", inputs: [{ name: "_povGate", type: "address" }] },
          { name: "setSettlementController", type: "write", inputs: [{ name: "_sc", type: "address" }] },
          { name: "reserve", type: "write", inputs: [{ name: "uniquenessKey", type: "bytes32" }] },
          { name: "finalize", type: "write", inputs: [{ name: "uniquenessKey", type: "bytes32" }] },
          { name: "admin", type: "read", inputs: [], outputs: ["address"] },
          { name: "povGate", type: "read", inputs: [], outputs: ["address"] },
          { name: "settlementController", type: "read", inputs: [], outputs: ["address"] },
        ]
      },
      {
        name: "AttestorRegistry", addr: DEPLOYED.AttestorRegistry,
        fns: [
          { name: "registerAttestor", type: "write", inputs: [
            { name: "keyAddress", type: "address" }, { name: "orgIdHash", type: "bytes32" },
            { name: "roles", type: "bytes32[]" }
          ]},
          { name: "getAttestor", type: "read", inputs: [{ name: "keyAddress", type: "address" }], outputs: ["tuple"] },
          { name: "isActive", type: "read", inputs: [{ name: "keyAddress", type: "address" }], outputs: ["bool"] },
          { name: "hasRole", type: "read", inputs: [{ name: "keyAddress", type: "address" }, { name: "role", type: "bytes32" }], outputs: ["bool"] },
          { name: "getOrgId", type: "read", inputs: [{ name: "keyAddress", type: "address" }], outputs: ["bytes32"] },
          { name: "sameOrg", type: "read", inputs: [{ name: "a", type: "address" }, { name: "b", type: "address" }], outputs: ["bool"] },
          { name: "suspend", type: "write", inputs: [{ name: "keyAddress", type: "address" }, { name: "reason", type: "string" }] },
          { name: "reinstate", type: "write", inputs: [{ name: "keyAddress", type: "address" }] },
          { name: "revoke", type: "write", inputs: [{ name: "keyAddress", type: "address" }] },
          { name: "admin", type: "read", inputs: [], outputs: ["address"] },
        ]
      },
      {
        name: "RevocationManager", addr: DEPLOYED.RevocationManager,
        fns: [
          { name: "createRevocation", type: "write", inputs: [
            { name: "orderId", type: "bytes32" }, { name: "milestoneId", type: "bytes32" },
            { name: "povHash", type: "bytes32" }, { name: "reason", type: "string" },
            { name: "downstreamMilestones", type: "bytes32[]" }
          ]},
          { name: "resolveRevocation", type: "write", inputs: [
            { name: "revocationId", type: "bytes32" }, { name: "amendedReceiptId", type: "bytes32" },
            { name: "milestonesToUnfreeze", type: "bytes32[]" }
          ]},
          { name: "isFrozen", type: "read", inputs: [{ name: "orderId", type: "bytes32" }, { name: "milestoneId", type: "bytes32" }], outputs: ["bool"] },
          { name: "getRevocation", type: "read", inputs: [{ name: "revocationId", type: "bytes32" }], outputs: ["tuple"] },
          { name: "getOrderRevocations", type: "read", inputs: [{ name: "orderId", type: "bytes32" }], outputs: ["bytes32[]"] },
          { name: "admin", type: "read", inputs: [], outputs: ["address"] },
        ]
      },
    ]
  },
  {
    id: "settlement", label: "Settlement", icon: "💰",
    contracts: [
      {
        name: "EDSD", addr: DEPLOYED.EDSD,
        fns: [
          { name: "mint", type: "write", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }] },
          { name: "lock", type: "write", inputs: [
            { name: "orderId", type: "bytes32" }, { name: "milestoneId", type: "bytes32" },
            { name: "supplier", type: "address" }, { name: "amount", type: "uint256" }
          ]},
          { name: "unlock", type: "write", inputs: [
            { name: "orderId", type: "bytes32" }, { name: "milestoneId", type: "bytes32" },
            { name: "supplier", type: "address" }, { name: "amount", type: "uint256" }
          ]},
          { name: "burn", type: "write", inputs: [{ name: "from", type: "address" }, { name: "amount", type: "uint256" }] },
          { name: "setAuthorized", type: "write", inputs: [{ name: "controller", type: "address" }, { name: "authorized", type: "bool" }] },
          { name: "getLockedAmount", type: "read", inputs: [
            { name: "orderId", type: "bytes32" }, { name: "milestoneId", type: "bytes32" }, { name: "supplier", type: "address" }
          ], outputs: ["uint256"] },
          { name: "isUnlocked", type: "read", inputs: [
            { name: "orderId", type: "bytes32" }, { name: "milestoneId", type: "bytes32" }, { name: "supplier", type: "address" }
          ], outputs: ["bool"] },
          { name: "totalSupply", type: "read", inputs: [], outputs: ["uint256"] },
          { name: "totalLocked", type: "read", inputs: [], outputs: ["uint256"] },
          { name: "totalBurned", type: "read", inputs: [], outputs: ["uint256"] },
          { name: "balanceOf", type: "read", inputs: [{ name: "account", type: "address" }], outputs: ["uint256"] },
          { name: "decimals", type: "read", inputs: [], outputs: ["uint8"] },
          { name: "admin", type: "read", inputs: [], outputs: ["address"] },
        ]
      },
      {
        name: "EMT", addr: DEPLOYED.EMT,
        fns: [
          { name: "getRecord", type: "read", inputs: [{ name: "emtId", type: "bytes32" }], outputs: ["tuple"] },
          { name: "isConsumed", type: "read", inputs: [{ name: "emtId", type: "bytes32" }], outputs: ["bool"] },
          { name: "consume", type: "write", inputs: [{ name: "emtId", type: "bytes32" }] },
        ]
      },
      {
        name: "SettlementController", addr: DEPLOYED.SettlementController,
        fns: [
          { name: "configureMilestone", type: "write", inputs: [
            { name: "orderId", type: "bytes32" }, { name: "milestoneId", type: "bytes32" },
            { name: "weightBps", type: "uint256" }, { name: "supplier", type: "address" },
            { name: "corridorId", type: "bytes32" }, { name: "poTotalValue", type: "uint256" }
          ]},
          { name: "settleTrancheOnPass", type: "write", inputs: [
            { name: "orderId", type: "bytes32" }, { name: "milestoneId", type: "bytes32" },
            { name: "gatePassId", type: "bytes32" }, { name: "uniquenessKey", type: "bytes32" },
            { name: "povHash", type: "bytes32" }
          ]},
        ]
      },
    ]
  },
  {
    id: "economics", label: "Economics", icon: "🔥",
    contracts: [
      {
        name: "FeeRouter", addr: DEPLOYED.FeeRouter,
        fns: [
          { name: "calculateFee", type: "read", inputs: [
            { name: "corridorId", type: "bytes32" }, { name: "feeCode", type: "bytes32" },
            { name: "baseAmount", type: "uint256" }, { name: "orderId", type: "bytes32" }
          ], outputs: ["uint256", "uint256", "uint256"] },
          { name: "setCorridorOverride", type: "write", inputs: [
            { name: "corridorId", type: "bytes32" }, { name: "feeCode", type: "bytes32" },
            { name: "rateBps", type: "uint256" }, { name: "capBps", type: "uint256" }
          ]},
          { name: "setSettlementController", type: "write", inputs: [{ name: "_sc", type: "address" }] },
          { name: "admin", type: "read", inputs: [], outputs: ["address"] },
        ]
      },
      {
        name: "EDMBurner", addr: DEPLOYED.EDMBurner,
        fns: [
          { name: "setSettlementController", type: "write", inputs: [{ name: "_sc", type: "address" }] },
        ]
      },
    ]
  },
  {
    id: "assets", label: "Assets", icon: "📜",
    contracts: [
      {
        name: "ETT", addr: DEPLOYED.ETT,
        fns: [
          { name: "getToken", type: "read", inputs: [{ name: "tokenId", type: "uint256" }], outputs: ["tuple"] },
          { name: "getProducerTokenCount", type: "read", inputs: [{ name: "producer", type: "address" }], outputs: ["uint256"] },
          { name: "setSettlementController", type: "write", inputs: [{ name: "_sc", type: "address" }] },
          { name: "admin", type: "read", inputs: [], outputs: ["address"] },
        ]
      },
      {
        name: "CertificateNFT", addr: DEPLOYED.CertificateNFT,
        fns: [
          { name: "getCert", type: "read", inputs: [{ name: "tokenId", type: "uint256" }], outputs: ["tuple"] },
          { name: "isRetired", type: "read", inputs: [{ name: "tokenId", type: "uint256" }], outputs: ["bool"] },
          { name: "setSettlementController", type: "write", inputs: [{ name: "_sc", type: "address" }] },
          { name: "admin", type: "read", inputs: [], outputs: ["address"] },
        ]
      },
    ]
  },
  {
    id: "governance", label: "Governance", icon: "⚙️",
    contracts: [
      {
        name: "ParameterStore", addr: DEPLOYED.ParameterStore,
        fns: [
          { name: "get", type: "read", inputs: [{ name: "key", type: "bytes32" }], outputs: ["uint256"] },
          { name: "getBounds", type: "read", inputs: [{ name: "key", type: "bytes32" }], outputs: ["uint256", "uint256"] },
          { name: "getPending", type: "read", inputs: [{ name: "key", type: "bytes32" }], outputs: ["uint256", "uint256", "bool"] },
          { name: "proposeChange", type: "write", inputs: [{ name: "key", type: "bytes32" }, { name: "newValue", type: "uint256" }] },
          { name: "executeChange", type: "write", inputs: [{ name: "key", type: "bytes32" }] },
          { name: "cancelChange", type: "write", inputs: [{ name: "key", type: "bytes32" }] },
          { name: "transferAdmin", type: "write", inputs: [{ name: "newAdmin", type: "address" }] },
          { name: "admin", type: "read", inputs: [], outputs: ["address"] },
        ]
      },
    ]
  },
];

// ─── ABI Builder ──────────────────────────────────────────────────────────────
function buildABI(fns) {
  return fns.map(fn => {
    const inputs = (fn.inputs || []).map(i => {
      if (i.type === "bytes32[]") return { name: i.name, type: "bytes32[]" };
      if (i.type === "uint256[]") return { name: i.name, type: "uint256[]" };
      return { name: i.name, type: i.type };
    });
    const outputs = (fn.outputs || []).map((o, idx) => {
      if (o === "tuple") return { name: "", type: "bytes", internalType: "bytes" };
      return { name: `out${idx}`, type: o };
    });
    return {
      name: fn.name,
      type: "function",
      stateMutability: fn.type === "read" ? "view" : "nonpayable",
      inputs, outputs,
    };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const shortenAddr = (a) => a ? `${a.slice(0,6)}...${a.slice(-4)}` : "";
const shortenHash = (h) => h ? `${h.slice(0,10)}...${h.slice(-6)}` : "";
const toBytes32 = (s) => {
  if (s.startsWith("0x") && s.length === 66) return s;
  if (s.startsWith("0x")) return s.padEnd(66, "0");
  const hex = Array.from(new TextEncoder().encode(s)).map(b => b.toString(16).padStart(2, "0")).join("");
  return "0x" + hex.padEnd(64, "0");
};

const formatResult = (val) => {
  if (val === undefined || val === null) return "null";
  if (typeof val === "bigint") return val.toString();
  if (typeof val === "boolean") return val ? "true" : "false";
  if (Array.isArray(val)) return JSON.stringify(val.map(v => typeof v === "bigint" ? v.toString() : v), null, 2);
  if (typeof val === "object") {
    const o = {};
    for (const k of Object.keys(val)) {
      if (isNaN(k)) o[k] = typeof val[k] === "bigint" ? val[k].toString() : val[k];
    }
    return JSON.stringify(o, null, 2);
  }
  return String(val);
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function FunctionCard({ fn, contractAddr, provider, signer, addLog }) {
  const [inputs, setInputs] = useState({});
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const execute = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const abi = buildABI([fn]);
      const iface = new ethers.Interface(abi);
      const args = (fn.inputs || []).map(inp => {
        const val = inputs[inp.name] || "";
        if (inp.type === "bytes32") return toBytes32(val);
        if (inp.type === "bytes32[]" || inp.type === "uint256[]") {
          try { return JSON.parse(val); } catch { return val.split(",").map(s => inp.type === "bytes32[]" ? toBytes32(s.trim()) : s.trim()); }
        }
        if (inp.type === "uint256" || inp.type === "uint8") return val;
        if (inp.type === "bool") return val === "true" || val === "1";
        return val;
      });

      let contract;
      if (fn.type === "read") {
        contract = new ethers.Contract(contractAddr, abi, provider);
      } else {
        contract = new ethers.Contract(contractAddr, abi, signer);
      }

      if (fn.type === "read") {
        const res = await contract[fn.name](...args);
        const formatted = formatResult(res);
        setResult(formatted);
        addLog({ type: "read", fn: fn.name, args, result: formatted, ts: Date.now() });
      } else {
        const tx = await contract[fn.name](...args);
        const receipt = await tx.wait();
        setResult(`TX: ${receipt.hash}\nBlock: ${receipt.blockNumber}\nGas: ${receipt.gasUsed.toString()}`);
        addLog({ type: "write", fn: fn.name, args, hash: receipt.hash, block: receipt.blockNumber, gas: receipt.gasUsed.toString(), ts: Date.now() });
      }
    } catch (e) {
      const msg = e.reason || e.message || String(e);
      setError(msg.length > 200 ? msg.slice(0, 200) + "..." : msg);
      addLog({ type: "error", fn: fn.name, error: msg.slice(0, 120), ts: Date.now() });
    }
    setLoading(false);
  };

  const isRead = fn.type === "read";

  return (
    <div style={{
      background: "var(--card-bg)",
      border: `1px solid ${isRead ? "var(--border-read)" : "var(--border-write)"}`,
      borderRadius: 8, padding: "14px 16px", marginBottom: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: fn.inputs.length ? 10 : 0 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 1,
          color: isRead ? "var(--accent-read)" : "var(--accent-write)",
          background: isRead ? "var(--tag-read-bg)" : "var(--tag-write-bg)",
          padding: "2px 8px", borderRadius: 4, textTransform: "uppercase",
        }}>{isRead ? "READ" : "WRITE"}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>
          {fn.name}
        </span>
        {fn.inputs.length === 0 && (
          <button onClick={execute} disabled={loading} style={{
            marginLeft: "auto", padding: "4px 14px", fontSize: 12, fontWeight: 600,
            background: isRead ? "var(--accent-read)" : "var(--accent-write)",
            color: "#000", border: "none", borderRadius: 5, cursor: "pointer",
            opacity: loading ? 0.5 : 1,
          }}>{loading ? "..." : "Call"}</button>
        )}
      </div>

      {fn.inputs.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
          {fn.inputs.map(inp => (
            <div key={inp.name} style={{ flex: "1 1 180px", minWidth: 140 }}>
              <label style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", display: "block", marginBottom: 3 }}>
                {inp.name} <span style={{ opacity: 0.5 }}>({inp.type})</span>
              </label>
              <input
                value={inputs[inp.name] || ""}
                onChange={e => setInputs(p => ({ ...p, [inp.name]: e.target.value }))}
                placeholder={inp.type === "bytes32" ? "0x... or text" : inp.type === "address" ? "0x..." : inp.type === "bool" ? "true/false" : ""}
                style={{
                  width: "100%", padding: "6px 10px", fontSize: 13,
                  fontFamily: "var(--font-mono)", background: "var(--input-bg)", color: "var(--text-primary)",
                  border: "1px solid var(--input-border)", borderRadius: 5, outline: "none",
                  boxSizing: "border-box",
                }}
                onFocus={e => e.target.style.borderColor = "var(--accent-read)"}
                onBlur={e => e.target.style.borderColor = "var(--input-border)"}
              />
            </div>
          ))}
          <button onClick={execute} disabled={loading} style={{
            padding: "6px 20px", fontSize: 12, fontWeight: 600, alignSelf: "flex-end",
            background: isRead ? "var(--accent-read)" : "var(--accent-write)",
            color: "#000", border: "none", borderRadius: 5, cursor: "pointer",
            opacity: loading ? 0.5 : 1, whiteSpace: "nowrap",
          }}>{loading ? "Sending..." : isRead ? "Query" : "Execute"}</button>
        </div>
      )}

      {result && (
        <pre style={{
          marginTop: 10, padding: "8px 12px", background: "var(--result-bg)",
          borderRadius: 5, fontSize: 12, fontFamily: "var(--font-mono)",
          color: "var(--accent-read)", overflow: "auto", maxHeight: 160,
          whiteSpace: "pre-wrap", wordBreak: "break-all",
        }}>{result}</pre>
      )}
      {error && (
        <pre style={{
          marginTop: 10, padding: "8px 12px", background: "rgba(255,60,60,0.08)",
          borderRadius: 5, fontSize: 12, fontFamily: "var(--font-mono)",
          color: "#ff5555", overflow: "auto", maxHeight: 120, whiteSpace: "pre-wrap",
        }}>{error}</pre>
      )}
    </div>
  );
}

function ContractPanel({ contract, provider, signer, addLog }) {
  const [collapsed, setCollapsed] = useState(false);
  const reads = contract.fns.filter(f => f.type === "read");
  const writes = contract.fns.filter(f => f.type === "write");
  return (
    <div style={{ marginBottom: 24 }}>
      <div onClick={() => setCollapsed(!collapsed)} style={{
        display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
        padding: "10px 0", borderBottom: "1px solid var(--divider)",
      }}>
        <span style={{ fontSize: 12, color: "var(--text-dim)", transition: "transform 0.2s", transform: collapsed ? "rotate(-90deg)" : "rotate(0)" }}>▼</span>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>{contract.name}</h3>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>{shortenAddr(contract.addr)}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-dim)" }}>{reads.length}R · {writes.length}W</span>
      </div>
      {!collapsed && (
        <div style={{ paddingTop: 12 }}>
          {reads.length > 0 && reads.map(fn => <FunctionCard key={fn.name} fn={fn} contractAddr={contract.addr} provider={provider} signer={signer} addLog={addLog} />)}
          {writes.length > 0 && writes.map(fn => <FunctionCard key={fn.name} fn={fn} contractAddr={contract.addr} provider={provider} signer={signer} addLog={addLog} />)}
        </div>
      )}
    </div>
  );
}

function TransactionLog({ logs }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight); }, [logs]);
  return (
    <div ref={ref} style={{
      height: "100%", overflow: "auto", padding: "12px 16px",
      fontFamily: "var(--font-mono)", fontSize: 12,
    }}>
      {logs.length === 0 && <span style={{ color: "var(--text-dim)" }}>No transactions yet. Execute a function above.</span>}
      {logs.map((log, i) => (
        <div key={i} style={{
          padding: "6px 0", borderBottom: "1px solid var(--divider)",
          color: log.type === "error" ? "#ff5555" : log.type === "write" ? "var(--accent-write)" : "var(--text-secondary)",
        }}>
          <span style={{ opacity: 0.4, marginRight: 8 }}>{new Date(log.ts).toLocaleTimeString()}</span>
          <span style={{
            fontSize: 10, padding: "1px 6px", borderRadius: 3, marginRight: 8, fontWeight: 700,
            background: log.type === "error" ? "rgba(255,60,60,0.15)" : log.type === "write" ? "var(--tag-write-bg)" : "var(--tag-read-bg)",
            color: log.type === "error" ? "#ff5555" : log.type === "write" ? "var(--accent-write)" : "var(--accent-read)",
          }}>{log.type.toUpperCase()}</span>
          <span style={{ fontWeight: 600 }}>{log.fn}</span>
          {log.hash && <span style={{ marginLeft: 8, opacity: 0.6 }}>tx:{shortenHash(log.hash)} blk:{log.block} gas:{log.gas}</span>}
          {log.result && log.type === "read" && <span style={{ marginLeft: 8, opacity: 0.7 }}>→ {log.result.slice(0, 80)}{log.result.length > 80 ? "..." : ""}</span>}
          {log.error && <span style={{ marginLeft: 8 }}>{log.error}</span>}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════

export default function EDMADashboard() {
  const [activeGroup, setActiveGroup] = useState("pov");
  const [accountIdx, setAccountIdx] = useState(0);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [networkOk, setNetworkOk] = useState(false);
  const [blockNum, setBlockNum] = useState(0);
  const [balance, setBalance] = useState("0");
  const [logs, setLogs] = useState([]);
  const [logOpen, setLogOpen] = useState(true);
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState(null);

  const addLog = useCallback((entry) => setLogs(p => [...p.slice(-200), entry]), []);

  // Connect to devnet
  useEffect(() => {
    const connect = async () => {
      setConnecting(true); setError(null);
      try {
        const p = new ethers.JsonRpcProvider("http://localhost:9545");
        const net = await p.getNetwork();
        if (Number(net.chainId) !== 741) {
          setError(`Wrong chain: expected 741, got ${net.chainId}`);
          setConnecting(false);
          return;
        }
        const s = new ethers.Wallet(ACCOUNTS[accountIdx].key, p);
        const bal = await p.getBalance(ACCOUNTS[accountIdx].addr);
        const bn = await p.getBlockNumber();
        setProvider(p); setSigner(s); setNetworkOk(true);
        setBlockNum(bn); setBalance(ethers.formatEther(bal));
        setConnecting(false);
      } catch (e) {
        setError("Cannot connect to localhost:9545. Is the devnet running?");
        setConnecting(false);
      }
    };
    connect();
  }, [accountIdx]);

  // Poll block number
  useEffect(() => {
    if (!provider) return;
    const iv = setInterval(async () => {
      try {
        const bn = await provider.getBlockNumber();
        setBlockNum(bn);
      } catch {}
    }, 2000);
    return () => clearInterval(iv);
  }, [provider]);

  // Update balance on account change
  useEffect(() => {
    if (!provider) return;
    provider.getBalance(ACCOUNTS[accountIdx].addr).then(b => setBalance(ethers.formatEther(b)));
  }, [provider, accountIdx]);

  const activeContracts = CONTRACT_GROUPS.find(g => g.id === activeGroup)?.contracts || [];

  return (
    <div style={{
      "--font-display": "'JetBrains Mono', 'SF Mono', monospace",
      "--font-mono": "'JetBrains Mono', 'SF Mono', 'Menlo', monospace",
      "--bg-root": "#0a0b0f",
      "--bg-sidebar": "#0e1017",
      "--bg-main": "#12141c",
      "--card-bg": "rgba(255,255,255,0.025)",
      "--text-primary": "#e8eaf0",
      "--text-secondary": "#a0a4b8",
      "--text-dim": "#5c6078",
      "--accent-read": "#00d4aa",
      "--accent-write": "#ffa726",
      "--accent-active": "#7c4dff",
      "--border-read": "rgba(0,212,170,0.2)",
      "--border-write": "rgba(255,167,38,0.2)",
      "--tag-read-bg": "rgba(0,212,170,0.1)",
      "--tag-write-bg": "rgba(255,167,38,0.1)",
      "--input-bg": "rgba(0,0,0,0.3)",
      "--input-border": "rgba(255,255,255,0.1)",
      "--result-bg": "rgba(0,212,170,0.05)",
      "--divider": "rgba(255,255,255,0.06)",
      "--log-bg": "#080a0e",
      display: "flex", flexDirection: "column", height: "100vh", width: "100%",
      background: "var(--bg-root)", color: "var(--text-primary)",
      fontFamily: "var(--font-mono)", overflow: "hidden", fontSize: 14,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* ─── Header ─── */}
      <div style={{
        display: "flex", alignItems: "center", padding: "12px 20px",
        background: "var(--bg-sidebar)", borderBottom: "1px solid var(--divider)",
        gap: 16, flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: "linear-gradient(135deg, #7c4dff 0%, #00d4aa 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 800, fontSize: 13, color: "#000",
          }}>E</div>
          <div>
            <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: 1 }}>EDMA</span>
            <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>L2 Console</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 24 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: networkOk ? "#00d4aa" : connecting ? "#ffa726" : "#ff5555",
            boxShadow: networkOk ? "0 0 8px rgba(0,212,170,0.5)" : "none",
          }} />
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {connecting ? "Connecting..." : networkOk ? `Chain 741` : "Offline"}
          </span>
          {blockNum > 0 && <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 4 }}>#{blockNum}</span>}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <select
            value={accountIdx}
            onChange={e => setAccountIdx(Number(e.target.value))}
            style={{
              background: "var(--input-bg)", color: "var(--text-primary)",
              border: "1px solid var(--input-border)", borderRadius: 5,
              padding: "5px 10px", fontSize: 12, fontFamily: "var(--font-mono)",
              cursor: "pointer", outline: "none",
            }}
          >
            {ACCOUNTS.map((a, i) => <option key={i} value={i}>{a.name} ({shortenAddr(a.addr)})</option>)}
          </select>
          <span style={{ fontSize: 12, color: "var(--accent-read)", fontWeight: 600 }}>
            {parseFloat(balance).toFixed(2)} ETH
          </span>
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px 20px", background: "rgba(255,60,60,0.1)", color: "#ff5555", fontSize: 13, flexShrink: 0 }}>
          {error}
        </div>
      )}

      {/* ─── Body ─── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ─── Sidebar ─── */}
        <div style={{
          width: 200, minWidth: 200, background: "var(--bg-sidebar)",
          borderRight: "1px solid var(--divider)", padding: "16px 0",
          display: "flex", flexDirection: "column", overflow: "auto", flexShrink: 0,
        }}>
          <div style={{ padding: "0 16px 12px", fontSize: 10, fontWeight: 700, color: "var(--text-dim)", letterSpacing: 2, textTransform: "uppercase" }}>
            Contract Groups
          </div>
          {CONTRACT_GROUPS.map(g => (
            <button key={g.id} onClick={() => setActiveGroup(g.id)} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 16px", width: "100%",
              background: activeGroup === g.id ? "rgba(124,77,255,0.1)" : "transparent",
              borderLeft: activeGroup === g.id ? "3px solid var(--accent-active)" : "3px solid transparent",
              border: "none", borderRight: "none", borderTop: "none", borderBottom: "none",
              borderLeftWidth: 3, borderLeftStyle: "solid",
              borderLeftColor: activeGroup === g.id ? "var(--accent-active)" : "transparent",
              color: activeGroup === g.id ? "var(--text-primary)" : "var(--text-secondary)",
              cursor: "pointer", textAlign: "left", fontSize: 13, fontWeight: activeGroup === g.id ? 600 : 400,
              fontFamily: "var(--font-mono)", transition: "all 0.15s",
            }}>
              <span style={{ fontSize: 16 }}>{g.icon}</span>
              <span>{g.label}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.4 }}>{g.contracts.length}</span>
            </button>
          ))}

          <div style={{ flex: 1 }} />

          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--divider)" }}>
            <div style={{ fontSize: 10, color: "var(--text-dim)", letterSpacing: 1, marginBottom: 6 }}>DEPLOYED</div>
            {Object.entries(DEPLOYED).slice(0, 5).map(([n, a]) => (
              <div key={n} style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 2 }}>
                {n.slice(0, 12)} <span style={{ color: "var(--text-secondary)" }}>{shortenAddr(a)}</span>
              </div>
            ))}
            <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>+{Object.keys(DEPLOYED).length - 5} more</div>
          </div>
        </div>

        {/* ─── Main Content ─── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
            <div style={{ maxWidth: 900 }}>
              <h2 style={{
                fontSize: 20, fontWeight: 700, margin: "0 0 4px",
                color: "var(--text-primary)", fontFamily: "var(--font-display)",
              }}>
                {CONTRACT_GROUPS.find(g => g.id === activeGroup)?.icon}{" "}
                {CONTRACT_GROUPS.find(g => g.id === activeGroup)?.label}
              </h2>
              <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 20px" }}>
                {activeContracts.length} contract{activeContracts.length > 1 ? "s" : ""} ·{" "}
                {activeContracts.reduce((s, c) => s + c.fns.filter(f => f.type === "read").length, 0)} reads ·{" "}
                {activeContracts.reduce((s, c) => s + c.fns.filter(f => f.type === "write").length, 0)} writes
              </p>
              {provider ? (
                activeContracts.map(c => (
                  <ContractPanel key={c.name} contract={c} provider={provider} signer={signer} addLog={addLog} />
                ))
              ) : (
                <div style={{ textAlign: "center", padding: 40, color: "var(--text-dim)" }}>
                  {connecting ? "Connecting to EDMA devnet (localhost:9545)..." : "Start your devnet to interact with contracts."}
                </div>
              )}
            </div>
          </div>

          {/* ─── Transaction Log ─── */}
          <div style={{
            height: logOpen ? 180 : 36, flexShrink: 0,
            background: "var(--log-bg)", borderTop: "1px solid var(--divider)",
            transition: "height 0.2s", overflow: "hidden",
          }}>
            <div onClick={() => setLogOpen(!logOpen)} style={{
              display: "flex", alignItems: "center", padding: "8px 16px",
              cursor: "pointer", borderBottom: logOpen ? "1px solid var(--divider)" : "none",
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
                Transaction Log
              </span>
              <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-dim)" }}>({logs.length})</span>
              <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-dim)", transform: logOpen ? "rotate(0)" : "rotate(180deg)", transition: "transform 0.2s" }}>▼</span>
            </div>
            {logOpen && <TransactionLog logs={logs} />}
          </div>
        </div>
      </div>
    </div>
  );
}
