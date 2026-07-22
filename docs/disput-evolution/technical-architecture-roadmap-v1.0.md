Technical Architecture Roadmap v1.0
Disput Universal Discussion Engine
1. Executive Summary
Disput находится в переходном состоянии между набором специализированных сценариев обсуждения и универсальным движком управления многосторонним интеллектуальным процессом.
В текущей реализации уже присутствуют правильные базовые абстракции:
    • DebateApplication;
    • DebateExecutionPlan;
    • DebateCase;
    • StateDelta;
    • state map;
    • trigger-driven execution;
    • response acceptance;
    • event trace;
    • convergence and stagnation detection.
Однако execution layer по-прежнему определяется специализированными runners, отдельными FSM, topology-specific событиями и imperative loops.
Основной системный дефект:
ExecutionPlan создаётся и валидируется, но фактическая последовательность исполнения определяется кодом runners.
Следовательно, система фактически проверяет один pipeline, а исполняет другой. Этот разрыв должен быть устранён до дальнейшего масштабирования архитектуры.
Целевой результат — не единый фиксированный pipeline, а универсальный движок обсуждения, в котором:
    • DebateCase является каноническим состоянием;
    • Planner определяет следующее полезное действие;
    • Orchestrator управляет жизненным циклом;
    • StageExecutor исполняет конкретные задачи;
    • Human является полноценным Participant;
    • Pause и Continue работают через persisted state;
    • Pipeline Canvas является проекцией execution graph и командным интерфейсом;
    • synthesis является опциональной вставляемой стадией;
    • изменения исполнения оформляются как immutable Plan Revisions.
Миграция должна выполняться по модели Strangler Fig: небольшими вертикальными срезами, каждый из которых переводит конкретное поведение на новый execution path и удаляет соответствующую часть legacy.

2. Strategic Objective
Создать универсальный движок, способный управлять обсуждением между:
    • несколькими LLM;
    • человеком;
    • инструментами;
    • внешними агентами;
    • специализированными service capabilities.
Движок не должен зависеть от исторических режимов или названий presets после старта run.
После компиляции начальной конфигурации runtime должен оперировать только:
    • Participants;
    • Goals;
    • Artifacts;
    • Constraints;
    • Policies;
    • Stage Instances;
    • State Deltas;
    • Events;
    • Planning Decisions.

3. Architectural Invariants
Миграция считается архитектурно корректной только при выполнении следующих инвариантов.
3.1. Runtime neutrality
После инициализации runtime не содержит и не использует:
duel
triad
multi
free_talk
topology
Legacy presets могут существовать только как стартовые конфигурации.
3.2. Canonical state
DebateCase является первичным состоянием обсуждения.
Все остальные структуры являются:
    • execution state;
    • projections;
    • caches;
    • UI representations;
    • snapshots.
Они не могут противоречить DebateCase.
3.3. Controlled execution
Ни одна задача не может исполняться, если она не оформлена как зарегистрированная StageInstance.
3.4. Planning/execution separation
Planner определяет:
    • какую цель обрабатывать;
    • какое действие выполнить;
    • кому назначить задачу;
    • можно ли выполнять задачи параллельно;
    • необходимо ли завершить run.
StageExecutor не принимает planning decisions.
3.5. Event-driven lifecycle
Pause, Continue, intervention, response, revision и finalization существуют как persistent events, а не как локальные Promise, callback или JavaScript closure state.
3.6. Human participation
Человек является Participant с собственными:
    • tasks;
    • inputs;
    • responses;
    • artifacts;
    • state deltas;
    • visibility rules;
    • response lifecycle.
3.7. Immutable revisions
Активный план не мутируется напрямую.
Любое изменение создаёт новую PlanRevision.
3.8. Optional synthesis
Synthesis не является обязательным terminal step.
Run может:
    • завершиться без synthesis;
    • содержать промежуточный synthesis;
    • содержать несколько synthesis stages;
    • продолжаться после synthesis;
    • завершиться synthesis + audit.

4. Target Architecture
User Configuration
        ↓
