Legacy Capability Extraction Contract v1.1
Disput Universal Discussion Engine
Нормативное дополнение к Technical Architecture Roadmap
Обязательный порядок удаления Duel / Triad / Multi / FreeTalk legacy implementation

1. Статус документа
1.1. Назначение
Настоящий документ определяет обязательный порядок анализа, переноса и удаления legacy-архитектуры Disput.
Документ применяется ко всем историческим execution paths, включая:
    1. Duel;
    2. Triad;
    3. Multi;
    4. FreeTalk;
    5. связанные runners;
    6. topology-specific FSM;
    7. topology-specific protocols;
    8. topology-specific prompt contracts;
    9. topology-specific UI validation;
    10. topology-specific participant limits;
    11. topology-specific degradation modes;
    12. topology-specific persistence fields;
    13. compatibility adapters;
    14. legacy pipeline presets.
1.2. Основная цель
Цель проекта — удалить legacy-организацию системы, но не потерять накопленные инженерные возможности.
Необходимо удалить:
    1. специализированные runners;
    2. topology routing;
    3. imperative sequencing;
    4. duplicated execution logic;
    5. скрытые preset-specific ограничения;
    6. устаревшие naming contracts.
Необходимо сохранить и перенести:
    1. полезные execution capabilities;
    2. recovery semantics;
    3. retry semantics;
    4. synchronization;
    5. response validation;
    6. prompt behavior;
    7. participant selection;
    8. dropout handling;
    9. audit behavior;
    10. UI-visible guarantees;
    11. proven failure handling.

2. Главный принцип
Удаляются не возможности, а исторический способ их организации.
Правильное преобразование:
Legacy Topology
→ Capability Inventory
→ Neutral Capability
→ New Architectural Owner
→ Verified Parity
→ Legacy Removal
Запрещённое преобразование:
Legacy Topology
→ Delete Files
→ Discover Lost Behavior Later

3. Основные инварианты
3.1. No deletion before extraction
Ни один legacy module не может быть удалён до завершения:
    1. Capability Inventory;
    2. Capability Classification;
    3. Capability Ledger;
    4. Characterization Tests;
    5. Prompt Regression Tests;
    6. Preset Independence Verification;
    7. New Owner Integration;
    8. Behavioral Parity Verification;
    9. Removal Gate.
3.2. No topology-owned capability
После переноса ни одна capability не должна называться или концептуально принадлежать:
    1. Duel;
    2. Triad;
    3. Multi;
    4. FreeTalk.
Примеры запрещённых целевых сущностей:
TriadBarrier
DuelRetry
MultiBatch
FreeTalkPlanner
Допустимые нейтральные сущности:
BarrierCompletionPolicy
SequentialDispatchStrategy
ParallelDispatchStrategy
RetryPolicy
DynamicPlanningPolicy
3.3. Preset is configuration only
Preset может определять только initial configuration.
После создания DebateCase preset не должен влиять на:
    1. maximum participant count;
    2. runtime routing;
    3. Planner implementation;
    4. Executor implementation;
    5. Stage lifecycle;
    6. response acceptance;
    7. recovery;
    8. Pause/Continue;
    9. synthesis availability;
    10. Human participation.
3.4. No hidden legacy constraint
Любое legacy-ограничение должно быть:
    1. перенесено в явную Policy;
    2. обосновано технической необходимостью;
    3. покрыто тестами;
либо полностью удалено.
Скрытые ограничения запрещены.
Пример скрытого ограничения:
FreeTalk allows only two models
Если архитектурная модель допускает произвольное количество Participants, такое ограничение является регрессией, пока оно не оформлено как явная policy.
3.5. UI/runtime consistency
UI не может ограничивать то, что runtime поддерживает, без явной Policy.
Runtime не может принимать конфигурацию, которую UI считает недопустимой, без единого validation contract.
Должен существовать один источник правил конфигурации.

