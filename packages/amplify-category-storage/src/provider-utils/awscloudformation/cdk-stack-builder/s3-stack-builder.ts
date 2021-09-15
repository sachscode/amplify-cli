

import * as cdk from '@aws-cdk/core';
import * as s3Cdk from '@aws-cdk/aws-s3';
import * as iamCdk from '@aws-cdk/aws-iam';

import {AmplifyResourceCfnStack, AmplifyS3ResourceTemplate} from './types';
import { S3UserInputs, defaultS3UserInputs } from '../service-walkthrough-types/s3-user-input-types';
import { $TSObject } from 'amplify-cli-core';
import { HttpMethods } from '@aws-cdk/aws-s3';


export class AmplifyS3ResourceCfnStack extends AmplifyResourceCfnStack implements AmplifyS3ResourceTemplate {
    id: string;
    scope  : cdk.Construct;
    s3Bucket!: s3Cdk.CfnBucket;
    authIAMPolicy !: iamCdk.PolicyDocument;
    guestIAMPolicy !: iamCdk.PolicyDocument;
    groupIAMPolicy !: iamCdk.PolicyDocument;
    conditions !: AmplifyS3Conditions;
    s3AuthPublicPolicy?: iamCdk.CfnPolicy
    s3AuthProtectedPolicy?: iamCdk.CfnPolicy
    s3AuthPrivatePolicy?: iamCdk.CfnPolicy
    s3AuthUploadPolicy?: iamCdk.CfnPolicy
    s3AuthReadPolicy?: iamCdk.CfnPolicy
    s3GuestPublicPolicy?: iamCdk.CfnPolicy
    s3GuestUploadPolicy?: iamCdk.CfnPolicy
    s3GuestReadPolicy?: iamCdk.CfnPolicy
    s3GroupPolicyList?: Array<iamCdk.CfnPolicy>
    s3TriggerPolicy?: iamCdk.CfnPolicy

    _props: S3UserInputs = defaultS3UserInputs();
    constructor( scope: cdk.Construct, id: string, props: S3UserInputs ) {
        super(scope, id);
        this.scope = scope;
        this.id = id;
        this._props = props;
        this.templateOptions.templateFormatVersion = CFN_TEMPLATE_FORMAT_VERSION;
        this.templateOptions.description = S3_ROOT_CFN_DESCRIPTION;
        this.conditions = this.buildConditions();
    }

     //Generate cloudformation stack for S3 resource
     generateCfnStackResources() {
        //1. Create the S3 bucket and configure CORS
        this.s3Bucket = new s3Cdk.CfnBucket(this, 'S3Bucket', {
            bucketName : this.buildBucketName(),
            corsConfiguration : this.buildCORSRules(),
        });

        //2. Configure Notifications on the S3 bucket. [Optional]
        if ( this._props.triggerFunctionName ){
            this.s3Bucket.notificationConfiguration = this.buildNotificationConfiguration();
        }

        //3. Create IAM policies to control Cognito pool access to S3 bucket
        this.createAndSetIAMPolicies();

        //4. Configure Cognito User pool policies
        if ( this._props.groupList && this._props.groupList.length > 0 ){
            this.s3GroupPolicyList = this.createGroupPolicies( this._props.groupList as Array<string>,
                                      this._props.groupPolicyMap as $TSObject );
        }

        //5. Configure Trigger policies
        if ( this._props.triggerFunctionName ){
            this.s3TriggerPolicy = this.createTriggerPolicy();
        }
    }

