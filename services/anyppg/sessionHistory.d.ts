import type { CsvReport } from './core';
import type { SqlDatabase } from '../sql-database';
import type { EstimateHistory, PrototypeEstimate } from '../readings/estimate-history';

export const history: EstimateHistory;
export function recordCsvReport(
  report: CsvReport,
  options?: { recordingId?: string; intervalId?: string; sourceKind?: 'imported_csv' | 'watch_live' },
): PrototypeEstimate[];
export function attachSqlitePersistence(
  db: SqlDatabase,
  options?: { modelId?: string },
): Promise<EstimateHistory>;
export function flushHistoryPersistence(): Promise<void>;
