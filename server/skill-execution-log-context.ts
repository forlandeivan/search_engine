import {
  InMemorySkillExecutionLogRepository,
  DatabaseSkillExecutionLogRepository,
  SkillExecutionLogService,
} from "./skill-execution-log-service";

const repository =
  process.env.SKILL_EXECUTION_LOG_STORAGE === "memory"
    ? new InMemorySkillExecutionLogRepository()
    : new DatabaseSkillExecutionLogRepository();

const skillExecutionLogService = new SkillExecutionLogService(repository, {
  enabled: process.env.SKILL_EXECUTION_LOG_ENABLED !== "false",
});

export { skillExecutionLogService };

export function __getSkillExecutionLogRepositoryForTests() {
  return repository;
}

export function __resetSkillExecutionLogsForTests() {
  if (repository instanceof InMemorySkillExecutionLogRepository) {
    repository.executions.length = 0;
    repository.steps.length = 0;
  }
}