DebateCaseFactory
        ↓
DebateCase
        ↓
Initial Plan Revision
        ↓
DebateApplication
        ↓
DebateOrchestrator
        ↓
Rule-based Planner
        ↓
PlanningDecision
        ↓
StageInstance(s)
        ↓
StageExecutor
        ↓
Participant Adapter
        ├── LLM Adapter
        ├── Human Adapter
        ├── Tool Adapter
        └── External Agent Adapter
        ↓
Response Acceptance
        ↓
Artifact Extraction
        ↓
StateDelta Validation
        ↓
DebateCase Commit
        ↓
State Map Projection
        ↓
Planner
Supporting components:
DebateRunStore
PlanRevisionStore
StageStore
SnapshotStore
StateMapProjector
PipelineCanvasProjection

5. Component Responsibilities
5.1. DebateApplication
DebateApplication является внешней API-границей.
Основные команды:
start(config)
pause(runId)
continue(runId)
cancel(runId)

submitParticipantResponse(command)
submitIntervention(command)

insertStage(command)
removePlannedStage(command)
changeParticipant(command)
changePolicy(command)
requestSynthesis(command)
DebateApplication не должен:
    • выбирать runner;
    • выполнять stages;
    • ранжировать goals;
    • хранить execution loop;
    • ждать ответы через Promise;
    • ветвиться по topology.

5.2. DebateOrchestrator
Orchestrator владеет жизненным циклом run.
Он отвечает за:
    • загрузку состояния;
    • запуск Planner tick;
    • создание Stage Instances;
    • вызов StageExecutor;
    • фиксацию событий;
    • pause boundary;
    • recovery;
    • idempotency;
    • concurrency;
    • revision activation;
    • reconciliation late responses;
    • finalization lifecycle.
Orchestrator не определяет содержательную стратегию обсуждения.

5.3. Planner
Planner является rule-based и детерминированным по умолчанию.
Он принимает:
{
  debateCase,
  stateMap,
  openGoals,
  activePlanRevision,
  availableParticipants,
  policies,
  budgets,
  activeStages
}
Planner возвращает:
PlanningDecision
Пример:
{
  decisionId: "decision-42",
  inputCaseVersion: 17,
  type: "CREATE_STAGES",
  rationaleCode: "UNSUPPORTED_CLAIM",
  consideredGoals: ["verify-claim-C7"],
  selectedGoals: ["verify-claim-C7"],
  stages: [
    {
      purpose: "verification",
      participants: ["gemini"],
      targetArtifacts: ["claim:C7"]
    }
  ]
}
Planner не выполняет LLM calls.
Опциональный LLM advisory может быть добавлен позднее, но его предложения должны:
    • иметь структурированный контракт;
    • проходить rule validation;
    • не управлять runtime напрямую.

5.4. StageExecutor
Executor получает готовую StageInstance.
Он отвечает за:
    • prompt compilation;
    • transport dispatch;
    • sequential or parallel execution;
    • timeout;
    • retry;
    • response acceptance;
    • format repair;
    • artifact extraction;
    • proposed StateDelta;
    • execution events.
Executor не должен решать:
    • зачем нужна стадия;
    • что выполнять после неё;
    • когда завершать run;
    • стоит ли вставить synthesis.

5.5. Participant Adapters
Единая модель Participant:
interface ParticipantDefinition {
  participantId: string;
  type: "llm" | "human" | "tool" | "external_agent";
  capabilities: Capability[];
  executionAdapterId: string;
  availabilityPolicy: AvailabilityPolicy;
  visibilityPolicy: VisibilityPolicy;
}
Различается только механизм получения ответа.

6. Core Domain Model
6.1. DebateCase
interface DebateCase {
  caseId: string;
  version: number;

  topic: TopicDefinition;
  constraints: Constraint[];
  participants: ParticipantDefinition[];

  artifacts: Artifact[];
  relations: ArtifactRelation[];

  openGoals: Goal[];
  resolvedGoals: GoalResolution[];

