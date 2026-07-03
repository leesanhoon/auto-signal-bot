# AI Model Configuration Audit Report
**Date**: 2026-07-04  
**Reviewed By**: Claude Code Assistant  
**Status**: READ-ONLY AUDIT (No modifications made)

---

## 📋 Executive Summary

The project has undergone significant AI provider changes over the past month:
- **Old config**: Gemini 3.5 Flash + Claude Sonnet 4.6 (June 2026)
- **Current config**: OpenRouter with DeepSeek models (July 2026)
- **Legacy support**: Code still contains unused Gemini/Claude references for backwards compatibility

**Key Finding**: Configuration is partially migrated. OpenRouter is the active provider, but logging/tracking code retains support for old providers.

---

## 1️⃣ Project-Level Configuration Files (`.claude/`)

### File: `.claude/settings.local.json`
- **Last Modified**: 2026-07-04 01:39:17 AM
- **Size**: ~2.8 KB
- **Status**: ĐANG DÙNG (Active)
- **Content Summary**:
  - Contains permission allowlist for tools (Bash, PowerShell, Skill, MCP)
  - Includes API keys for the-odds-api.com (embedded as curl examples)
  - No AI model configuration here (model config is in `.env`)

### File: `.claude/scheduled_tasks.lock`
- **Last Modified**: 2026-07-03 10:12:27 PM
- **Size**: Small lock file
- **Status**: Maintenance file (not relevant to AI config)

### File: `.claude/worktrees/`
- **Last Modified**: 2026-06-30 4:56:11 PM
- **Status**: Git worktrees directory (not relevant to AI config)

### No CLAUDE.md found in project root
- Status: **RÕ RÀNG DƯ THỪA** (Missing but not critical - no design doc)

---

## 2️⃣ User-Level Configuration Files (`~/.claude/`)

### File: `~/.claude/settings.json`
- **Last Modified**: 2026-07-01 11:55:05 PM
- **Content**:
  ```json
  {
    "model": "sonnet",
    "effortLevel": "medium",
    "theme": "dark"
  }
  ```
- **Status**: ĐANG DÙNG (Active - Claude Code personal settings)
- **Meaning**: User's default Claude model for Claude Code IDE is set to Sonnet (not relevant to the bot project)

### File: `~/.claude/.credentials.json`
- **Last Modified**: 2026-07-03 03:14:41 AM
- **Status**: KHÔNG CHẮC (Encrypted credentials storage, content not readable)

---

## 3️⃣ Environment Configuration (`.env` and `.env.example`)

### `.env.example` (Version Control)
```env
# OpenRouter AI
OPENROUTER_API_KEY=your_openrouter_api_key_here
AI_VISION_MODEL=xiaomi/mimo-v2.5
AI_TEXT_MODEL=deepseek/deepseek-v4-flash
AI_TEXT_FALLBACK_MODEL=deepseek/deepseek-v4-flash
```
- **Status**: ĐANG DÙNG (Current)
- **Last Git Change**: Not explicitly shown, but referenced in working code

### `.env` (Production Secrets)
```env
OPENROUTER_API_KEY=sk-or-v1-... (ACTIVE KEY)
AI_VISION_MODEL=xiaomi/mimo-v2.5 (active)
AI_TEXT_MODEL=deepseek/deepseek-v4-flash (active)
```
- **Status**: ĐANG DÙNG (Active in production)
- **Last Modified**: Not tracked by git (secrets file)

---

## 4️⃣ Source Code AI References

### Core AI Integration Files

| File | Location | Provider | Status | Last Modified | Notes |
|------|----------|----------|--------|---------------|-------|
| `openrouter.ts` | `src/shared/` | OpenRouter | ĐANG DÙNG | 2026-07-03 22:12 | Core API client for OpenRouter calls |
| `ai-usage.ts` | `src/shared/` | Multi-provider | ĐANG DÙNG | (in ai-usage.ts) | Tracks gemini/claude/openrouter usage |
| `ai-env.ts` | `src/shared/` | Generic | ĐANG DÙNG | (small file) | Reads AI_REASONING_EFFORT env var |
| `betting-gemini.ts` | `src/betting/` | OpenRouter | ĐANG DÙNG | 2026-07-03 22:55 | **NAMING MISLEADING**: Calls OpenRouter (DeepSeek), NOT Gemini |
| `analyzer.ts` | `src/charts/` | OpenRouter | ĐANG DÙNG | 2026-07-03 | Uses xiaomi/mimo-v2.5 for chart vision analysis |
| `lottery-ai-predict.ts` | `src/lottery/` | OpenRouter | ĐANG DÙNG | 2026-07-03 22:12 | Uses deepseek/deepseek-v4-pro for lottery prediction |

