import { $TSAny } from 'amplify-cli-core';
import { Input } from '../input';
import { ProjectSettings } from './UsageDataPayload';

/**
 * Usage data
 */
export interface IUsageData {
  emitError: (error: Error) => Promise<void>;
  emitInvoke: () => Promise<void>;
  emitAbort: () => Promise<void>;
  emitSuccess: () => Promise<void>;
  init: (installationUuid: string, version: string, input: Input, accountId: string, projectSettings: ProjectSettings) => void;
}

/**
 * CLI Flow Data
 */
export interface IFlowData{
  pushFlow: (flowData: Record<string, $TSAny>) => void;
}
