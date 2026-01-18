import { AsrExecutionLogService, DatabaseAsrExecutionRepository, InMemoryAsrExecutionRepository } from "./asr-execution-log-service";

const asrExecutionRepository =
  process.env.NODE_ENV === "test"
    ? new InMemoryAsrExecutionRepository()
    : new DatabaseAsrExecutionRepository();

export const asrExecutionLogService = new AsrExecutionLogService(asrExecutionRepository);

// Helpers for tests/debugging
export function __getAsrExecutionRepositoryForTests() {
  return asrExecutionRepository;
}

export function __resetAsrExecutionsForTests() {
  if (asrExecutionRepository instanceof InMemoryAsrExecutionRepository) {
    asrExecutionRepository.reset();
  }
}
