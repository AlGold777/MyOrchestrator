Planner Contract v1.0
Disput Universal Discussion Engine
Нормативный контракт принятия решений

1. Статус документа
1.1. Назначение
Настоящий документ определяет:
    1. роль Planner в архитектуре Disput;
    2. границы ответственности Planner;
    3. входные и выходные контракты;
    4. Planner tick lifecycle;
    5. Goal lifecycle;
    6. trigger evaluation;
    7. ranking algorithm;
    8. разрешение конфликтов между Goals;
    9. правила создания одной или нескольких Stage Instances;
    10. выбор Participant;
    11. stagnation и repetition handling;
    12. finalization decisions;
    13. synthesis decisions;
    14. взаимодействие с Human Participant;
    15. границу между rule-based Planner и опциональным LLM advisory;
    16. требования к тестированию, детерминированности и наблюдаемости.
1.2. Нормативность
Реализация Planner не может считаться соответствующей контракту, если она:
    1. принимает решения вне описанного Planner tick;
    2. мутирует каноническое состояние напрямую;
    3. вызывает transport или StageExecutor;
    4. использует topology-specific branching;
    5. зависит от локальной LLM в MVP;
    6. создаёт Stage без persisted PlanningDecision;
    7. принимает недетерминированное решение без trace;
    8. завершает run вне Finalization Policy.

2. Architectural Role
2.1. Основная роль
Planner отвечает на вопрос:
Какое следующее полезное действие должно быть выполнено с учётом текущего канонического состояния, открытых Goals, активной Plan Revision, доступных Participants, политик и бюджетов?
2.2. Позиция в архитектуре
DebateCase
    +
State Map
    +
Open Goals
    +
Active Plan Revision
    +
Policies
    +
Available Participants
        ↓
Planner
        ↓
PlanningDecision
        ↓
DebateOrchestrator
        ↓
StageInstance(s)
2.3. Разделение ответственности
Planner
Определяет:
    1. какие Goals актуальны;
    2. какие Goals уже покрыты активными Stages;
    3. какие Goals заблокированы;
    4. какие actions допустимы;
    5. какие actions имеют наибольшую utility;
    6. какие Participants подходят;
    7. какие Stages могут выполняться параллельно;
    8. требуется ли Human Decision;
    9. требуется ли finalization;
    10. требуется ли synthesis или audit.
Orchestrator
Определяет:
    1. можно ли применить PlanningDecision;
    2. действительны ли версии состояния;
    3. можно ли создать Stages;
    4. соблюдены ли concurrency limits;
    5. нет ли pause, recovery или revision conflict;
    6. когда вызвать StageExecutor.
StageExecutor
Исполняет уже созданную StageInstance.

3. Core Invariants
3.1. Rule-based MVP
Planner MVP является:
    1. rule-based;
    2. deterministic;
    3. traceable;
    4. reproducible;
    5. testable;
    6. topology-neutral;
    7. независимым от локальной LLM.
3.2. No direct mutation
Planner не может напрямую:
    1. менять DebateCase;
    2. менять Goal status;
    3. менять Plan Revision;
    4. создавать persisted events;
    5. создавать StageInstance в store;
    6. запускать Participant;
    7. завершать run.
Planner только возвращает PlanningDecision.
3.3. Same input, same output
При одинаковых:
    1. caseVersion;
    2. stateMapVersion;
    3. activePlanRevisionId;
    4. open Goals;
    5. active Stages;
    6. participant availability;
    7. budgets;
    8. policies;
    9. rule set version
Planner обязан вернуть одинаковый результат.
3.4. No hidden sequencing
Planner не должен содержать скрытый сценарий вида:
first do positions
then critique
then synthesis
Каждое решение должно быть обосновано текущим состоянием и правилами.
3.5. No topology branching
Запрещены условия вида:
if duel
if triad
if multi
if free_talk
3.6. Goal-first planning
Planner работает с Goals, а не с legacy stage names.
Stage является способом достижения Goal, а не первичной единицей reasoning.

4. Planner API
4.1. Интерфейс
interface DebatePlanner {
  evaluate(input: PlannerInput): PlanningDecision;
}
4.2. PlannerInput
interface PlannerInput {
  runId: string;

