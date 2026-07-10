# Context — Position Engine Split (Subtask 04)

## What Is This Subtask Part Of?

This is **Task 04 of 10** in the plan: **"Tách hoàn toàn SMC và Bob Volman thành 2 flow độc lập"**

Plan reference: `tasks/smc-volman-full-separation/plan.md`

---

## Position Engine: Current Monolithic Design

### What Is position-engine.ts?

Central module that handles:
1. **Risk/reward calculations** — how much risk per trade, expected profit
2. **Trade validation** — is this a valid setup based on risk/reward rules
3. **Position management** — how to partially close, trail stops, manage open trades
4. **Configuration** — reading POSITION_MIN_RISK_REWARD_RATIO and TP1 close % from env

### Why It Needs Splitting

Currently, BOTH Volman and SMC systems use functions from position-engine, but:

**Volman uses:**
- `buildOpenPositionInsertRow()` — builds database row for new trades
  - Calls `getConfiguredMinRiskRewardRatio()` to validate risk/reward
  - Calls `getConfiguredTp1ClosePercent()` to set partial close %
  - Calls `validateTradeSetupForOpen()` to check the setup

**SMC uses:**
- `calculateRiskRewardPlan()` — calculates plan (generic math, no Volman config)
- `deriveManagementPatch()` — manages existing positions

**Problem:** Both systems import from same file, but:
1. Volman-specific config functions (`getConfiguredMinRiskRewardRatio()`) aren't needed by SMC
2. `deriveSignalSystem()` function checks detectionSource to determine system — unnecessary with hardcoded entrypoints
3. `SignalSystem` type is obsolete (system is known at import time)

---

## Architecture Decision: System-Specific Versions

### Volman Version (`position-engine-volman.ts`)

**Keeps:**
- All generic risk/reward logic
- All Volman-specific config functions
- Helper functions for calculation

**Why:** Volman pipeline calls `buildOpenPositionInsertRow()` which depends on Volman config functions

**Functions in this version:**
```
getConfiguredMinRiskRewardRatio()         ← Reads POSITION_MIN_RISK_REWARD_RATIO
getConfiguredMinRiskRewardRatioForPattern() ← Reads POSITION_MIN_RISK_REWARD_RATIO_BY_PATTERN
getConfiguredTp1ClosePercent()            ← Reads POSITION_TP1_CLOSE_PERCENT
calculateRiskRewardPlan()                 ← Generic math
validateTradeSetupForOpen()               ← Generic validation
buildOpenPositionInsertRow()              ← Volman-specific: uses config functions
deriveManagementPatch()                   ← Generic position management
```

### SMC Version (`position-engine-smc.ts`)

**Keeps:**
- All generic risk/reward logic
- Helper functions for calculation

