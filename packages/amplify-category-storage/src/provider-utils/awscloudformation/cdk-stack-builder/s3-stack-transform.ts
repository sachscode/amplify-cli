import {S3UserInputs} from '../service-walkthrough-types/s3-user-input-types'
import {S3CFNDependsOn, S3FeatureMetadata, S3InputState} from '../service-walkthroughs/s3-user-input-state';
import {AmplifyS3ResourceCfnStack} from './s3-stack-builder';
import * as cdk from '@aws-cdk/core';
import {AmplifyS3ResourceInputParameters} from './types'
import { App } from '@aws-cdk/core';
import * as fs from 'fs-extra';
import { JSONUtilities } from 'amplify-cli-core';
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
    cliMetadata : S3FeatureMetadata;
    _resourceTemplateObj: AmplifyS3ResourceCfnStack | undefined;
    cliInputsState: S3InputState;
    cfn!: string;
    cfnInputParams!: AmplifyS3ResourceInputParameters;

    constructor(resourceName: string) {
        this.app = new App();
        // Validate the cli-inputs.json for the resource
        this.cliInputsState = new S3InputState(resourceName, undefined);
        this.cliInputs = this.cliInputsState.getCliInputPayload();
        this.cliMetadata = this.cliInputsState.getCliMetadata();
    }

    async transform() {

        const validationResult =   await this.cliInputsState.isCLIInputsValid();

        //Only generate stack if truthsy
        if ( validationResult ) {
            // Generate  cloudformation stack from cli-inputs.json
            await this.generateStack();

            // Generate  cloudformation stack from cli-inputs.json
            this.generateCfnInputParameters();

            // Modify cloudformation files based on overrides
            this.applyOverrides()

            // Save generated cloudformation.json and parameters.json files
            this.saveBuildFiles();
        } else {
            return new Error("cli-inputs.json has been altered or doesn't match input-schema for the resource");
        }

    }

    generateCfnInputParameters() {
        this.cfnInputParams = this.cliInputsState.getCliInputParams();
    }

    // Modify cloudformation files based on overrides
    applyOverrides() {
        // Build overrides
        // Get modified props from overrides
    }

    saveBuildFiles() {
        // Store cloudformation-template.json
        this._saveFilesToLocalFileSystem('cloudformation-template.json', this.cfn);
        this._saveFilesToLocalFileSystem('parameters.json', this.cfnInputParams);
    }

    async generateStack() {
        // Create Resource Stack from CLI Inputs in this._resourceTemplateObj
        this._resourceTemplateObj = new AmplifyS3ResourceCfnStack(this.app, 'AmplifyS3ResourceStack', this.cliInputs);

        // Add Parameters
        this._addParameters();

        // Add Outputs
        this._addOutputs();

        /*
        ** Generate Stack Resources for the S3 resource
        **
        * 1. Create the S3 bucket, configure CORS and create CFN Conditions
        * 2. Configure Notifications on the S3 bucket.
        * 3. Create IAM policies to control Cognito pool access to S3 bucket
        * 4. Configure Cognito User pool policies
        * 5. Configure Trigger policies
        */
        this._resourceTemplateObj.generateCfnStackResources();

        // Render CFN Template string and store as member in this.cfn
        this._resourceTemplateObj.renderCloudFormationTemplate();
    }

    _addOutputs(){
        this._resourceTemplateObj?.addCfnOutput({
            value: cdk.Fn.ref('S3Bucket'),
            description : "Bucket name for the S3 bucket"
          },
          'BucketName');
        this._resourceTemplateObj?.addCfnOutput({
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
            {
                params: ["selectedGuestPermissions" , "selectedAuthenticatedPermissions"],
                paramType: 'CommaDelimitedList',
                default: 'None'
            },
        ];

        let s3CfnDependsOnParams : Array<AmplifyCfnParamType> = this._getDependsOnParameters()

        s3CfnParams = s3CfnParams.concat( s3CfnDependsOnParams );
        s3CfnParams.map(params => this._setCFNParams(params) )

    }

    _getDependsOnParameters(){
        let s3CfnDependsOnParams : Array<AmplifyCfnParamType> = []
        //Add DependsOn Params
        if ( this.cliMetadata.dependsOn && this.cliMetadata.dependsOn.length > 0 ){
            const dependsOn : S3CFNDependsOn[] = this.cliMetadata.dependsOn;
            for ( const dependency of dependsOn ) {
                for( const attribute of dependency.attributes) {
                    const dependsOnParam: AmplifyCfnParamType = {
                        params: [`${dependency.category}${dependency.resourceName}${attribute}`],
                        paramType : "String",
                        default: `${dependency.category}${dependency.resourceName}${attribute}`
                    };
                    s3CfnDependsOnParams.push(dependsOnParam);
                }
            }
        }
        return s3CfnDependsOnParams;
    }

    //Helper: Add CFN Resource Param definitions as CfnParameter .
    _setCFNParams( paramDefinitions : AmplifyCfnParamType ){
        const resourceTemplateObj = this._resourceTemplateObj;
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
          throw new Error(e);
        }
    }

}