  caseVersion: number;
  stateMapVersion: number;
  activePlanRevisionId: string;

  debateCase: DebateCase;
  stateMap: StateMap;

  openGoals: Goal[];
  resolvedGoals: GoalResolution[];
  activeStages: StageInstance[];

  availableParticipants: ParticipantAvailability[];
  participantCapabilities: ParticipantCapabilityIndex;

  policies: PlannerPolicies;
  budgets: PlannerBudgets;

  ruleSetVersion: string;
  currentTime: string;
}
4.3. PlanningDecision
interface PlanningDecision {
  decisionId: string;

  inputCaseVersion: number;
  inputStateMapVersion: number;
  inputPlanRevisionId: string;
  ruleSetVersion: string;

  type:
    | "CREATE_STAGES"
    | "REQUEST_HUMAN_DECISION"
    | "WAIT"
    | "FINALIZE"
    | "NO_OP";

  consideredGoalIds: string[];
  selectedGoalIds: string[];

  firedRules: FiredRule[];
  suppressedRules: SuppressedRule[];

  proposedStages?: ProposedStage[];
  humanDecisionRequest?: HumanDecisionRequest;
  finalizationDecision?: FinalizationDecision;

  rationaleCode: string;
  rationaleData: Record<string, unknown>;

  utilityBreakdown: UtilityBreakdown[];
  createdAt: string;
}

5. Planner Tick Lifecycle
5.1. Preconditions
Planner tick допускается только если:
    1. run lifecycle = RUNNING;
    2. Orchestrator владеет execution ownership;
    3. active Plan Revision валидна;
    4. отсутствует blocking reconciliation;
    5. отсутствует uncommitted semantic transaction;
    6. Planner tick для этого run ещё не выполняется;
    7. Pause не запрошен;
    8. finalization ещё не начата.
5.2. Tick sequence
1. Validate input versions
2. Normalize input
3. Reconcile Goal coverage
4. Generate derived Goals
5. Evaluate rules
6. Suppress invalid actions
7. Compute utility
8. Resolve conflicts
9. Select Goals
10. Select action types
11. Select Participants
12. Build Proposed Stages
13. Evaluate finalization
14. Return PlanningDecision
5.3. Tick atomicity
Planner tick:
    1. читает immutable input;
    2. не изменяет external state;
    3. возвращает один immutable PlanningDecision;
    4. не выполняет partial commit;
    5. не создаёт side effects.
5.4. Stale input
Если input version устарела до применения решения, Orchestrator обязан отклонить решение как:
PLANNING_DECISION_STALE
Planner не выполняет self-retry самостоятельно.

6. Goal Model
6.1. Goal definition
interface Goal {
  goalId: string;

  type:
    | "establish_position"
    | "verify_claim"
    | "verify_evidence"
    | "resolve_objection"
    | "resolve_contradiction"
    | "answer_open_question"
    | "examine_dissent"
    | "test_revision"
    | "recheck_conclusion"
    | "compact_context"
    | "produce_synthesis"
    | "audit_output"
    | "request_human_judgment";

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
  createdAt: string;

  requiredCapabilities?: string[];
  blockingArtifactIds?: string[];
  resolutionCriteria?: GoalResolutionCriteria;
}
6.2. Goal lifecycle
OPEN
  ↓ Planner selects Goal
ASSIGNED
  ↓ Stage starts
IN_PROGRESS
  ├── resolution criteria satisfied → RESOLVED
  ├── temporary execution failure → OPEN
  ├── participant unavailable → OPEN or BLOCKED
  ├── required input unavailable → BLOCKED
  ├── plan invalidation → OPEN
  └── explicit cancellation → CANCELLED
6.3. Goal status ownership
Planner предлагает переходы, но не применяет их.
Фактический Goal status изменяется через:
    1. Orchestrator event;
    2. Stage lifecycle event;
    3. StateDelta;
    4. revision activation;
    5. explicit Human command.
6.4. Goal creation
Goal может быть создан из:
    1. initial configuration;
    2. StateMap condition;
    3. accepted artifact;
    4. unresolved objection;
    5. contradiction;
    6. missing evidence;
    7. Human intervention;
    8. synthesis audit;
    9. Planner-derived rule.
