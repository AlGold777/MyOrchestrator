Plan Revision Specification v1.0
Disput Universal Discussion Engine
Нормативная спецификация изменения плана выполнения

1. Статус документа
1.1. Назначение
Настоящий документ определяет единый механизм изменения плана выполнения Discussion Run.
Документ является нормативным контрактом между:
    • DebateApplication;
    • Pipeline Canvas;
    • Human Participant;
    • Planner;
    • DebateOrchestrator;
    • StageExecutor.
Любое изменение поведения Discussion Run должно проходить через механизм Plan Revision.

2. Цель
План обсуждения не является статичной структурой.
Во время выполнения пользователь или система могут:
    • изменить последовательность действий;
    • добавить новый этап;
    • удалить запланированный этап;
    • заменить участников;
    • изменить ограничения;
    • изменить стратегию;
    • добавить Human Stage;
    • добавить Synthesis;
    • изменить политики.
Все подобные изменения должны происходить безопасно, воспроизводимо и без нарушения целостности выполнения.

3. Основные принципы
3.1 Immutable
Активная Revision никогда не изменяется.
Любое изменение создаёт новую Revision.

3.2 Single Active Revision
Для каждого Run существует только одна Active Revision.

3.3 Complete History
История изменений плана никогда не теряется.
Каждая Revision хранится полностью.

3.4 Planner Independence
Planner не изменяет Revision.
Planner только использует Active Revision.

3.5 Runtime Independence
StageExecutor ничего не знает о Revision.

3.6 Deterministic
При одинаковом наборе Revision система обязана получить одинаковый execution graph.

4. Revision Model
interface PlanRevision {

revisionId

parentRevisionId

runId

revisionNumber

createdAt

createdBy

reason

commands[]

executionPolicies

constraints

plannedStages

metadata

status

}

5. Revision Status
DRAFT

↓

VALIDATED

↓

ACTIVE

↓

SUPERSEDED

↓

ARCHIVED

6. Ownership
Revision могут создавать
6.1 Human
Через Canvas.
Через команды.
Через Pause.

6.2 Planner
Только если это разрешено Policy.

6.3 System
Recovery.
Migration.
Automation.

7. Revision Commands
Все изменения выполняются только командами.

7.1 INSERT_STAGE
Добавить новую Stage.

7.2 REMOVE_PENDING_STAGE
Удалить ещё не начавшуюся Stage.

7.3 CHANGE_STAGE_ORDER
Изменить порядок выполнения.

7.4 CHANGE_PARTICIPANT
Заменить Participant.

7.5 CHANGE_VISIBILITY
Изменить Visibility Policy.

7.6 CHANGE_EXECUTION_POLICY
Изменить execution mode.

7.7 CHANGE_COMPLETION_POLICY
Изменить completion policy.

7.8 REQUEST_SYNTHESIS
Добавить Synthesis.

7.9 REQUEST_AUDIT
Добавить Audit.

7.10 INSERT_HUMAN_STAGE
Добавить Human Task.

7.11 ADD_CONSTRAINT
Добавить Constraint.

7.12 REMOVE_CONSTRAINT
Удалить Constraint.

7.13 CHANGE_PRIORITY
Изменить приоритет.

7.14 SPLIT_STAGE
Разделить Stage.

7.15 MERGE_STAGES
Объединить несколько Stage.

7.16 CANCEL_GOAL
Отменить Goal.

7.17 REOPEN_GOAL
Повторно открыть Goal.

8. Command Contract
Каждая команда содержит
commandId

expectedRevisionId

commandType

payload

createdBy

timestamp

9. Validation Pipeline
Каждая команда проходит
Schema Validation

↓

Semantic Validation

↓

Dependency Validation

↓

Capability Validation

↓

Policy Validation

↓

Budget Validation

↓

Conflict Detection

↓

Revision Creation

10. Conflict Definition
Команды конфликтуют если
    • меняют один Stage;
    • меняют одного Participant несовместимо;
    • меняют одинаковую Constraint;
    • меняют одну Policy разными значениями;
    • нарушают Dependency Graph;
    • нарушают Visibility;
    • нарушают Budget;
    • нарушают Completion Policy.

11. Atomic Revision Creation
Read Active Revision

↓

Validate Command

↓

Create Revision

↓

Recalculate Dependency Graph

↓

Invalidate Stages

↓

Activate Revision

↓

Persist

↓

Emit Events
Любая ошибка откатывает процесс полностью.

12. Dependency Graph
Каждая Stage должна хранить
    • upstream dependencies;
    • downstream dependencies;
    • Goal dependencies;
    • Artifact dependencies.
Dependency Graph является каноническим механизмом определения влияния изменений.

13. Dependency Closure
После изменения Planner обязан определить
Affected Stage Set.
Для этого вычисляется
Dependency Closure
В него входят
    • сама изменённая Stage;
    • downstream;
    • связанные Goals;
    • связанные Constraints.

14. Stage Invalidation
Stage может получить
UNCHANGED

STALE

CANCELLED

14.1 UNCHANGED
Stage не зависит от изменений.

14.2 STALE
Stage требует повторного планирования.

14.3 CANCELLED
Stage больше не должна существовать.

15. Running Stage Policy
Если Revision появилась во время выполнения Stage
Policy может быть
FINISH
Дождаться окончания.

CANCEL
Остановить.

