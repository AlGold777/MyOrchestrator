# Acceptance report — стабилизационный слой 2.80.00

- Дата: 2026-06-13
- Основание: `docs/stabilization/TZ-stabilization-layer.md`
- Baseline: 51 suites / 255 tests после этапа 1 (см. `baseline-test-report.md` и change-log)

## 1. Тесты

`npm test -- --runInBand`: **59 suites passed / 59, 280 tests passed / 280, 0 failed.**

Новые тестовые сьюты (все зелёные):
- `tests/run-ownership-guard.test.js`
- `tests/transport-policy.test.js`
- `tests/circuit-breaker-unified.test.js`
- `tests/run-error.test.js`
- `tests/error-output-helper.test.js`
- `tests/rate-limit-alarms.test.js`
- `tests/judge-prompt-builder.test.js`
- `tests/evaluation-ready-handshake.test.js`
- `tests/remote-selectors-signature.test.js`

## 2. Синтаксис

`node --check` пройден для всех изменённых `.js` файлов (background, shared, results, selectors-config, tos-consent, scripts).

## 3. Контрольные grep-проверки (все чистые)

| Проверка | Результат |
|---|---|
| `handleLLMResponse(llmName, "Error..."` в background/ | пусто |
| `startsWith('Error:')` в results.js | пусто |
| `scheduleAfterRateLimit` в background/ | пусто |
| `circuitBreakerState` в background/, shared/ | пусто |
| `sucsefull` | пусто |

## 4. Tooling

- `node scripts/sign-selectors.js keygen` → пара JWK сгенерирована.
- `node scripts/sign-selectors.js sign <payload> <key>` → конверт `selectors-override.signed.v1` корректен (проверено e2e в сессии; приватный ключ в репозиторий не коммитился).

## 5. Версия

- `manifest.json`: 2.74.136 → **2.80.00**
- `package.json`: 0.1.1 → **2.80.00** (рассинхрон версий устранён)
- Запись добавлена в `docs/CHANGELOG.md`.

## 6. Ручной смоук (требует человека/браузера) — НЕ выполнен в этой сессии

Следующие пункты чек-листа этапа 10 требуют загрузки расширения в Chrome и не могут быть выполнены автономно в этой среде. Их нужно прогнать перед сабмитом в стор:

1. `chrome://extensions` → Load unpacked → расширение загружается без ошибок SW (проверить консоль service worker на ошибки importScripts).
2. Страница результатов: появляется consent-оверлей; после принятия — пропадает и больше не показывается.
3. Запуск рана на 2 моделях: вкладки открываются, ответы собираются.
4. Повторный запуск во время рана → уведомление «Another run is already in progress».
5. В телеметрии каждой модели есть `TRANSPORT_DECISION ... api_transport_feature_disabled`.
6. Judge-раунд: в логах диспатча judge-промпт содержит маркеры `<<<RESPONSE <nonce> ... START>>>`.

## 7. Открытые пункты (за пределами кода)

- R1/R2 из `risk-register.md` — решения уровня product owner (стратегия деградации, ревизия permissions перед сабмитом).
- Для включения remote-канала селекторов: `npm run selectors:keygen`, приватный ключ — в менеджер секретов, публичный JWK — в `REMOTE_SELECTORS_PUBLIC_KEY_JWK` (`background/remote-selectors.js`).