6.5. Goal deduplication
Перед созданием нового Goal Planner обязан проверить:
    1. существует ли Goal того же type;
    2. совпадает ли target artifact set;
    3. находится ли Goal в open, assigned или in_progress;
    4. покрывает ли активная Stage тот же resolution criterion.
Дублирующий Goal не создаётся.
6.6. Goal resolution
Goal считается resolved только если выполнен его resolutionCriteria.
Завершение Stage само по себе не разрешает Goal.
Пример:
Stage verification completed
не равно:
Claim verified
Goal разрешается только после committed StateDelta, который изменил статус claim или evidence.

7. Derived Goal Generation
7.1. Назначение
Planner может создавать derived Goals из текущего StateMap.
7.2. Базовые conditions
Unsupported claim
claim.status = unsupported
→ Goal verify_claim
Disputed evidence
evidence.status = disputed
→ Goal verify_evidence
Blocking objection
objection.severity = blocking
and objection.status = unresolved
→ Goal resolve_objection
Contradiction
contradiction.status = open
→ Goal resolve_contradiction
Open question
question.status = open
→ Goal answer_open_question
Unexamined dissent
dissent.status = unexamined
→ Goal examine_dissent
Revised claim
claim.revision != null
and revision.status = untested
→ Goal test_revision
Context pressure
contextPressure > configuredThreshold
→ Goal compact_context
Synthesis readiness
requiredGoals resolved
and finalizationPolicy permits synthesis
→ Goal produce_synthesis
Synthesis audit
synthesis exists
and audit policy = required
and no valid audit exists
→ Goal audit_output

8. Rule Model
8.1. Rule definition
interface PlannerRule {
  ruleId: string;
  version: string;

  condition: RuleCondition;
  action: RuleAction;

  basePriority: number;
  costWeight: number;
  uncertaintyWeight: number;

  mutexGroup?: string;
  requiredCapabilities?: string[];

  enabled: boolean;
}
8.2. Rule evaluation
Каждое правило получает:
    1. DebateCase;
    2. StateMap;
    3. open Goals;
    4. active Stages;
    5. participant capabilities;
    6. policies;
    7. budgets.
8.3. FiredRule
interface FiredRule {
  ruleId: string;
  version: string;
  targetGoalIds: string[];
  candidateAction: string;
  basePriority: number;
  matchedConditions: string[];
}
8.4. SuppressedRule
interface SuppressedRule {
  ruleId: string;
  targetGoalIds: string[];
  suppressionReason:
    | "GOAL_ALREADY_COVERED"
    | "DEPENDENCY_NOT_READY"
    | "PARTICIPANT_UNAVAILABLE"
    | "POLICY_FORBIDS"
    | "BUDGET_EXCEEDED"
    | "CONFLICT_WITH_HIGHER_UTILITY"
    | "PAUSE_PENDING"
    | "FINALIZATION_PENDING"
    | "VISIBILITY_CONFLICT";
}

9. Utility Ranking
9.1. Utility formula
MVP должен использовать явную детерминированную формулу.
utility =
  basePriority
  + blockerBonus
  + disputedBonus
  + uncertaintyBonus
  + dependencyUnlockBonus
  + humanPriorityBonus
  - executionCostPenalty
  - participantScarcityPenalty
  - contextCostPenalty
  - duplicationPenalty
  - latencyPenalty;
9.2. Обязательные компоненты
basePriority
Берётся из Rule или Goal.
blockerBonus
Добавляется, если Goal блокирует другие Goals или finalization.
disputedBonus
Добавляется для disputed claim, evidence или conclusion.
uncertaintyBonus
Добавляется для high-impact uncertainty.
dependencyUnlockBonus
Добавляется, если разрешение Goal разблокирует несколько dependent Goals.
executionCostPenalty
Учитывает ожидаемую стоимость Stage.
participantScarcityPenalty
Учитывает ограниченность подходящего Participant.
contextCostPenalty
Учитывает объём контекста.
duplicationPenalty
Применяется, если похожая Stage недавно выполнялась без StateDelta.
latencyPenalty
Может применяться к Human или недоступному Participant, если policy требует быстрый progress.
9.3. Utility trace
Каждое выбранное действие обязано сохранять breakdown.
interface UtilityBreakdown {
  goalId: string;
  ruleId: string;