  sourceEvents: EventReference[];

  activePlanRevisionId: string;
  lifecycle: CaseLifecycle;
}
DebateCase создаётся до запуска runtime.
Запрещён порядок:
Start legacy runtime
→ create aggregate
→ project aggregate into DebateCase
Обязательный порядок:
Validate configuration
→ create DebateCase
→ create Plan Revision
→ create Run
→ start Orchestrator

6.2. Goal
Planner работает с целями, а не с названиями старых stages.
interface Goal {
  goalId: string;

  type:
    | "establish_position"
    | "verify_claim"
    | "resolve_contradiction"
    | "answer_open_question"
    | "examine_dissent"
    | "test_revision"
    | "compact_context"
    | "produce_synthesis"
    | "audit_output";

  targetArtifactIds: string[];

  status:
    | "open"
    | "assigned"
    | "in_progress"
    | "resolved"
    | "blocked"
    | "cancelled";

  priority: number;
  createdFromEventId: string;
}
Goal lifecycle
OPEN
  ↓ Planner creates StageInstance
ASSIGNED
  ↓ Stage starts
IN_PROGRESS
  ├── successful StateDelta → RESOLVED
  ├── temporary failure → OPEN
  ├── missing capability → BLOCKED
  └── plan invalidation → OPEN or CANCELLED
Одна stage может обслуживать несколько goals.
Один goal может потребовать несколько stages.

6.3. StageDefinition
interface StageDefinition {
  kind: string;
  purpose: string;
  inputContract: Contract;
  outputContract: Contract;
  executionPolicy: ExecutionPolicy;
}

6.4. StageInstance
interface StageInstance {
  stageInstanceId: string;
  planRevisionId: string;
  createdByDecisionId: string;

  goalIds: string[];

  purpose: string;
  participants: string[];

  inputArtifactIds: string[];
  expectedOutputs: OutputContract[];

  dispatchMode:
    | "single"
    | "parallel"
    | "sequential";

  completionMode:
    | "all"
    | "quorum"
    | "first_success";

  status:
    | "pending"
    | "running"
    | "awaiting_participant"
    | "receiving"
    | "validating"
    | "committing"
    | "completed"
    | "failed"
    | "cancelled"
    | "stale";

  attempt: number;
}
Необходимо избегать кодирования старой архитектуры через stage names вида:
duel_turn
triad_wave
multi_round

7. Mandatory Architecture Contracts
До начала первого migration PR должны быть утверждены четыре нормативных документа.

7.1. Orchestrator Contract
Документ должен определить:
    • ownership run;
    • lifecycle ownership;
    • single-active-orchestrator invariant;
    • single-tab или multi-tab execution policy;
    • idempotency keys;
    • concurrency model;
    • stage commit boundaries;
    • event ordering;
    • recovery process;
    • pause and quiescing semantics;
    • late-response reconciliation;
    • Continue semantics;
    • snapshot loading;
    • transaction boundaries.
Continue contract
CONTINUE_REQUESTED
→ acquire execution ownership
→ load latest snapshot
→ replay subsequent events
→ reconcile late responses
→ apply interventions
→ invalidate stale stages
→ rebuild DebateCase projection
→ rebuild state map
→ activate latest valid revision
→ Planner tick
→ RUN_RESUMED
Continue не является продолжением сохранённой JavaScript-функции.

7.2. Planner Contract
Документ должен определить:
    • Planner tick inputs;
    • rule evaluation order;
    • ranking algorithm;
    • simultaneous trigger conflict resolution;
    • deterministic tie-breaking;
    • maximum stages per tick;
    • parallel-stage eligibility;
    • Goal lifecycle;
    • blocked-goal handling;
    • stale-goal handling;
    • termination decisions;
    • finalization policy;
    • LLM advisory boundary.
Planner tick semantics
Planner tick должен:
    1. Зафиксировать inputCaseVersion.
    2. Вычислить доступные goals.
    3. Вычислить fired и suppressed rules.
    4. Исключить goals, уже покрытые активными stages.
    5. Рассчитать utility.
    6. Выбрать одну или несколько совместимых целей.
    7. Создать PlanningDecision.
    8. Не мутировать состояние напрямую.
