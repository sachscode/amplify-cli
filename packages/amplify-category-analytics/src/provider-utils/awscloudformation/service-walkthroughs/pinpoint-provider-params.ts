import { $TSAny, $TSContext, AmplifyProviderPlugin } from 'amplify-cli-core';

/**
 * Pinpoint Service Cloudformation input file API.
 * Updates the Params object and saves it Params.json, generates the Cloudformation template
 */
export class AnalyticsPinpointProviderParams {
    // value prefixes and suffixes for Analytics Pinpoint CFN properties
    static LambdaRoleSuffix = 'LambdaRole';
    static PinpointPolicyPrefix = 'pinpointPolicy';
    static CloudFormationPolicyPrefix = 'cloudformationPolicy';
    static CloudWatchPolicyPrefix = 'cloudWatchPolicy';
    static AuthPolicyPrefix = 'pinpoint_amplify_';
    static UnauthPolicyPrefix = 'pinpoint_amplify_';
    static AuthRoleNameRef = 'AuthRoleName';
    static UnauthRoleNameRef = 'UnauthRoleName';

    context: $TSContext; // amplify context
    projectName: string; // pinpoint project name
    service: string;
    providerPlugin: AmplifyProviderPlugin;
    shortId: string;
    constructor(context: $TSContext, projectName: string) {
      this.context = context;
      this.projectName = projectName;
      this.shortId = this.getShortUUID();
      // generate the cloudformation input params
      this.context.exeInfo.providerParams = (this.context.exeInfo.providerParams) || {};
      this.context.exeInfo.providerParams.analytics = (this.context.exeInfo.providerParams.analytics) || {};
      this.context.exeInfo.providerParams.analytics[projectName] = (this.context.exeInfo.providerParams.analytics[projectName]) || {};
      this.context.exeInfo.providerParams.analytics[projectName].appName = projectName;
    }

    /**
     * Configures the APPID for the Analytics Pinpoint project
     */
    setAppId(projectId: string): AnalyticsProviderParams {
      this.context.exeInfo.providerParams.analytics[this.projectName].appId = projectId;
      return this;
    }

    private getShortUUID = (longInputUUID?:string): string => {
      const longUUID = (longInputUUID) || uuid();
      const [shortId] = longUUID.split('-');
      return shortId;
    };

    /**
     *  Generates the Pinpoint deployment role name for the CFN Params
     */
    generatePinpointDeploymentRoleName(): AnalyticsProviderParams {
      const roleName = this.service + AnalyticsProviderParams.LambdaRoleSuffix + this.shortId;
      this.context.exeInfo.providerParams.analytics[this.projectName].roleName = roleName;
      return this;
    }

    /**
     * Generates the Pinpoint policy names for the CFN Params
     */
    generatePolicyNames(): AnalyticsProviderParams {
      const policyNames = {
        cloudformationPolicyName: AnalyticsProviderParams.CloudFormationPolicyPrefix + this.shortId,
        cloudWatchPolicyName: AnalyticsProviderParams.CloudWatchPolicyPrefix + this.shortId,
        pinpointPolicyName: AnalyticsProviderParams.PinpointPolicyPrefix + this.shortId,
        authPolicyName: AnalyticsProviderParams.AuthPolicyPrefix + this.shortId,
        unauthPolicyName: AnalyticsProviderParams.UnauthPolicyPrefix + this.shortId,
      };
      this.context.exeInfo.providerParams.analytics[this.projectName] = {
        ...this.context.exeInfo.providerParams.analytics[this.projectName],
        ...policyNames,
      };
      return this;
    }

    /**
    * Generates the Auth/UnAuth role name refs for input params
    */
    generateRoleNameRefs(): AnalyticsProviderParams {
      const roleNameRefs = {
        authRoleName: {
          Ref: AnalyticsProviderParams.AuthRoleNameRef,
        },
        unauthRoleName: {
          Ref: AnalyticsProviderParams.UnauthRoleNameRef,
        },
      };
      this.context.exeInfo.providerParams.analytics[this.projectName] = {
        ...this.context.exeInfo.providerParams.analytics[this.projectName],
        ...roleNameRefs,
      };
      return this;
    }

    /**
     * Generates the Auth/Unauth role arns for input params
     */
    generateRoleARNRefs() : AnalyticsProviderParams {
      const roleARNRefs = {
        authRoleArn: {
          'Fn::GetAtt': [
            'AuthRole',
            'Arn',
          ],
        },
      };
      this.context.exeInfo.providerParams.analytics[this.projectName] = {
        ...this.context.exeInfo.providerParams.analytics[this.projectName],
        ...roleARNRefs,
      };
      return this;
    }

    /**
     *  Generates the Auth/Unauth role policies for input params
     */
    async save() : Promise<Record<string, $TSAny>> {
      const mergedCFNParams = await updateCFNParams(this.context,
        this.projectName /** pinpoint project name */, this.context.exeInfo.providerParams);
      return mergedCFNParams;
    }
}