4. Обязательный порядок удаления
Для каждого legacy execution path выполняются следующие этапы.
1. Source Inventory
2. Capability Inventory
3. Capability Classification
4. Constraint Inventory
5. Prompt Inventory
6. State and Event Inventory
7. UI Behavior Inventory
8. Characterization Tests
9. Capability Extraction
10. New Owner Integration
11. Preset Independence Verification
12. Behavioral Parity Verification
13. Production Path Switch
14. Dead Path Confirmation
15. Physical Removal
16. Repository Enforcement
Пропуск любого этапа запрещён.

5. Source Inventory
5.1. Объект анализа
Перед удалением необходимо определить полный вертикальный slice legacy-функциональности.
Нельзя анализировать только runner.
Для каждой topology исследуются:
    1. preset definition;
    2. profile definition;
    3. PlanCompiler branches;
    4. Validator rules;
    5. prompt contracts;
    6. prompt templates;
    7. protocol events;
    8. FSM;
    9. runtime state;
    10. runner;
    11. service functions;
    12. response acceptance;
    13. StateDelta integration;
    14. trace events;
    15. persistence;
    16. UI controls;
    17. participant selectors;
    18. start validation;
    19. pause/resume handlers;
    20. finalization handlers;
    21. tests;
    22. compatibility shims.
5.2. Source Map
Для каждой topology создаётся Source Map:
Layer	Files	Relevant symbols	Status
Preset			
Compiler			
Prompt			
Protocol			
FSM			
Runner			
UI			
Persistence			
Tests			
Без Source Map удаление запрещено.

6. Capability Inventory
6.1. Определение capability
Capability — наблюдаемая или инфраструктурная способность системы, имеющая самостоятельную ценность вне legacy topology.
6.2. Категории capabilities
Execution
    1. single dispatch;
    2. sequential dispatch;
    3. parallel dispatch;
    4. batched dispatch;
    5. barriers;
    6. quorum;
    7. retries;
    8. timeout;
    9. cancellation;
    10. partial completion;
    11. late response handling.
Planning
    1. participant selection;
    2. role allocation;
    3. trigger evaluation;
    4. next-action selection;
    5. stagnation detection;
    6. repetition suppression;
    7. synthesis readiness;
    8. finalization decision.
Response processing
    1. response assembly;
    2. streaming;
    3. acceptance validation;
    4. format repair;
    5. truncation detection;
    6. structured output validation;
    7. artifact extraction;
    8. no-state-change detection.
State
    1. checkpoint;
    2. StateDelta;
    3. artifact provenance;
    4. Goal update;
    5. state map update;
    6. conflict tracking;
    7. dissent preservation.
Resilience
    1. participant dropout;
    2. degraded continuation;
    3. restart;
    4. recovery;
    5. duplicate response protection;
    6. idempotency;
    7. interrupted execution reconciliation.
Finalization
    1. final words;
    2. synthesis;
    3. synthesis retry;
    4. audit;
    5. audit correction;
    6. completion without synthesis.
Human interaction
    1. approval;
    2. intervention;
    3. response assignment;
    4. manual continuation;
    5. correction;
    6. constraint insertion.

7. Capability Classification
Каждая найденная capability классифицируется.
7.1. Universal Capability
Полезна независимо от topology.
Подлежит переносу.
Примеры:
    1. sequential execution;
    2. parallel execution;
    3. barrier;
    4. quorum;
    5. retry;
    6. timeout;
    7. repair;
    8. checkpoint;
    9. audit;
    10. dropout recovery.
7.2. Policy
Не является самостоятельным executor behavior, но задаёт конфигурацию capability.
Примеры:
    1. completion mode;
    2. retry count;
    3. quorum size;
    4. participant independence requirement;
    5. finalization mode;
    6. visibility policy;
    7. maximum participant count.
Policy должна быть явной и topology-neutral.
7.3. Legacy Implementation
Конкретный код, реализующий capability внутри topology.
Подлежит удалению после переноса capability.
7.4. Historical Workaround
Временный hack или compatibility mechanism.
Подлежит удалению после подтверждения отсутствия необходимости.
7.5. Product Behavior
Пользовательски значимое поведение, которое должно быть подтверждено Product Owner или архитектурным контрактом.
Пример:
    1. необходимость final words;
    2. возможность approval между stages;
    3. видимость промежуточных ответов;
    4. количество Participants;
    5. продолжение после synthesis.