Conflict resolution
Одновременные goals могут выполняться параллельно только если:
    • не изменяют один и тот же exclusive artifact;
    • не зависят от результатов друг друга;
    • не нарушают participant capacity;
    • не конфликтуют по visibility policy;
    • не превышают execution budget.
В остальных случаях используется детерминированное ранжирование.

7.3. Plan Revision Specification
Документ должен определить:
    • revision schema;
    • conflict definition;
    • command validation;
    • atomicity;
    • activation rules;
    • stale revision handling;
    • concurrent commands;
    • retry semantics;
    • stage invalidation;
    • dependency closure;
    • revision rollback policy.
Базовая модель
interface PlanRevision {
  revisionId: string;
  parentRevisionId: string | null;
  runId: string;

  createdAt: string;
  createdBy: "system" | "human";
  reason: string;

  policies: PlanPolicies;
  constraints: PlanConstraint[];
  plannedStages: PlannedStage[];
  allowedActions: string[];
}
Revision commands
INSERT_STAGE
REMOVE_PLANNED_STAGE
CHANGE_PARTICIPANT
CHANGE_POLICY
ADD_CONSTRAINT
REMOVE_CONSTRAINT
REQUEST_SYNTHESIS
REQUEST_AUDIT
Atomicity
Команда либо:
    • создаёт полностью валидную Rev N+1;
    • либо отклоняется без изменения активного состояния.
Pending revisions не допускаются в MVP.
Concurrent commands
Команда обязана содержать:
expectedRevisionId
Если активная revision уже изменилась:
REVISION_STALE
Клиент должен перечитать новое состояние и повторить команду.
Invalidation
Изменение plan инвалидирует только pending stages, которые зависят от изменённых:
    • participants;
    • constraints;
    • policies;
    • inputs;
    • artifact dependencies.
Invalidation определяется через dependency graph, а не через массовую отмену всех будущих stages.

7.4. Migration Strategy
Документ должен определить:
    • feature flags;
    • vertical slices;
    • legacy/new-path coexistence rules;
    • rollback criteria;
    • characterization tests;
    • removal gates;
    • ownership каждого slice;
    • запрет развития legacy после миграции конкретного поведения.

8. Human as Runtime Participant
8.1. Human task
Planner может создать:
{
  purpose: "critique",
  participants: ["human:owner"],
  status: "awaiting_participant"
}
UI показывает конкретное назначенное задание.
8.2. Human response
Ответ проходит общий lifecycle:
PARTICIPANT_TASK_ASSIGNED
→ PARTICIPANT_RESPONSE_SUBMITTED
→ RESPONSE_ACCEPTED
→ ARTIFACTS_EXTRACTED
→ STATE_DELTA_PROPOSED
→ STATE_DELTA_APPLIED
→ STAGE_COMPLETED
8.3. Human intervention
Ответ на назначенную задачу и управляющее вмешательство — разные операции.
Команды:
SUBMIT_PARTICIPANT_RESPONSE
ADD_CLARIFICATION
ADD_CONSTRAINT
CORRECT_FACT
REQUEST_VERIFICATION
REQUEST_SYNTHESIS
CANCEL_GOAL
STOP_RUN
8.4. Addressing
all
participant
selected_participants
service_capability
8.5. Visibility
private
targets_only
shared_after_response
public
Human является равноправным Participant на уровне domain model, но adapter и acceptance rules могут учитывать тип участника.
Не требуется создавать отдельную параллельную архитектуру Human pipeline.

9. Pause and Continue
9.1. Pause state machine
RUNNING
  ↓ PAUSE_REQUESTED
PAUSE_REQUESTED
  ↓ no new stages may be created
QUIESCING
  ↓ active work drained or cancelled
