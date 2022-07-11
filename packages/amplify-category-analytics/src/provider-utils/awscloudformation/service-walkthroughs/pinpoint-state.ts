import { $TSContext, AmplifyProviderPlugin, AmplifySupportedService } from 'amplify-cli-core';
import { AnalyticsConfig } from './analytics-config';
import { AnalyticsPinpointProviderParams } from './pinpoint-provider-params';

/**
 *
 */
export class AnalyticsPinpoint {
    static cfg = AnalyticsConfig;
    static provider = AnalyticsPinpointProviderParams;
    static meta: any;
    static sdk: any;
    /**
     *
     */
    static setContext(context: $TSContext): void {
      AnalyticsPinpoint.context = context;
    }

    /**
     *
     */
    static async saveBackendCfgImportPinpoint(projectName: string) : Promise<$TSContext> {
      // create the backend config for the importPinpoint function
      const analyticsProjectCfg = new AnalyticsPinpoint.cfg(AnalyticsPinpoint.context, projectName);
      analyticsProjectCfg.setService(AmplifySupportedService.PINPOINT);
      analyticsProjectCfg.setProviderPlugin(AmplifyProviderPlugin.AWSCLOUDFORMATION);
      await analyticsProjectCfg.save();
      return AnalyticsPinpoint.context;
    }

    // context, projectName, region, projectId
    /**
     *
     */
    static async saveCFNParamsImportPinpoint(projectName: string, region : string, projectId : string) : Promise<$TSContext> {
      // create the resource input params for cloudformation , fetch if already exists
      const analyticsProjectProviderParams = new AnalyticsPinpoint.provider(AnalyticsPinpoint.context, projectName);
      analyticsProjectProviderParams
        .setAppId(projectId) // !!! Required - set the Pinpoint appId so that cloudformation will not create a new one.
        .generatePinpointDeploymentRoleName() // generate the deployment role name
        .generatePolicyNames() // generate the cloudwatch and cloudformation policy names
        .generateRoleNameRefs() // generate the auth/unauth role name refs
        .generateRoleARNRefs(); // generate the auth/unauth role arn refs
      await analyticsProjectProviderParams.save(); // generate the cloudformation template and persist it
      return AnalyticsPinpoint.context;
    }

    static saveAmplifyMetaImportPinpoint = async (projectName: string, region : string, projectId:string) : Promise<$TSContext> => {
      // create the resource metadata
      const analyticsProjectMeta = await AnalyticsPinpoint.meta.create(AnalyticsPinpoint.context, projectName);
      analyticsProjectMeta.setService(AmplifySupportedService.PINPOINT);
      analyticsProjectMeta.setProviderPlugin(AmplifyProviderPlugin.AWSCLOUDFORMATION);
      analyticsProjectMeta.buildProviderMetaData(); // configures logicalId;
      analyticsProjectMeta.setOutputAppName(projectName);
      analyticsProjectMeta.setOutputAppId(projectId);
      analyticsProjectMeta.setOutputRegion(region);
      await analyticsProjectMeta.save();
      return AnalyticsPinpoint.context;
    };

    static context: $TSContext;
}