Нельзя автоматически считать любое legacy-поведение обязательным продуктовым требованием.

8. Constraint Inventory
8.1. Цель
Необходимо найти все ограничения, которые legacy topology накладывает на систему.
8.2. Проверяемые ограничения
Для каждой topology проверяются:
    1. minimum participant count;
    2. maximum participant count;
    3. fixed participant count;
    4. role count;
    5. synthesizer requirement;
    6. auditor requirement;
    7. round count;
    8. maximum waves;
    9. execution order;
    10. allowed Stage types;
    11. allowed Participant types;
    12. Human availability;
    13. Pause availability;
    14. Continue availability;
    15. Canvas editing availability;
    16. visibility restrictions;
    17. prompt length restrictions;
    18. provider restrictions;
    19. model capability restrictions;
    20. finalization restrictions.
8.3. Constraint Decision
Каждое найденное ограничение получает решение:
KEEP_AS_EXPLICIT_POLICY
REMOVE_AS_LEGACY
REPLACE_WITH_CAPABILITY_RULE
TEMPORARY_COMPATIBILITY_ONLY
8.4. Обязательное обоснование
Для KEEP_AS_EXPLICIT_POLICY необходимо указать:
    1. техническую причину;
    2. product requirement;
    3. владельца policy;
    4. validation location;
    5. тест.
8.5. Participant cardinality
Количество Participants не может зависеть от названия preset.
Должна существовать явная конфигурация:
interface ParticipantCardinalityPolicy {
  minimum: number;
  maximum: number | null;
  recommended?: number;
  reason?: string;
}
Если maximum = 2, должна существовать явная причина.
Без такой policy ограничение считается дефектом.

9. Prompt Inventory
9.1. Объект анализа
Для каждой topology необходимо сохранить знания, заложенные в prompts.
Анализируются:
    1. opening prompts;
    2. critique prompts;
    3. response prompts;
    4. verification prompts;
    5. checkpoint prompts;
    6. final words prompts;
    7. synthesis prompts;
    8. audit prompts;
    9. repair prompts;
    10. dropout prompts;
    11. Human-facing instructions.
9.2. Prompt Capability Extraction
Необходимо выделить:
    1. purpose;
    2. expected input;
    3. context selection;
    4. visibility;
    5. output contract;
    6. role instructions;
    7. failure behavior.
9.3. Prompt migration
Legacy prompt нельзя удалить, пока:
    1. существует нейтральный replacement;
    2. prompt contract test проходит;
    3. golden test проходит;
    4. visibility test проходит;
    5. output acceptance parity подтверждена.
9.4. Запрет prefix-only migration
Недостаточно переименовать:
triad_wave → wave_batch
Нужно проверить, не потерялась ли семантика prompt.

10. State and Event Inventory
Для каждой topology необходимо определить:
    1. какие данные хранятся только в runner-local state;
    2. какие данные persistent;
    3. какие поля являются topology-specific;
    4. какие events используются;
    5. какие events должны быть перенесены;
    6. какие state transitions полезны;
    7. какие transitions являются legacy.
Особое внимание:
    1. pause state;
    2. approval state;
    3. barrier state;
    4. wave counters;
    5. participant completion;
    6. retry attempt;
    7. dropout status;
    8. synthesis state;
    9. audit state;
    10. finalization state.

11. UI Behavior Inventory
11.1. Цель
Legacy capability может быть потеряна не только в runtime, но и в UI.
11.2. Проверяемые UI behaviors
    1. выбор Participants;
    2. число доступных Participants;
    3. сохранение выбранных Participants;
    4. порядок отображения;
    5. role assignment;
    6. synthesizer selection;
    7. auditor selection;
    8. none handling;
    9. Pause button behavior;
    10. Continue button behavior;
    11. Human message targeting;
    12. Canvas blocks;
    13. Canvas connections;
    14. insert-stage controls;
    15. validation errors;
    16. disabled controls;
    17. status display;
    18. partial response display;
    19. finalization display.
