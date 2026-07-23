Orchestrator Contract v1.0
Disput Universal Discussion Engine
1. Purpose
DebateOrchestrator является владельцем жизненного цикла выполнения одного discussion run.
Он координирует:
    • загрузку и восстановление состояния;
    • вызов Planner;
    • создание и запуск StageInstance;
    • фиксацию событий;
    • pause and continue;
    • reconciliation late responses;
    • plan revision activation;
    • finalization;
    • recovery after reload or runtime restart.
Orchestrator не принимает содержательные решения об обсуждении.
Он не определяет:
    • какой claim важнее;
    • какую модель выбрать по смыслу;
    • нужен ли synthesis;
    • завершено ли обсуждение содержательно;
    • какую стратегию рассуждения использовать.
Эти решения принадлежат Planner и policies.

2. Core Responsibility
Orchestrator обеспечивает выполнение следующего цикла:
Load canonical state
→ Reconcile runtime state
→ Invoke Planner
→ Persist PlanningDecision
→ Create StageInstance(s)
→ Execute StageInstance(s)
→ Persist results
→ Apply StateDelta
→ Repeat
Orchestrator отвечает за корректность процесса.
Planner отвечает за корректность выбора следующего действия.
StageExecutor отвечает за корректность исполнения конкретной стадии.

3. Architectural Position
DebateApplication
        ↓ commands
DebateOrchestrator
        ├── DebateRunStore
        ├── DebateCaseStore
        ├── PlanRevisionStore
        ├── StageStore
        ├── SnapshotStore
        ├── Planner
        └── StageExecutor
DebateApplication является API boundary.
DebateOrchestrator является lifecycle owner.
Planner является decision owner.
StageExecutor является execution owner.

4. Primary Invariants
4.1. Single execution owner
Для одного runId одновременно может существовать только один активный Orchestrator owner.
Ни одна другая вкладка, runtime instance или background worker не может создавать новые stages для того же run без получения execution ownership.
4.2. Persistent state over local state
Любое состояние, необходимое для Continue или Recovery, должно быть сохранено в persistent store.
Запрещено полагаться на:
    • unresolved Promise;
    • callback closure;
    • module-local cursor;
    • page-global boolean;
    • in-memory stage queue;
    • active JavaScript loop.
4.3. No invisible execution
Ни один transport request не может быть отправлен без:
    1. существующего StageInstance;
    2. persisted STAGE_CREATED;
    3. persisted execution attempt;
    4. idempotency key.
4.4. Atomic state transition
Stage не считается завершённой до фиксации:
    • accepted response;
    • extracted artifacts;
    • StateDelta result;
    • stage terminal event.
UI-отображение ответа не означает semantic commit.
4.5. No planning during pause
После перехода в PAUSE_REQUESTED Planner не может создавать новые Stage Instances.
4.6. Revision consistency
Каждая новая StageInstance должна ссылаться на активную PlanRevision.
Stage, созданная по устаревшей revision, не может быть запущена.
4.7. Idempotent recovery
Повторный запуск recovery для одного и того же event sequence должен приводить к одному и тому же runtime state.
4.8. Semantic event idempotency
`eventId` не является достаточным доказательством повтора. Каждое событие
имеет детерминированный semantic hash, вычисленный из его типа, источника,
причины, correlation, causality, payload и provenance, без transport timing.
Повтор с тем же ID и тем же hash является no-op. Повтор с тем же ID и другим
hash отклоняется как конфликт и не расходует collector sequence.
4.9. Persistent participant collections
Snapshot v2 хранит три канонические коллекции: `configuredParticipants`,
`activeParticipants` и `droppedParticipants` с terminal evidence. При recovery
старого snapshot без этих полей они детерминированно восстанавливаются из
`participantStatus`; выпавший participant не может вернуться в routing только
из-за reload.

5. Orchestrator API
interface DebateOrchestrator {
  startRun(command: StartRunCommand): Promise<RunResult>;

  requestPause(command: PauseRunCommand): Promise<PauseResult>;

  requestContinue(command: ContinueRunCommand): Promise<ContinueResult>;

  requestCancel(command: CancelRunCommand): Promise<CancelResult>;

  submitParticipantResponse(
    command: SubmitParticipantResponseCommand
  ): Promise<ResponseSubmissionResult>;

  submitIntervention(
    command: SubmitInterventionCommand
  ): Promise<InterventionResult>;