IGNORE_RESULT
Разрешить закончить,
но не применять StateDelta.

CONVERT_TO_AUDIT
Использовать как Audit.

RESTART
После завершения запустить новую Stage.

16. Concurrent Revisions
Одновременно могут существовать команды от
    • Planner;
    • Human;
    • Automation.
Активироваться может только одна Revision.

17. expectedRevisionId
Каждая команда обязана содержать
expectedRevisionId
При несовпадении
REVISION_STALE
Команда отклоняется.

18. Retry Semantics
После REVISION_STALE
источник команды обязан
    • перечитать Active Revision;
    • пересчитать Command;
    • создать новую попытку.
Повторное применение старой команды запрещено.

19. Activation
Revision становится Active только после
    • полной валидации;
    • построения нового Dependency Graph;
    • определения Affected Stages;
    • сохранения.

20. Continue Semantics
Если во время Pause создана новая Revision
Continue выполняет
Load Snapshot

↓

Replay Events

↓

Activate Latest Revision

↓

Invalidate Stale Stages

↓

Rebuild Execution Graph

↓

Planner Tick
Продолжение старого execution graph запрещено.

21. Canvas Contract
Canvas никогда не изменяет Plan напрямую.
Любое действие Canvas
↓
Command
↓
DebateApplication
↓
Revision Validation
↓
New Revision
↓
Planner
↓
Canvas Projection

22. Human Intervention
Любое вмешательство человека
становится
Revision Command.
Не существует отдельного UI-пути,
который меняет Runtime напрямую.

23. Semantic Stability Rules
Не каждое изменение требует новой Revision.
Revision создаётся только при изменении семантики выполнения.

Не требуют Revision
    • изменение масштаба Canvas;
    • изменение расположения блоков;
    • изменение цвета;
    • изменение свёрнутости;
    • изменение фильтров;
    • изменение сортировки отображения;
    • локальные UI-настройки.

Требуют Revision
    • изменение Goal;
    • изменение Constraint;
    • изменение Participant;
    • изменение Prompt Contract;
    • изменение Stage;
    • изменение Dependencies;
    • изменение Visibility;
    • изменение Execution Policy;
    • изменение Completion Policy;
    • изменение порядка выполнения;
    • изменение Planner Policy;
    • добавление Human;
    • удаление Stage;
    • вставка Synthesis;
    • вставка Audit.

24. Revision Events
REVISION_CREATED

REVISION_VALIDATED

REVISION_REJECTED

REVISION_ACTIVATED

REVISION_SUPERSEDED

REVISION_ARCHIVED

REVISION_STALE

25. Observability
Каждая Revision должна иметь Trace
runId

revisionId

parentRevisionId

revisionNumber

createdBy

commands

affectedStages

affectedGoals

dependencyClosure

plannerVersion

timestamp

26. Versioning
Каждая Revision хранит
    • schemaVersion;
    • plannerVersion;
    • dependencyGraphVersion;
    • policyVersion.

27. Recovery
Recovery обязан восстановить
    • Active Revision;
    • Revision Lineage;
    • Dependency Graph;
    • Invalidated Stages.

28. Required Tests
Revision
    • create;
    • activate;
    • supersede;
    • archive.

Commands
Все команды отдельно.

Dependency
    • upstream;
    • downstream;
    • closure.

Running Stage
Все пять Policy.

Concurrent Revision
Planner.
Human.
Automation.

Continue
Pause.
Revision.
Continue.

Canvas
Все операции.

Human
Все команды.

Recovery
Reload.
Restart.
Late Revision.

Stale
Version mismatch.
Retry.

29. Acceptance Criteria
Реализация считается завершённой если
    1. Revision immutable.
    2. Active Revision единственная.
    3. Все изменения проходят через Revision.
    4. Canvas не меняет Runtime напрямую.
    5. Human создаёт только Revision Commands.
    6. Planner использует только Active Revision.
    7. StageExecutor не знает о Revision.
    8. Dependency Graph является единственным механизмом определения affected stages.
    9. Running Stage Policy централизована.
    10. Continue всегда использует последнюю Active Revision.
    11. Все изменения полностью трассируются.
    12. Все обязательные тесты проходят.

30. Definition of Done
Plan Revision реализован только если
    1. отсутствуют прямые изменения execution graph;
    2. отсутствуют mutable планы;
    3. отсутствуют скрытые изменения Planner;
    4. отсутствуют специальные Canvas-path;
    5. отсутствуют специальные Human-path;
    6. любая модификация проходит через Revision;
    7. recovery полностью восстанавливает Revision Lineage;
    8. dependency recalculation детерминирована;
    9. stale detection централизована;
    10. реализация соответствует настоящему документу.

31. Mandatory LLM Implementation Report
Для каждого реализованного пункта LLM обязана предоставить
Номер пункта

Статус
DONE / PARTIAL / BLOCKED

Изменённые файлы

Добавленные тесты

Новые события

Изменения схем

Оставшиеся ограничения

32. Final Statement
Plan Revision является единственным механизмом изменения поведения выполняющегося Discussion Run.
Ни Planner, ни Canvas, ни Human, ни Orchestrator не имеют права изменять execution graph напрямую.
Главный принцип:
Execution is immutable.

Plans evolve through immutable revisions.

Only one revision is active.

Every semantic change creates a new revision.

Everything else is projection.