11.3. UI Constraint Trace
Каждое UI-ограничение должно ссылаться на:
    1. explicit policy;
    2. capability requirement;
    3. backend validation contract.
Hardcoded UI limits запрещены.

12. Capability Ledger
12.1. Обязательность
Для каждого legacy execution path создаётся отдельный Capability Ledger.
Без него удаление запрещено.
12.2. Формат
ID	Legacy source	Capability	Classification	New owner	Policy	Tests	Status
12.3. Статусы
DISCOVERED
CLASSIFIED
TESTED
EXTRACTED
INTEGRATED
PARITY_VERIFIED
LEGACY_REMOVED
12.4. Отдельные ledgers
Необходимо создать:
    1. Duel Capability Ledger;
    2. Triad Capability Ledger;
    3. Multi Capability Ledger;
    4. FreeTalk Capability Ledger;
    5. Shared Legacy Services Ledger;
    6. Legacy UI Constraints Ledger;
    7. Legacy Prompt Ledger.

13. Expected Capability Sources
Ниже указаны известные группы возможностей, которые обязательно должны быть проверены. Список не является исчерпывающим.
13.1. Duel
Проверить и при необходимости сохранить:
    1. sequential dispatch;
    2. ordered turn routing;
    3. approval boundary;
    4. public turn lifecycle;
    5. final words;
    6. retry semantics;
    7. participant dropout;
    8. self-retest;
    9. response ordering;
    10. cancellation between turns.
13.2. Triad
Проверить и при необходимости сохранить:
    1. parallel barrier;
    2. initialization barrier;
    3. quorum;
    4. wave synchronization;
    5. role differentiation;
    6. format repair;
    7. checkpoint;
    8. critical attack;
    9. meta-review;
    10. participant dropout;
    11. degraded continuation;
    12. barrier release conditions.
13.3. Multi
Проверить и при необходимости сохранить:
    1. arbitrary participant batch;
    2. large parallel dispatch;
    3. partial batch completion;
    4. participant selection per round;
    5. batch failure handling;
    6. synthesis retry;
    7. audit;
    8. audit correction;
    9. degraded continuation;
    10. participant capacity handling.
13.4. FreeTalk
Проверить и при необходимости сохранить:
    1. dynamic trigger evaluation;
    2. next-action planning;
    3. action contracts;
    4. participant routing;
    5. state-map checkpoint;
    6. stagnation detection;
    7. repetition detection;
    8. progress window;
    9. Human decision request;
    10. context compaction;
    11. dynamic repair;
    12. arbitrary participant count;
    13. optional synthesis;
    14. no-synthesis completion;
    15. dynamic continuation.
Особая проверка:
FreeTalk не должен сохранять историческое ограничение на двух Participants, если такое ограничение не оформлено явной policy.

14. Characterization Tests
14.1. Назначение
До извлечения capability создаются тесты текущего наблюдаемого поведения.
14.2. Проверяется observable behavior
Тесты не должны зависеть от:
    1. внутренних функций runner;
    2. private fields;
    3. topology-specific variable names;
    4. конкретного цикла.
14.3. Обязательные группы
Participant cardinality
    1. 1 Participant, если policy допускает;
    2. 2 Participants;
    3. 3 Participants;
    4. 4+ Participants;
    5. UI selection parity;
    6. runtime acceptance parity;
    7. persistence after reload.
Execution
    1. single;
    2. sequential;
    3. parallel;
    4. large batch;
    5. partial failure;
    6. retry;
    7. timeout;
    8. cancellation.
Barrier
    1. all completed;
    2. quorum;
    3. timeout;
    4. participant dropout;
    5. cancellation.
Prompt
    1. contract;
    2. golden output;
    3. visibility;
    4. repair;
    5. artifact IDs.
State
    1. StateDelta;
    2. no-state-change;
    3. checkpoint;
    4. Goal update;
    5. artifact provenance.
Finalization
    1. no synthesis;
    2. synthesis;
    3. synthesis + audit;
    4. continue after synthesis;
    5. manual stop.
