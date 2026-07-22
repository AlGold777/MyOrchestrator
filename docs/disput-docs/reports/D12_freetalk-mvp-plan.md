# D12. FreeTalk MVP — план реализации

Этот документ является исполнимым планом внедрения профилей pipeline, живого
дела, карты состояния и FreeTalk в Disput.

Правило отметки: `Done:` ставится сразу после номера только после реализации и
проверки пункта. Частично выполненный пункт не получает отметку.

## I. Подготовка и совместимость

1. Done: Зафиксировать существующие пути Duel, Triad, Multi, moderator и autonomous тестами.
2. Done: Зафиксировать хранение, восстановление, остановку, retry и финализацию текущих run.
3. Done: Оформить Duel/Triad/Multi как встроенные профили, а не отдельные основы архитектуры.
4. Done: Добавить feature flag для нового профильно-карточного пути и безопасный возврат к старому UI.

## II. Общее дело Disput

5. Done: Создать версионированную схему дела: задача, профиль, участники, артефакты, снимки и исход.
6. Done: Реализовать тип Claim с историей статусов и связей.
7. Done: Реализовать тип Objection с target, axis, severity, requiredAction, owner и возрастом.
8. Done: Реализовать тип Evidence с tier, provenance, target и verification status.
9. Done: Реализовать тип Revision без незаметной перезаписи исходного claim.
10. Done: Реализовать AxisVerdict, Dissent и HumanDecision.
11. Done: Добавить сквозное provenance для каждого элемента дела.
12. Done: Добавить проверку ссылочной целостности и отклонение сиротских ссылок.
13. Done: Создать append-only журнал изменений дела.
14. Done: Создавать детерминированный snapshot после каждого принятого изменения.

## III. Надёжное хранение

15. Done: Сохранять дело в chrome.storage.local после каждого принятого ответа.
16. Done: Добавить version manifest дела, профиля, prompt pack, карты и движка.
17. Done: Добавить миграции старых сохранённых run и pipeline store.
18. Done: Восстанавливать незавершённое дело после перезагрузки.
19. Done: Отклонять stale и duplicate ответы по устойчивым correlation ID.
20. Done: Добавить экспорт, импорт и удаление дела.
21. Done: Добавить понятный degraded status при неполном восстановлении или dropout.

## IV. Профили pipeline

22. Done: Создать паспорт профиля: id, version, status, taskTypes, parent и engine range.
23. Done: Отделить роли профиля от назначения конкретных моделей.
24. Done: Добавить ProblemSpec: цель, тип задачи, ожидаемый результат, ограничения и риск.
25. Done: Создать каталог подключаемых элементов с входом, выходом, trigger и failure policy.
26. Описывать этапы через профиль, а не через ветвления Duel/Triad в runtime.
27. Done: Реализовать компиляцию профиля в неизменяемый план запуска.
28. Done: Реализовать валидацию ролей, этапов, переходов, бюджета и prompt contracts.
29. Done: Создать и версионировать prompt pack для пар stage × role.
30. Done: Расширить pipeline store ссылкой на профиль и его версию.
31. Done: Добавить UI создания, копирования, проверки, сохранения, импорта и экспорта профиля.
32. Done: Мигрировать встроенные и пользовательские pipelines на профильную схему.

## V. Система триггеров

33. Done: Создать событие изменения дела с точным перечнем добавленного и изменённого.
34. Done: Создать каталог детерминированных триггеров на основе состояния дела.
35. Done: Связать каждый trigger с действием, ролью, приоритетом и режимом подтверждения.
36. Done: Реализовать очередь автоматически созданных задач.
37. Done: Добавить дедупликацию, cooldown, предел параллельности и защиту от циклов.
38. Done: Добавить объяснение «почему элемент включён» в trace и UI.
39. Done: Поддержать automatic, ask-human и human-only режимы одного действия.
40. Done: Добавить budget, context pressure, stagnation и dropout triggers.

## VI. Проекция карты состояния

41. Done: Создать карту как детерминированную проекцию дела без отдельного LLM-вызова.
42. Done: Проецировать claims, objections, evidence, revisions, dissent и limitations.
43. Done: Проецировать оси, динамику, blockers, readiness и terminal outcome.
44. Done: Проецировать связи и историю элемента для Graf и Structure.
45. Done: Добавить промежуточный и финальный экспорт карты.
46. Done: Гарантировать доступность карты при error, budget limit, stagnation и manual stop.

## VII. Интеграция карты в Disput

47. Done: Добавить сворачиваемый блок карты сразу под сохранёнными pipelines.
48. Done: В свёрнутом виде показать дело, профиль, этап, readiness, blockers и live status.
49. Done: В раскрытом виде добавить выбор run и переключатель Structure/Graf.
50. Done: Вынести рабочее тело карты в широкую область Disput, не сжимая Graf в sidebar.
51. Done: Разделить UI карты на самостоятельные модули и scoped styles.
52. Done: Подключить карту к сохранённому делу сначала в read-only режиме.
53. Done: Подключить живые обновления без сброса режима, фильтра, фокуса и прокрутки.
54. Done: Добавить drawer с provenance, связями, историей и переходом к исходному ответу.

## VIII. Доработка Structure

