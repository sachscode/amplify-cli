/* eslint-disable spellcheck/spell-checker */
/* eslint-disable func-style */
/* eslint-disable prefer-arrow/prefer-arrow-functions */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-param-reassign */
/* eslint-disable no-restricted-globals */
/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-shadow */
/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable jsdoc/require-description */
import { v4 as uuid } from 'uuid';
import https from 'https';
import { UrlWithStringQuery } from 'url';
import { $TSAny, JSONUtilities } from 'amplify-cli-core';
import _ from 'lodash';
import { Input } from '../input';
import redactInput from './identifiable-input-regex';
import { ProjectSettings, UsageDataPayload, InputOptions } from './UsageDataPayload';
import { getUrl } from './getUsageDataUrl';
import { IFlowData, IUsageData } from './IUsageData';
import { CLIFlowReport } from './FlowReport';

/**
 * Singleton class to manage Usage data
 */
export class UsageData implements IUsageData, IFlowData {
  sessionUuid: string;
  accountId = '';
  installationUuid = '';
  version = '';
  input: Input;
  projectSettings: ProjectSettings;
  url: UrlWithStringQuery;
  inputOptions: InputOptions;
  requestTimeout = 100;
  record: Record<string, $TSAny>[];
  private static instance: UsageData;
  public static flow : CLIFlowReport;

  private constructor() {
    this.sessionUuid = uuid();
    this.url = getUrl();
    this.input = new Input([]);
    this.projectSettings = {};
    this.inputOptions = {};
    this.record = [];
  }

  /**
   *
   */
  init(installationUuid: string, version: string, input: Input, accountId: string, projectSettings: ProjectSettings): void {
    this.installationUuid = installationUuid;
    this.accountId = accountId;
    this.projectSettings = projectSettings;
    this.version = version;
    this.inputOptions = input.options ? _.pick(input.options as InputOptions, ['sandboxId']) : {};
    this.input = redactInput(input, true);
    UsageData.flow.setInput(input);
  }

  /**
   *
   */
  static get Instance(): IUsageData {
    if (!UsageData.instance) {
      UsageData.instance = new UsageData();
      UsageData.flow = CLIFlowReport.instance;
    }
    return UsageData.instance;
  }

  /**
   *
   */
  emitError(error: Error | null): Promise<void> {
    return this.emit(error, WorkflowState.Failed);
  }

  /**
   *
   */
  emitInvoke(): Promise<void> {
    return this.emit(null, WorkflowState.Invoke);
  }

  /**
   *
   */
  emitAbort(): Promise<void> {
    return this.emit(null, WorkflowState.Aborted);
  }

  /**
   *
   */
  emitSuccess(): Promise<void> {
    return this.emit(null, WorkflowState.Successful);
  }

  /**
   *
   */
  addRecord(arbitraryData: Record<string, any>) {
    this.record.push(arbitraryData);
  }

  /**
   * Append record to CLI Flow data
   * @param flowData input accepted from the CLI
   */
  pushFlow(flowData: Record<string, $TSAny>) {
    UsageData.flow.pushOption(flowData);
    const flowString = JSON.stringify(UsageData.flow.getJSON(), null, 2);
    console.log('SACPCDEBUG:UsageData:FLOW: ', flowString);
  }

  /**
   *
   */
  async emit(error: Error | null, state: string): Promise<void> {
    const payload = new UsageDataPayload(
      this.sessionUuid,
      this.installationUuid,
      this.version,
      this.input,
      error,
      state,
      this.accountId,
      this.projectSettings,
      this.inputOptions,
      this.record,
    );
    return this.send(payload);
  }

  /**
   *
   */
  async send(payload: UsageDataPayload) {
    return new Promise<void>((resolve, _) => {
      const data: string = JSONUtilities.stringify(payload, {
        minify: true,
      })!;
      const req = https.request({
        hostname: this.url.hostname,
        port: this.url.port,
        path: this.url.path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': data.length,
        },
      });
      req.on('error', () => {});
      req.setTimeout(this.requestTimeout, () => {
        resolve();
      });
      req.write(data);
      req.end(() => {
        resolve();
      });
    });
  }
}

enum WorkflowState {
  Successful = 'SUCCEEDED',
  Invoke = 'INVOKED',
  Aborted = 'ABORTED',
  Failed = 'FAILED',
}

/**
 * Decorator for logging flow data into UsageData
 * @param flowData - CLI flow data
 * @returns property descriptor for input parameters
 */
export function FlowSave(flowData: Record<string, $TSAny>) {
  return function (_target: Object, _key: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    descriptor.value = function (..._args: any[]) {
      UsageData.flow.pushOption(flowData);
    };
    return descriptor;
  };
}
