import * as cdk from '@aws-cdk/core';
import * as ddb from '@aws-cdk/aws-dynamodb';
import * as s3Cdk from '@aws-cdk/aws-s3';


export interface AmplifyDDBResourceTemplate {
    dynamoDBTable?: ddb.CfnTable;
    addCfnParameter(props: cdk.CfnParameterProps, logicalId: string): void;
    addCfnOutput(props: cdk.CfnOutputProps, logicalId: string): void;
    addCfnMapping(props: cdk.CfnMappingProps, logicalId: string): void;
    addCfnCondition(props: cdk.CfnConditionProps, logicalId: string): void;
    addCfnResource(props: cdk.CfnResourceProps, logicalId: string): void;
}

export interface AmplifyDDBResourceInputParameters {
    tableName: string,
    partitionKeyName: string,
    partitionKeyType: string,
    sortKeyName?: string,
    sortKeyType?: string
}

//CDK - L1 methods to store CFN gen related information
export interface AmplifyCDKL1 {
    addCfnParameter(props: cdk.CfnParameterProps, logicalId: string): void;
    addCfnOutput(props: cdk.CfnOutputProps, logicalId: string): void;
    addCfnMapping(props: cdk.CfnMappingProps, logicalId: string): void;
    addCfnCondition(props: cdk.CfnConditionProps, logicalId: string): void;
    addCfnResource(props: cdk.CfnResourceProps, logicalId: string): void;
}

export interface AmplifyS3ResourceTemplate {
    s3Bucket?: s3Cdk.CfnBucket
}

export interface AmplifyS3ResourceInputParameters {
    bucketName : string,
    authPolicyName : string,
    unauthPolicyName : string,
    authRoleName : string,
    unauthRoleName : string,
    s3PublicPolicy : string,
    s3PrivatePolicy : string, //default:"NONE"
    s3ProtectedPolicy : string,
    s3UploadsPolicy : string,
    s3ReadPolicy : string,
    s3PermissionsAuthenticatedPublic : string,
    s3PermissionsAuthenticatedProtected : string,
    s3PermissionsAuthenticatedPrivate : string,
    s3PermissionsAuthenticatedUploads : string,
    s3PermissionsGuestPublic : string,
    s3PermissionsGuestUploads : string,
    AuthenticatedAllowList : string,
    GuestAllowList : string,
    selectedGuestPermissions : Array<string>,
    selectedAuthenticatedPermissions : Array<string>,
    triggerFunction : string
}

//Base class for all storage resource stacks ( S3, DDB )
export class AmplifyResourceCfnStack extends cdk.Stack implements AmplifyCDKL1 {

    _cfnParameterMap: Map<string, cdk.CfnParameter> = new Map();
    constructor(scope: cdk.Construct, id: string ) {
      super(scope, id, undefined);
    }

    /**
     *
     * @param props :cdk.CfnOutputProps
     * @param logicalId: : lodicalId of the Resource
     */
    addCfnOutput(props: cdk.CfnOutputProps, logicalId: string): void {
      try {
        new cdk.CfnOutput(this, logicalId, props);
      } catch (error) {
        throw new Error(error);
      }
    }

    /**
     *
     * @param props
     * @param logicalId
     */
    addCfnMapping(props: cdk.CfnMappingProps, logicalId: string): void {
      try {
        new cdk.CfnMapping(this, logicalId, props);
      } catch (error) {
        throw new Error(error);
      }
    }

    /**
     *
     * @param props
     * @param logicalId
     */
    addCfnCondition(props: cdk.CfnConditionProps, logicalId: string): void {
      try {
        new cdk.CfnCondition(this, logicalId, props);
      } catch (error) {
        throw new Error(error);
      }
    }
    /**
     *
     * @param props
     * @param logicalId
     */
    addCfnResource(props: cdk.CfnResourceProps, logicalId: string): void {
      try {
        new cdk.CfnResource(this, logicalId, props);
      } catch (error) {
        throw new Error(error);
      }
    }
    /**
     *
     * @param props
     * @param logicalId
     */
    addCfnParameter(props: cdk.CfnParameterProps, logicalId: string): void {
      try {
        if (this._cfnParameterMap.has(logicalId)) {
          throw new Error('logical Id already Exists');
        }
        this._cfnParameterMap.set(logicalId, new cdk.CfnParameter(this, logicalId, props));
      } catch (error) {
        throw new Error(error);
      }
    }

    //Generate convert cdk stack to cloudformation
    public renderCloudFormationTemplate = (): string => {
        return JSON.stringify(this._toCloudFormation(), undefined, 2);
    };

}