  basePriority: number;
  blockerBonus: number;
  disputedBonus: number;
  uncertaintyBonus: number;
  dependencyUnlockBonus: number;
  humanPriorityBonus: number;

  executionCostPenalty: number;
  participantScarcityPenalty: number;
  contextCostPenalty: number;
  duplicationPenalty: number;
  latencyPenalty: number;

  total: number;
}
9.4. Tie-breaking
При одинаковой utility применяется последовательность:
    1. blocking Goal;
    2. Goal с большим числом dependents;
    3. Goal, созданный раньше;
    4. меньшая execution cost;
    5. лексикографически меньший goalId.
Tie-breaking не может быть случайным.

10. Conflict Resolution
10.1. Определение конфликта
Два candidate actions конфликтуют, если:
    1. изменяют один exclusive artifact;
    2. один зависит от результата другого;
    3. назначают одного Participant сверх capacity;
    4. используют несовместимую visibility policy;
    5. требуют несовместимых Plan policies;
    6. один action делает другой semantic stale;
    7. превышают concurrency budget;
    8. входят в один mutexGroup.
10.2. Compatible actions
Actions совместимы, если:
    1. имеют независимые target artifacts;
    2. не зависят друг от друга;
    3. Participants доступны;
    4. output одной Stage не требуется другой;
    5. semantic commit может быть сериализован;
    6. visibility policies не конфликтуют.
10.3. Selection algorithm
Planner должен:
    1. отсортировать candidates по utility;
    2. выбрать candidate с наибольшей utility;
    3. последовательно добавлять совместимые candidates;
    4. остановиться при достижении:
        ◦ maxStagesPerTick;
        ◦ concurrency budget;
        ◦ participant capacity;
        ◦ context budget.
10.4. Dependency ordering
Если Goal B зависит от Goal A:
A → B
Planner не может создать Stage для B до выполнения resolution criteria A, кроме случаев, когда B explicitly supports speculative execution.
10.5. Speculative execution
Speculative execution не входит в MVP.

11. Stage Proposal Contract
11.1. ProposedStage
interface ProposedStage {
  proposedStageId: string;

  purpose:
    | "position"
    | "critique"
    | "response"
    | "verification"
    | "evidence_review"
    | "contradiction_resolution"
    | "dissent_examination"
    | "context_compaction"
    | "synthesis"
    | "audit"
    | "human_judgment";

  goalIds: string[];
  participantIds: string[];

  inputArtifactIds: string[];
  expectedArtifactTypes: string[];

  dispatchMode:
    | "single"
    | "parallel"
    | "sequential";

  completionMode:
    | "all"
    | "quorum"
    | "first_success";

  executionPolicyId: string;
  promptContractId: string;
  visibilityPolicy: VisibilityPolicy;
}
11.2. No direct stage identity
Planner не создаёт persisted stageInstanceId.
Он создаёт ProposedStage.
Orchestrator после validation создаёт фактическую StageInstance.
11.3. Required provenance
Каждая ProposedStage должна ссылаться на:
    1. decisionId;
    2. Goal IDs;
    3. Rule IDs;
    4. input case version;
    5. active Plan Revision;
    6. participant selection rationale.

12. Participant Selection
12.1. Selection inputs
Planner учитывает:
    1. required capabilities;
    2. participant availability;
    3. participant type;
    4. provider independence;
    5. previous authorship;
    6. visibility access;
    7. cost policy;
    8. latency policy;
    9. current capacity;
    10. conflict-of-interest policy.
12.2. Capability matching
Participant может быть выбран только если он удовлетворяет обязательным capabilities Stage.
12.3. Independence policy
Для verification, audit и critical review Planner должен предпочитать Participant, который:
    1. не является автором target artifact;
    2. использует другой provider, если возможно;
    3. не выполнял предыдущую проверку того же artifact;
    4. имеет соответствующую capability.
12.4. Degraded independence
Если независимый Participant недоступен, Planner может предложить degraded execution только если policy это разрешает.
PlanningDecision обязан содержать:
DEGRADED_INDEPENDENCE
и объяснение причины.
12.5. Human selection
Human выбирается, если:
    1. Goal требует domain judgment;
    2. policy требует Human approval;
    3. доступные LLM не имеют необходимой capability;
    4. конфликт не разрешается правилами;
    5. требуется новая constraint;
    6. требуется subjective preference;
    7. Planner достиг configured uncertainty threshold.
