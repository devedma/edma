// ── @edma/sdk — Integration bridge: edma-ops ↔ EDMA L2 ──────────────────────
// This SDK handles:
// 1. Evidence normalization (NocoDB shipment data → canonical JSON → povHash)
// 2. Attestor signature collection (EIP-712)
// 3. Contract call wrappers (evaluateClaim → settleTrancheOnPass)
// 4. Event listeners (MilestoneSettled → webhook → NocoDB update)
// 5. Receipt parsing and verification

export { EdmaClient } from "./client";
export { EvidenceNormalizer, type ShipmentEvent } from "./evidence";
export { AttestorSigner } from "./signer";
export { type EdmaContracts, type ContractAddresses } from "./types";