  activatePlanRevision(
    command: ActivatePlanRevisionCommand
  ): Promise<RevisionActivationResult>;

  recoverRun(command: RecoverRunCommand): Promise<RecoveryResult>;

  finalizeRun(command: FinalizeRunCommand): Promise<FinalizationResult>;
}

6. Run Ownership
6.1. Ownership model
MVP использует single-owner lease.
interface RunLease {
  runId: string;
  ownerId: string;
  acquiredAt: string;
  expiresAt: string;
  version: number;
}
ownerId должен однозначно идентифицировать runtime instance.
Например:
tabId + extensionInstanceId + randomSessionId
`leaseRevision` — монотонный fencing token. Старое поле `version` допускается
только для чтения сохранённых данных и имеет то же значение.
6.2. Lease acquisition
Перед любым execution action Orchestrator обязан получить lease.
Acquire lease
→ verify current run status
→ verify active revision
→ continue execution
6.3. Lease renewal
Lease должен периодически продлеваться, пока run находится в активном execution state.
Lease не должен продлеваться в состояниях:
PAUSED
COMPLETED
CANCELLED
FAILED
Перед semantic commit после любого длительного dispatch Orchestrator обязан
сравнить ownerId и leaseRevision с persistent lease. При несовпадении ответ
становится stale, abort tree останавливается, а run переходит в безопасное
paused-состояние без StateDelta commit.
6.3.1 Release
Владелец освобождает lease только с совпадающим fencing token после safe pause
boundary либо terminal transition. Это позволяет другому контексту немедленно
выполнить recovery без ожидания TTL.
6.4. Lease expiration
Если owner перестал продлевать lease:
    • новые stages не создаются;
    • другой Orchestrator может получить ownership;
    • выполняется recovery;
    • late responses reconciled;
    • run продолжается только после проверки persisted state.
Persistence может публиковать `LEASE_ACQUIRED`, `LEASE_RENEWED` и
`LEASE_RELEASED` соседним контекстам. Получивший сообщение контекст обязан
перечитать persistent lease перед любым execution action; уведомление само по
себе не является разрешением на dispatch.
6.5. Two-tab behavior
Если вторая вкладка открывает активный run:
    • она работает в read-only режиме;
    • может запрашивать ownership takeover;
    • не может выполнять Planner tick или StageExecutor dispatch.

7. Run Lifecycle
CREATED
  ↓
STARTING
  ↓
RUNNING
  ↓
PAUSE_REQUESTED
  ↓
QUIESCING
  ↓
PAUSED
  ↓
RECONCILING
  ↓
RUNNING
  ↓
FINALIZING
  ↓
COMPLETED
Альтернативные terminal states:
CANCELLED
FAILED

8. Lifecycle Transitions
8.1. CREATED → STARTING
Условия:
    • существует DebateCase;
    • существует initial PlanRevision;
    • конфигурация валидна;
    • run lease получен.
События:
RUN_CREATED
RUN_START_REQUESTED
RUN_STARTED
8.2. STARTING → RUNNING
Orchestrator:
    1. загружает DebateCase;
    2. загружает active Plan Revision;
    3. создаёт initial goals при необходимости;
    4. запускает Planner tick.
8.3. RUNNING → PAUSE_REQUESTED
Триггер:
    • user pause command;
    • system safety pause;
    • technical pause;
    • ownership loss.
Событие:
PAUSE_REQUESTED
8.4. PAUSE_REQUESTED → QUIESCING
Orchestrator:
    • запрещает Planner tick;
    • запрещает создание новых stages;
    • определяет судьбу активных attempts согласно pause policy;
    • продолжает принимать late responses.
8.5. QUIESCING → PAUSED
Переход возможен, когда:
    • нет новых dispatch;
    • активные attempts завершены или отменены;
    • late responses зафиксированы;
    • stage statuses консистентны;
    • snapshot может быть построен.
Событие:
RUN_PAUSED
8.6. PAUSED → RECONCILING
Триггер:
CONTINUE_REQUESTED
Orchestrator:
    • получает lease;
    • загружает snapshot;
    • проигрывает новые events;
    • применяет interventions;
    • проверяет plan revision;
    • инвалидирует stale stages.
8.7. RECONCILING → RUNNING
После успешной reconciliation:
    • state map пересобран;
    • active goals актуализированы;
    • Planner может выполнить новый tick;
    • сохраняется RUN_RESUMED.