55. Done: Удалить дубли метрик, временной шкалы и кнопки возврата к live.
56. Done: Показать связи и счётчики objections/evidence прямо в карточках.
57. Done: Добавить переход к родителю, связанному элементу и в Graf.
58. Done: Сортировать claims, objections и evidence по риску и срочности.
59. Done: Добавить блок «Требует внимания» с влиянием на результат.
60. Done: Добавить объяснимую готовность к синтезу.
61. Done: Заменить независимые фильтры на Всё/Открытые/Blocking/Dissent.
62. Done: Исправить поиск, счётчик скрытого и пустые состояния.
63. Done: Добавить автоматический diff выбранного этапа с предыдущим.
64. Done: Показать requiredAction, owner и возраст blocker.
65. Done: Сделать оси интерактивными и связать их с элементами.
66. Done: Доработать A–B comparison без молчаливого лимита элементов.
67. Done: Сократить карточки, реализовать раскрытие текста и удалить заглушки.
68. Done: Обеспечить адаптивность, клавиатуру, тачпад и темы.

## IX. Graf

69. Done: Строить Graf по реальным связям, не хранить координаты в деле.
70. Done: Различать objection, evidence, revision, dissent, blocking и limitation.
71. Done: Добавить focus, grouping, zoom, поиск и автоматическое размещение.
72. Done: Синхронизировать выбранный снимок, фильтр, сравнение и элемент со Structure.

## X. Связь карты и исполнения

73. Done: Принимать решения о продолжении по делу, а не по самоотчёту модели.
74. Done: Разделить TechnicalStatus и EpistemicOutcome.
75. Done: Добавить human actions: approve/reject closure, assign, request evidence, stop и synthesize.
76. Done: Сохранять карту и объяснение исхода при любом терминальном пути.

## XI. Миграция пробных pipelines

77. Исполнить Duel через общий профильный runtime.
78. Исполнить Triad через общий профильный runtime.
79. Исполнить Multi через общий профильный runtime.
80. Сравнить старые и новые пути на одинаковых fixtures и живых задачах.
81. Удалить специальные обходы после подтверждения совместимости.

## XII. FreeTalk MVP

82. Done: Создать профиль FreeTalk без фиксированного числа моделей и раундов.
83. Done: Добавить запуск с целью, пулом моделей, бюджетом, автономностью и инструментами.
84. Done: Реализовать blind стартовые позиции.
85. Done: Реализовать цикл: изменение дела → triggers → очередь → dispatch → acceptance → карта.
86. Done: Добавить triggers: uncriticized claim, blocking, fact dispute и weak evidence.
87. Done: Добавить triggers: revision recheck, contradiction, dissent и repetition.
88. Done: Добавить triggers: stagnation, context pressure, readiness и synthesis audit.
89. Done: Реализовать динамическое назначение ролей с запретом самопроверки.
90. Done: Реализовать параллельные независимые ветки и безопасное объединение.
91. Done: Реализовать selective context с защищёнными claims, blockers, dissent и axes.
92. Done: Реализовать resolved, partial, inconclusive, stagnation, budget и manual outcomes.
93. Done: Добавить UI FreeTalk: активные роли, очередь, причины, бюджет, pause и intervention.
94. Done: Добавить ручное подтверждение дорогих и рискованных действий в Alpha.

## XIII. Расширение тематическими pipelines

95. Done: Создать контракт добавления типов, ролей, осей, triggers, tools и секций карты.
96. Done: Добавить первый тематический профиль Deep Research поверх общей системы.
97. Done: Проверить, что тематическое расширение не требует изменения базового runtime.

## XIV. Проверка и выпуск

98. Done: Добавить unit tests схем, профилей, компиляции, triggers, очереди и карты.
99. Done: Добавить conformance tests события → дело → проекция → UI.
100. Done: Добавить recovery tests reload, duplicate, stale, timeout, dropout и migration.
101. Done: Добавить UI tests collapse, Structure, Graf, history, filters и responsive layout.
102. Провести prompt audit и gate надёжности extraction на живых run.
103. Сравнить single model, fixed Triad и FreeTalk при одинаковом бюджете.
104. Done: Выпускать read-only map, live map, profiles, triggers и FreeTalk отдельными флагами.
105. Done: Добавить rollback, telemetry без утечки содержимого и experiments log.

## XV. Документация

106. Done: Обновить D2_disput-architecture.md и D3_disput-architecture-boundaries.md.
107. Done: Обновить D7_disput-telemetry.md и UI/export contract.
108. Done: Обновить и отделить актуальные Duel/Triad/Multi specs от исторических планов реализации.
109. Done: Добавить нормативную спецификацию pipeline profiles и FreeTalk.
110. Done: Обновить project-overview.md, D19_disput-next-steps.md и D0_documentation-map.md.
111. Done: Добавить append-only запись в CHANGELOG.md с проверками.
112. Done: Провести финальную проверку ссылок, старых имён и противоречий документации.

## XVI. Rule intelligence и решения модератора

113. Done: Заменить бинарное подтверждение FreeTalk типизированным DecisionRequest с контекстными вариантами и effects.
114. Done: Добавить auto, assisted и manual policy выбора.
115. Done: Превратить trigger list профиля в параметризованные rule instances.
116. Done: Записывать fired и suppressed rules с точной причиной.
117. Done: Подключить shadow rule evaluation к общему checkpoint Duel, Triad и Multi без изменения их flow.
118. Done: Добавить profile-driven progress window и явный fallback при стагнации.
119. Done: Реализовать ровно один дополнительный human-authorized шаг без отключения будущих guards.
120. Done: Сохранять решения в RunStore, trace и DebateCase.
121. Done: Добавить межзапусковую аналитику fire rate и изменения карты после действия.
122. Done: Добавить страницу History в карту состояния.
123. Done: Добавить экспериментальный ModelSignal только как shadow-диагностику без влияния на дело и flow.
124. Done: Версионировать profile, run store, trace, state map и protocol contracts.
125. Done: Добавить unit и regression tests решений, rules, history и model signals.
126. Done: Перенумеровать документацию Disput, удалить дубликаты исторических ТЗ и обновить ссылки.