Pause/Continue
    1. pause before dispatch;
    2. pause during dispatch;
    3. continue after reload;
    4. late response;
    5. stale stage reconciliation.

15. Capability Extraction
15.1. Правило
Capability извлекается в нейтральный компонент.
15.2. Примеры
Было:
TriadRunner.dispatchWave()
Стало:
ParallelDispatchStrategy
BarrierCompletionPolicy
Было:
DuelRunner.nextTurn()
Стало:
SequentialDispatchStrategy
Было:
MultiRunner.auditSynthesis()
Стало:
AuditStageDefinition
AuditExecutionPolicy
Было:
FreeTalkRunner.planNext()
Стало:
DebatePlanner
GoalGenerator
ConflictResolver
ParticipantSelector
15.3. Запрет копирования topology
Нельзя переносить topology-specific abstraction под новым именем без реального обобщения.

16. New Architectural Ownership
Каждая capability должна получить одного владельца.
Capability	Новый владелец
Sequential dispatch	StageExecutor
Parallel dispatch	StageExecutor
Streaming	StageExecutor / Stream Store
Retry	StageExecutor
Timeout	StageExecutor
Cancellation	Orchestrator + Executor
Barrier	Completion Policy
Quorum	Completion Policy
Participant selection	Planner
Goal prioritization	Planner
Trigger evaluation	Planner
Stagnation	Planner
Repetition suppression	Planner
Prompt compilation	PromptCompiler
Prompt templates	PromptCatalog
Response acceptance	Acceptance Service
Repair	Executor / Repair Service
Artifact extraction	Artifact Extraction Service
State update	StateDelta
Pause	Orchestrator
Continue	Orchestrator
Recovery	Orchestrator
Synthesis	Synthesis Stage
Audit	Audit Stage
Human response	Human Participant Adapter
Participant cardinality	Explicit Policy + Validation
Ни одна capability не может иметь двух независимых production owners.

17. Preset Independence Verification
17.1. Обязательность
Перед удалением topology необходимо доказать, что preset больше не влияет на runtime behavior, кроме явно заданных initial policies.
17.2. Проверка
Для каждого preset проверяется:
    1. создаётся канонический DebateCase;
    2. Participants представлены одинаковой schema;
    3. participant count не ограничен скрыто;
    4. используется один Planner;
    5. используется один Orchestrator;
    6. используется один StageExecutor;
    7. используются одинаковые Stage contracts;
    8. Pause работает одинаково;
    9. Continue работает одинаково;
    10. Human participation доступно одинаково;
    11. synthesis policy интерпретируется одинаково;
    12. audit policy интерпретируется одинаково;
    13. UI validation основана на общей policy;
    14. prompt contracts topology-neutral;
    15. persistence topology-neutral.
17.3. Matrix
Создаётся таблица:
Behavior	Duel preset	Triad preset	Multi preset	FreeTalk preset	Explicit policy difference
Любое отличие без explicit policy считается регрессией.
17.4. Participant count test
Обязательный тест:
Given:
Preset = FreeTalk
Available Participants = 4
Policy maximum = null

Expected:
User can select all 4
DebateCase contains all 4
Plan contains all 4 where applicable
Runtime dispatch supports all 4

18. Configuration Validation Contract
18.1. Один источник правил
UI и runtime должны использовать один validation contract.
18.2. Запрещённые источники ограничений
Нельзя независимо hardcode:
    1. maximum model count в UI;
    2. maximum model count в preset;
    3. maximum model count в compiler;
    4. maximum model count в runner;
    5. maximum model count в validator.
18.3. Validation result
Validation должен возвращать:
interface ConfigurationValidationResult {
  valid: boolean;
  errors: ValidationError[];
  appliedPolicies: string[];
}
18.4. Traceability
Каждый отказ выбора Participant должен содержать:
    1. policy ID;
    2. причина;
    3. фактическое значение;
    4. допустимое значение.