8.8. RUNNING → FINALIZING
Основание:
    • Planner возвращает terminal decision;
    • user отправляет STOP_RUN;
    • budget policy требует завершения;
    • fatal unrecoverable state;
    • finalization policy выполнена.
8.9. FINALIZING → COMPLETED
Orchestrator:
    • строит final state projection;
    • фиксирует final artifacts;
    • записывает finalization reason;
    • освобождает lease;
    • создаёт terminal snapshot.

9. Planner Tick Contract
Orchestrator может вызвать Planner только если:
    • run status = RUNNING;
    • lease действителен;
    • нет блокирующей reconciliation;
    • active revision валидна;
    • отсутствует uncommitted stage transaction;
    • не превышен concurrency limit.
9.1. Tick sequence
PLANNING_STARTED
→ load input state
→ Planner.evaluate(...)
→ validate PlanningDecision
→ PLANNING_COMPLETED
→ create StageInstance(s)
9.2. Input consistency
Planner получает:
{
  runId,
  caseVersion,
  activePlanRevisionId,
  stateMapVersion,
  openGoals,
  activeStages,
  availableParticipants,
  policies,
  budgets
}
Если любой version изменился между началом и commit PlanningDecision:
PLANNING_DECISION_STALE
Решение не применяется.
9.3. One tick at a time
Для одного run одновременно допускается только один Planner tick.
9.4. Multiple stages per tick
Planner может создать несколько stages, только если решение явно отмечает их как совместимые для параллельного исполнения.
Orchestrator обязан повторно проверить:
    • dependency conflicts;
    • participant capacity;
    • revision consistency;
    • concurrency limits.

10. Stage Creation Contract
Stage создаётся только после persisted PlanningDecision.
Порядок:
PLANNING_DECISION_RECORDED
→ STAGE_CREATED
→ PARTICIPANT_TASK_ASSIGNED
→ STAGE_STARTED
10.1. Stage identity
interface StageIdentity {
  runId: string;
  stageInstanceId: string;
  attemptId: string;
  planningDecisionId: string;
  planRevisionId: string;
}
10.2. Idempotency key
Transport idempotency key:
runId:stageInstanceId:attemptNumber:participantId
Повторный dispatch с тем же ключом не должен создавать второй logical response.
10.3. Attempt semantics
Retry создаёт новый attemptId, но не новый stageInstanceId.
Новая logical stage создаётся только новым PlanningDecision.

11. Stage Execution Contract
Orchestrator вызывает:
StageExecutor.execute(stageInstance, executionContext)
StageExecutor возвращает:
interface StageExecutionResult {
  stageInstanceId: string;
  attempts: AttemptResult[];
  acceptedResponses: AcceptedResponse[];
  proposedStateDeltas: StateDelta[];
  executionStatus:
    | "completed"
    | "partial"
    | "failed"
    | "cancelled";
}
Orchestrator не должен принимать transport-specific решения.
Он только:
    • фиксирует результат;
    • запускает commit process;
    • обновляет lifecycle;
    • решает, нужен ли следующий Planner tick.

12. Response Commit Transaction
Ответ проходит следующие состояния:
RECEIVED
→ ACCEPTED or REJECTED
→ ARTIFACTS_EXTRACTED
→ STATE_DELTA_PROPOSED
→ STATE_DELTA_APPLIED or REJECTED
→ STAGE_COMPLETED
12.1. Transaction boundary
Semantic commit должен быть атомарным относительно:
    • artifact insertion;
    • relation insertion;
    • goal update;
    • case version increment;
    • stage terminal status.
Если commit не завершён полностью, stage не может получить статус COMPLETED.
12.2. No-state-change response
Если ответ принят, но не создаёт meaningful StateDelta:
NO_STATE_CHANGE
Stage может быть:
    • completed with no contribution;
    • retried;
    • marked ineffective;
    • returned to Planner.
Поведение определяется stage policy.

13. Pause Contract
13.1. Pause request
Команда:
interface PauseRunCommand {
  runId: string;
  requestedBy: string;
  policy:
    | "finish_current_stage"
    | "cancel_active_dispatch"
    | "finish_received_only";
  reason?: string;
}
13.2. Default policy
finish_current_stage
13.3. Pause effects
После PAUSE_REQUESTED запрещено:
    • запускать Planner;
    • создавать stages;
    • запускать retries;
    • активировать новую plan revision автоматически;
    • инициировать final synthesis.