12.6. Participant capacity
Planner не может назначить Participant сверх установленной capacity.

13. Human Decision Requests
13.1. Не вся Human activity является Stage
Planner может вернуть REQUEST_HUMAN_DECISION, если требуется:
    1. выбрать между несовместимыми стратегиями;
    2. подтвердить degraded execution;
    3. изменить policy;
    4. разрешить subjective conflict;
    5. подтвердить finalization;
    6. выбрать synthesis point;
    7. выбрать Participant при равных вариантах.
13.2. HumanDecisionRequest
interface HumanDecisionRequest {
  requestId: string;

  type:
    | "CHOOSE_ACTION"
    | "APPROVE_DEGRADED_EXECUTION"
    | "APPROVE_FINALIZATION"
    | "SELECT_PARTICIPANT"
    | "RESOLVE_POLICY_CONFLICT"
    | "SELECT_SYNTHESIS_SCOPE";

  question: string;
  options: HumanDecisionOption[];
  defaultOptionId?: string;

  blocking: boolean;
  relatedGoalIds: string[];
  relatedArtifactIds: string[];
}
13.3. Blocking request
Если request blocking = true, Planner должен вернуть только REQUEST_HUMAN_DECISION и не создавать Stages.

14. Stagnation Detection
14.1. Stagnation signals
Planner учитывает:
    1. число последовательных Stages без StateDelta;
    2. повторяющиеся artifact fingerprints;
    3. повторяющиеся objections;
    4. отсутствие новых evidence;
    5. отсутствие изменения Goal statuses;
    6. context growth без semantic progress;
    7. повторный выбор одинакового action;
    8. repeated repair failures.
14.2. Stagnation threshold
Threshold задаётся policy.
Пример:
interface StagnationPolicy {
  unchangedStateMapLimit: number;
  noStateDeltaLimit: number;
  repeatedActionLimit: number;
  repeatedArtifactSimilarityThreshold: number;
}
14.3. Planner actions при stagnation
Planner может предложить:
    1. compact_context;
    2. сменить Participant;
    3. изменить action type;
    4. запросить Human Decision;
    5. предложить synthesis;
    6. предложить finalization;
    7. открыть Goal examine_dissent;
    8. вернуть WAIT, если нет допустимого действия.
14.4. Запрет автоматического synthesis
Stagnation не означает автоматический synthesis.
Решение зависит от FinalizationPolicy.

15. Repetition Handling
15.1. Repetition signal
Repetition detector является вспомогательным сигналом.
Он не может самостоятельно завершить Stage или run.
15.2. Required evidence
Action подавляется как repetition только при сочетании:
    1. similarity signal;
    2. отсутствия meaningful StateDelta;
    3. совпадения target Goal;
    4. совпадения action purpose;
    5. превышения configured repetition threshold.
15.3. Возможные действия
    1. suppress candidate;
    2. assign another Participant;
    3. request new evidence;
    4. compact context;
    5. ask Human;
    6. finalize по policy.

16. Budget Model
16.1. PlannerBudgets
interface PlannerBudgets {
  maxStagesPerTick: number;
  maxConcurrentStages: number;
  maxTotalStages: number;

  maxModelCalls: number;
  maxHumanWaits: number;

  maxContextTokens?: number;
  maxEstimatedCost?: number;
  maxElapsedTimeMs?: number;
}
16.2. Budget behavior
При приближении к budget Planner должен:
    1. повысить utility Goals, разблокирующих finalization;
    2. уменьшить число параллельных Stages;
    3. избегать низкоценностных checks;
    4. рассмотреть context compaction;
    5. применить Finalization Policy.
16.3. Budget exhaustion
При полном исчерпании budget Planner обязан вернуть:
    1. FINALIZE, если policy разрешает;
    2. REQUEST_HUMAN_DECISION, если требуется Human;
    3. WAIT, если budget может быть расширен внешней командой.
Planner не может молча продолжать execution.