    buildConditions(){
        return {
            ShouldNotCreateEnvResources : new cdk.CfnCondition(this, 'ShouldNotCreateEnvResources', {
                                                                        expression: cdk.Fn.conditionEquals(cdk.Fn.ref("Env"), "NONE"),
                                                                        }),
            CreateAuthPublic : new cdk.CfnCondition(this, 'CreateAuthPublic', {
                                                                        expression: cdk.Fn.conditionNot(
                                                                                    cdk.Fn.conditionEquals(cdk.Fn.ref("s3PermissionsAuthenticatedPublic"), "DISALLOW")
                                                                                ),
                                                                        }),
            CreateAuthProtectedCondition : new cdk.CfnCondition(this, 'CreateAuthProtected', {
                expression: cdk.Fn.conditionNot(
                            cdk.Fn.conditionEquals(cdk.Fn.ref("s3PermissionsAuthenticatedProtected"), "DISALLOW")
                        ),
            }),

            CreateAuthPrivateCondition : new cdk.CfnCondition(this, 'CreateAuthProtected', {
            expression: cdk.Fn.conditionNot(
                        cdk.Fn.conditionEquals(cdk.Fn.ref("s3PermissionsAuthenticatedPrivate"), "DISALLOW")
                    ),
            }),

            CreateAuthUploadsCondition : new cdk.CfnCondition(this, 'CreateAuthUploads', {
            expression: cdk.Fn.conditionNot(
                        cdk.Fn.conditionEquals(cdk.Fn.ref("s3PermissionsAuthenticatedUploads"), "DISALLOW")
                    ),
            }),

            CreateGuestPublicCondition : new cdk.CfnCondition(this, 'CreateGuestPublic', {
            expression: cdk.Fn.conditionNot(
                        cdk.Fn.conditionEquals(cdk.Fn.ref("s3PermissionsGuestPublic"), "DISALLOW")
                    ),
            }),

            CreateGuestUploadsCondition : new cdk.CfnCondition(this, 'CreateGuestUploads', {
            expression: cdk.Fn.conditionNot(
                        cdk.Fn.conditionEquals(cdk.Fn.ref("s3PermissionsGuestUploads"), "DISALLOW")
                    ),
            }),

            CreateAuthReadAndList : new cdk.CfnCondition(this, 'AuthReadAndList', {
            expression: cdk.Fn.conditionNot(
                        cdk.Fn.conditionEquals(cdk.Fn.ref("AuthenticatedAllowList"), "DISALLOW")
                    ),
            }),

            CreateReadAndList : new cdk.CfnCondition(this, 'GuestReadAndList', {
            expression: cdk.Fn.conditionNot(
                        cdk.Fn.conditionEquals(cdk.Fn.ref("GuestAllowList"), "DISALLOW")
                    ),
            })
        }

    }

    buildBucketName(){
        return cdk.Fn.conditionIf(
            'ShouldNotCreateEnvResources',
            cdk.Fn.ref('bucketName'),
            cdk.Fn.join('', [cdk.Fn.ref('bucketName'), '-', cdk.Fn.ref('env')]),
          ).toString()
    }

    buildCORSRules(): s3Cdk.CfnBucket.CorsConfigurationProperty{
        const corsRule : s3Cdk.CfnBucket.CorsRuleProperty =
        {
              id: "S3CORSRuleId1",
              maxAge: 3000,
              exposedHeaders : [
                "x-amz-server-side-encryption",
                "x-amz-request-id",
                "x-amz-id-2",
                "ETag"
              ],
              allowedHeaders: ["*"],
              allowedOrigins: ["*"],
              allowedMethods: [ HttpMethods.GET,
                                HttpMethods.PUT,
                                HttpMethods.POST,
                                HttpMethods.DELETE],
        };
        const corsConfig : s3Cdk.CfnBucket.CorsConfigurationProperty = {
            corsRules: [corsRule]
        }

        return corsConfig;
    }

    buildNotificationConfiguration(): s3Cdk.CfnBucket.NotificationConfigurationProperty{
        const triggerFunctionRef = cdk.Fn.ref(`function${this._props.triggerFunctionName}Arn`);
        const lambdaConfigurations = [{
            event : "s3:ObjectCreated:*",
            function : triggerFunctionRef
        },
        {
            event: "s3:ObjectRemoved:*",
            function : triggerFunctionRef
        }];

        return {
            lambdaConfigurations
        };
    }

    createAndSetIAMPolicies(){
        this.s3AuthPublicPolicy =  this.createS3AuthPublicPolicy();
        this.s3AuthProtectedPolicy = this.createS3AuthProtectedPolicy();
        this.s3AuthPrivatePolicy = this.createS3AuthPrivatePolicy();
        this.s3AuthUploadPolicy = this.createS3AuthUploadPolicy();
        this.s3GuestPublicPolicy = this.createS3GuestPublicPolicy();
        this.s3GuestUploadPolicy = this.createGuestUploadsPolicy();
        this.s3AuthReadPolicy = this.createS3AuthReadPolicy();
        this.s3GuestReadPolicy = this.createS3GuestReadPolicy();
    }

    createS3IAMPolicyDocument( refStr: string, pathStr:string,  actionStr: string, effect: iamCdk.Effect ){
        const props : iamCdk.PolicyStatementProps = {
            resources: [ cdk.Fn.join('', ["arn:aws:s3:::", cdk.Fn.ref(refStr), pathStr]) ],
            actions: cdk.Fn.split( "," , cdk.Fn.ref(actionStr)),
            effect
        };
        return new iamCdk.PolicyDocument({
            statements: [
               new iamCdk.PolicyStatement(props),
            ],
        });
    }


