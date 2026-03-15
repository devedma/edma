// ── EDMA SDK Types ───────────────────────────────────────────────────────────

export interface ContractAddresses {
  povGate: string;
  oneClaimLedger: string;
  attestorRegistry: string;
  edsd: string;
  settlementController: string;
  feeRouter: string;
  edmBurner: string;
  emt: string;
  ett: string;
  certificateNFT: string;
  parameterStore: string;
  revocationManager: string;
}

export interface EdmaContracts {
  povGate: any;
  oneClaim: any;
  attestorRegistry: any;
  edsd: any;
  settlement: any;
  feeRouter: any;
  edmBurner: any;
}

export interface Attestation {
  attestor: string;
  role: string;
  evidenceHash: string;
  timestamp: number;
  signature: string;
}

export interface GateResult {
  pass: boolean;
  gatePassId: string;
  claimId: string;
  outcome: number;
  reason: string;
}

export interface SettlementResult {
  receiptId: string;
  orderId: string;
  milestoneId: string;
  trancheGross: bigint;
  platformFee: bigint;
  burnAmount: bigint;
  burnHash: string;
  netToBeneficiary: bigint;
}

export interface MilestoneConfig {
  orderId: string;
  milestoneId: string;
  weightBps: number;
  supplier: string;
  corridorId: string;
  poTotalValue: bigint;
}

// ── Shipment Event (maps to shipment_event_v1.json) ─────────────────────────
export interface ShipmentEventV1 {
  schema_version: "v1.0";
  event_id: string;
  event_type: "EBL" | "CUSTOMS" | "POD" | "QA" | "TELEMETRY" | "METER_WINDOW" | "OTHER";
  kind: string;
  occurred_at: string;
  recorded_at: string;
  corridor_id?: string;
  po_id?: string;
  source_id: string;
  payload: Record<string, any>;
  one_claim_anchor: {
    type: string;
    [key: string]: any;
  };
}

// ── Receipt (maps to receipt_v1.json) ────────────────────────────────────────
export interface ReceiptV1 {
  receipt_version: "v1.0";
  claim_id: string;
  po_id: string;
  corridor_id: string;
  milestone_id: string;
  schedule_version: string;
  created_at: string;
  counterparties: {
    buyer_id_hash: string;
    seller_id_hash: string;
  };
  pov_hash: string;
  evidence_nodes: Array<{
    type: string;
    source_id: string;
    event_hash: string;
    timestamp: string;
    attrs: Record<string, any>;
  }>;
  attestors: Array<{
    role: string;
    org_id_hash: string;
    signature: string;
    pass_timestamp: string;
    latency_ms: number;
  }>;
  financial: {
    tranche_gross: { amount: string; ccy: string };
    platform_fee: { amount: string; ccy: string };
    burn_amount: { amount: string; ccy: string };
    burn_hash: string;
    net_to_beneficiary: { amount: string; ccy: string };
  };
}
