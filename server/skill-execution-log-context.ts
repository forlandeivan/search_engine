import { InMemorySkillExecutionLogRepository, SkillExecutionLogService } from "./skill-execution-log-service";

const repository = new InMemorySkillExecutionLogRepository();

const skillExecutionLogService = new SkillExecutionLogService(repository, {
  enabled: process.env.SKILL_EXECUTION_LOG_ENABLED !== "false",
});

export { skillExecutionLogService };

export function __getSkillExecutionLogRepositoryForTests() {
  return repository;
}

export function __resetSkillExecutionLogsForTests() {
  repository.executions.length = 0;
  repository.steps.length = 0;
}
