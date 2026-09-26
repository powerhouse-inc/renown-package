import { MemoryOidcStore } from "../store/memory.js";
import { describeOidcStoreContract } from "./store-contract.js";

describeOidcStoreContract("MemoryOidcStore", () => Promise.resolve(new MemoryOidcStore()));
