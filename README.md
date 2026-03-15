# EDMA L2 — Smart Contract Repository

**Proof-of-Verification settlement layer on an OP Stack rollup (Chain ID: 741)**

Nothing mints, nothing settles, nothing moves until real-world evidence is cryptographically verified on-chain.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  EDMA L2 (OP Stack Rollup — Chain 741)                  │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   PoV Layer  │  │  Settlement  │  │  Economics   │  │
│  │              │  │              │  │              │  │
│  │  PoVGate     │  │  EDSD        │  │  FeeRouter   │  │
│  │  OneClaim    │──│  EMT         │──│  EDMBurner   │  │
│  │  Attestor    │  │  Settlement  │  │              │  │
│  │  Registry    │  │  Controller  │  │              │  │
│  │  Revocation  │  │              │  │              │  │
│  │  Manager     │  │              │  │              │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐                     │
│  │   Assets     │  │  Governance  │                     │
│  │  ETT (1155)  │  │  Parameter   │                     │
│  │  CertNFT     │  │  Store       │                     │
│  │  (721)       │  │              │                     │
│  └──────────────┘  └──────────────┘                     │
└─────────────────────────────────────────────────────────┘
```

## Contracts (16 files, 1,824 lines Solidity)

| Contract | Purpose | Invariant |
|---|---|---|
| **PoVGate** | EIP-712 claim submission & attestor verification | I-4: Locked→Unlocked only on proof |
| **OneClaimLedger** | One-claim-per-evidence deduplication | I-2: One-Claim |
| **AttestorRegistry** | Attestor registration, SLA, staking | I-4 enforcement |
| **RevocationManager** | Claim revocation with cooldown | Post-verification correction |
| **EDSD** | Escrow Digital Settlement Depository | I-3: Must-Fund before shipping |
| **EMT** | Escrow Movement Ticket (ERC-721) | I-1: No EMT, No Funds |
| **SettlementController** | Orchestrates claim→verify→settle flow | All invariants |
| **FeeRouter** | Protocol fee splitting | I-5: 50% burns EDM |
| **EDMBurner** | Burns bridged EDM on L2 | I-5 enforcement |
| **ETT** | Energy Transition Token (ERC-1155) | Asset tokenization |
| **CertificateNFT** | REC/GO/CLE certificates (ERC-721) | Certificate issuance |
| **ParameterStore** | Governance-controlled parameters | Protocol configuration |

## 5 Immutable Invariants

1. **I-1: No EMT, No Funds** — No escrow movement without an EMT
2. **I-2: One-Claim** — Each evidence hash can only be claimed once
3. **I-3: Must-Fund** — Escrow must be funded before shipping begins
4. **I-4: Locked→Unlocked only on proof** — Only cryptographic verification unlocks funds
5. **I-5: 50% protocol fee burns EDM** — Deflationary pressure on EDM token

## Quick Start

### Prerequisites

- Node.js 18+
- The EDMA devnet running (see `~/Projects/edma-l2/optimism/ops-bedrock`)

### Setup

```bash
cd ~/Projects/edma-l2/edma-contracts
npm install
cp .env.example .env
```

### Deploy to Live Devnet

```bash
cd packages/contracts
npx hardhat run script/Deploy.s.js --network edma_devnet
```

Deploys all 12 contracts and wires their permissions using a pre-funded devnet account.

### Run Tests

```bash
cd packages/contracts
npx hardhat test
```

### RPC Endpoints

| Network | URL | Chain ID |
|---|---|---|
| EDMA L2 (devnet) | `http://localhost:9545` | 741 |
| L1 (devnet) | `http://localhost:8545` | 900 |

### Pre-funded Devnet Accounts

| Account | Address |
|---|---|
| Deployer | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| User 1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| User 2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |

## Project Structure

```
edma-contracts/
├── packages/
│   ├── contracts/           # Solidity contracts
│   │   ├── src/
│   │   │   ├── pov/         # PoVGate, OneClaim, Attestor, Revocation
│   │   │   ├── settlement/  # EDSD, EMT, SettlementController
│   │   │   ├── economics/   # FeeRouter, EDMBurner
│   │   │   ├── assets/      # ETT, CertificateNFT
│   │   │   ├── governance/  # ParameterStore
│   │   │   ├── interfaces/  # IPoVGate, IOneClaim, IAttestor
│   │   │   └── libraries/   # EdmaTypes
│   │   ├── test/            # Test suite (604 lines)
│   │   └── script/          # Deployment scripts
│   ├── sdk/                 # TypeScript SDK (@edma/sdk)
│   └── chain-config/        # L2 chain configuration
├── .env.example
├── .gitignore
└── package.json
```

## Key Addresses

- **EDM Token (L1 Ethereum):** `0xf6fb036ca17ceeb345fe39dfb132d1d80ab45029`
- **EDMA Chain ID:** 741
- **Batch Inbox:** `0xfF00000000000000000000000000000000000741`