17. Finalization Decision
17.1. Finalization is Planner decision
Orchestrator не принимает содержательное решение о завершении.
Planner возвращает FINALIZE.
17.2. Finalization conditions
Planner оценивает:
    1. required Goals;
    2. unresolved blockers;
    3. open contradictions;
    4. unexamined dissent;
    5. budget;
    6. stagnation;
    7. synthesis policy;
    8. audit policy;
    9. Human instructions;
    10. Plan Revision constraints.
17.3. FinalizationDecision
interface FinalizationDecision {
  reason:
    | "MANUAL_STOP"
    | "REQUIRED_GOALS_RESOLVED"
    | "STAGNATION"
    | "BUDGET_EXHAUSTED"
    | "SYNTHESIS_COMPLETED"
    | "NO_ACTIONABLE_GOALS"
    | "UNRECOVERABLE_BLOCK";

  finalizationMode:
    | "STATE_MAP"
    | "ARTIFACTS_ONLY"
    | "SYNTHESIS"
    | "SYNTHESIS_AND_AUDIT";

  unresolvedGoalIds: string[];
  selectedFinalArtifactIds: string[];

  humanApprovalRequired: boolean;
}
17.4. No synthesis finalization
Валидные terminal outcomes:
    1. STATE_MAP;
    2. ARTIFACTS_ONLY.
Synthesis не обязателен.
17.5. Required Goals
Run не должен автоматически завершаться, если существуют unresolved required Goals, кроме:
    1. budget exhaustion;
    2. Human stop;
    3. unrecoverable block;
    4. explicit policy.

18. Synthesis Planning
18.1. Synthesis as Goal
Synthesis оформляется как Goal:
produce_synthesis
18.2. Когда synthesis допустим
Planner может предложить synthesis, если:
    1. synthesis policy = optional или required;
    2. существует достаточный набор committed artifacts;
    3. нет blocking contradiction, запрещающей synthesis;
    4. определён synthesis scope;
    5. выбран Participant с synthesis capability.
18.3. Когда synthesis запрещён
Planner не предлагает synthesis, если:
    1. synthesis policy = none;
    2. required Goals ещё не разрешены, а policy запрещает premature synthesis;
    3. отсутствуют meaningful artifacts;
    4. active Plan Revision запрещает synthesis;
    5. Human explicitly запретил synthesis.
18.4. Intermediate synthesis
Если allowContinueAfterSynthesis = true, synthesis Stage не ведёт автоматически к finalization.
Результат создаёт synthesis artifact и новые Goals могут быть созданы для:
    1. audit;
    2. critique;
    3. revision;
    4. evidence verification;
    5. continuation.
18.5. Multiple synthesis artifacts
Planner должен ссылаться на конкретный synthesis artifact и provenance chain.

19. Audit Planning
19.1. Audit conditions
Planner создаёт Goal audit_output, если:
    1. audit policy = required;
    2. существует новый synthesis artifact;
    3. для него нет valid audit;
    4. доступен подходящий Participant.
19.2. Audit independence
Audit Participant должен отличаться от synthesis author, если это возможно.
19.3. Audit outcomes
Audit может создать:
    1. accepted;
    2. accepted_with_issues;
    3. revision_required;
    4. rejected.
Planner на основании committed audit artifact может создать Goal:
test_revision
или новую synthesis Stage.

20. Context Compaction
20.1. Context compaction as maintenance Goal
Compaction не является synthesis.
Она не должна менять смысловые выводы.
20.2. Conditions
Planner предлагает compaction, если:
    1. context budget превышен;
    2. prompt compilation становится невозможным;
    3. повторяется большое количество неактуальных artifacts;
    4. policy разрешает compaction.
20.3. Compaction constraints
Compaction artifact должен сохранять:
    1. artifact IDs;
    2. unresolved Goals;
    3. contradictions;
    4. evidence provenance;
    5. dissent;
    6. Human constraints;
    7. visibility boundaries.

21. WAIT and NO_OP
21.1. WAIT
Planner возвращает WAIT, если:
    1. существует active Stage;
    2. ожидается Human response;
    3. ожидается внешняя dependency;
    4. Participants временно недоступны;
    5. нет права создавать новую Stage.
