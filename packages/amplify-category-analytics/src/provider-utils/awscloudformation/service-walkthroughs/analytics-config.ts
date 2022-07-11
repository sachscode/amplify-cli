import { $TSAny, $TSContext } from 'amplify-cli-core';
import { AmplifyProviderPlugin } from 'amplify-cli-core/src/cliConstants';

/**
 *  Analytics category plugin config file apis
 *  Build updated config data into context.exeinfo.backendConfig
 *  Save updated config data into context.exeinfo.backendConfig
 */
export class AnalyticsConfig {
    context: $TSContext;
    projectName: string;
    providerPlugin: AmplifyProviderPlugin;

    constructor(context: $TSContext, projectName: string) {
      this.context = context;
      this.projectName = projectName;
      this.context.exeInfo.backendConfig.analytics = (context.exeInfo.backendConfig.analytics) || {};
      this.context.exeInfo.backendConfig.analytics[projectName] = (this.context.exeInfo.backendConfig.analytics[projectName]) || {};
    }

    /**
     * Set the analytics service name e.g Pinpoint or Kinesis
     */
    setService(serviceName: string): AnalyticsConfig {
      this.context.exeInfo.backendConfig.analytics[this.projectName].service = serviceName;
      return this;
    }

    /**
     * Set the analytics provider plugin e.g awscloudformation
     */
    setProviderPlugin(providerPluginName: AmplifyProviderPlugin): AnalyticsConfig {
      this.context.exeInfo.backendConfig.analytics[this.projectName].providerPlugin = providerPluginName;
      return this;
    }

    /**
     *  Sync the backend config changes for analytics category into backendConfig.json
     */
    async save(): Promise<Record<string, $TSAny>> {
      // update the analytics backend config
      const mergedBackendCfg = await updateBackendConfig(this.context.exeInfo.backendConfig.analytics);
      return mergedBackendCfg;
    }
}
