import {S3PermissionType, S3UserInputs} from '../service-walkthrough-types/s3-user-input-types'
import {S3CFNPermissionType, S3InputState} from '../service-walkthroughs/s3-user-input-state';
import {AmplifyS3ResourceCfnStack} from './s3-stack-builder';
import * as cdk from '@aws-cdk/core';
import {App} from '@aws-cdk/core';
import {AmplifyBuildParamsPermissions, AmplifyS3ResourceInputParameters} from './types'
import * as fs from 'fs-extra';
import { $TSContext, AmplifyCategories, JSONUtilities } from 'amplify-cli-core';
import path from 'path';



type AmplifyCfnParamType = {
    params : Array<string>
    paramType : string
    default? : string
}



//stack transform for S3
export class AmplifyS3ResourceStackTransform {
    app: App;
    cliInputs: S3UserInputs;
    resourceTemplateObj: AmplifyS3ResourceCfnStack | undefined;
    cliInputsState: S3InputState;
    cfn!: string;
    cfnInputParams!: AmplifyS3ResourceInputParameters;
    context : $TSContext;
    resourceName : string;

    constructor(resourceName: string, context : $TSContext) {
        this.app = new App();
        // Validate the cli-inputs.json for the resource
        this.cliInputsState = new S3InputState(resourceName, undefined);
        this.cliInputs = this.cliInputsState.getCliInputPayload();
        this.context = context;
        this.resourceName = resourceName;
    }

    async transform(context : $TSContext) {
        //SACPC!: Validation logic is broken. TBD
        // const validationResult =   await this.cliInputsState.isCLIInputsValid();
        // console.log("SACPCDEBUG: TRANSFORM: ValidationResult: ", validationResult);
        const validationResult = true;
        //Only generate stack if truthsy
        if ( validationResult ) {
            this.generateCfnInputParameters();
            // Generate cloudformation stack from cli-inputs.json
            await this.generateStack(context);

            // Modify cloudformation files based on overrides
            this.applyOverrides()

            // Save generated cloudformation.json and parameters.json files
            this.saveBuildFiles();
        } else {
            throw new Error("cli-inputs.json has been altered or doesn't match input-schema for the resource");
        }

    }

    generateCfnInputParameters() {
        const userInput : S3UserInputs = this.cliInputsState.getUserInput();

        const permissionCRUD = [ S3PermissionType.CREATE,
                                 S3PermissionType.READ,
                                 S3PermissionType.DELETE] ;
        const permissionC = [S3PermissionType.CREATE];
        //DEFAULT Parameters
        const defaultS3PermissionsAuthenticatedPrivate = permissionCRUD;
        const defaultS3PermissionsAuthenticatedProtected = permissionCRUD;
        const defaultS3PermissionsAuthenticatedPublic = permissionCRUD;
        const defaultS3PermissionsAuthenticatedUploads = permissionC;
        const defaultS3PermissionsGuestPublic = permissionCRUD;
        const defaultS3PermissionsGuestUploads = permissionC;


        this.cfnInputParams = {
            bucketName : userInput.bucketName,
            triggerFunction: ( userInput.triggerFunction && userInput.triggerFunction !== "NONE")? userInput.triggerFunction:undefined,
            selectedGuestPermissions: S3InputState.getCfnPermissionsFromInputPermissions(userInput.guestAccess),
            selectedAuthenticatedPermissions: S3InputState.getCfnPermissionsFromInputPermissions(userInput.authAccess),
            unauthRoleName: {
                "Ref": "UnauthRoleName"
            },
            authRoleName : {
                "Ref": "AuthRoleName"
            }
        }
        this.cfnInputParams.s3PrivatePolicy = `Private_policy_${userInput.policyUUID}`;
        this.cfnInputParams.s3ProtectedPolicy =  `Protected_policy_${userInput.policyUUID}`;
        this.cfnInputParams.s3PublicPolicy = `Public_policy_${userInput.policyUUID}`;
        this.cfnInputParams.s3ReadPolicy = `read_policy_${userInput.policyUUID}`;
        this.cfnInputParams.s3UploadsPolicy = `Uploads_policy_${userInput.policyUUID}`;
        this.cfnInputParams.AuthenticatedAllowList = this._getAuthGuestListPermission( S3PermissionType.LIST, userInput.authAccess)
        this.cfnInputParams.GuestAllowList = this._getAuthGuestListPermission( S3PermissionType.LIST, userInput.guestAccess)
        this.cfnInputParams.s3PermissionsAuthenticatedPrivate = this._getPublicPrivatePermissions(defaultS3PermissionsAuthenticatedPrivate, userInput.authAccess);
        this.cfnInputParams.s3PermissionsAuthenticatedProtected = this._getPublicPrivatePermissions(defaultS3PermissionsAuthenticatedProtected, userInput.authAccess);
        this.cfnInputParams.s3PermissionsAuthenticatedPublic = this._getPublicPrivatePermissions(defaultS3PermissionsAuthenticatedPublic, userInput.authAccess);
        this.cfnInputParams.s3PermissionsAuthenticatedUploads = this._getPublicPrivatePermissions(defaultS3PermissionsAuthenticatedUploads, userInput.authAccess);
        this.cfnInputParams.s3PermissionsGuestPublic = this._getPublicPrivatePermissions( defaultS3PermissionsGuestPublic, userInput.guestAccess);
        this.cfnInputParams.s3PermissionsGuestUploads = this._getPublicPrivatePermissions( defaultS3PermissionsGuestUploads, userInput.guestAccess);
        this.cfnInputParams.authPolicyName = `s3_amplify_${userInput.policyUUID}`;
        this.cfnInputParams.unauthPolicyName = `s3_amplify_${userInput.policyUUID}`;
    }