21.2. NO_OP
Planner возвращает NO_OP, если:
    1. нет actionable Goals;
    2. finalization запрещена;
    3. run требует внешней команды;
    4. текущее состояние валидно, но progress невозможен.
NO_OP должен иметь rationale.

22. LLM Advisory Boundary
22.1. Статус
LLM advisory не входит в MVP.
22.2. Допустимая будущая роль
LLM может:
    1. предложить ranking;
    2. предложить новые derived Goals;
    3. объяснить ambiguity;
    4. предложить alternative actions.
22.3. Ограничения
LLM advisory:
    1. не создаёт StageInstance;
    2. не меняет Goal status;
    3. не завершает run;
    4. не выбирает Participant без rule validation;
    5. не может обходить budget;
    6. не может обходить Plan Revision;
    7. не является source of truth.
22.4. Validation
Любое LLM advisory решение должно быть:
    1. schema-valid;
    2. policy-valid;
    3. capability-valid;
    4. budget-valid;
    5. traceable;
    6. отклоняемым deterministic fallback.

23. Planner Versioning
23.1. Required versions
Каждый PlanningDecision должен содержать:
    1. ruleSetVersion;
    2. plannerAlgorithmVersion;
    3. utilityFormulaVersion;
    4. goalSchemaVersion;
    5. stateMapSchemaVersion.
23.2. In-flight runs
После deployment старый run должен:
    1. восстановить текущие Goals;
    2. использовать новую Planner version только после successful recovery;
    3. фиксировать смену Planner version;
    4. не переинтерпретировать старое PlanningDecision задним числом.
23.3. Reproducibility
Для расследования должна быть возможность воспроизвести решение с использованием исходной версии Planner.

24. Observability
24.1. Обязательные события
PLANNING_STARTED
PLANNING_COMPLETED
PLANNING_FAILED
PLANNING_DECISION_STALE
PLANNING_NO_ACTION
PLANNING_FINALIZATION_PROPOSED
PLANNING_HUMAN_DECISION_REQUIRED
24.2. Обязательные trace fields
{
  runId,
  decisionId,
  caseVersion,
  stateMapVersion,
  planRevisionId,
  ruleSetVersion,
  consideredGoalIds,
  selectedGoalIds,
  firedRules,
  suppressedRules,
  utilityBreakdown,
  selectedParticipants,
  proposedStageIds,
  rationaleCode,
  timestamp
}
24.3. Metrics
Необходимо измерять:
    1. Planner ticks per run;
    2. average Goals considered;
    3. selected Goals per tick;
    4. suppressed rules;
    5. stale decisions;
    6. repeated-action suppression;
    7. Human decision requests;
    8. finalization proposals;
    9. no-op ticks;
    10. average Planner execution time.

25. Prohibited Responsibilities
Planner не должен:
    1. отправлять prompts;
    2. компилировать prompts;
    3. принимать stream chunks;
    4. выполнять response acceptance;
    5. извлекать artifacts;
    6. применять StateDelta;
    7. изменять Plan Revision;
    8. активировать revision;
    9. сохранять events;
    10. управлять lease;
    11. выполнять recovery;
    12. ждать Human response;
    13. изменять UI;
    14. использовать topology;
    15. создавать direct transport calls.

26. Required Tests
26.1. Determinism
    1. identical input → identical decision;
    2. tie-breaking deterministic;
    3. participant ordering deterministic;
    4. rule ordering deterministic.
26.2. Goal lifecycle
    1. open Goal selected;
    2. assigned Goal not duplicated;
    3. in-progress Goal not reselected;
    4. resolved Goal ignored;
    5. blocked Goal handled;
    6. invalidated Goal reopened;
    7. cancelled Goal ignored.
26.3. Trigger evaluation
    1. unsupported claim;
    2. disputed evidence;
    3. blocking objection;
    4. contradiction;
    5. open question;
    6. unexamined dissent;
    7. untested revision;
    8. context pressure;
    9. synthesis readiness;
    10. audit requirement.
26.4. Ranking
    1. blocker outranks non-blocker;
    2. dependency unlock bonus;
    3. cost penalty;
    4. scarcity penalty;
    5. duplication penalty;
    6. exact tie resolution.