19. Behavioral Parity Verification
19.1. Паритет
После интеграции capability необходимо доказать:
    1. функциональную эквивалентность;
    2. отсутствие потери failure handling;
    3. отсутствие потери prompt behavior;
    4. отсутствие потери UI behavior;
    5. отсутствие participant cardinality regression;
    6. отсутствие persistence regression;
    7. отсутствие Pause/Continue regression.
19.2. Не требуется слепое копирование
Behavioral parity не означает сохранение любого legacy defect.
Legacy defect может быть исправлен, если:
    1. он классифицирован как defect;
    2. исправление зафиксировано;
    3. новый expected behavior утверждён;
    4. тест обновлён осознанно.
19.3. Parity Report
Для каждого legacy path создаётся отчёт:
Capabilities discovered:
Capabilities preserved:
Capabilities replaced:
Legacy defects removed:
Behavioral differences:
Tests:
Remaining risks:

20. Production Path Switch
Новый path становится primary только если:
    1. Capability Ledger заполнен;
    2. обязательные tests проходят;
    3. preset independence проверена;
    4. prompt parity проверена;
    5. UI/runtime validation единообразна;
    6. feature flag включён;
    7. observability подтверждает корректное исполнение.
После switch запрещено добавлять новые features в legacy path.

21. Legacy Removal Gate
Legacy implementation можно удалить только если одновременно выполнены все условия:
    1. Source Inventory завершён.
    2. Capability Inventory завершён.
    3. Constraint Inventory завершён.
    4. Prompt Inventory завершён.
    5. UI Behavior Inventory завершён.
    6. Capability Ledger заполнен.
    7. Universal capabilities перенесены.
    8. Explicit policies созданы.
    9. Characterization Tests проходят.
    10. Prompt Regression Tests проходят.
    11. Preset Independence Verification проходит.
    12. Participant cardinality tests проходят.
    13. New execution path активен.
    14. Legacy path не вызывается.
    15. Feature flag rollback больше не требуется.
    16. Architecture review завершён.

22. Physical Removal
После прохождения gate удаляются:
    1. runner;
    2. related FSM;
    3. related protocol events;
    4. topology-specific compiler branches;
    5. topology-specific validator rules;
    6. topology-specific prompt prefixes;
    7. topology-specific UI branches;
    8. obsolete tests;
    9. compatibility adapters;
    10. dead persistence fields;
    11. unused preset helpers.
Удаление только runner-файла не считается завершением.

23. Repository Enforcement
После удаления добавляются CI gates.
23.1. Legacy terminology
grep -R "topology\|duel\|triad\|multi\|free_talk" disput/
Допустимы только разрешённые migration/history locations.
23.2. Hidden participant limits
CI или tests должны выявлять hardcoded patterns:
maxModels = 2
participants.slice(0, 2)
selectedModels.length > 2
topology === "free_talk"
Такие конструкции допустимы только при ссылке на explicit policy.
23.3. Direct runner invocation
UI и Application не должны импортировать legacy runners.
23.4. Configuration duplication
Не допускается несколько независимых источников participant cardinality validation.

24. Запрещённые действия для LLM-разработчика
LLM запрещается:
    1. удалять runner без Capability Ledger;
    2. удалять code path без Source Inventory;
    3. считать отсутствие compile errors доказательством успешной миграции;
    4. переносить только happy path;
    5. игнорировать UI ограничения;
    6. игнорировать prompt differences;
    7. сохранять topology limits без explicit policy;
    8. создавать новый unified runner с legacy branching;
    9. копировать topology-specific code под neutral filename;
    10. удалять tests до создания replacement tests;
    11. считать два Participants нормой для FreeTalk без policy;
    12. менять expected behavior без отчёта;
    13. оставлять permanent adapters;
    14. объявлять legacy удалённым при существующем runtime вызове.

25. Required Tests
25.1. Capability coverage
Для каждой записи Capability Ledger должен существовать:
    1. characterization test;
    2. new owner test;
    3. parity test или обоснованное изменение behavior.
25.2. Preset independence
    1. одинаковая participant schema;
    2. одинаковый Planner;
    3. одинаковый Executor;
    4. одинаковый Pause/Continue;
    5. одинаковый Human path;
    6. отсутствие скрытых limits.
