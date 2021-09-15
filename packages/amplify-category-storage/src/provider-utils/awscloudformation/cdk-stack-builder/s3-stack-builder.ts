

import * as cdk from '@aws-cdk/core';
import * as s3Cdk from '@aws-cdk/aws-s3';
import * as iamCdk from '@aws-cdk/aws-iam';
import * as lambdaCdk from '@aws-cdk/aws-lambda';


import {AmplifyResourceCfnStack, AmplifyS3ResourceTemplate, AmplifyCfnParamType} from './types';
import { S3UserInputs, defaultS3UserInputs, GroupAccessType, S3PermissionType } from '../service-walkthrough-types/s3-user-input-types';
import { $TSAny, $TSContext, $TSObject } from 'amplify-cli-core';
import { HttpMethods } from '@aws-cdk/aws-s3';
import { isResolvableObject } from '@aws-cdk/core';
import * as s3AuthAPI from '../service-walkthroughs/s3-auth-api';
import { S3InputState } from '../service-walkthroughs/s3-user-input-state';


export class AmplifyS3ResourceCfnStack extends AmplifyResourceCfnStack implements AmplifyS3ResourceTemplate {
    id: string;
    scope  : cdk.Construct;
    s3Bucket!: s3Cdk.CfnBucket;
    triggerLambdaPermissions?: lambdaCdk.CfnPermission;
    authIAMPolicy !: iamCdk.PolicyDocument;
    guestIAMPolicy !: iamCdk.PolicyDocument;
    groupIAMPolicy !: iamCdk.PolicyDocument;
    conditions !: AmplifyS3Conditions;
    parameters !: AmplifyS3CfnParameters;
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
    }

     //Generate cloudformation stack for S3 resource
     async generateCfnStackResources(context : $TSContext ) {
        //1. Create the S3 bucket and configure CORS
        this.s3Bucket = new s3Cdk.CfnBucket(this, 'S3Bucket', {
            bucketName : this.buildBucketName(),
            corsConfiguration : this.buildCORSRules(),
        });
        this.s3Bucket.applyRemovalPolicy( cdk.RemovalPolicy.RETAIN );
        console.log("SACPCDEBUG: BUCKET-CREATED!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")

        //2. Configure Notifications on the S3 bucket. [Optional]
        if ( this._props.triggerFunction && this._props.triggerFunction != "NONE" ){
            console.log("SACPCDEBUG: FUNCTION-CONFIGURED!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
            this.s3Bucket.notificationConfiguration = this.buildNotificationConfiguration();
            this.createAndSetTriggerPermissions();
        }

        //3. Create IAM policies to control Cognito pool access to S3 bucket
        console.log("SACPCDEBUG: IAM-POLICIES TBD");
        this.createAndSetIAMPolicies();
        console.log("SACPCDEBUG: IAM-POLICIES CONFIGURED!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");

        //4. Configure Cognito User pool policies
        if ( this._props.groupList && this._props.groupList.length > 0 ){
            console.log("SACPCDEBUG: GROUP-POLICIES TBD");
            const authResourceName : string = await s3AuthAPI.getAuthResourceARN( context );
            this.s3GroupPolicyList = this.createS3AmplifyGroupPolicies( authResourceName,
                                                                        this._props.groupList as Array<string>,
                                                                        this._props.groupAccess as GroupAccessType );
            console.log("SACPCDEBUG: GROUP-POLICIES DONE: authResourceARN: ", authResourceName);
            //add Group Params - Auth resource name and auth roles
            this.addGroupParams(authResourceName);
        }

        //5. Configure Trigger policies
        if ( this._props.triggerFunction && this._props.triggerFunction != "NONE" ){
            this.s3TriggerPolicy = this.createTriggerPolicy();
        }
    }


    public addGroupParams( authResourceName : string ) : AmplifyS3CfnParameters | undefined {
        if ( this._props.groupList ) {
            let s3CfnParams : Array<AmplifyCfnParamType> = [
                {
                    params : [`auth${authResourceName}UserPoolId`],
                    paramType : 'String',
                    default: `auth${authResourceName}UserPoolId`
                }
            ];

            for (const groupName of this._props.groupList) {
                s3CfnParams.push({
                    params : [`authuserPoolGroups${this.buildGroupRoleName(groupName)}`],
                    paramType : 'String',
                    default: `authuserPoolGroups${this.buildGroupRoleName(groupName)}`
                });
            }
            //insert into the stack
            s3CfnParams.map(params => this._setCFNParams(params) )
        }
        return undefined;
    }


    public addParameters(){
        let s3CfnParams : Array<AmplifyCfnParamType> = [
            {
                params : ["env", "bucketName","authRoleName", "unauthRoleName"],
                paramType : 'String'
            },
            {
                params: ["s3PublicPolicy", "s3PrivatePolicy", "s3ProtectedPolicy",
                         "s3UploadsPolicy", "s3ReadPolicy"],
                paramType: 'String',
                default: 'None'
            },
            {
                params: ["s3PermissionsAuthenticatedPublic","s3PermissionsAuthenticatedProtected",
                         "s3PermissionsAuthenticatedPrivate", "s3PermissionsAuthenticatedUploads" ,
                         "s3PermissionsGuestPublic", "s3PermissionsGuestUploads", "AuthenticatedAllowList",
                         "GuestAllowList"],
                paramType: 'String',
                default: 'Disallow'
            },
        ];
        if ( this._props.triggerFunction && this._props.triggerFunction != "NONE" ){
            const params = [`function${this._props.triggerFunction}Arn`,
                            `function${this._props.triggerFunction}Name`,
                            `function${this._props.triggerFunction}LambdaExecutionRole`]
            params.map( param=> {
                            s3CfnParams.push(
                                {
                                    params : [param],
                                    paramType: 'String',
                                    default : param
                                } )
                        } );
        }

        if ( this._props.groupList && this._props.groupList.length > 0 ){
            const params = [`function${this._props.triggerFunction}Arn`,
            `function${this._props.triggerFunction}Name`,
            `function${this._props.triggerFunction}LambdaExecutionRole`]
        }

        let s3CfnDependsOnParams : Array<AmplifyCfnParamType> = this._getDependsOnParameters()

        s3CfnParams = s3CfnParams.concat( s3CfnDependsOnParams );

        //insert into the stack
        s3CfnParams.map(params => this._setCFNParams(params) )
    }


    public addConditions(){
        this.conditions =  {
            ShouldNotCreateEnvResources : new cdk.CfnCondition(this, 'ShouldNotCreateEnvResources', {
                                                                        expression: cdk.Fn.conditionEquals(cdk.Fn.ref("env"), "NONE"),
                                                                        }),
            CreateAuthPublic : new cdk.CfnCondition(this, 'CreateAuthPublic', {
                                                                        expression: cdk.Fn.conditionNot(
                                                                                    cdk.Fn.conditionEquals(cdk.Fn.ref("s3PermissionsAuthenticatedPublic"), "DISALLOW")
                                                                                ),
                                                                        }),
            CreateAuthProtected : new cdk.CfnCondition(this, 'CreateAuthProtected', {
                expression: cdk.Fn.conditionNot(
                            cdk.Fn.conditionEquals(cdk.Fn.ref("s3PermissionsAuthenticatedProtected"), "DISALLOW")
                        ),
            }),

            CreateAuthPrivate : new cdk.CfnCondition(this, 'CreateAuthPrivate', {
            expression: cdk.Fn.conditionNot(
                        cdk.Fn.conditionEquals(cdk.Fn.ref("s3PermissionsAuthenticatedPrivate"), "DISALLOW")
                    ),
            }),

            CreateAuthUploads : new cdk.CfnCondition(this, 'CreateAuthUploads', {
            expression: cdk.Fn.conditionNot(
                        cdk.Fn.conditionEquals(cdk.Fn.ref("s3PermissionsAuthenticatedUploads"), "DISALLOW")
                    ),
            }),

            CreateGuestPublic : new cdk.CfnCondition(this, 'CreateGuestPublic', {
            expression: cdk.Fn.conditionNot(
                        cdk.Fn.conditionEquals(cdk.Fn.ref("s3PermissionsGuestPublic"), "DISALLOW")
                    ),
            }),

            CreateGuestUploads : new cdk.CfnCondition(this, 'CreateGuestUploads', {
            expression: cdk.Fn.conditionNot(
                        cdk.Fn.conditionEquals(cdk.Fn.ref("s3PermissionsGuestUploads"), "DISALLOW")
                    ),
            }),

            CreateAuthReadAndList : new cdk.CfnCondition(this, 'AuthReadAndList', {
            expression: cdk.Fn.conditionNot(
                        cdk.Fn.conditionEquals(cdk.Fn.ref("AuthenticatedAllowList"), "DISALLOW")
                    ),
            }),

            CreateGuestReadAndList : new cdk.CfnCondition(this, 'GuestReadAndList', {
            expression: cdk.Fn.conditionNot(
                        cdk.Fn.conditionEquals(cdk.Fn.ref("GuestAllowList"), "DISALLOW")
                    ),
            })

        }

        return this.conditions;

    }

    public addOutputs(){
        this.addCfnOutput({
            value: cdk.Fn.ref('S3Bucket'),
            description : "Bucket name for the S3 bucket"
          },
          'BucketName');
        this.addCfnOutput({
            value: cdk.Fn.ref('AWS::Region'),
          },
          'Region');
    }

    buildBucketName(){
       const bucketNameSuffixRef = cdk.Fn.select(3, cdk.Fn.split("-", cdk.Fn.ref("AWS::StackName")));
       const bucketRef = cdk.Fn.ref('bucketName');
       const envRef = cdk.Fn.ref("env");
       return cdk.Fn.conditionIf(
            'ShouldNotCreateEnvResources',
            bucketRef,
            cdk.Fn.join( "",[bucketRef, bucketNameSuffixRef, "-", envRef])
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
                                HttpMethods.HEAD,
                                HttpMethods.PUT,
                                HttpMethods.POST,
                                HttpMethods.DELETE],
        };
        const corsConfig : s3Cdk.CfnBucket.CorsConfigurationProperty = {
            corsRules: [corsRule]
        }

        return corsConfig;
    }

    buildNotificationConfiguration(): s3Cdk.CfnBucket.NotificationConfigurationProperty    {
        const triggerFunctionArnRef = cdk.Fn.ref(`function${this._props.triggerFunction}Arn`);

        const lambdaConfigurations = [{
            event : "s3:ObjectCreated:*",
            function : triggerFunctionArnRef,
        },
        {
            event: "s3:ObjectRemoved:*",
            function : triggerFunctionArnRef
        }];

        let notificationConfig : $TSAny = {
            lambdaConfigurations
        }

        return notificationConfig as s3Cdk.CfnBucket.NotificationConfigurationProperty
    }

    createAndSetIAMPolicies(){
        console.log("SACPCDEBUG:createAndSetIAMPolicies: Calling PublicPolicy : ");
        this.s3AuthPublicPolicy =  this.createS3AuthPublicPolicy();
        console.log("SACPCDEBUG:createS3AuthProtectedPolicy: Calling ProtectedPolicy : ");
        this.s3AuthProtectedPolicy = this.createS3AuthProtectedPolicy();
        console.log("SACPCDEBUG:createS3AuthPrivatePolicy: Calling PrivatePolicy : ");
        this.s3AuthPrivatePolicy = this.createS3AuthPrivatePolicy();
        console.log("SACPCDEBUG:createS3AuthUploadPolicy: Calling UploadPolicy : ");
        this.s3AuthUploadPolicy = this.createS3AuthUploadPolicy();
        console.log("SACPCDEBUG:createS3AuthPublicPolicy: Calling PublicPolicy : ");
        this.s3GuestPublicPolicy = this.createS3GuestPublicPolicy();
        console.log("SACPCDEBUG:createS3GuestUploadsPolicy: Calling GuestUploadsPolicy : ");
        this.s3GuestUploadPolicy = this.createGuestUploadsPolicy();
        console.log("SACPCDEBUG:createS3AuthReadPolicy: Calling AuthReadPolicy : ");
        this.s3AuthReadPolicy = this.createS3AuthReadPolicy();
        console.log("SACPCDEBUG:createS3GuestReadPolicy: Calling GuestReadPolicy : ");
        this.s3GuestReadPolicy = this.createS3GuestReadPolicy();
    }
    createAndSetTriggerPermissions(){
        this.triggerLambdaPermissions = this.createInvokeFunctionS3Permission();
    }

    createS3IAMPolicyDocument( refStr: string, pathStr:string,  actionStr: string, effect: iamCdk.Effect ){
        const props : iamCdk.PolicyStatementProps = {
            resources: [ cdk.Fn.join('', ["arn:aws:s3:::", cdk.Fn.ref(refStr), pathStr]) ],
            // actions: [ "s3:GetObject" ],
            // actions: cdk.Lazy.listValue( { produce : ()=> cdk.Fn.split( "," ,
            //                                               cdk.Lazy.stringValue({ produce : ()=> cdk.Fn.ref(actionStr) })) } ),
            actions: cdk.Fn.split( "," ,cdk.Fn.ref(actionStr)),
            effect
        };
        console.log("SACPCDEBUG: createS3IAMPolicyDocument: Props : ", props );
        const policyDocument =  new iamCdk.PolicyDocument();
        const policyStatement = new iamCdk.PolicyStatement(props);
        policyDocument.addStatements( policyStatement );

        return policyDocument;
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
     *  Lambda Trigger Permissions : Allow S3 to invoke the trigger function
     ***************************************************************************************************/
    createInvokeFunctionS3Permission( ) :lambdaCdk.CfnPermission{
        const logicalId = "TriggerPermissions";
        const sourceArn = cdk.Fn.join( "", [ "arn:aws:s3:::", this.buildBucketName()])

        let resourceDefinition : lambdaCdk.CfnPermissionProps = {
                action : "lambda:InvokeFunction",
                functionName : cdk.Fn.ref(`function${this._props.triggerFunction}Name`),
                principal:"s3.amazonaws.com",
                sourceAccount : cdk.Fn.ref("AWS::AccountId"),
                sourceArn
        }
        const lambdaPermission = new lambdaCdk.CfnPermission( this, logicalId, resourceDefinition);
        return lambdaPermission;
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
            logicalId : "S3AuthPublicPolicy",
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
            //dependsOn : [ this.s3Bucket ] - Not required since refStr implicitly adds this
        }
        const policy = this.createIAMPolicy(policyDefinition);
        return policy;
    }

    //S3AuthProtectedPolicy
    createS3AuthProtectedPolicy() {
        let policyDefinition: IAmplifyPolicyDefinition = {
            logicalId : "S3AuthProtectedPolicy",
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
            //dependsOn : [ this.s3Bucket ]- Not required since refStr implicitly adds this
        }
        const policy = this.createIAMPolicy(policyDefinition);
        return policy;
    }

    //S3AuthPrivatePolicy
    createS3AuthPrivatePolicy() {
        let policyDefinition: IAmplifyPolicyDefinition = {
            logicalId : "S3AuthPrivatePolicy",
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
            //dependsOn : [ this.s3Bucket ]- Not required since refStr implicitly adds this
        }
        const policy = this.createIAMPolicy(policyDefinition);
        return policy;
    }

    //S3AuthUploadPolicy
    createS3AuthUploadPolicy() {
        let policyDefinition: IAmplifyPolicyDefinition = {
            logicalId : "S3AuthUploadPolicy",
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
            //dependsOn : [ this.s3Bucket ]- Not required since refStr implicitly adds this
        }
        const policy = this.createIAMPolicy(policyDefinition);
        return policy;
    }

    //S3GuestPublicPolicy
    createS3GuestPublicPolicy() {
        let policyDefinition: IAmplifyPolicyDefinition = {
            logicalId : "S3GuestPublicPolicy",
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
            //dependsOn : [ this.s3Bucket ]- Not required since refStr implicitly adds this
        }
        const policy = this.createIAMPolicy(policyDefinition);
        return policy;
    }

    //S3GuestUploadPolicy
    createGuestUploadsPolicy() {
        let policyDefinition: IAmplifyPolicyDefinition = {
            logicalId : "S3GuestUploadsPolicy",
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
            //dependsOn : [ this.s3Bucket ]- Not required since refStr implicitly adds this
        }
        const policy = this.createIAMPolicy(policyDefinition);
        return policy;
    }

    //S3AuthReadPolicy
    createS3AuthReadPolicy() {
        let policyDefinition: IAmplifyPolicyDefinition = {
            logicalId : "S3AuthReadPolicy",
            policyNameRef : "s3ReadPolicy",
            roleRefs : ["authRoleName"],
            condition : this.conditions.CreateAuthReadAndList,
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
            //dependsOn : [ this.s3Bucket ]- Not required since refStr implicitly adds this
        }

        const policy:iamCdk.CfnPolicy = this.createMultiStatementIAMPolicy(policyDefinition);
        return policy;
    }

    //S3GuestReadPolicy
    createS3GuestReadPolicy():iamCdk.CfnPolicy {
        let policyDefinition: IAmplifyPolicyDefinition = {
            logicalId : "S3GuestReadPolicy",
            policyNameRef : "s3ReadPolicy",
            roleRefs : ["unauthRoleName"],
            condition: this.conditions.CreateGuestReadAndList,
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
            //dependsOn : [ this.s3Bucket ]- Not required since refStr implicitly adds this
        }
        const policy:iamCdk.CfnPolicy = this.createMultiStatementIAMPolicy(policyDefinition);
        return policy;
    }

    //S3TriggerBucketPolicy - Policy to control trigger function access to S3 bucket
    createTriggerPolicy():iamCdk.CfnPolicy {
        let policyDefinition: IAmplifyPolicyDefinition = {
            logicalId : "S3TriggerBucketPolicy",
            isPolicyNameAbsolute : true, // set if policyName is not a reference
            policyNameRef : "amplify-lambda-execution-policy-storage",
            roleRefs : [`function${this._props.triggerFunction}LambdaExecutionRole`],
            statements : [
                {
                    refStr  : "S3Bucket",
                    pathStr : "/*",
                    isActionAbsolute : true, //actions are not refs
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
    createIAMPolicy(policyDefinition : IAmplifyPolicyDefinition):iamCdk.CfnPolicy{
        let policyL1 : $TSObject = {};
        //Policy Properties
        policyL1.Properties = {};
            //1. Property: PolicyName
            if (policyDefinition.isPolicyNameAbsolute){
                policyL1.Properties.policyName = policyDefinition.policyNameRef;
            } else {
                policyL1.Properties.policyName = {
                    "Ref" : policyDefinition.policyNameRef
                }
            }
            //2. Property: Roles
            policyL1.Properties.roles = policyDefinition.roleRefs.map( roleRef=> ({
                                                                    "Ref" : roleRef
                                       }));
            //3. Property: PolicyDocument
            policyL1.Properties.policyDocument = {
                "Version": "2012-10-17",
                "Statement": {}
            }
            //3.1.1 Property: PolicyDocument.Statement.Action
            if (policyDefinition.statements[0].actions){
                policyL1.Properties.policyDocument.Statement.Effect = policyDefinition.statements[0].effect;
                if (policyDefinition.statements[0].isActionAbsolute){
                    policyL1.Properties.policyDocument.Statement.Action =
                    policyDefinition.statements[0].actions
                } else {
                    policyL1.Properties.policyDocument.Statement.Action =
                    policyDefinition.statements[0].actions.map(action => (
                        {
                            "Fn::Split" : [ "," , {
                                "Ref": action
                            } ]
                        }
                    ))
                }
            }
            //3.1.2 Property: PolicyDocument.Statement.Resource
            policyL1.Properties.policyDocument.Statement.Resource = [
                {
                    "Fn::Join": [
                        "",
                        [
                            "arn:aws:s3:::",
                            {
                                "Ref": policyDefinition.statements[0].refStr
                            },
                            policyDefinition.statements[0].pathStr
                        ]
                    ]
                }
            ]

        const policy = new iamCdk.CfnPolicy(this, policyDefinition.logicalId, policyL1["Properties"])
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
        const policy = new iamCdk.CfnPolicy( this, policyDefinition.logicalId, props); //bind policy to stack
        if ( policyDefinition.dependsOn ){
            policyDefinition.dependsOn.map( dependency => policy.addDependsOn( dependency ))
        }
        if ( policyDefinition.condition ){
            policy.cfnOptions.condition = policyDefinition.condition
        }
        return policy;
    }

    //Helper:: function to create Cognito Group IAM policy & bind to the App's stack
    createS3AmplifyGroupPolicies( authResourceName: string,  groupList : string[], groupPolicyMap : GroupAccessType ) : Array<iamCdk.CfnPolicy>{
        const groupPolicyList : Array<iamCdk.CfnPolicy> = [];
        //Build policy statement
        for( const groupName of groupList ){
            const logicalID =  this.buildGroupPolicyLogicalID(groupName);
            const groupPolicyName = this.buildGroupPolicyName(groupName);
            const policyStatementList = this._buildCDKGroupPolicyStatements(groupPolicyMap[groupName]);//convert permissions to statements
            const props : iamCdk.CfnPolicyProps = {
                policyName : groupPolicyName,
                roles : this.buildCDKGroupRoles(groupName, authResourceName),
                policyDocument : this._buildCDKGroupPolicyDocument(policyStatementList),
            };
            const groupPolicy : iamCdk.CfnPolicy = new iamCdk.CfnPolicy(this, logicalID, props);
            groupPolicyList.push(groupPolicy);
        }
        return groupPolicyList;
    }

    /**************************************************************************************************
     *  END IAM Policies - Control Auth and Guest access to S3 bucket using Cognito Identity Pool
     * ***********************************************************************************************/


    //Helper:: create logical ID from groupName
    buildGroupPolicyLogicalID(groupName :string):string{
        return `${groupName}GroupPolicy`;
    }
    //Helper:: create policyName from groupName
    buildGroupPolicyName(groupName: string):string{
        return `${groupName}-group-s3-policy`;
    }
    //Helper:: create group Role name from groupName
    buildGroupRoleName( groupName: string):string {
        return `${groupName}GroupRole`;
    }

    //Helper:: create CDK Group-Role name from groupName and cognito ARN
    public buildCDKGroupRoles( groupName: string, authResourceName: string){
        const roles =  [
            cdk.Fn.join( "",[cdk.Fn.ref(`auth${authResourceName}UserPoolId`), `-${this.buildGroupRoleName(groupName)}`])
        ]
        return roles;
    }

    //Helper:: Create Group permissions into CDK policy statements
    _buildCDKGroupPolicyStatements( groupPerms : S3PermissionType[]) :iamCdk.PolicyStatement[]{
           const policyStatementList : Array<iamCdk.PolicyStatement> = [];
           const bucketArn = cdk.Fn.join('', [ "arn:aws:s3:::" , cdk.Fn.ref("S3Bucket")]).toString();
           const permissions = groupPerms.map( groupPerm => S3InputState.getCfnTypeFromPermissionType(groupPerm) )
           policyStatementList.push(
                new iamCdk.PolicyStatement({
                    resources: [ `${bucketArn}/*` ],
                    actions: permissions,
                    effect: iamCdk.Effect.ALLOW,
                })
           );
           if ( groupPerms.includes( S3PermissionType.LIST )){
                policyStatementList.push(
                    new iamCdk.PolicyStatement({
                        resources: [ `${bucketArn}` ],
                        actions: [S3InputState.getCfnTypeFromPermissionType(S3PermissionType.LIST)],
                        effect: iamCdk.Effect.ALLOW,
                    })
                )
           }
           return policyStatementList;
    }

    //Helper:: Create PolicyDocument from policyStatement list
    _buildCDKGroupPolicyDocument( policyStatementList :iamCdk.PolicyStatement[]){
        const policyDocument = new iamCdk.PolicyDocument();
        policyStatementList.map( policyStatement => {
            //Add Statement to Policy
            policyDocument.addStatements(policyStatement);
        });
        return policyDocument;
    }

    //Helper: Add CFN Resource Param definitions as CfnParameter .
    _setCFNParams( paramDefinitions : AmplifyCfnParamType ){
        paramDefinitions.params.map( paramName => {
            //set param type
            let cfnParam: any = {
                                type: paramDefinitions.paramType
                            };
            //set param default if provided
            if ( paramDefinitions.default){
                cfnParam.default = paramDefinitions.default
            }
            //configure param in resource template object
            this.addCfnParameter( cfnParam , paramName);

        } );
    }

    _getDependsOnParameters(){
        let s3CfnDependsOnParams : Array<AmplifyCfnParamType> = []
        // //Add DependsOn Params
        // if ( this.cliMetadata.dependsOn && this.cliMetadata.dependsOn.length > 0 ){
        //     const dependsOn : S3CFNDependsOn[] = this.cliMetadata.dependsOn;
        //     for ( const dependency of dependsOn ) {
        //         for( const attribute of dependency.attributes) {
        //             const dependsOnParam: AmplifyCfnParamType = {
        //                 params: [`${dependency.category}${dependency.resourceName}${attribute}`],
        //                 paramType : "String",
        //                 default: `${dependency.category}${dependency.resourceName}${attribute}`
        //             };
        //             s3CfnDependsOnParams.push(dependsOnParam);
        //         }
        //     }
        // }
        return s3CfnDependsOnParams;
    }

}

//Constants and Interfaces
const CFN_TEMPLATE_FORMAT_VERSION = '2010-09-09';
const S3_ROOT_CFN_DESCRIPTION = 'S3 Resource for AWS Amplify CLI';

interface IAmplifyIamPolicyStatementParams {
    refStr   : string,
    conditions? : $TSObject,
    pathStr? : string,
    isActionAbsolute?: boolean,
    actions? : Array<string>,
    effect   : iamCdk.Effect
}

interface IAmplifyPolicyDefinition {
    logicalId : string,
    isPolicyNameAbsolute? : boolean,
    policyNameRef : string,
    roleRefs : Array<string>,
    condition? : cdk.CfnCondition,
    statements : Array<IAmplifyIamPolicyStatementParams>
    dependsOn? : Array<cdk.CfnResource>
}

type AmplifyS3Conditions = Record<string, cdk.CfnCondition>

type AmplifyS3CfnParameters = Record<string, cdk.CfnParameter>