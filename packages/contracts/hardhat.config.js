require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: "../../.env" });

// OP Stack devnet pre-funded accounts (Hardhat mnemonic "test test...junk")
const DEVNET_ACCOUNTS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // Account 0
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // Account 1
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // Account 2
];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      chainId: 741,
      allowUnlimitedContractSize: false,
      gas: "auto",
      gasPrice: "auto",
    },
    edma_devnet: {
      url: "http://127.0.0.1:9545",
      chainId: 741,
      accounts: DEVNET_ACCOUNTS,
    },
    edma_l1: {
      url: "http://127.0.0.1:8545",
      chainId: 900,
      accounts: DEVNET_ACCOUNTS,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      chainId: 11155111,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    gasPrice: 21,
  },
};