    createMultiStatementIAMPolicyDocument(  policyStatements : Array<IAmplifyIamPolicyStatementParams>){
        const policyDocument = new iamCdk.PolicyDocument();
        policyStatements.map( policyStatement => {
            const props : iamCdk.PolicyStatementProps = {
                resources: (policyStatement.pathStr)?[cdk.Fn.join('', ["arn:aws:s3:::", cdk.Fn.ref(policyStatement.refStr), policyStatement.pathStr])]:
                                                     [cdk.Fn.join('', ["arn:aws:s3:::", cdk.Fn.ref(policyStatement.refStr)])],
                conditions : policyStatement.conditions,
                actions: policyStatement.actions,
                effect : policyStatement.effect,
            };
            const statement =  new iamCdk.PolicyStatement( props );
            //Add Statement to Policy
            policyDocument.addStatements(statement);
        });
        return policyDocument;
    }

    /***************************************************************************************************
     *  IAM Policies - Control Auth and Guest access to S3 bucket using Cognito Identity Pool
     *
     * Note :- Currently S3 doesn't have direct integration with Cognito for access control to S3 bucket.
     * We need to make cognito work with S3 for App clients. The following polcies are tied to the roles
     * attached to the cognito identity pool.
     * ************************************************************************************************/
    //S3AuthPublicPolicy
    createS3AuthPublicPolicy() {
        let policyDefinition: IAmplifyPolicyDefinition = {
            policyNameRef : "s3PublicPolicy",
            roleRefs : ["authRoleName"],
            condition : this.conditions.CreateAuthPublic,
            statements : [
                {
                    refStr  : "S3Bucket",
                    pathStr : "/public/*",
                    actions : ["s3PermissionsAuthenticatedPublic"],
                    effect  : iamCdk.Effect.ALLOW
                }
            ],
            dependsOn : [ this.s3Bucket ]
        }
        const policy = this.createIAMPolicy(policyDefinition);
        return policy;
    }

    //S3AuthProtectedPolicy
    createS3AuthProtectedPolicy() {
        let policyDefinition: IAmplifyPolicyDefinition = {
            policyNameRef : "s3ProtectedPolicy",
            roleRefs : ["authRoleName"],
            condition : this.conditions.CreateAuthProtected,
            statements : [
                {
                    refStr  : "S3Bucket",
                    pathStr : "/protected/${cognito-identity.amazonaws.com:sub}/*",
                    actions : ["s3PermissionsAuthenticatedProtected"],
                    effect  : iamCdk.Effect.ALLOW
                }
            ],
            dependsOn : [ this.s3Bucket ]
        }
        const policy = this.createIAMPolicy(policyDefinition);
        return policy;
    }

    //S3AuthPrivatePolicy
    createS3AuthPrivatePolicy() {
        let policyDefinition: IAmplifyPolicyDefinition = {
            policyNameRef : "s3PrivatePolicy",
            roleRefs : ["authRoleName"],
            condition : this.conditions.CreateAuthPrivate,
            statements : [
                {
                    refStr  : "S3Bucket",
                    pathStr : "/private/${cognito-identity.amazonaws.com:sub}/*",
                    actions : ["s3PermissionsAuthenticatedPrivate"],
                    effect  : iamCdk.Effect.ALLOW
                }
            ],
            dependsOn : [ this.s3Bucket ]
        }
        const policy = this.createIAMPolicy(policyDefinition);
        return policy;
    }

    //S3AuthUploadPolicy
    createS3AuthUploadPolicy() {
        let policyDefinition: IAmplifyPolicyDefinition = {
            policyNameRef : "s3UploadsPolicy",
            roleRefs : ["authRoleName"],
            condition : this.conditions.CreateAuthUploads,
            statements : [
                {
                    refStr  : "S3Bucket",
                    pathStr : "/uploads/*",
                    actions : ["s3PermissionsAuthenticatedUploads"],
                    effect  : iamCdk.Effect.ALLOW
                }
            ],
            dependsOn : [ this.s3Bucket ]
        }
        const policy = this.createIAMPolicy(policyDefinition);
        return policy;
    }

