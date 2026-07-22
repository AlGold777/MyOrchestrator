# Answer-mechanics review — разбор и follow-up

Дата: 2026-06-16. Источник: внешнее ревью «механика получения ответов LLM» (мульти-модельный экспорт). Здесь — что из него актуально, что устарело, и что взято в работу.

## Статус идей ревью

| Идея ревью | Статус | Комментарий |
|---|---|---|
| Единый `AnswerEvidence` контракт | **уже есть** | `shared/answer-evidence.js` (`buildAnswerEvidence`, `shouldFinalizeWithEvidence`) |
| Единый `FinalizationController` (single-writer статуса) | **уже есть** | `shared/finalization-controller.js` (`tryFinalize`, rank/idemp.); см. `finalization-decision-audit.md` |
| `RecoveryBudget` контракт по модели/ран | **есть + доработан** | `RECOVERY_BUDGET_*` + `consumeRecoveryBudget`; модель-aware бюджет добавлен в 2.80.41 |
| Инференс `promptSubmittedAt` из valid evidence (Qwen false NO_SEND) | **частично есть** | `submitSource==='inferred_answer_evidence'` в `job-orchestrator.js` |
| Version drift (manifest vs package) | **закрыто** | синхронизированы (оба 2.80.4x) |
| Debate как отдельный turn-based слой | **сделано** | `disput/debate-engine.js` (envelope/turn/approval) |
| **P0.2 tri-state сигналов завершения** | **✅ сделано (2.80.41)** | см. ниже |
| **P1.2 «ответ принадлежит этому промпту»** | частично (F6) → follow-up | ниже |
| **P1.3 content-classifier вместо textLength≥20** | follow-up | ниже |
| **P0.5 manual ping `forceTerminalSuccess`** | follow-up | ниже |
| Распил `results.js` (P1) | известный долг (F7) | вне релизного объёма |

## Сделано: P0.2 tri-state завершения (2.80.41)

`content-utils/response-lifecycle-detector.js`: сигнал стоп-кнопки переведён в tri-state `true | false | 'unknown'`. Раньше «стоп-кнопку не нашли» = «генерация закончилась», что смешивало два случая: (A) кнопки реально нет (завершено), (B) проба не отработала (DOM не запросить) → мы НЕ знаем. Теперь:
- `probeTrusted` = смогли запросить DOM и не все запросы упали;
- `stopButtonSignal` = `true` (найдена) / `false` (проба прошла, не найдена) / `'unknown'` (проба недостоверна);
- завершение (`ANSWER_COMPLETE_DETECTED`/`LLM_RESPONSE_READY`) инферится **только** при `stopButtonSignal === false`; `'unknown'` не даёт ни completion, ни +0.20 к confidence (правило `unknown !== false`).
- Заодно починен латентный баг: regex стоп-кнопки `/stop/i` **пропускал локализованные** `Останов/Detener/Arrêter` → присутствующая стоп-кнопка читалась как отсутствующая → ложное завершение. Regex расширен.

Тест: `tests/lifecycle-tristate-completion.test.js` (локализованная стоп-кнопка блокирует завершение; чистая страница завершается).

## Follow-up (следующий этап, с ревью — не вслепую)

### P1.2 — «ответ появился после этого промпта» (усиление F6)
F6 уже якорит на сигнатуру текста предыдущего ответа. Ревью предлагает строже, на уровне DOM-узла:
`observedAfterDispatch`, `firstSeenAt`, `lastChangedAt`, `domNodeFingerprint`, `conversationTurnIndex`. Правило terminal-success: `firstSeenAt >= promptSubmittedAt - tolerance` ИЛИ узел добавлен/изменён после диспатча. Усиливает защиту от подхвата последнего старого ответа в чате.

### P1.3 — content-classifier вместо `textLength >= 20`
Жёсткий порог длины ловит и шум (>20 симв.), и режет короткие валидные ответы («Да.»). Завести `AnswerContentClassifier → valid | short_valid | prompt_echo | ui_noise | provider_error | empty | partial_stream` и завязать terminal-eligibility на класс, а не на длину. Свяжет воедино уже точечные guard'ы (suspect-short, prompt_echo).

### P0.5 — manual ping не должен иметь прямой `forceTerminalSuccess`
Сейчас manual/late-collect пути ставят `forceTerminalSuccess: true` (job-orchestrator). Ревью: manual ping должен выдавать `AnswerEvidence`, а terminal-решение — только через `FinalizationController`. Заменить прямой override на `manualIntent: 'try_finalize_if_valid'`. Снижает риск ложного SUCCESS из снапшота/эха на слабом evidence.

### P1.1 — селекторы по уровням доверия + связь с extraction strategy
`SelectorTier` (primary_assistant → … → last_resort_generic); `last_resort_generic` не даёт terminal-success без доп. подтверждений (текст изменился после диспатча, не prompt-echo, стабилен, нет индикатора генерации). И связать selector-health со стратегией извлечения: при `broken` профиле демотить primary-селектор. Это же расширит источники `'unknown'` для tri-state (P0.2) — естественная синергия.