26.5. Conflict resolution
    1. compatible Goals selected together;
    2. artifact conflict serialized;
    3. participant capacity respected;
    4. dependency ordering respected;
    5. mutex group respected;
    6. visibility conflict suppressed.
26.6. Participant selection
    1. capability match;
    2. unavailable Participant excluded;
    3. independent verifier preferred;
    4. degraded independence marked;
    5. Human selected for judgment;
    6. capacity limit enforced.
26.7. Stagnation
    1. unchanged map threshold;
    2. no-delta threshold;
    3. repeated action threshold;
    4. compaction selected;
    5. Human decision selected;
    6. finalization selected according to policy.
26.8. Finalization
    1. no-synthesis finalization;
    2. synthesis-required policy;
    3. manual policy;
    4. budget exhaustion;
    5. unresolved required Goal;
    6. Human approval required;
    7. audit-required flow.
26.9. Stale decisions
    1. case version changed;
    2. state map version changed;
    3. plan revision changed;
    4. participant availability changed.

27. Acceptance Criteria
Planner Contract считается реализованным, если:
    1. Planner является rule-based.
    2. Planner не вызывает LLM.
    3. Planner не содержит topology branching.
    4. Planner работает с Goals.
    5. Planner возвращает immutable PlanningDecision.
    6. Один input даёт один deterministic output.
    7. Все выбранные actions имеют utility breakdown.
    8. Все suppressed actions имеют suppression reason.
    9. Goal lifecycle соблюдается.
    10. Active Goal не дублируется.
    11. Одновременные Goals проходят conflict resolution.
    12. Participant selection учитывает capabilities и independence.
    13. Human Decision оформляется отдельным request.
    14. Stagnation не означает автоматический synthesis.
    15. Finalization определяется policy.
    16. Synthesis является обычным Goal.
    17. Audit является отдельным Goal.
    18. Planner version фиксируется.
    19. Решение полностью трассируется.
    20. Orchestrator может отклонить stale decision.
    21. Все обязательные тесты проходят.

28. Definition of Done
Planner v1.0 завершён только если:
    1. создан отдельный Planner module;
    2. legacy planning logic извлечена из runners;
    3. Planner tick вызывается только Orchestrator;
    4. все новые Stages происходят из PlanningDecision;
    5. Goal generation централизована;
    6. ranking централизован;
    7. conflict resolution централизован;
    8. participant selection централизован;
    9. finalization decision централизовано;
    10. synthesis decision централизовано;
    11. Human decision request централизован;
    12. отсутствуют hidden execution loops;
    13. отсутствует topology-specific behavior;
    14. существует rule set versioning;
    15. существует utility formula versioning;
    16. characterization tests legacy planning behavior сохранены;
    17. Planner trace достаточен для полного объяснения каждого решения;
    18. LLM-разработчик предоставил отчёт по каждому пункту настоящего контракта.

29. Mandatory LLM Implementation Report
По завершении реализации Planner LLM обязана предоставить:
29.1. Component report
Planner module:
Rule engine module:
Utility module:
Conflict resolver module:
Participant selector module:
Goal generator module:
Finalization evaluator module:
29.2. Point-by-point status
Для каждого применимого пункта:
[номер] — DONE / PARTIAL / BLOCKED / NOT APPLICABLE

Изменения:
Файлы:
Тесты:
Доказательство:
Отклонения:
29.3. Architecture confirmation
LLM обязана подтвердить:
    1. Planner не вызывает LLM.
    2. Planner не вызывает transport.
    3. Planner не мутирует DebateCase.
    4. Planner не создаёт persisted Stage напрямую.
    5. Planner не использует topology.
    6. Все решения имеют rationale.
    7. Все решения имеют version metadata.
    8. Все конфликты разрешаются детерминированно.
    9. Finalization не зашита в runner.
    10. Synthesis не является обязательным концом run.

30. Final Statement
Planner не является новым runner и не является универсальной LLM.
Его задача — детерминированно преобразовать текущее каноническое состояние в проверяемое решение о следующем действии.
Главный принцип:
Goals define what must be achieved.
Rules define what actions are allowed.
Utility defines what matters now.
Planner proposes.
Orchestrator validates and coordinates.
Executor executes.
StateDelta determines whether progress actually occurred.