PAUSED
Pause policies
finish_current_stage
cancel_active_dispatch
finish_received_only
Default:
finish_current_stage
UI обязан различать:
Pause requested
Finishing active stage
Paused
9.2. Continue
Continue всегда выполняет reconstruction и replanning.
PAUSED
→ RECONCILING
→ rebuild current state
→ Planner
→ RUNNING

10. Finalization Policy
Finalization должна быть явной policy.
interface FinalizationPolicy {
  mode:
    | "manual"
    | "on_stagnation"
    | "on_budget_exhaustion"
    | "after_required_goals"
    | "after_synthesis";

  synthesis:
    | "none"
    | "optional"
    | "required";

  audit:
    | "none"
    | "optional"
    | "required";

  allowContinueAfterSynthesis: boolean;
}
Synthesizer = none
Означает:
В активной конфигурации нет обязательной synthesis stage.
Не означает:
    • завершить run после стартовых позиций;
    • запретить synthesis навсегда;
    • автоматически остановить discussion.
Multiple synthesis stages
Каждый synthesis является отдельным artifact:
SYN-1
SYN-2 revises SYN-1
SYN-3 revises SYN-2
Final artifact определяется finalization event, а не правилом latest-text-wins.

11. Pipeline Canvas
Canvas является:
    1. Проекцией завершённого исполнения.
    2. Представлением активных stages.
    3. Представлением текущей Plan Revision.
    4. Command surface для изменений.
Canvas не является source of truth.
Он строится из:
Run Events
+
Stage Instances
+
Active Plan Revision
+
DebateCase
+ между stages
При нажатии пользователь может вставить:
    • synthesis;
    • audit;
    • human task;
    • verification;
    • critique;
    • judge;
    • future service capability.
Команда не мутирует Canvas напрямую.
Она отправляется через DebateApplication, проходит validation и создаёт новую Plan Revision.

12. Migration Strategy: Strangler Fig
Линейная миграция из двенадцати крупных зависимых фаз заменяется последовательностью deployable vertical slices.
Каждый slice должен:
    1. Зафиксировать старое поведение characterization tests.
    2. Реализовать то же поведение через новый execution path.
    3. Включаться feature flag.
    4. Сравнивать результаты old/new path.
    5. Удалять соответствующий legacy path после стабилизации.
    6. Не оставлять два permanent execution paths.

13. Vertical Migration Slices
Slice A — Architecture Contracts
Результат:
    • утверждены четыре нормативных документа;
    • определены invariants;
    • определён event vocabulary;
    • определены ownership boundaries;
    • запрещено добавление новой topology-specific логики.
Без завершения Slice A coding migration не начинается.

Slice B — DebateCase-first for Dynamic Discussion
Результат:
    • DebateCase создаётся до run;
    • dynamic discussion читает primary state из DebateCase;
    • legacy aggregate становится projection;
    • создаётся feature flag:
disput.case_first_runtime

Slice C — StageExecutor for Dynamic Actions
Из dynamic runner извлекаются:
    • prompt compilation;
    • model dispatch;
    • response acceptance;
    • repair;
    • artifact extraction;
    • StateDelta proposal;
    • stage events.
Runner временно сохраняет loop, но перестаёт исполнять stage самостоятельно.

Slice D — Rule-based Planner MVP
Из dynamic runner извлекаются:
    • trigger evaluation;
    • goal creation;
    • utility ranking;
    • participant selection;
    • stagnation handling;
    • planning decision.
Planner создаёт StageInstance.
Dynamic runner превращается во временный thin adapter.

Slice E — Persistent Pause/Continue
Результат:
    • Promise waiters перестают быть source of truth;
    • Pause проходит через state machine;
    • Continue выполняет replay and replan;
    • run переживает reload страницы.

Slice F — Human Participant
Результат:
    • Human входит в participants;
    • Human может получать task;
    • Human response проходит artifact pipeline;
    • intervention отделён от participant response;
    • поддерживается адресация и visibility.

Slice G — Plan Revisions
Результат:
    • immutable revisions;
    • revision commands;
    • stale revision handling;
    • stage invalidation;
    • revision activation.