25.3. Participant cardinality
    1. select 2;
    2. select 3;
    3. select 4;
    4. select maximum by policy;
    5. persist after reload;
    6. compile plan;
    7. dispatch batch;
    8. display on Canvas.
25.4. UI/runtime parity
    1. UI accepts → runtime accepts;
    2. UI rejects → policy explains;
    3. direct runtime invalid config rejects with same error;
    4. validation messages include policy ID.
25.5. Prompt parity
    1. purpose preserved;
    2. context preserved;
    3. output schema preserved;
    4. visibility preserved;
    5. repair preserved.

26. Acceptance Criteria
Legacy Capability Extraction считается выполненным, если:
    1. полный vertical slice каждой topology исследован;
    2. создан Source Map;
    3. создан Capability Ledger;
    4. создан Constraint Inventory;
    5. создан Prompt Ledger;
    6. создан UI Constraints Ledger;
    7. каждая universal capability имеет нового владельца;
    8. каждое сохранённое ограничение является explicit policy;
    9. hidden participant limits отсутствуют;
    10. FreeTalk допускает количество Participants согласно policy, а не legacy topology;
    11. UI и runtime используют единый validation contract;
    12. characterization tests проходят;
    13. prompt tests проходят;
    14. preset independence подтверждена;
    15. behavioral parity подтверждён;
    16. legacy execution path физически удалён;
    17. repository gates включены;
    18. ни одна проверенная capability не потеряна.

27. Definition of Done
Legacy runner считается полностью и правильно удалённым только если:
    1. удалён не только runner, но весь topology-specific vertical slice;
    2. полезные capabilities извлечены;
    3. capabilities интегрированы в целевую архитектуру;
    4. ограничения классифицированы;
    5. скрытые ограничения удалены;
    6. participant cardinality управляется explicit policy;
    7. prompts мигрированы;
    8. state/events мигрированы;
    9. UI behavior мигрировано;
    10. Pause/Continue parity подтверждена;
    11. Human path parity подтверждена;
    12. все tests проходят;
    13. legacy symbols не используются production runtime;
    14. LLM предоставила полный отчёт по каждому пункту.

28. Mandatory LLM Report
Для каждого legacy path LLM обязана предоставить отчёт.
28.1. Scope
Legacy path:
Files analyzed:
Entry points:
UI entry points:
Persistence fields:
Prompt contracts:
28.2. Capability Ledger summary
Capabilities discovered:
Universal capabilities:
Policies:
Legacy implementations:
Historical workarounds:
Product behaviors requiring confirmation:
28.3. Constraint report
Participant limits:
Round limits:
Synthesis restrictions:
Audit restrictions:
Human restrictions:
UI restrictions:
Hidden constraints found:
28.4. Migration report
Для каждого пункта:
[номер Capability Ledger]

Status:
New owner:
Files:
Tests:
Behavior difference:
Removal status:
28.5. Preset independence report
Participant schema parity:
Participant count parity:
Planner parity:
Executor parity:
Pause/Continue parity:
Human parity:
Synthesis parity:
Remaining preset-specific differences:
Explicit policy IDs:
28.6. Removal confirmation
LLM обязана подтвердить:
    1. legacy path больше не вызывается;
    2. hidden limits отсутствуют;
    3. no topology-specific branching добавлено;
    4. no capability lost;
    5. all gates pass.

29. Final Statement
Duel, Triad, Multi и FreeTalk являются источниками накопленных инженерных решений, но не должны оставаться архитектурными сущностями runtime.
Удаление считается корректным только тогда, когда:
Every useful capability is identified.
Every constraint is explained.
Every prompt behavior is preserved or intentionally changed.
Every hidden topology restriction is removed.
Every capability has a neutral owner.
Every legacy path is tested before deletion.
Главный принцип:
Do not migrate topology.

Extract capabilities.

Convert constraints into explicit policies.

Verify preset independence.

Remove only legacy implementation.

Never delete proven engineering behavior.