    //S3GuestPublicPolicy
    createS3GuestPublicPolicy() {
        let policyDefinition: IAmplifyPolicyDefinition = {
            policyNameRef : "s3PublicPolicy",
            roleRefs : ["unauthRoleName"],
            condition : this.conditions.CreateGuestPublic,
            statements : [
                {
                    refStr  : "S3Bucket",
                    pathStr : "/public/*",
                    actions : ["s3PermissionsGuestPublic"],
                    effect  : iamCdk.Effect.ALLOW
                }
            ],
            dependsOn : [ this.s3Bucket ]
        }
        const policy = this.createIAMPolicy(policyDefinition);
        return policy;
    }

    //S3GuestUploadPolicy
    createGuestUploadsPolicy() {
        let policyDefinition: IAmplifyPolicyDefinition = {
            policyNameRef : "s3UploadsPolicy",
            roleRefs : ["unauthRoleName"],
            condition : this.conditions.CreateGuestUploads,
            statements : [
                {
                    refStr  : "S3Bucket",
                    pathStr : "/uploads/*",
                    actions : ["s3PermissionsGuestUploads"],
                    effect  : iamCdk.Effect.ALLOW
                }
            ],
            dependsOn : [ this.s3Bucket ]
        }
        const policy = this.createIAMPolicy(policyDefinition);
        return policy;
    }

    //S3AuthReadPolicy
    createS3AuthReadPolicy() {
        let policyDefinition: IAmplifyPolicyDefinition = {
            policyNameRef : "s3ReadPolicy",
            roleRefs : ["authRoleName"],
            condition : this.conditions.AuthReadAndList,
            statements : [
                            {
                                refStr  : "S3Bucket",
                                pathStr : "/protected/*",
                                actions : ["s3:GetObject"],
                                effect  : iamCdk.Effect.ALLOW
                            },
                            {
                                refStr  : "S3Bucket",
                                actions : ["s3:ListBucket"],
                                conditions : {
                                    "StringLike": {
                                        "s3:prefix": [
                                            "public/",
                                            "public/*",
                                            "protected/",
                                            "protected/*",
                                            "private/${cognito-identity.amazonaws.com:sub}/",
                                            "private/${cognito-identity.amazonaws.com:sub}/*"
                                        ]
                                    }
                                },
                                effect  : iamCdk.Effect.ALLOW
                            }
                        ],
            dependsOn : [ this.s3Bucket ]
        }

        const policy:iamCdk.CfnPolicy = this.createMultiStatementIAMPolicy(policyDefinition);
        return policy;
    }

    //S3GuestReadPolicy
    createS3GuestReadPolicy():iamCdk.CfnPolicy {
        let policyDefinition: IAmplifyPolicyDefinition = {
            policyNameRef : "s3ReadPolicy",
            roleRefs : ["unauthRoleName"],
            condition: this.conditions.CreateGuestPublic,
            statements : [
                {
                    refStr  : "S3Bucket",
                    pathStr : "/protected/*",
                    actions : ["s3:GetObject"],
                    effect  : iamCdk.Effect.ALLOW
                },
                {
                    refStr  : "S3Bucket",
                    actions : ["s3:ListBucket"],
                    conditions : {
                        "StringLike": {
                            "s3:prefix": [
                                "public/",
                                "public/*",
                                "protected/",
                                "protected/*"
                            ]
                        }
                    },
                    effect  : iamCdk.Effect.ALLOW
                }
            ],
            dependsOn : [ this.s3Bucket ]
        }
        const policy:iamCdk.CfnPolicy = this.createMultiStatementIAMPolicy(policyDefinition);
        return policy;
    }

    //S3TriggerBucketPolicy - Policy to control trigger function access to S3 bucket
    createTriggerPolicy():iamCdk.CfnPolicy {
        let policyDefinition: IAmplifyPolicyDefinition = {
            policyNameRef : "amplify-lambda-execution-policy-storage",
            roleRefs : [`function${this._props.triggerFunctionName}LambdaExecutionRole`],
            statements : [
                {
                    refStr  : "S3Bucket",
                    pathStr : "/*",
                    actions : [ "s3:PutObject",
                                "s3:GetObject",
                                "s3:ListBucket",
                                "s3:DeleteObject"],
                    effect  : iamCdk.Effect.ALLOW
                }
            ],
            dependsOn : [ this.s3Bucket ]
        }
        const policy:iamCdk.CfnPolicy = this.createIAMPolicy(policyDefinition);
        return policy;
    }