Slice H — Canvas Command Surface
Результат:
    • + между stages;
    • insert synthesis;
    • insert human;
    • insert audit;
    • revision preview;
    • stale/cancelled stage representation.

Slice I — Parallel Batch Legacy Migration
Перенести legacy parallel execution на новый StageExecutor:
    • multiple participants;
    • barrier;
    • quorum;
    • partial failure;
    • dropout;
    • repair.
После стабилизации удалить соответствующий runner path.

Slice J — Sequential Turn Legacy Migration
Перенести:
    • sequential dispatch;
    • approval boundary;
    • retries;
    • final words;
    • participant routing.
После стабилизации удалить соответствующий runner path.

Slice K — Multi-participant and Audit Migration
Перенести:
    • large batch execution;
    • degraded continuation;
    • synthesis retry;
    • audit;
    • audit correction.
После стабилизации удалить соответствующий runner path.

Slice L — Legacy Runtime Removal
Удалить:
    • specialized runners;
    • topology FSM;
    • topology protocol events;
    • topology routing;
    • prompt contracts с legacy prefixes;
    • topology-specific dropout modes;
    • UI branches;
    • duplicated services.

Slice M — Final Cleanup and Enforcement
Добавить repository gates:
grep -R "topology\|duel\|triad\|multi\|free_talk" disput/
Допустимы только:
    • migration history;
    • archived preset labels;
    • compatibility import tests;
    • changelog.
В production runtime совпадений быть не должно.

14. Characterization Test Strategy
До переноса каждого поведения создаются black-box tests.
Тесты проверяют:
    • observable final state;
    • emitted event sequence;
    • committed artifacts;
    • stage status;
    • retry and failure semantics.
Они не должны проверять internal runner variables.
Минимальные группы:
Execution
    • single participant;
    • parallel participants;
    • sequential participants;
    • partial failure;
    • retry;
    • duplicate response;
    • no-state-change response;
    • dropout;
    • degraded continuation;
    • audit repair.
Barrier
    • all participants;
    • quorum;
    • timeout;
    • cancellation.
Acceptance
    • truncation;
    • incomplete output;
    • missing sections;
    • invalid structured output;
    • repair success;
    • repair failure.
Planner
    • single trigger;
    • simultaneous compatible triggers;
    • simultaneous conflicting triggers;
    • deterministic tie;
    • blocked goal;
    • stagnation;
    • budget exhaustion;
    • finalization decision.
Human
    • human receives task;
    • human responds after reload;
    • human rejects task;
    • human submits revision;
    • human adds constraint;
    • private intervention;
    • public intervention.
Pause/Continue
    • pause before dispatch;
    • pause during dispatch;
    • late response;
    • continue after reload;
    • continue after revision;
    • cancel during quiescing.
Plan revisions
    • insert synthesis;
    • remove pending stage;
    • change participant;
    • change policy;
    • stale revision rejected;
    • modification of completed stage rejected.

15. Feature Flag Strategy
Каждый vertical slice имеет отдельный flag.
Примеры:
disput.case_first_runtime
disput.stage_executor_dynamic
disput.rule_planner
disput.persisted_pause
disput.human_participant
disput.plan_revisions
disput.canvas_commands
disput.parallel_executor
disput.sequential_executor
Требования:
    • flag может быть включён для test cohort;
    • rollback не требует migration rollback;
    • old/new path нельзя развивать параллельно после принятия нового;
    • legacy path удаляется после прохождения removal gate.

16. Acceptance Criteria
Architecture
    • DebateCase создаётся до run;
    • один Orchestrator;
    • один Planner;
    • один StageExecutor;
    • один stage lifecycle;
    • один persistent event model;
    • runtime не содержит topology;
    • UI не вызывает runners;
    • Validator проверяет фактически исполняемые contracts.
Human
    • Human является Participant;
    • Human task переживает reload;
    • Human response проходит StateDelta;
    • intervention влияет на replanning;
    • target visibility соблюдается.
