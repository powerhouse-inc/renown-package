import { MemoryWorkloadStore } from "../store/memory.js";
import { describeWorkloadStoreContract } from "./store-contract.js";

describeWorkloadStoreContract("MemoryWorkloadStore", () =>
  Promise.resolve(new MemoryWorkloadStore()),
);