    //Helper:: function to create single statement IAM policy & bind to the App's stack
    createIAMPolicy(policyDefinition : IAmplifyPolicyDefinition){
        const statement:IAmplifyIamPolicyStatementParams = policyDefinition.statements[0];
        const action = (statement.actions)? statement.actions[0]:""
        const props : iamCdk.CfnPolicyProps = {
            policyName : cdk.Fn.ref(policyDefinition.policyNameRef),
            roles : policyDefinition.roleRefs.map( roleRef=> cdk.Fn.ref( roleRef )),
            policyDocument :  this.createS3IAMPolicyDocument( statement.refStr,
                                            statement.pathStr as string,
                                            action,
                                            statement.effect),
        };

        const policy = new iamCdk.CfnPolicy(this.scope, this.id, props); //bind policy to stack
        if ( policyDefinition.dependsOn ){
            policyDefinition.dependsOn.map( dependency => policy.addDependsOn( dependency ))
        }
        if ( policyDefinition.condition ){
            policy.cfnOptions.condition = policyDefinition.condition
        }
        return policy;
    }

    //Helper:: function to create multi-statement IAM policy & bind to the App's stack
    createMultiStatementIAMPolicy(policyDefinition : IAmplifyPolicyDefinition) {
        const props : iamCdk.CfnPolicyProps = {
            policyName : cdk.Fn.ref(policyDefinition.policyNameRef),
            roles : policyDefinition.roleRefs.map( roleRef => cdk.Fn.ref(roleRef as string) ),
            policyDocument : this.createMultiStatementIAMPolicyDocument(policyDefinition.statements)
        };
        const policy = new iamCdk.CfnPolicy( this.scope, this.id, props); //bind policy to stack
        if ( policyDefinition.dependsOn ){
            policyDefinition.dependsOn.map( dependency => policy.addDependsOn( dependency ))
        }
        if ( policyDefinition.condition ){
            policy.cfnOptions.condition = policyDefinition.condition
        }
        return policy;
    }

    /**************************************************************************************************
     *  END IAM Policies - Control Auth and Guest access to S3 bucket using Cognito Identity Pool
     * ***********************************************************************************************/

    createGroupPolicies( groupList : string[], groupPolicyMap : $TSObject ) : Array<iamCdk.CfnPolicy> {
        //Build policy statement
        const groupPolicies = groupList.map( groupName => {
            const policyList :Array<iamCdk.PolicyStatement> = [];
            const groupPolicy = groupPolicyMap[groupName];
            const bucketArn = cdk.Fn.join('', [cdk.Fn.ref(`auth${this._props.resourceName}UserPoolId`), '-',  `${groupName}GroupRole`]).toString();
            policyList.push(
                new iamCdk.PolicyStatement({
                    resources: [ bucketArn,`${bucketArn}/*` ],
                    actions: groupPolicy,
                    effect: iamCdk.Effect.ALLOW,
                })
            );

            if ( groupPolicy.includes('s3:ListBucket') ){
                policyList.push(
                    new iamCdk.PolicyStatement({
                        resources: [ bucketArn ],
                        actions: ["s3:ListBucket"],
                        effect: iamCdk.Effect.ALLOW,
                    })
                );
            }
            const policyDocument = new iamCdk.PolicyDocument({
                statements: policyList,
            });
            return this.createAmplifyS3GroupPolicy(groupName, policyDocument)
        })
        return groupPolicies;
    }

    //create and bind the policy
    createAmplifyS3GroupPolicy( groupName :string, policyDocument: iamCdk.PolicyDocument ): iamCdk.CfnPolicy {
        const groupRole = cdk.Fn.join('', [cdk.Fn.ref(`auth${this._props.resourceName}UserPoolId`), '-', `${groupName}GroupRole`]).toString();
        const props : iamCdk.CfnPolicyProps = {
             policyName : `${groupName}-group-s3-policy`,
             roles : [ groupRole ],
             policyDocument
        };
        const groupPolicy : iamCdk.CfnPolicy = new iamCdk.CfnPolicy(this.scope, this.id, props);
        return groupPolicy;
    }

}

//Constants and Interfaces
const CFN_TEMPLATE_FORMAT_VERSION = '2010-09-09';
const S3_ROOT_CFN_DESCRIPTION = 'S3 Resource for AWS Amplify CLI';

interface IAmplifyIamPolicyStatementParams {
    refStr   : string,
    conditions? : $TSObject,
    pathStr? : string,
    actions? : Array<string>,
    effect   : iamCdk.Effect
}

interface IAmplifyPolicyDefinition {
    policyNameRef : string,
    roleRefs : Array<string>,
    condition? : cdk.CfnCondition,
    statements : Array<IAmplifyIamPolicyStatementParams>
    dependsOn? : Array<cdk.CfnResource>
}

type AmplifyS3Conditions = Record<string, cdk.CfnCondition>