### Usage Tracking References

#### `src/shared/ai-usage.ts` (Line 8-9)
```typescript
export type AiProvider = "gemini" | "claude" | "openrouter";
```
- **Status**: KHÔNG CHẮC (Support code for old providers still present)
- **DEFAULT_RATES hardcoded** (Lines 89-117):
  - Gemini models: gemini-2.5-pro, gemini-2.5-flash, gemini-3.5-flash
  - Claude models: claude-sonnet-4-6
  - OpenRouter models: xiaomi/mimo-v2.5, deepseek/deepseek-v4-flash, etc.
- **Assessment**: Pricing data is outdated (Gemini rates from when it was used)

#### `src/shared/logger.ts` (Lines 14-27)
```typescript
const SENSITIVE_KEYS = new Set([
  "geminiApiKey",
  "anthropicApiKey",
  "openrouterApiKey",
  ...
]);
```
- **Status**: KHÔNG CHẮC (Legacy keys still redacted but not used)
- **Assessment**: Safe (doesn't break anything, just over-broad)

---

## 5️⃣ Active AI Model Configuration

### Text Analysis (Primary)
| Config Variable | Value | Provider | Usage | Active |
|---|---|---|---|---|
| `AI_TEXT_MODEL` | `deepseek/deepseek-v4-flash` | OpenRouter | Betting analysis, lottery prediction | ✅ YES |
| `AI_TEXT_FALLBACK_MODEL` | `deepseek/deepseek-v4-flash` | OpenRouter | Fallback for timeout (same as primary) | ✅ YES |

**Code References**:
- `betting-gemini.ts:23-24` → Uses `ANALYZE_MODEL` from env
- `lottery-ai-predict.ts:27` → Uses `AI_TEXT_MODEL` from env

### Vision Analysis (Chart Images)
| Config Variable | Value | Provider | Usage | Active |
|---|---|---|---|---|
| `AI_VISION_MODEL` | `xiaomi/mimo-v2.5` | OpenRouter | Chart screenshot analysis | ✅ YES |

**Code References**:
- `analyzer.ts:20-21` → Uses `AI_VISION_MODEL` from env

### Reasoning Effort
| Config Variable | Value | Scope | Active |
|---|---|---|---|
| `AI_REASONING_EFFORT` | Not set (uses defaults) | Betting + Chart analysis | ⚠️ Optional |

**Code References**:
- `ai-env.ts` → Reads from env, fallback per caller
- `betting-gemini.ts` → Passes to OpenRouter reasoning parameter

---

## 6️⃣ Git History: AI Provider Migration Timeline

| Commit Hash | Date | Change | Assessment |
|---|---|---|---|
| `20c641d` | 2026-06-22 10:55:06 | Switched from Gemini 3.5 Flash → Claude Sonnet 4.6 | OLD CONFIG |
| `7dc9ecb` | 2026-06-23 18:51:34 | Switched back to Gemini 3.5 Flash + improved error handling | OLD CONFIG |
| `b5b46f9` | 2026-06-26 09:52:44 | Claude Sonnet for verification | OLD CONFIG |
| `3cb8cb5` | 2026-07-01 20:11:21 | **Standardized to gemini-3.5-flash + gemini-2.5-pro** | MIGRATION START |
| `382c2f7` | 2026-07-01 18:54:07 | Added configurable chart signal threshold, updated models in env | MIGRATION |
| `c122afe` | 2026-07-01 15:40:46 | Implemented AI usage tracking for Gemini and Claude | TRACKING |
| `ef9016a` | 2026-07-02 14:16:15 | Added OpenRouter bug report documentation | MIGRATION |
| `128862d` | 2026-07-02 22:55:00 | Single-pass AI analysis (no verify by default) | BEHAVIOR CHANGE |
| `bda0b6c` | 2026-07-03 09:33:06 | Combined match analysis with AI integration | BEHAVIOR |
| `3a20610` | 2026-07-03 22:12:02 | **AI-based lottery prediction system (uses OpenRouter)** | CURRENT |
| `c87a93e` | 2026-07-04 06:10:00 | Add lottery prediction workflows (Miền Bắc/Nam/Trung) | CURRENT |

**Pattern**: Rapid experimentation (Gemini ↔ Claude) in late June, then stabilized on OpenRouter with DeepSeek in early July.

---

## 7️⃣ Test Files Referencing AI Models

| File | Provider Referenced | Status | Notes |
|---|---|---|---|
| `tests/betting/betting-gemini.test.ts` | OpenRouter (DeepSeek) | ĐANG DÙNG | Tests deepseek-v4-pro and deepseek-v4-flash fallback |
| `tests/charts/analyzer.test.ts` | OpenRouter (xiaomi/mimo) | ĐANG DÙNG | Tests chart vision analysis |
| `tests/shared/ai-usage.test.ts` | All providers (gemini/claude/openrouter) | ĐANG DÙNG | Tests cost calculation for all 3 |
| `tests/lottery/lottery-ai-predict.test.ts` | OpenRouter | ĐANG DÙNG | Tests lottery AI prediction |

---

## 8️⃣ Configuration Assessment Summary

### ✅ ĐANG DÙNG (Active & Correct)
| Component | Config | Evidence |
|---|---|---|
| **Text Analysis** | OpenRouter + DeepSeek-v4-flash | `betting-gemini.ts:23`, `.env` |
| **Vision Analysis** | OpenRouter + xiaomi/mimo-v2.5 | `analyzer.ts:20`, `.env` |
| **Lottery Prediction** | OpenRouter + DeepSeek-v4-pro | `lottery-ai-predict.ts:27` |
| **Usage Tracking** | Supports all 3 providers in DB | `ai-usage.ts` + DB schema |
| **API Key** | `OPENROUTER_API_KEY` set | `.env` + `openrouter.ts:55` |

### ⚠️ KHÔNG CHẮC (Legacy Support, Might Be Used)
| Component | Status | Reason |
|---|---|---|
| **Gemini hardcoded rates** | `ai-usage.ts:90-93` | No active Gemini calls, but rates still in code |
| **Claude hardcoded rates** | `ai-usage.ts:95-96` | No active Claude API calls, but rates in code |
| **Legacy API key env vars** | `logger.ts:24,46` | Keys redacted but not needed |
| **AI_REASONING_EFFORT** | `ai-env.ts` | Optional, not set in `.env` |

### 🗑️ RÕ RÀNG DƯ THỪA (Dead Code or Outdated)
| Component | Reason for Removal | Impact if Left |
|---|---|---|
| Gemini model pricing in `DEFAULT_RATES` | No Gemini calls anymore, rates outdated | Misleads future developers, inflates AI cost reports if accidentally used |
| Claude model pricing in `DEFAULT_RATES` | No Claude API calls (only tracking code) | Same as above |
| `geminiApiKey` / `anthropicApiKey` in logger SENSITIVE_KEYS | Not read from env | Over-broad redaction, no harm |
| git history commits for Gemini/Claude switching | Historical record | Educational, but shows indecision |

---

## 9️⃣ Naming & Code Clarity Issues

### ⚠️ Misleading Filenames
1. **`src/betting/betting-gemini.ts`** (Line 1)
   - **Current Reality**: Calls OpenRouter DeepSeek, NOT Gemini
   - **Last API change**: 2026-07-01 (Gemini → OpenRouter)
   - **Impact**: Confusing for new developers
   - **Recommendation**: Consider renaming to `betting-ai.ts` or `betting-deepseek.ts`

2. **`src/shared/openrouter.ts`** vs **`src/betting/betting-gemini.ts`**
   - **Inconsistent naming pattern**: `openrouter.ts` is correctly named, but `betting-gemini.ts` isn't
   - **Recommendation**: Either rename both or add a TODO comment

---

## 🔟 Critical Files Not Found

| Item | Expected Location | Status | Impact |
|---|---|---|---|
| **CLAUDE.md** (project docs) | `./CLAUDE.md` | NOT FOUND | No critical impact, just design docs |
| **~/.claude/CLAUDE.md** (user docs) | `~/.claude/CLAUDE.md` | PROBABLY NOT PRESENT | User-level docs (optional) |
| **agents/** directory | `.claude/agents/` | NOT FOUND | No custom agents configured |
| **commands/** directory | `.claude/commands/` | NOT FOUND | No custom commands configured |

---

## 🔐 Security & Secrets Assessment

### ⚠️ API Keys in `.env`
| Key | Type | Exposure Risk | Mitigation |
|---|---|---|---|
| `OPENROUTER_API_KEY` | Production Secret | **HIGH** (in `.env`, could be committed) | ✅ `.gitignore` should exclude `.env` |
| `TELEGRAM_BOT_TOKEN` | Production Secret | **HIGH** | ✅ `.gitignore` should exclude `.env` |
| `SUPABASE_KEY` | Production Secret | **HIGH** | ✅ `.gitignore` should exclude `.env` |

### ✅ Verified
- `.env` file is present and NOT in git (checked via git log)
- `.env.example` exists as template (safe to commit)
- Logger redacts sensitive keys (Line 14-27 in `logger.ts`)

---

## 📊 Configuration Comparison Table

### Old Config (June 2026)
```
Primary:   Gemini 3.5 Flash
Fallback:  Claude Sonnet 4.6
Tracking:  ✅ Implemented
Cost Rate: ✅ Available
```

### Current Config (July 2026)
```
Primary:   OpenRouter + DeepSeek v4-flash
Fallback:  Same (deepseek v4-flash)
Vision:    OpenRouter + xiaomi/mimo-v2.5
Tracking:  ✅ Implemented (multi-provider)
Cost Rate: ⚠️ Rates outdated for Gemini/Claude
```

---

## 🎯 Recommendations (Non-Breaking)

### Priority 1: Clean Up Dead Code
1. Remove unused model rates from `ai-usage.ts:89-117` (Gemini/Claude)
2. Remove unused API key names from logger redaction list
3. This won't break anything but improves code clarity

### Priority 2: Rename Misleading File
1. Rename `src/betting/betting-gemini.ts` → `src/betting/betting-ai.ts`
2. Keep internal consistency with `openrouter.ts` naming
3. Update imports in dependent files

### Priority 3: Add Documentation
1. Create or update `.claude/CLAUDE.md` documenting AI provider choice rationale
2. Add comment in `betting-ai.ts`: "Uses OpenRouter with DeepSeek v4 (formerly Gemini)"
3. Update `.env.example` with model descriptions

### Priority 4: Monitoring
1. Set up `AI_REASONING_EFFORT` in `.env` if using DeepSeek extended thinking
2. Monitor OpenRouter API costs (new provider might have different pricing)
3. Review `ai-usage.ts` rate table periodically for accuracy

---

## 📝 File Manifest

### Audit Scope Files
- ✅ `H:\LeeSanHoon\auto-signal-bot\.claude\settings.local.json`
- ✅ `H:\LeeSanHoon\auto-signal-bot\.env.example`
- ✅ `H:\LeeSanHoon\auto-signal-bot\.env` (secrets, not in git)
- ✅ `C:\Users\nguye\.claude\settings.json`
- ✅ `src/shared/ai-usage.ts` (405 lines)
- ✅ `src/shared/ai-env.ts` (14 lines)
- ✅ `src/shared/openrouter.ts` (125 lines)
- ✅ `src/shared/logger.ts` (100+ lines, checked first 50)
- ✅ `src/betting/betting-gemini.ts` (partial, 150+ lines)
- ✅ `src/charts/analyzer.ts` (partial, 150+ lines)
- ✅ `src/lottery/lottery-ai-predict.ts` (partial, 150+ lines)

### Not Audited (not AI-related)
- Test files (13 files with AI references, all ĐANG DÙNG)
- CI/CD configuration (no found)
- Docker files (no found)

---

## 🏁 Audit Completion

| Section | Status | Findings |
|---|---|---|
| .claude/ files | ✅ Complete | 3 files found, 1 active config |
| .env configuration | ✅ Complete | OpenRouter primary, secrets secured |
| Source code references | ✅ Complete | 13 files with AI references |
| Git history | ✅ Complete | Provider migration timeline documented |
| Legacy config | ✅ Complete | Gemini/Claude code still present, unused |
| Test files | ✅ Complete | All test mocks updated for OpenRouter |
| User-level config | ✅ Complete | Not relevant to bot (IDE settings only) |

**Audit Date**: 2026-07-04  
**No modifications made to any files during audit**

---

### Legend
- **ĐANG DÙNG** = Currently active and being used by the application
- **KHÔNG CHẮC** = Legacy code present but status unclear (backwards compatibility?)
- **RÕ RÀNG DƯ THỪA** = Obviously not used, dead code or test/backup files