Разрешено:
    • принимать уже отправленные responses;
    • завершать текущий commit;
    • фиксировать intervention;
    • отменять transport requests;
    • строить snapshot.
13.4. Pause is not immediate completion
UI не должен показывать PAUSED, пока активная stage ещё выполняется.

14. Continue Contract
14.1. Continue command
interface ContinueRunCommand {
  runId: string;
  requestedBy: string;
  expectedCaseVersion?: number;
  expectedPlanRevisionId?: string;
}
14.2. Continue sequence
CONTINUE_REQUESTED
→ acquire lease
→ load latest snapshot
→ replay subsequent events
→ detect incomplete transactions
→ reconcile late responses
→ apply pending interventions
→ validate active revision
→ invalidate stale stages
→ reopen eligible goals
→ rebuild state map
→ run Planner tick
→ RUN_RESUMED
14.3. Continue never resumes closure
Запрещено реализовывать Continue через:
resolveContinuationPromise()
или продолжение старого runner loop.

15. Snapshot Contract
15.1. Snapshot purpose
Snapshot сокращает recovery cost, но не является primary source of truth.
Primary source:
Event log
Snapshot является materialized checkpoint.
15.2. Snapshot contents
interface RunSnapshot {
  runId: string;
  snapshotVersion: number;
  eventSequence: number;

  debateCase: DebateCase;
  activePlanRevisionId: string;
  activeStages: StageInstance[];
  openGoals: Goal[];
  runLifecycle: RunLifecycle;
  stateMapVersion: number;

  createdAt: string;
}
15.3. Snapshot validity
Snapshot валиден только если:
    • event sequence непрерывен;
    • case version согласована;
    • active revision существует;
    • нет незавершённой semantic transaction.
15.4. Recovery
Load latest valid snapshot
→ replay events with sequence > snapshot.eventSequence
→ rebuild transient indexes
15.5. Snapshot frequency
Частота snapshot не является частью v1.0 contract.
Она определяется implementation policy.
Обязательное требование:
Recovery не должен зависеть от наличия последнего snapshot.

16. Intervention Contract
Intervention является persisted command/event.
Примеры:
ADD_CONSTRAINT
CORRECT_FACT
REQUEST_VERIFICATION
REQUEST_SYNTHESIS
CANCEL_GOAL
STOP_RUN
16.1. Intervention during RUNNING
Если intervention влияет на active stage:
    • intervention сохраняется;
    • stage может быть помечена STALE_AFTER_COMPLETION;
    • её response принимается, но не применяется автоматически;
    • Planner выполняет новый tick после reconciliation.
16.2. Intervention during PAUSED
Intervention применяется до следующего Planner tick.
16.3. Addressing
Orchestrator обязан сохранить:
    • target participants;
    • visibility policy;
    • affected artifact IDs;
    • affected goal IDs.

17. Plan Revision Activation
Orchestrator активирует revision только если:
    • revision валидна;
    • parent revision соответствует active revision;
    • command не stale;
    • running stages не нарушаются;
    • pending dependency graph может быть пересчитан.
17.1. Activation sequence
PLAN_REVISION_CREATED
→ revision validation
→ affected stage detection
→ stale marking
→ PLAN_REVISION_ACTIVATED
→ Planner tick
17.2. Running stages
Running stage не изменяется задним числом.
Возможные policies:
    • finish and reconcile;
    • cancel if cancellable;
    • finish but reject semantic commit;
    • finish and mark result conditional.
Policy должна быть задана revision command.

18. Finalization Contract
Orchestrator начинает finalization только по валидному основанию.
interface FinalizationDecision {
  reason:
    | "manual_stop"
    | "required_goals_resolved"
    | "stagnation"
    | "budget_exhausted"
    | "synthesis_completed"
    | "fatal_failure";

  finalizationMode:
    | "state_map"
    | "artifacts_only"
    | "synthesis"
    | "synthesis_and_audit";
}
18.1. Finalization does not imply synthesis
state_map и artifacts_only являются валидными terminal outcomes.
18.2. Finalization transaction
RUN_FINALIZATION_STARTED
→ final state projection
→ final artifact selection
→ unresolved goals snapshot
→ terminal reason recorded
→ RUN_COMPLETED