Pause/Continue
    • Pause не создаёт новые stages;
    • состояние QUIESCING наблюдаемо;
    • Continue работает после reload;
    • late responses reconciled;
    • Planner выполняет новый tick.
Plan revisions
    • revision immutable;
    • stale command rejected;
    • invalid revision не активируется;
    • affected pending stages становятся stale;
    • completed stages не изменяются.
Synthesis
    • run может завершиться без synthesis;
    • synthesis вставляется через Canvas;
    • synthesis может быть промежуточным;
    • несколько synthesis artifacts имеют provenance;
    • audit является отдельной stage.

17. Definition of Done
Миграция завершена только если:
    1. Отсутствуют specialized runners.
    2. Отсутствуют topology-specific FSM.
    3. Отсутствуют topology-specific protocol events.
    4. DebateApplication не маршрутизирует по mode.
    5. DebateCase является primary state.
    6. Planner создаёт все новые Stage Instances.
    7. Executor не принимает planning decisions.
    8. Human является Participant.
    9. Pause переживает reload.
    10. Continue выполняет reconstruction and replanning.
    11. Plan имеет immutable revisions.
    12. Canvas работает через commands.
    13. Synthesis не является обязательным terminal path.
    14. Event log позволяет восстановить run.
    15. Characterization tests покрывают сохранённое legacy behavior.
    16. Каждый legacy execution path физически удалён.
    17. Repository gates запрещают возврат topology-specific логики.

18. Key Risks
18.1. Новый монолитный runner
Самый опасный сценарий:
four runners
→ one giant runner
Это уменьшит количество файлов, но сохранит:
    • imperative sequencing;
    • локальное состояние;
    • слабый Pause;
    • отсутствие Planner;
    • декоративный ExecutionPlan;
    • отдельный Human chat.
18.2. Permanent dual execution
Если old и new paths останутся надолго, система получит:
    • duplicated bug fixes;
    • divergent behavior;
    • увеличенный codebase;
    • невозможность удалить legacy.
Каждый slice обязан завершаться removal gate.
18.3. Planner as magic component
Planner не должен стать непрозрачным «умным» модулем.
MVP Planner:
    • rule-based;
    • deterministic;
    • traceable;
    • testable;
    • без LLM calls.
18.4. Direct Canvas mutation
Canvas не должен напрямую менять execution state.
Только:
Command
→ Validation
→ Plan Revision
→ Replanning
18.5. Human treated as chat
Если Human сообщения не проходят через events, artifacts и StateDelta, pipeline и человек снова станут двумя независимыми системами.

19. Management Decision Required
До начала PR A необходимо утвердить:
    1. Целевые архитектурные инварианты.
    2. Разделение Application / Orchestrator / Planner / Executor.
    3. Rule-based Planner как MVP.
    4. Human как runtime Participant.
    5. Persisted Pause/Continue.
    6. Immutable Plan Revisions.
    7. Strangler Fig как единственную стратегию миграции.
    8. Запрет на дальнейшее развитие specialized runners, кроме критических production fixes.
После утверждения необходимо подготовить четыре коротких нормативных документа:
    • Orchestrator Contract;
    • Planner Contract;
    • Plan Revision Specification;
    • Migration Strategy.
Только после их утверждения начинается Slice B — DebateCase-first for Dynamic Discussion.

20. Final Recommendation
Текущая кодовая база содержит значительную часть необходимого нейтрального фундамента, поэтому полный rewrite не требуется.
Необходимо:
    1. Сохранить contracts, DebateCase, StateDelta, response acceptance, trace и state-map infrastructure.
    2. Извлечь полезное поведение из dynamic и legacy runners.
    3. Последовательно переносить execution на новый Orchestrator–Planner–Executor path.
    4. Удалять legacy вертикальными срезами, а не в конце большого рефакторинга.
    5. Не начинать implementation migration до утверждения четырёх архитектурных контрактов.
Целевой результат — не унифицированный набор старых pipeline, а универсальный discussion engine, в котором execution определяется каноническим состоянием, правилами, goals и Plan Revisions, а не скрытой логикой runners.
