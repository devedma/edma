// ── Attestor Signer ──────────────────────────────────────────────────────────
// Creates EIP-712 typed signatures for PoV Gate attestations.
// These signatures are verified on-chain by PoVGate.sol.

import { ethers } from "ethers";

const DOMAIN_NAME = "EDMA PoV Gate";
const DOMAIN_VERSION = "1";

export class AttestorSigner {
  private signer: ethers.Signer;
  private chainId: bigint;
  private gateAddress: string;

  constructor(signer: ethers.Signer, chainId: bigint, gateAddress: string) {
    this.signer = signer;
    this.chainId = chainId;
    this.gateAddress = gateAddress;
  }

  /**
   * Sign an attestation using EIP-712 typed data.
   * This produces a signature that PoVGate.evaluateClaim() can verify.
   */
  async signAttestation(
    orderId: string,
    milestoneId: string,
    povHash: string
  ): Promise<string> {
    const domain = {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: this.chainId,
      verifyingContract: this.gateAddress,
    };

    const types = {
      Attestation: [
        { name: "orderId", type: "bytes32" },
        { name: "milestoneId", type: "bytes32" },
        { name: "povHash", type: "bytes32" },
      ],
    };

    const value = { orderId, milestoneId, povHash };

    // signTypedData produces a 65-byte EIP-712 signature
    return (this.signer as ethers.Wallet).signTypedData(domain, types, value);
  }

  /**
   * Build a complete attestation struct ready for submission to the Gate.
   */
  async buildAttestation(
    orderId: string,
    milestoneId: string,
    povHash: string,
    role: string
  ) {
    const signature = await this.signAttestation(orderId, milestoneId, povHash);
    const address = await this.signer.getAddress();

    return {
      attestor: address,
      role: role,
      evidenceHash: povHash,
      timestamp: Math.floor(Date.now() / 1000),
      signature: signature,
    };
  }
}