    _getAuthGuestListPermission( checkOperation : S3PermissionType, authPermissions : Array<S3PermissionType>|undefined ){
        if( authPermissions ){
            if( authPermissions.includes(checkOperation) ){
                return AmplifyBuildParamsPermissions.ALLOW
            } else {
                return AmplifyBuildParamsPermissions.DISALLOW;
            }
        } else {
            return AmplifyBuildParamsPermissions.DISALLOW;
        }
    }

    _getPublicPrivatePermissions(checkOperationList : Array<S3PermissionType>, authPermissions : Array<S3PermissionType>|undefined ){
        if ( authPermissions ){
           for( const permission of checkOperationList ){
                if ( !authPermissions.includes(permission) ){
                   return AmplifyBuildParamsPermissions.DISALLOW;
                }
            }
            const cfnPermissions : Array<S3CFNPermissionType> =  S3InputState.getCfnPermissionsFromInputPermissions( checkOperationList );
            return cfnPermissions.join();
        }
        return AmplifyBuildParamsPermissions.DISALLOW;
    }

    // Modify cloudformation files based on overrides
    applyOverrides() {
        // Build overrides
        // Get modified props from overrides
    }

    saveBuildFiles() {
        // Store cloudformation-template.json, Parameters.json and Update BackendConfig
        this._saveFilesToLocalFileSystem('cloudformation-template.json', this.cfn);
        this._saveFilesToLocalFileSystem('parameters.json', this.cfnInputParams);
        this._saveDependsOnToBackendConfig();
    }

    async generateStack( context : $TSContext ):Promise<string>{
        // Create Resource Stack from CLI Inputs in this._resourceTemplateObj
        this.resourceTemplateObj = new AmplifyS3ResourceCfnStack(this.app, 'AmplifyS3ResourceStack', this.cliInputs, this.cfnInputParams);

        // Add Parameters
        this.resourceTemplateObj.addParameters();

        // Add Conditions
        this.resourceTemplateObj.addConditions();

        // Add Outputs
        this.resourceTemplateObj.addOutputs();

        /*
        ** Generate Stack Resources for the S3 resource
        **
        * 1. Create the S3 bucket, configure CORS and create CFN Conditions
        * 2. Configure Notifications on the S3 bucket.
        * 3. Create IAM policies to control Cognito pool access to S3 bucket
        * 4. Configure Cognito User pool policies
        * 5. Configure Trigger policies
        */
        await this.resourceTemplateObj.generateCfnStackResources(context);

        // Render CFN Template string and store as member in this.cfn
        this.cfn = this.resourceTemplateObj.renderCloudFormationTemplate();
        return this.cfn;
    }

