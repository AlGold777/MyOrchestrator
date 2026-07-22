# Shared Legacy Services / UI Constraints / Prompt Ledgers

## Shared Legacy Services Ledger

| ID | Legacy source | Capability | Classification | New owner | Status |
|---|---|---|---|---|---|
| S-1 | debate-response-acceptance.js | Acceptance validation (kind/taskClass/maxWords) | Universal (уже нейтральный) | Acceptance Service (сохраняется) | INTEGRATED |
| S-2 | debate-state-delta.js | StateDelta propose/apply | Universal (нейтральный) | StateDelta (сохраняется) | INTEGRATED |
| S-3 | debate-prompt-compiler.js / debate-prompt-catalog.js | Prompt compilation, repairPrompt | Universal | PromptCompiler / PromptCatalog (сохраняются) | INTEGRATED |
| S-4 | debate-run-store.js | Event log + aggregate | Universal | DebateRunStore (расширен новыми событиями нового path) | INTEGRATED |
| S-5 | debate-execution-context.js | AbortController, approval promise waiters | Historical workaround (Promise-based Continue) | Orchestrator persisted lifecycle | INTEGRATED (новый path не использует promise waiters) |
| S-6 | debate-correlation-guard.js | Dispatch correlation | Universal | StageExecutor | INTEGRATED |
| S-7 | debate-run-services.js resolveServiceRoles | Synthesizer/auditor role resolution | Universal | Planner participant selection | INTEGRATED |
| S-8 | debate-convergence.js / debate-stagnation-warning.js | Convergence/stagnation signals | Universal | Planner stagnation inputs | CLASSIFIED |

## Legacy UI Constraints Ledger

| ID | UI behavior | Constraint | Decision | Status |
|---|---|---|---|---|
| U-1 | Participant selector count | Preset-driven defaults (defaultModelCount) | KEEP_AS_EXPLICIT_POLICY (initial config only) | CLASSIFIED |
| U-2 | Approval controls (approveTurn) | Duel-only approval | REPLACE: единый ApprovalPolicy для всех presets | CLASSIFIED |
| U-3 | Pause/Continue buttons | немедленный PAUSED без QUIESCING | REPLACE: три состояния Pause requested / Finishing stage / Paused | CLASSIFIED |
| U-4 | Synthesizer/auditor selects | 'auto' отклоняется runner-ом | REMOVE_AS_LEGACY | CLASSIFIED |

Hardcoded UI limits: не обнаружено числовых hardcode > policy; полная UI-инвентаризация остаётся открытой (панель pipeline вне scope этого прохода).

## Legacy Prompt Ledger

| ID | Prompt | Purpose | Output contract | Visibility | Status |
|---|---|---|---|---|---|
| P-1 | buildInitAPrompt / buildInitBPrompt | opening position (B silent) | position text | A public, B private до release | CLASSIFIED |
| P-2 | turn route prompt (prepareRoute) | critique/response | free text + header | public | CLASSIFIED |
| P-3 | buildFinalWordPrompt | final position | required section «Эволюция позиции» | public | CLASSIFIED |
| P-4 | buildFinalSynthesisPrompt / buildTriadSynthesisPrompt | synthesis | sections: Вердикт, Что устояло, Позиции меньшинства, Нерешённые вопросы, Выводы синтезатора, Уверенность и основания | public | CLASSIFIED |
| P-5 | audit prompt (runSynthesisAudit) | audit | status + issues text | system | CLASSIFIED |
| P-6 | repairPrompt (Compiler) | format repair | original contract + missing sections | system | INTEGRATED (нейтральный) |
| P-7 | checkpoint / state extraction prompts | state map extraction | structured artifacts | system | CLASSIFIED |

Prompt migration (§9.3) не завершена: legacy prompts не удаляются; нейтральные promptContractId введены в новом path, golden-tests legacy prompts сохранены в существующих тестах.

## Removal Gate Status (все topologies)

Gate §21: **НЕ ПРОЙДЕН**. Выполнено: 1–8 (inventories, ledgers, universal capabilities → новые владельцы, explicit policies, tests нового path). Не выполнено: 13 (production switch по умолчанию выключен флагом), 14–16 (legacy path вызывается production-кодом, flag rollback требуется, architecture review не проведён). Физическое удаление legacy запрещено контрактом до прохождения gate.