**Removes:**
- Volman-specific config functions (SMC doesn't use them)

**Why:** SMC doesn't use Volman's config-based risk/reward model. SMC has its own liquidity-zone-based risk model defined elsewhere

**Functions in this version:**
```
calculateRiskRewardPlan()        ← Generic math (SMC can use this)
deriveManagementPatch()          ← Generic position management (SMC can use this)
validateTradeSetupForOpen()      ← Generic validation (SMC can use this)
deriveManagementPatch()          ← Generic management (SMC can use this)

(Does NOT have config functions — SMC doesn't need them)
```

---

## Functions to Delete (Both Versions)

### SignalSystem Type

**Current:**
```typescript
export type SignalSystem = "volman" | "smc";
```

**Delete because:** With hardcoded entrypoints, no need to tag trades with the system they came from

### deriveSignalSystem() Function

**Current:**
```typescript
export function deriveSignalSystem(
  setup: Pick<TradeSetup, "detectionSource">,
): SignalSystem {
  return setup.detectionSource === "smc" ? "smc" : "volman";
}
```

**Delete because:**
- Determines system from `detectionSource` field
- But now `index.ts` is hardcoded to Volman, `smc-index.ts` is hardcoded to SMC
- No need to derive anymore — the entrypoint already knows

**Used by:** `positions-repository.ts` for dedup logic — will be removed when that file is split in later task

---

## Impact on Importing Code

### index.ts (Volman)

**Currently:**
```typescript
import { buildOpenPositionInsertRow, ... } from "./position-engine.js";
```

**After:**
```typescript
import { buildOpenPositionInsertRow, ... } from "./position-engine-volman.js";
```

Volman imports the config functions automatically (they're in volman version)

### smc-index.ts (SMC)

**Currently:**
```typescript
import { ... } from "./position-engine.js";  // Doesn't use config functions anyway
```

**After:**
```typescript
import { ... } from "./position-engine-smc.js";  // Cleaner: only has what SMC needs
```

### positions-repository.ts (Will be split in task 05)

**Currently:**
```typescript
import { deriveSignalSystem } from "./position-engine.js";
// Used to tag: system: deriveSignalSystem(setup)
```

**After subtask 04:**
Remove the call — positions-repository will be split in task 05 anyway, and each version won't need to derive system

**Workaround for now:** Remove `deriveSignalSystem()` call and replace with hardcoded string for test purposes (or comment out if not critical)

---

## Risk: System Derivation

**Question:** What if something still needs to know which system a trade came from?

**Answer (from current code):** Nothing in the split flow needs it:
- Volman entrypoint (`index.ts`) always saves to Volman database
- SMC entrypoint (`smc-index.ts`) always saves to SMC database
- No cross-system queries (Volman data never gets SMC logic applied and vice versa)

**When would we need it again?**
- Dashboard that summarizes both systems (out of scope, task 10 doesn't include this)
- Audit log of which system generated a trade (not currently tracked)

So it's safe to delete now.

---

## Config Functions: Volman Specific?

### getConfiguredMinRiskRewardRatio()

**Reads:** `POSITION_MIN_RISK_REWARD_RATIO` (default 3)  
**Used by:** Volman's `buildOpenPositionInsertRow()` to validate setups  
**SMC needs?** No — SMC uses liquidity zones, not a global risk/reward threshold  
**Verdict:** Volman-specific ✓

### getConfiguredTp1ClosePercent()

**Reads:** `POSITION_TP1_CLOSE_PERCENT` (default 50)  
**Used by:** Volman's `buildOpenPositionInsertRow()` to set partial close %  
**SMC needs?** No — SMC has different position management model  
**Verdict:** Volman-specific ✓

---

## Generic Functions (Both Versions Keep)

### calculateRiskRewardPlan()

Pure math: given entry/SL/TP, calculate risk, reward, R:R ratio  
**Used by:** Both systems for validation and planning  
**Verdict:** Keep in both ✓

### validateTradeSetupForOpen()

Checks if entry is above/below setup level based on direction  
Checks risk/reward against configured minimum  
**Used by:** Both systems  
**Verdict:** Keep in both ✓

### buildOpenPositionInsertRow()

Constructs database row for opening a trade  
**Only in Volman version** — SMC doesn't open positions via this path  
**Uses:** Config functions (why it's Volman-specific)  
**Verdict:** Volman only ✓

### deriveManagementPatch()

Calculates what to do with an open position (move SL, close partial, trail, close)  
**Used by:** Both systems for position management  
**Verdict:** Keep in both ✓

---

## Timeline & Dependencies

**Depends on:**
- Task 02 (type splitting) ✓ Complete
- Task 03 (config splitting) ✓ Complete

**Blocks:**
- Task 05 (repository splitting) — positions-repository will import these files

**Effort:** ~30-40 minutes (2 new files, update imports, update tests)

---

## Checklist For Understanding

- [x] Position engine is a "position management logic" module
- [x] Volman uses config-based risk/reward validation
- [x] SMC uses different (liquidity-based) risk model
- [x] SignalSystem and deriveSignalSystem are obsolete with hardcoded entrypoints
- [x] All generic functions can be duplicated in both versions
- [x] Config functions only needed in Volman version
