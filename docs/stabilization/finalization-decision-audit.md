# Finalization decision audit (F4)

Дата: 2026-06-16. Цель: задокументировать, как принимается решение «ответ завершён» (источник недетерминизма из логов: `Finalization deferred`, `Finalization forced`, `Stable pending auto-finalization`), и зафиксировать единый терминальный авторитет.

## Два разных слоя — не путать

| Слой | Где | Что решает | Характер |
|---|---|---|---|
| **Терминальная сверка статусов** | `shared/finalization-controller.js` (`FinalizationController.tryFinalize`) | можно ли *записать* терминальный статус поверх уже зафиксированного (rank-upgrade, downgrade-ignore, duplicate-ignore, recovered-upgrade) | чистая функция, идемпотентна, покрыта `tests/finalization-controller.test.js` ✅ |
| **Тайминг «ответ готов»** | `background/job-orchestrator.js` (`handleStreamFinalizationDeferred` ~1860, `scheduleStablePendingAutoFinalization` ~1997) | *когда* при активной генерации считать pending-ответ финальным | таймеры + пороги + DOM-пробы, гонки stop/busy |

Терминальная сверка — **единственный** авторитет на запись статуса, и он централизован. Это здоровая часть. Риск недетерминизма — во втором слое (тайминг).

## Поток решения тайминга (deferred finalization)

Вход: pending-ответ есть, но страница может всё ещё генерировать. Состояние страницы `state = { active, stopVisible, busyVisible }` (DOM-проба `detectActiveGenerationInPage`).

```
elapsedMs = now - generationStart
evidence  = AnswerEvidence.shouldFinalizeWithEvidence(pendingAnswerEvidence, {minChars})

streamingMaxReached  = active && elapsedMs >= DEFER_STREAM_FINAL_MAX_MS
hasCompletionEvidence = lifecycleReadyAt || answerCompleteDetectedAt
                        || lifecycleReadyMeta.state==='COMPLETE'
                        || completionReason~/timeout/ || source~/snapshot/
stableAnswerForceFinal = active && !stopVisible
                        && pendingLen >= DEFER_STREAM_STABLE_FORCE_MIN_CHARS
                        && (elapsedMs >= DEFER_STREAM_STABLE_FORCE_MS || hasCompletionEvidence)
evidenceCanOverrideStop = evidence.reason ∈ {timeout_with_text, hardstop_with_text, materialize_with_text}
evidenceForceFinal = evidence.ok && active && (!stopVisible || evidenceCanOverrideStop)

IF active && !streamingMaxReached && !stableAnswerForceFinal && !evidenceForceFinal:
    → DEFER: status=RECEIVING, отправить LLM_PARTIAL_RESPONSE,
      scheduleStablePendingAutoFinalization(...),
      через DEFER_STREAM_FINAL_RECHECK_MS — triggerResponseCollectionPing (recovery, 3 попытки)
ELSE:
    → FINALIZE через handleLLMResponse:
        completionReason = streamingMaxReached ? 'streaming_incomplete'
                         : evidence.ok ? evidence.reason : 'generation_inactive'
        partial = streamingMaxReached || pendingAnswerEvidence.partialAllowed
```

`scheduleStablePendingAutoFinalization` (через `STABLE_PENDING_AUTO_FINALIZE_MS`): повторно пробит DOM; если `active && stopVisible` — снова откладывает (лог `…deferred (stop visible)`), иначе финализирует с `forceTerminalSuccess:true, lateCollectFinal:true`.

## Пороги (единый справочник)

| Константа | Значение | Роль |
|---|---|---|
| `DEFER_STREAM_FINAL_RECHECK_MS` | 8000 | период перепроверки во время defer |
| `DEFER_STREAM_FINAL_MAX_MS` | 180000 | жёсткий потолок: после него финал как `streaming_incomplete` (→ PARTIAL) |
| `DEFER_STREAM_STABLE_FORCE_MS` | 30000 | при пропавшей stop-кнопке и длинном тексте — форсить финал |
| `DEFER_STREAM_STABLE_FORCE_MIN_CHARS` | 1200 (`AnswerLengthPolicy.DEFAULTS.stableForceMinChars`) | мин. длина для stable-force |
| `DOM_SNAPSHOT_RECOVERY_MIN_CHARS` | 80 (`…minTerminalChars`) | мин. длина для evidence-терминальности |

## Разбор кейса Le Chat из лога `All Logs 20260616_15-47`

- `active && stopVisible` держались ~232с → `stableAnswerForceFinal` не срабатывал (требует `!stopVisible`), `evidenceForceFinal` тоже (stop виден, reason не из override-набора) → корректно **deferred**.
- Когда stop-кнопка исчезла: `len=35141, elapsed=232243ms, stop=false` → `stableAnswerForceFinal` сработал → `Finalization forced (stable answer evidence)`, итог **PARTIAL** (`streaming_incomplete`, т.к. достигнут потолок логики).
- **Вывод:** сам тайминг-слой отработал по контракту. Видимый «3-минутный шум» в логе — это (а) пинги перепроверки каждые 8с и (б) спам `RECOVERY_INTENT_DENIED` от супервайзера. (б) устранён в F1; (а) — функционально корректно, но избыточно подробно.

## Вердикт

- Терминальная сверка статусов централизована и протестирована — **трогать не нужно**.
- Тайминг-слой **функционально корректен** на разобранном кейсе; явного бага не найдено. Это «верно, но шумно и зависит от множества порогов» — менять пороги/структуру вслепую запрещено ТЗ и рискованно.

## Рекомендованные follow-up (с ревью, НЕ вслепую)

1. **Снизить шум перепроверок**: при повторных defer с неизменной длиной увеличивать интервал (backoff) вместо фиксированных 8с — по аналогии с F1. Низкий риск, заметное снижение шума телеметрии.
2. **Свойство-тест на тайминг** через `tests/log-replay-harness`: прогон реального лога Le Chat → ассерт, что итог = PARTIAL и нет дублей финализации. Закрепит контракт без изменения логики.
3. **Свести пороги в один конфиг** (`config/timing.js`/`AnswerLengthPolicy`) — сейчас часть в `job-orchestrator`, часть в policy. Чисто организационно, без смены значений.

Эти пункты — кандидаты в следующий этап, а не в текущий релизный фикс.