    _addOutputs(){
        this.resourceTemplateObj?.addCfnOutput({
            value: cdk.Fn.ref('S3Bucket'),
            description : "Bucket name for the S3 bucket"
          },
          'BucketName');
        this.resourceTemplateObj?.addCfnOutput({
            value: cdk.Fn.ref('AWS::Region'),
          },
          'Region');
    }

    _addParameters(){
        let s3CfnParams : Array<AmplifyCfnParamType> = [
            {
                params : ["env", "bucketName" ,"authPolicyName", "unauthPolicyName",
                          "authRoleName", "unauthRoleName", "triggerFunction"],
                paramType : 'String'
            },
            {
                params: ["s3PublicPolicy", "s3PrivatePolicy", "s3ProtectedPolicy",
                         "s3UploadsPolicy", "s3ReadPolicy"],
                paramType: 'String',
                default: 'NONE'
            },
            {
                params: ["s3PermissionsAuthenticatedPublic","s3PermissionsAuthenticatedProtected",
                         "s3PermissionsAuthenticatedPrivate", "s3PermissionsAuthenticatedUploads" ,
                         "s3PermissionsGuestPublic", "s3PermissionsGuestUploads", "AuthenticatedAllowList",
                         "GuestAllowList"],
                paramType: 'String',
                default: AmplifyBuildParamsPermissions.DISALLOW
            },
            {
                params: ["selectedGuestPermissions" , "selectedAuthenticatedPermissions"],
                paramType: 'CommaDelimitedList',
                default: 'NONE'
            },
        ];

        s3CfnParams.map(params => this._setCFNParams(params) )
    }

    // _getDependsOnParameters(){
    //     let s3CfnDependsOnParams : Array<AmplifyCfnParamType> = []
    //     // //Add DependsOn Params
    //     // if ( this.cliMetadata.dependsOn && this.cliMetadata.dependsOn.length > 0 ){
    //     //     const dependsOn : S3CFNDependsOn[] = this.cliMetadata.dependsOn;
    //     //     for ( const dependency of dependsOn ) {
    //     //         for( const attribute of dependency.attributes) {
    //     //             const dependsOnParam: AmplifyCfnParamType = {
    //     //                 params: [`${dependency.category}${dependency.resourceName}${attribute}`],
    //     //                 paramType : "String",
    //     //                 default: `${dependency.category}${dependency.resourceName}${attribute}`
    //     //             };
    //     //             s3CfnDependsOnParams.push(dependsOnParam);
    //     //         }
    //     //     }
    //     // }
    //     return s3CfnDependsOnParams;
    // }

    //Helper: Add CFN Resource Param definitions as CfnParameter .
    _setCFNParams( paramDefinitions : AmplifyCfnParamType ){
        const resourceTemplateObj = this.resourceTemplateObj;
        if (resourceTemplateObj ) {
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
                resourceTemplateObj.addCfnParameter( cfnParam , paramName);

            } );
        } //else throw an exception TBD
    }

    //Helper: Save files in local-filesysten
    _saveFilesToLocalFileSystem( fileName : string,  data : any  ){
        fs.ensureDirSync(this.cliInputsState.buildFilePath);
        const cfnFilePath = path.resolve(path.join(this.cliInputsState.buildFilePath, fileName ));
        try {
          JSONUtilities.writeJson(cfnFilePath, data);
        } catch (e) {
          throw e;
        }
    }

    //Helper: Save DependsOn entries to backend-config.json
    _saveDependsOnToBackendConfig(){
        if (this.resourceTemplateObj) {
            //Get all collated resource dependencies
            const s3DependsOnResources = this.resourceTemplateObj.getS3DependsOn();
            if ( s3DependsOnResources && s3DependsOnResources.length > 0) {
                this.context.amplify.updateamplifyMetaAfterResourceUpdate( AmplifyCategories.STORAGE,
                                                                           this.resourceName,
                                                                          'dependsOn',
                                                                           s3DependsOnResources, true);
                console.log( "SACPCDEBUG: SAVING-DEPENDSON: ", {
                   [this.resourceName] : s3DependsOnResources
                } );
            }
        }
    }
}