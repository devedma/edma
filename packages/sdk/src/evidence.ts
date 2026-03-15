// ── Evidence Normalizer ──────────────────────────────────────────────────────
// Converts NocoDB shipment/order data into canonical JSON per shipment_event_v1.json,
// then computes the PoV hash (SHA-256 of the normalized, sorted JSON).
// Canon reference: PoV-Gate Baseline Rules v1.0 §6 — normalization & PoV hash

import { ethers } from "ethers";

export interface ShipmentEvent {
  event_type: string;
  kind: string;
  source_id: string;
  occurred_at: string;
  payload: Record<string, any>;
  one_claim_anchor: Record<string, any>;
}

export class EvidenceNormalizer {

  /**
   * Normalize a shipment event into canonical JSON and compute its hash.
   * Canonical JSON: keys sorted recursively, no whitespace, UTF-8.
   */
  static normalize(event: ShipmentEvent): { canonical: string; hash: string } {
    const canonical = EvidenceNormalizer.canonicalize(event);
    const hash = ethers.id(canonical); // keccak256 — on-chain we use this too
    return { canonical, hash };
  }

  /**
   * Compute the PoV hash for a complete evidence set (multiple events).
   * Events are sorted by (event_type, source_id) before hashing.
   */
  static computePovHash(events: ShipmentEvent[]): string {
    const sorted = [...events].sort((a, b) => {
      const typeComp = a.event_type.localeCompare(b.event_type);
      if (typeComp !== 0) return typeComp;
      return a.source_id.localeCompare(b.source_id);
    });
    const canonicalSet = sorted.map(e => EvidenceNormalizer.canonicalize(e));
    const combined = canonicalSet.join("|");
    return ethers.id(combined);
  }

  /**
   * Compute a uniqueness key for One-Claim based on evidence type.
   * Canon §6: same fact pattern → one claim.
   */
  static computeUniquenessKey(event: ShipmentEvent): string {
    const anchor = event.one_claim_anchor;
    switch (anchor.type) {
      case "TITLE_FACTS":
        return ethers.solidityPackedKeccak256(
          ["string", "string", "string"],
          [anchor.bl_id, JSON.stringify(anchor.container_set), anchor.voyage_id || ""]
        );
      case "METER_WINDOW_FACTS":
        return ethers.solidityPackedKeccak256(
          ["string", "uint256", "uint256"],
          [anchor.device_id, anchor.window_start, anchor.window_end]
        );
      case "REGISTRY_SERIAL":
        return ethers.solidityPackedKeccak256(
          ["string", "string"],
          [anchor.registry_id, anchor.serial_number]
        );
      default:
        throw new Error(`Unknown one_claim_anchor type: ${anchor.type}`);
    }
  }

  /**
   * Build a shipment event from NocoDB shipment row + container data.
   * This is the adapter between edma-ops data model and the L2 evidence schema.
   */
  static fromNocoDBShipment(
    shipment: Record<string, any>,
    containers: Array<Record<string, any>>,
    eventType: "EBL" | "CUSTOMS" | "QA",
    kind: string
  ): ShipmentEvent {
    const containerIds = containers.map(c => c.id || c.containerId);

    if (eventType === "EBL") {
      return {
        event_type: "EBL",
        kind: kind,   // "ON_BOARD", "ROLLED", "RELEASED"
        source_id: `BL:${shipment.blNumber}`,
        occurred_at: new Date().toISOString(),
        payload: {
          on_board: kind === "ON_BOARD",
          bl_id: shipment.blNumber,
          carrier_id: shipment.carrier,
          voyage_id: shipment.voyageId || "",
          container_set: containerIds,
          port_code: shipment.route?.split("→")[0]?.trim() || "",
        },
        one_claim_anchor: {
          type: "TITLE_FACTS",
          bl_id: shipment.blNumber,
          container_set: containerIds,
          voyage_id: shipment.voyageId || "",
        },
      };
    }

    if (eventType === "CUSTOMS") {
      return {
        event_type: "CUSTOMS",
        kind: kind,   // "CLEARED", "ACCEPTED", "HELD"
        source_id: `CUSTOMS:${shipment.customsRef || shipment.id}`,
        occurred_at: new Date().toISOString(),
        payload: {
          customs_status: kind.toLowerCase(),
          mrn: shipment.customsRef,
          port_code: shipment.route?.split("→")[1]?.trim() || "",
          country: shipment.destinationCountry || "",
        },
        one_claim_anchor: {
          type: "TITLE_FACTS",
          bl_id: shipment.blNumber,
          container_set: containerIds,
          voyage_id: shipment.voyageId || "",
        },
      };
    }

    // QA
    return {
      event_type: "QA",
      kind: kind,   // "PASS", "FAIL", "CONDITIONAL"
      source_id: `QA:${shipment.qaReportId || shipment.id}`,
      occurred_at: new Date().toISOString(),
      payload: {
        result: kind.toLowerCase(),
        report_id: shipment.qaReportId,
      },
      one_claim_anchor: {
        type: "TITLE_FACTS",
        bl_id: shipment.blNumber,
        container_set: containerIds,
        voyage_id: shipment.voyageId || "",
      },
    };
  }

  // ── Internal: deterministic JSON serialization ────────────────────────────
  private static canonicalize(obj: any): string {
    if (obj === null || obj === undefined) return "null";
    if (typeof obj === "string") return JSON.stringify(obj);
    if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
    if (Array.isArray(obj)) {
      return "[" + obj.map(v => EvidenceNormalizer.canonicalize(v)).join(",") + "]";
    }
    const keys = Object.keys(obj).sort();
    const pairs = keys.map(k => `${JSON.stringify(k)}:${EvidenceNormalizer.canonicalize(obj[k])}`);
    return "{" + pairs.join(",") + "}";
  }
}