19. Error Handling
19.1. Recoverable errors
Примеры:
    • participant timeout;
    • temporary transport failure;
    • invalid response;
    • stale PlanningDecision;
    • stale revision command;
    • lease loss.
Они не переводят run автоматически в FAILED.
19.2. Fatal errors
Примеры:
    • corrupted event sequence;
    • impossible case version transition;
    • missing active revision;
    • irrecoverable semantic transaction;
    • duplicated final commit.
Fatal error переводит run в:
FAILED
с обязательным diagnostic artifact.

20. Concurrency Model
20.1. Planner concurrency
Один Planner tick на run.
20.2. Stage concurrency
Несколько stages могут исполняться параллельно только если это разрешено PlanningDecision и повторно подтверждено Orchestrator.
20.3. Commit concurrency
Semantic commits должны быть сериализованы по DebateCase.version.
Каждый StateDelta содержит:
expectedCaseVersion
Если версия изменилась:
STATE_DELTA_STALE
Delta должна быть пересчитана или отклонена.

21. Idempotency
Обязательные idempotency boundaries:
    • command submission;
    • Planner decision commit;
    • stage creation;
    • participant dispatch;
    • response receipt;
    • StateDelta application;
    • revision activation;
    • finalization.
Повтор события не должен создавать повторный logical effect.

22. Observability
Каждое действие Orchestrator должно быть трассируемым.
Минимальные поля:
{
  runId,
  ownerId,
  eventId,
  eventSequence,
  caseVersion,
  planRevisionId,
  stageInstanceId?,
  attemptId?,
  planningDecisionId?,
  timestamp
}
Обязательные metrics:
    • planner ticks;
    • stale decisions;
    • active stages;
    • retries;
    • late responses;
    • pause duration;
    • reconciliation duration;
    • recovery count;
    • lease conflicts;
    • revision conflicts;
    • no-state-change responses.

23. Prohibited Responsibilities
Orchestrator не должен:
    • анализировать смысл ответа;
    • определять истинность claim;
    • выбирать аргумент победителя;
    • писать prompts;
    • выполнять response repair;
    • принимать LLM planning output без validation;
    • менять DebateCase напрямую без StateDelta;
    • мутировать PlanRevision;
    • хранить единственную копию runtime state в памяти;
    • ветвиться по legacy preset names.

24. Required Tests
Ownership
    • second tab cannot dispatch;
    • expired lease can be acquired;
    • takeover triggers recovery;
    • duplicate owner cannot exist.
Planning
    • stale PlanningDecision rejected;
    • only one Planner tick active;
    • compatible stages run in parallel;
    • conflicting stages serialized.
Pause
    • pause before Planner tick;
    • pause during dispatch;
    • pause during commit;
    • late response after pause;
    • no stage created after pause request.
Continue
    • continue after reload;
    • continue after owner loss;
    • continue with pending intervention;
    • continue with new plan revision;
    • continue with late response.
Idempotency
    • duplicate stage creation;
    • duplicate response;
    • duplicate StateDelta;
    • duplicate revision activation;
    • duplicate finalization.
Recovery
    • recovery from snapshot;
    • recovery without snapshot;
    • recovery from incomplete attempt;
    • recovery from interrupted commit;
    • corrupted event sequence detected.

25. Definition of Done
Orchestrator Contract считается реализованным, если:
    1. Для каждого run существует не более одного execution owner.
    2. Run можно восстановить после reload.
    3. Continue не зависит от старого Promise или closure.
    4. Pause имеет QUIESCING.
    5. После PAUSE_REQUESTED новые stages не создаются.
    6. Planner tick сериализован.
    7. Stage создаётся только после persisted PlanningDecision.
    8. Transport request имеет idempotency key.
    9. Semantic commit атомарен.
    10. StateDelta применяется по optimistic case version.
    11. Plan Revision activation сериализована.
    12. Late responses reconciled.
    13. Finalization проходит через единый путь.
    14. Event log достаточен для полного recovery.
    15. Orchestrator не содержит topology-specific branching.
    16. Orchestrator не принимает содержательные planning decisions.

26. Final Statement
DebateOrchestrator не является новым универсальным runner.
Его задача — не определять сценарий обсуждения, а гарантировать корректное, восстанавливаемое и детерминированное выполнение решений Planner.
Главный архитектурный принцип:
Planner decides.
Orchestrator coordinates.
Executor executes.
DebateCase records meaning.
Event log records history.
