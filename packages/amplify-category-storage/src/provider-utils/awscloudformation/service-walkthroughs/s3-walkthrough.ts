import * as inquirer from 'inquirer';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';
import _ from 'lodash';
import uuid from 'uuid';
import { printer } from 'amplify-prompts';
import { ResourceDoesNotExistError, ResourceAlreadyExistsError, exitOnNextTick, $TSAny, $TSContext, AmplifyCategories } from 'amplify-cli-core';
import { S3CFNDependsOn, S3CFNPermissionMapType, S3CLIWalkthroughParams, S3InputState, S3InputStateOptions, S3PermissionMapType } from './s3-user-input-state';
import { pathManager } from 'amplify-cli-core';
import { AmplifyBuildParamsPermissions, AmplifyS3ResourceInputParameters } from '../cdk-stack-builder/types';
import { S3ResourceParameters } from '../import/types';
import { S3AccessType, S3UserAccessRole, S3UserInputs, S3TriggerFunctionType, S3PermissionType } from '../service-walkthrough-types/s3-user-input-types';
import { AmplifyS3ResourceStackTransform } from  '../cdk-stack-builder/s3-stack-transform'
import { askAndInvokeAuthWorkflow, askResourceNameQuestion, askBucketNameQuestion,
         askWhoHasAccessQuestion, askCRUDQuestion, askUserPoolGroupPermissionSelectionQuestion,
         askUserPoolGroupSelectionQuestion,
         askGroupPermissionQuestion,
         askUpdateTriggerSelection,
         askAuthPermissionQuestion,
         conditionallyAskGuestPermissionQuestion,
         permissionMap,
         askUserPoolGroupSelectionUntilPermissionSelected,
         conditionallyAskWhoHasAccessQuestion,
         askGroupOrIndividualAccessFlow} from './s3-questions';
import { printErrorAlreadyCreated, printErrorNoResourcesToUpdate } from './s3-errors';
import { getAllDefaults } from '../default-values/s3-defaults'
import * as cliS3Auth from './s3-auth-api';


// keep in sync with ServiceName in amplify-category-function, but probably it will not change
const FunctionServiceNameLambdaFunction = 'Lambda';
const parametersFileName = 'parameters.json';
const storageParamsFileName = 'storage-params.json';
const serviceName = 'S3';
const templateFileName = 's3-cloudformation-template.json.ejs';
const amplifyMetaFilename = 'amplify-meta.json';
const category = AmplifyCategories.STORAGE;
// map of s3 actions corresponding to CRUD verbs
// 'create/update' have been consolidated since s3 only has put concept

function buildShortUUID(){
  const [shortId] = uuid().split('-');
  return shortId;
}

async function addWalkthrough( context: $TSContext ){
  const { amplify } = context;
  const { amplifyMeta } = amplify.getProjectDetails();
  console.log("SACPCDEBUG:2: amplifyMeta: " , JSON.stringify(amplifyMeta, null, 2) );

  //First ask customers to configure Auth on the S3 resource, invoke auth workflow
  await askAndInvokeAuthWorkflow(context);
  const resourceName = await getS3ResourceName( context , amplifyMeta );

  if (resourceName) {
    await printErrorAlreadyCreated(context);
    exitOnNextTick(0);
  } else {
    //Ask S3 walkthrough questions
    const policyID = buildShortUUID(); //prefix/suffix for all resources.
    const defaultValues = getAllDefaults(amplify.getProjectDetails(), policyID );
    const resourceName = await askResourceNameQuestion(context, defaultValues); //Cannot be changed once added
    const bucketName = await askBucketNameQuestion(context, defaultValues, resourceName); //Cannot be changed once added
    const storageAccess = await askWhoHasAccessQuestion(context, defaultValues); //Auth/Guest/AuthandGuest
    const authAccess = await askAuthPermissionQuestion(context, defaultValues);
    const guestAccess = await conditionallyAskGuestPermissionQuestion( storageAccess, context, defaultValues);
    const triggerFunction = await startAddTriggerFunctionFlow(context, resourceName, policyID, undefined );


    //Build userInputs for S3 resources
    let cliInputs : S3UserInputs = {
                                      resourceName,
                                      bucketName,
                                      policyUUID : policyID,
                                      storageAccess,
                                      authAccess : authAccess,
                                      guestAccess : guestAccess,
                                      triggerFunction : (triggerFunction)?triggerFunction:"NONE",
                                      groupAccess : {},
                                      groupList: []
                                    }
    let s3DependsOnResources : Array<S3CFNDependsOn> = [];

    // //Save DependsOn in Root
    // context.amplify.updateamplifyMetaAfterResourceUpdate(AmplifyCategories.STORAGE,
    //                                                      resourceName /*friendly name*/ ,
    //                                                      'dependsOn',
    //                                                     s3DependsOnResources);

    //Save CLI Inputs payload
    const cliInputsState = new S3InputState(cliInputs.resourceName as string, cliInputs);
    cliInputsState.saveCliInputPayload( cliInputs );

    //Generate Cloudformation
    const stackGenerator = new AmplifyS3ResourceStackTransform(cliInputs.resourceName as string, context );
    await stackGenerator.transform(context);
    return cliInputs.resourceName;
  }
};


async function  updateWalkthrough(context: any){
  const { amplify } = context;
  const { amplifyMeta } = amplify.getProjectDetails();
  const resourceName : string| undefined = await getS3ResourceName( context , amplifyMeta );
  if (resourceName === undefined ){
    await printErrorNoResourcesToUpdate(context);
    exitOnNextTick(0);
  } else {
      // For better DX check if the storage is imported
      if (amplifyMeta[category][resourceName].serviceType === 'imported') {
        printer.error('Updating of an imported storage resource is not supported.');
        return;
      }
      //load existing cliInputs
      let cliInputsState = new S3InputState(resourceName, undefined);
      let previousUserInput = cliInputsState.getUserInput();
      let cliInputs : S3UserInputs= Object.assign({}, previousUserInput); //overwrite this with updated params
      const defaultValues = getAllDefaults(amplify.getProjectDetails(), cliInputs.policyUUID as string);
      console.log("SACPCDEBUG:Update DEBUG : Previous CLIInputs: ", JSON.stringify(cliInputs, null, 2) );

      //note: If userPoolGroups have been created/Updated, then they need to be updated in CLI Inputs
      //This check is not required once Auth is integrated with s3-auth-apis.
      const userPoolGroupList = context.amplify.getUserPoolGroupList();
      if ( userPoolGroupList && userPoolGroupList.length > 0){
        cliInputs = await askGroupOrIndividualAccessFlow(userPoolGroupList, context, cliInputs);
        //Ask S3 walkthrough questions
        console.log("SACPCDEBUG: UserPoolGroupList: ", userPoolGroupList , " GroupList: " , cliInputs.groupList, " ", cliInputs.groupAccess  );
      } else {
        //Build userInputs for S3 resources
        cliInputs.storageAccess = await askWhoHasAccessQuestion(context, previousUserInput); //Auth/Guest
        cliInputs.authAccess = await askAuthPermissionQuestion(context, previousUserInput);
        cliInputs.guestAccess = await conditionallyAskGuestPermissionQuestion( cliInputs.storageAccess, context, previousUserInput);
      }

      //Build userInputs for S3 resources
      cliInputs.triggerFunction = await  startUpdateTriggerFunctionFlow( context, resourceName,
                                                                          previousUserInput.policyUUID as string,
                                                                          previousUserInput.triggerFunction ) ;
      console.log("SACPCDEBUG:Update DEBUG : NEW CLIInputs: ", JSON.stringify(cliInputs, null, 2) );

      //Save CLI Inputs payload
      cliInputsState.saveCliInputPayload(cliInputs);
      //Generate Cloudformation
      const stackGenerator = new AmplifyS3ResourceStackTransform(cliInputs.resourceName as string, context);
      stackGenerator.transform(context);
      return cliInputs.resourceName;
  }
};

async function startAddTriggerFunctionFlow( context: $TSContext, resourceName: string,  policyID : string, existingTriggerFunction : string|undefined):Promise<string|undefined>{
  const { amplify } = context;
  const enableLambdaTriggerOnS3 : boolean = await amplify.confirmPrompt('Do you want to add a Lambda Trigger for your S3 Bucket?', false);
  let triggerFunction : string|undefined = undefined;
  if ( enableLambdaTriggerOnS3 ) {
    try {
      //create new function or add existing function as trigger to S3 bucket.
      triggerFunction = await addTrigger(S3CLITriggerFlow.ADD ,context, resourceName, policyID, existingTriggerFunction);
    } catch (e) {
      printer.error((e as Error).message);
    }
  }
  return triggerFunction;
}

async function startUpdateTriggerFunctionFlow( context: $TSContext, resourceName: string, policyID: string, existingTriggerFunction : string | undefined):Promise<string|undefined>{
  let triggerFunction = existingTriggerFunction;

  //Update Trigger Flow
  let continueWithTriggerOperationQuestion = true;
  do {
      const triggerOperationAnswer = await askUpdateTriggerSelection(existingTriggerFunction);
      switch (triggerOperationAnswer) {
          case S3CLITriggerUpdateMenuOptions.ADD:
          case S3CLITriggerUpdateMenuOptions.UPDATE: {
            try {
              triggerFunction = await addTrigger( S3CLITriggerFlow.UPDATE, context, resourceName, policyID, existingTriggerFunction );
              continueWithTriggerOperationQuestion = false;
            } catch (e) {
              printer.error((e as Error).message);
              continueWithTriggerOperationQuestion = true;
            }
            break;
          }
          case S3CLITriggerUpdateMenuOptions.REMOVE: {
            //await removeTrigger(context, resourceName, triggerFunction);
            triggerFunction = undefined; //cli inputs should not have function
            continueWithTriggerOperationQuestion = false;
            break;
          }
          case S3CLITriggerUpdateMenuOptions.SKIP: {
            continueWithTriggerOperationQuestion = false;
            break;
          }
          default:
            printer.error(`${triggerOperationAnswer} not supported`);
            continueWithTriggerOperationQuestion = false;
      }
  } while( continueWithTriggerOperationQuestion );

  return triggerFunction;
}

function getS3ResourcesFromAmplifyMeta( amplifyMeta : any ) : Record<string, $TSAny>|undefined{
  if( !amplifyMeta.hasOwnProperty(category)){
    return undefined;
  }
  const resources : Record<string, $TSAny> = {}; //maps cx resource to
  Object.keys(amplifyMeta[category]).forEach(resourceName => {
    if ( amplifyMeta[category][resourceName].service === serviceName &&
         amplifyMeta[category][resourceName].mobileHubMigrated !== true &&
         amplifyMeta[category][resourceName].serviceType !== 'imported') {
      resources[resourceName] = amplifyMeta[category][resourceName];
    }
  });
  return resources;
}

async function getS3ResourceName( context : $TSContext, amplifyMeta: any) : Promise<string|undefined> {
  //Fetch storage resources from Amplify Meta file
  const storageResources : Record<string, $TSAny>| undefined = getS3ResourcesFromAmplifyMeta( amplifyMeta );
  if ( storageResources ) {
    if (Object.keys(storageResources).length === 0) {
      return undefined;
    }
    const [resourceName] = Object.keys(storageResources); //only one resource is allowed
    return resourceName
  }
  return undefined;
}


async function updateCfnTemplateWithGroups(context: any, oldGroupList: any, newGroupList: any, newGroupPolicyMap: any, s3ResourceName: any, authResourceName: any) {
  const groupsToBeDeleted = _.difference(oldGroupList, newGroupList);

  // Update Cloudformtion file
  const projectBackendDirPath = context.amplify.pathManager.getBackendDirPath();
  const resourceDirPath = path.join(projectBackendDirPath, category, s3ResourceName);
  const storageCFNFilePath = path.join(resourceDirPath, 's3-cloudformation-template.json');
  const storageCFNFile = context.amplify.readJsonFile(storageCFNFilePath);

  const amplifyMetaFilePath = path.join(projectBackendDirPath, amplifyMetaFilename);
  const amplifyMetaFile = context.amplify.readJsonFile(amplifyMetaFilePath);

  let s3DependsOnResources = amplifyMetaFile.storage[s3ResourceName].dependsOn || [];

  s3DependsOnResources = s3DependsOnResources.filter((resource: any) => resource.category !== 'auth');

  if (newGroupList.length > 0) {
    s3DependsOnResources.push({
      category: 'auth',
      resourceName: authResourceName,
      attributes: ['UserPoolId'],
    });
  }

  storageCFNFile.Parameters[`auth${authResourceName}UserPoolId`] = {
    Type: 'String',
    Default: `auth${authResourceName}UserPoolId`,
  };

  groupsToBeDeleted.forEach((group: any) => {
    delete storageCFNFile.Parameters[`authuserPoolGroups${group}GroupRole`];
    delete storageCFNFile.Resources[`${group}GroupPolicy`];
  });

  newGroupList.forEach((group: any) => {
    s3DependsOnResources.push({
      category: 'auth',
      resourceName: 'userPoolGroups',
      attributes: [`${group}GroupRole`],
    });

    storageCFNFile.Parameters[`authuserPoolGroups${group}GroupRole`] = {
      Type: 'String',
      Default: `authuserPoolGroups${group}GroupRole`,
    };

    storageCFNFile.Resources[`${group}GroupPolicy`] = {
      Type: 'AWS::IAM::Policy',
      Properties: {
        PolicyName: `${group}-group-s3-policy`,
        Roles: [
          {
            'Fn::Join': [
              '',
              [
                {
                  Ref: `auth${authResourceName}UserPoolId`,
                },
                `-${group}GroupRole`,
              ],
            ],
          },
        ],
        PolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: newGroupPolicyMap[group],
              Resource: [
                {
                  'Fn::Join': [
                    '',
                    [
                      'arn:aws:s3:::',
                      {
                        Ref: 'S3Bucket',
                      },
                      '/*',
                    ],
                  ],
                },
              ],
            },
          ],
        },
      },
    };
  });

  // added a new policy for the user group to make action on buckets
  newGroupList.forEach((group: any) => {
    if (newGroupPolicyMap[group].includes('s3:ListBucket') === true) {
      storageCFNFile.Resources[`${group}GroupPolicy`].Properties.PolicyDocument.Statement.push({
        Effect: 'Allow',
        Action: 's3:ListBucket',
        Resource: [
          {
            'Fn::Join': [
              '',
              [
                'arn:aws:s3:::',
                {
                  Ref: 'S3Bucket',
                },
              ],
            ],
          },
        ],
      });
    }
  });

  context.amplify.updateamplifyMetaAfterResourceUpdate(category, s3ResourceName, 'dependsOn', s3DependsOnResources);

  const storageCFNString = JSON.stringify(storageCFNFile, null, 4);

  fs.writeFileSync(storageCFNFilePath, storageCFNString, 'utf8');
}


/**
async function removeTrigger(context: any, resourceName: any, triggerFunction: any) {
  // Update Cloudformtion file
  const projectBackendDirPath = context.amplify.pathManager.getBackendDirPath();
  const resourceDirPath = path.join(projectBackendDirPath, category, resourceName);
  const storageCFNFilePath = path.join(resourceDirPath, 's3-cloudformation-template.json');
  const storageCFNFile = context.amplify.readJsonFile(storageCFNFilePath);
  const parametersFilePath = path.join(resourceDirPath, parametersFileName);
  const bucketParameters = context.amplify.readJsonFile(parametersFilePath);
  const adminTrigger = bucketParameters.adminTriggerFunction;

  delete storageCFNFile.Parameters[`function${triggerFunction}Arn`];
  delete storageCFNFile.Parameters[`function${triggerFunction}Name`];
  delete storageCFNFile.Parameters[`function${triggerFunction}LambdaExecutionRole`];
  delete storageCFNFile.Resources.TriggerPermissions;

  if (!adminTrigger) {
    // Remove reference for old triggerFunction
    delete storageCFNFile.Resources.S3Bucket.Properties.NotificationConfiguration;
    delete storageCFNFile.Resources.S3TriggerBucketPolicy;
    delete storageCFNFile.Resources.S3Bucket.DependsOn;
  } else {
    const lambdaConfigurations: any = [];

    // eslint-disable-next-line max-len
    storageCFNFile.Resources.S3Bucket.Properties.NotificationConfiguration.LambdaConfigurations.forEach((triggers: any) => {
      if (
        triggers.Filter &&
        typeof triggers.Filter.S3Key.Rules[0].Value === 'string' &&
        triggers.Filter.S3Key.Rules[0].Value.includes('index-faces')
      ) {
        lambdaConfigurations.push(triggers);
      }
    });

    // eslint-disable-next-line max-len
    storageCFNFile.Resources.S3Bucket.Properties.NotificationConfiguration.LambdaConfigurations = lambdaConfigurations;

    const index = storageCFNFile.Resources.S3Bucket.DependsOn.indexOf('TriggerPermissions');

    if (index > -1) {
      storageCFNFile.Resources.S3Bucket.DependsOn.splice(index, 1);
    }

    const roles: any = [];

    storageCFNFile.Resources.S3TriggerBucketPolicy.Properties.Roles.forEach((role: any) => {
      if (!role.Ref.includes(triggerFunction)) {
        roles.push(role);
      }
    });

    storageCFNFile.Resources.S3TriggerBucketPolicy.Properties.Roles = roles;
  }

  const storageCFNString = JSON.stringify(storageCFNFile, null, 4);

  fs.writeFileSync(storageCFNFilePath, storageCFNString, 'utf8');

  const amplifyMetaFilePath = path.join(projectBackendDirPath, amplifyMetaFilename);
  const amplifyMetaFile = context.amplify.readJsonFile(amplifyMetaFilePath);
  const s3DependsOnResources = amplifyMetaFile.storage[resourceName].dependsOn;
  const s3Resources: any = [];

  s3DependsOnResources.forEach((resource: any) => {
    if (resource.resourceName !== triggerFunction) {
      s3Resources.push(resource);
    }
  });

  context.amplify.updateamplifyMetaAfterResourceUpdate(category, resourceName, 'dependsOn', s3Resources);
}

**/

async function askTriggerFunctionTypeQuestion(): Promise<S3TriggerFunctionType>{
    const triggerTypeQuestion = [{
      type: 'list',
      name: 'triggerType',
      message: 'Select from the following options',
      choices: [S3TriggerFunctionType.EXISTING_FUNCTION, S3TriggerFunctionType.NEW_FUNCTION],
    }];
    const triggerTypeAnswer = await inquirer.prompt(triggerTypeQuestion);
    return triggerTypeAnswer.triggerType as S3TriggerFunctionType;
}

async function askSelectExistingFunctionToAddTrigger( lambdaResources : Array<string> ) : Promise<string>{
  const triggerOptionQuestion = [{
    type: 'list',
    name: 'triggerOption',
    message: 'Select from the following options',
    choices: lambdaResources,
  }];
  const triggerOptionAnswer = await inquirer.prompt(triggerOptionQuestion);
  return  triggerOptionAnswer.triggerOption as string;
}

/**
//Update the lambda function cloudformation to export it's role for use in S3
function exportFunctionExecutionRoleInCFN( context: $TSContext, functionName: string ){
    const projectBackendDirPath = context.amplify.pathManager.getBackendDirPath();
    const functionCFNFilePath = path.join(projectBackendDirPath, 'function', functionName, `${functionName}-cloudformation-template.json`);

    if (fs.existsSync(functionCFNFilePath)) {
      const functionCFNFile = context.amplify.readJsonFile(functionCFNFilePath);

      functionCFNFile.Outputs.LambdaExecutionRole = {
        Value: {
          Ref: 'LambdaExecutionRole',
        },
      };

      // Update the functions resource
      const functionCFNString = JSON.stringify(functionCFNFile, null, 4);

      fs.writeFileSync(functionCFNFilePath, functionCFNString, 'utf8');

      printer.success(`Successfully updated resource ${functionName} locally`);
    }
}

**/

//Has to Stay
async function createNewLambdaAndUpdateCFN( context: $TSContext, _policyUUID : string ) : Promise<string>{
    const targetDir = context.amplify.pathManager.getBackendDirPath();
    const newShortUUID = buildShortUUID();
    const newFunctionName = `S3Trigger${newShortUUID}`;
    const pluginDir = __dirname;

    const defaults = {
      functionName: `${newFunctionName}`,
      roleName: `${newFunctionName}LambdaRole${newShortUUID}`,
    };

    const copyJobs = [
      {
        dir: pluginDir,
        template: path.join('..', '..', '..', '..', 'resources', 'triggers', 's3', 'lambda-cloudformation-template.json.ejs'),
        target: path.join(targetDir, 'function', newFunctionName, `${newFunctionName}-cloudformation-template.json`),
      },
      {
        dir: pluginDir,
        template: path.join('..', '..', '..', '..', 'resources', 'triggers', 's3', 'event.json'),
        target: path.join(targetDir, 'function', newFunctionName, 'src', 'event.json'),
      },
      {
        dir: pluginDir,
        template: path.join('..', '..', '..', '..', 'resources', 'triggers', 's3', 'index.js'),
        target: path.join(targetDir, 'function', newFunctionName, 'src', 'index.js'),
      },
      {
        dir: pluginDir,
        template: path.join('..', '..', '..', '..', 'resources', 'triggers', 's3', 'package.json.ejs'),
        target: path.join(targetDir, 'function', newFunctionName, 'src', 'package.json'),
      },
    ];

    // copy over the files
    await context.amplify.copyBatch(context, copyJobs, defaults);

    // Update amplify-meta and backend-config
    const backendConfigs = {
      service: FunctionServiceNameLambdaFunction,
      providerPlugin: 'awscloudformation',
      build: true,
    };

    await context.amplify.updateamplifyMetaAfterResourceAdd('function', newFunctionName, backendConfigs);

    printer.success(`Successfully added resource ${newFunctionName} locally`);

    return newFunctionName;
}

async function getExistingFunctionsForTrigger( context: $TSContext,
                                               excludeFunctionName: string | undefined ,
                                               isInteractive: boolean) : Promise<Array<string>>{
  let lambdaResourceNames : Array<string> = await getLambdaFunctions(context);
  if (excludeFunctionName) {
    lambdaResourceNames = lambdaResourceNames.filter((lambdaResource: any) => lambdaResource !== excludeFunctionName);
  }

  if (lambdaResourceNames.length === 0 && isInteractive) {
    throw new Error("No functions were found in the project. Use 'amplify add function' to add a new function.");
  }
  return lambdaResourceNames;
}

/*
*  askAndOpenFunctionEditor
** Ask user if they want to edit the function,
** Open the function's index.js in the editor
*/
async function askAndOpenFunctionEditor( context: $TSContext, functionName : string ){
  const targetDir = context.amplify.pathManager.getBackendDirPath();
  if (await context.amplify.confirmPrompt(`Do you want to edit the local ${functionName} lambda function now?`)) {
    await context.amplify.openEditor(context, `${targetDir}/function/${functionName}/src/index.js`);
  }
}

//Delete Old Trigger Function from Storage CFN
function removeOldTriggerFunctionStorageCFN( storageCFNFile: $TSAny , oldTriggerFunction:string): $TSAny{
      delete storageCFNFile.Parameters[`function${oldTriggerFunction}Arn`];
      delete storageCFNFile.Parameters[`function${oldTriggerFunction}Name`];
      delete storageCFNFile.Parameters[`function${oldTriggerFunction}LambdaExecutionRole`];
      return storageCFNFile;
}

//Add New Trigger Function into Storage CFN
function addNewTriggerFunctionStorageCFNParameters( storageCFNFile: $TSAny , newTriggerFunction:string , oldTriggerFunction:string|undefined): $TSAny {

      if (oldTriggerFunction) {
        storageCFNFile = removeOldTriggerFunctionStorageCFN(storageCFNFile, oldTriggerFunction);
      }

      storageCFNFile.Parameters[`function${newTriggerFunction}Arn`] = {
        Type: 'String',
        Default: `function${newTriggerFunction}Arn`,
      };

      storageCFNFile.Parameters[`function${newTriggerFunction}Name`] = {
        Type: 'String',
        Default: `function${newTriggerFunction}Name`,
      };

      storageCFNFile.Parameters[`function${newTriggerFunction}LambdaExecutionRole`] = {
        Type: 'String',
        Default: `function${newTriggerFunction}LambdaExecutionRole`,
      };

      storageCFNFile.Parameters.triggerFunction = {
        Type: 'String',
      };
}

function saveDependsOnToAmplifyMeta( context : $TSContext, amplifyMetaFile: $TSAny, resourceName : string, newTriggerFunctionName: string ){
  const dependsOnResources = amplifyMetaFile.storage[resourceName].dependsOn;
  dependsOnResources.push({
    category: 'function',
    resourceName: newTriggerFunctionName,
    attributes: ['Name', 'Arn', 'LambdaExecutionRole'],
  });
  context.amplify.updateamplifyMetaAfterResourceUpdate(category, resourceName, 'dependsOn', dependsOnResources);

}

//StorageCFN Functions
function addNewTriggerFunctionInS3TriggerBucketPolicyRoles(storageCFNFile : $TSAny,
                                                 newTriggerFunctionName : string,
                                                 oldTriggerFunctionName : string|undefined){
  if ( oldTriggerFunctionName ) {
    //Replace function in roles
    storageCFNFile.Resources.S3TriggerBucketPolicy.Properties.Roles.forEach((role: any) => {
      if (role.Ref.includes(oldTriggerFunctionName)) {
        role.Ref = `function${newTriggerFunctionName}LambdaExecutionRole`;
      }
    });
  } else {
    //Add function in roles
    storageCFNFile.Resources.S3TriggerBucketPolicy.Properties.Roles.push({
      Ref: `function${newTriggerFunctionName}LambdaExecutionRole`,
    });
  }

  return storageCFNFile;
}


function addTriggerPermissionsInS3BucketDependsOn(storageCFNFile : $TSAny ){
  storageCFNFile.Resources.S3Bucket.DependsOn.push('TriggerPermissions');
}

function addFunctionInTriggerPermissions(storageCFNFile : $TSAny, functionName : string){
      storageCFNFile.Resources.TriggerPermissions.Properties.FunctionName.Ref = `function${functionName}Name`;
      return storageCFNFile;
}

function updateNotificationConfigurationFunction( storageCFNFile : $TSAny , newFunctionName : string) {
  let lambdaConfigurations = storageCFNFile.Resources.S3Bucket.Properties.NotificationConfiguration.LambdaConfigurations;
  lambdaConfigurations = lambdaConfigurations.concat(
        getTriggersForLambdaConfiguration('private', newFunctionName),
        getTriggersForLambdaConfiguration('protected', newFunctionName),
        getTriggersForLambdaConfiguration('public', newFunctionName),
      );
  storageCFNFile.Resources.S3Bucket.Properties.NotificationConfiguration.LambdaConfigurations = lambdaConfigurations;
  return storageCFNFile; //updated with new notification lambda function
}

export enum S3CLITriggerFlow{
  ADD  = "TRIGGER_ADD_FLOW",
  UPDATE = "TRIGGER_UPDATE_FLOW",
  REMOVE = "TRIGGER_REMOVE_FLOW"
}

export enum S3CLITriggerStateEvent {
  ADD_NEW_TRIGGER = "ADD_NEW_TRIGGER", //no trigger exists, need to be added in cloudformation
  REPLACE_TRIGGER = "REPLACE_TRIGGER", //trigger exists, (delete old trigger, add new trigger)
  DELETE_TRIGGER  = "DELETE_TRIGGER",   //delete existing trigger from s3 cloudformation and delete file
  ERROR = "TRIGGER_ERROR", //This state change is not allowed
  NO_OP = "TRIGGER_NO_OP"  //No change required here
}

export enum S3CLITriggerUpdateMenuOptions {
  ADD = 'Add the Trigger',
  UPDATE = 'Update the Trigger',
  REMOVE = 'Remove the trigger',
  SKIP   = 'Skip Question'
}

//Based on the Trigger-flow initiated and received parameters, we infer the CLI Trigger state change to handle
function getCLITriggerStateEvent(triggerFlowType: S3CLITriggerFlow, existingTriggerFunction: string|undefined){
  if (triggerFlowType === S3CLITriggerFlow.ADD) {
    if(existingTriggerFunction){
      return S3CLITriggerStateEvent.ERROR; //ERROR:Adding a new function when a trigger already exists
    } else {
      return S3CLITriggerStateEvent.ADD_NEW_TRIGGER;
    }
  } else {
    if ( triggerFlowType === S3CLITriggerFlow.UPDATE ){
      return S3CLITriggerStateEvent.REPLACE_TRIGGER; //Update function should ask for existing or new function to be added
    } else { //REMOVE Flow
      if( existingTriggerFunction ){
        return S3CLITriggerStateEvent.DELETE_TRIGGER;
      } else {
        return S3CLITriggerStateEvent.NO_OP;
      }
    }
  }
}

//Interactive: Create new function and display "open file in editor" prompt
async function interactiveCreateNewLambdaAndUpdateCFN(context : $TSContext, policyID : string){
  const newTriggerFunction = await createNewLambdaAndUpdateCFN( context, policyID );
  await askAndOpenFunctionEditor( context, newTriggerFunction );
  return newTriggerFunction;
}

//Interactive: Allow Cx to Select existing function
async function interactiveAddExistingLambdaAndUpdateCFN(context : $TSContext,
                                                        existingTriggerFunction : string|undefined = undefined,
                                                        existingLambdaResources : Array<string>|undefined = undefined){
   //Get all available lambdas - [ exclude the existing triggerFunction ]
   //note:- In an [update storage + Add trigger flow] , the existing lambda resources are already read and passed into this function.
   let lambdaResources = (existingLambdaResources)?existingLambdaResources :
                         await getExistingFunctionsForTrigger(context, existingTriggerFunction, true);
   //Select the function to add trigger
   const selectedFunction = await askSelectExistingFunctionToAddTrigger( lambdaResources );
   //User selected the currently configured trigger function. Hence CFN not updated.
   return selectedFunction;
}

//Interaive : Ask Cx to select existing or new function and call downstream interactive functions
async function interactiveAskTriggerTypeFlow(context : $TSContext , policyID : string,
                                             existingTriggerFunction : string|undefined,
                                             existingLambdaResources : Array<string>|undefined = undefined){
  const triggerTypeAnswer : S3TriggerFunctionType = await askTriggerFunctionTypeQuestion();
  switch(triggerTypeAnswer){
      case S3TriggerFunctionType.EXISTING_FUNCTION:
        const selectedFunction = await interactiveAddExistingLambdaAndUpdateCFN( context,
                                                                                 existingTriggerFunction,
                                                                                 existingLambdaResources);
        return selectedFunction;
      case S3TriggerFunctionType.NEW_FUNCTION:
        console.log("SACPCDEBUG:addTrigger: UPDATING Storage with new Trigger function")
        //Create a new lambda trigger and update cloudformation
        const newTriggerFunction = await interactiveCreateNewLambdaAndUpdateCFN( context, policyID );
        return newTriggerFunction;
  } //Existing function or New function
  return undefined;
}

/*
When updating
Remove the old trigger
Add a new one
*/
export async function addTrigger( triggerFlowType: S3CLITriggerFlow,
                                  context: $TSContext,
                                  resourceName: string,
                                  policyID: string,
                                  existingTriggerFunction: string|undefined) : Promise<string|undefined> {
      const triggerStateEvent = getCLITriggerStateEvent( triggerFlowType, existingTriggerFunction );
      let triggerFunction : string|undefined = existingTriggerFunction;
      switch( triggerStateEvent ) {
          case  S3CLITriggerStateEvent.ERROR :
            throw new Error("Lambda Trigger is already enabled, please use 'amplify update storage'")
          case S3CLITriggerStateEvent.ADD_NEW_TRIGGER :
            // Check if functions exist and if exists, ask if Cx wants to use existing or create new
            let existingLambdaResources = await getExistingFunctionsForTrigger(context, existingTriggerFunction, false);
            if (existingLambdaResources && existingLambdaResources.length > 0 ){
              triggerFunction = await interactiveAskTriggerTypeFlow( context, policyID,
                                                                     existingTriggerFunction,
                                                                     existingLambdaResources);
            } else {
              //add a new function
               triggerFunction = await interactiveCreateNewLambdaAndUpdateCFN( context, policyID );
            }
            break
          case S3CLITriggerStateEvent.REPLACE_TRIGGER :
            triggerFunction = await interactiveAskTriggerTypeFlow(context, policyID,existingTriggerFunction);
            break
          case S3CLITriggerStateEvent.DELETE_TRIGGER:
            triggerFunction = undefined; // no trigger function.
            break
      } // END - TriggerState event
      return triggerFunction;
}

async function getLambdaFunctions(context: any) {
  const { allResources } = await context.amplify.getResourceStatus();
  const lambdaResources = allResources
    .filter((resource: any) => resource.service === FunctionServiceNameLambdaFunction)
    .map((resource: any) => resource.resourceName);

  return lambdaResources;
}

function createPermissionKeys(userType: any, answers: any, selectedPermissions: any) {
  const [policyId] = uuid().split('-');

  // max arrays represent highest possibly privileges for particular S3 keys
  const maxPermissions = ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'];
  const maxPublic = maxPermissions;
  const maxUploads = ['s3:PutObject'];
  const maxPrivate = userType ===  S3UserAccessRole.AUTH ? maxPermissions : [];
  const maxProtected = userType === S3UserAccessRole.AUTH ? maxPermissions : ['s3:GetObject'];

  function addPermissionKeys(key: any, possiblePermissions: any) {
    const permissions = _.intersection(selectedPermissions, possiblePermissions).join();

    answers[`s3Permissions${userType}${key}`] = !permissions ? AmplifyBuildParamsPermissions.DISALLOW : permissions;
    answers[`s3${key}Policy`] = `${key}_policy_${policyId}`;
  }

  addPermissionKeys('Public', maxPublic);
  addPermissionKeys('Uploads', maxUploads);

  if (userType !== 'Guest') {
    addPermissionKeys('Protected', maxProtected);
    addPermissionKeys('Private', maxPrivate);
  }

  answers[`${userType}AllowList`] = selectedPermissions.includes('s3:GetObject') ? 'ALLOW' : AmplifyBuildParamsPermissions.DISALLOW;
  answers.s3ReadPolicy = `read_policy_${policyId}`;

  // double-check to make sure guest is denied
  if (answers.storageAccess !== 'authAndGuest') {
    answers.s3PermissionsGuestPublic = AmplifyBuildParamsPermissions.DISALLOW;
    answers.s3PermissionsGuestUploads = AmplifyBuildParamsPermissions.DISALLOW;
    answers.GuestAllowList = AmplifyBuildParamsPermissions.DISALLOW;
  }
}

function removeAuthUnauthAccess(answers: any) {
  answers.s3PermissionsGuestPublic = AmplifyBuildParamsPermissions.DISALLOW;
  answers.s3PermissionsGuestUploads = AmplifyBuildParamsPermissions.DISALLOW;
  answers.GuestAllowList = AmplifyBuildParamsPermissions.DISALLOW;
  answers.s3PermissionsAuthenticatedPublic = AmplifyBuildParamsPermissions.DISALLOW;
  answers.s3PermissionsAuthenticatedProtected = AmplifyBuildParamsPermissions.DISALLOW;
  answers.s3PermissionsAuthenticatedPrivate = AmplifyBuildParamsPermissions.DISALLOW;
  answers.s3PermissionsAuthenticatedUploads = AmplifyBuildParamsPermissions.DISALLOW;
  answers.AuthenticatedAllowList = AmplifyBuildParamsPermissions.DISALLOW;
}

export const resourceAlreadyExists = (context: any) => {
  const { amplify } = context;
  const { amplifyMeta } = amplify.getProjectDetails();
  let resourceName;

  if (amplifyMeta[category]) {
    const categoryResources = amplifyMeta[category];

    Object.keys(categoryResources).forEach(resource => {
      if (categoryResources[resource].service === serviceName) {
        resourceName = resource;
      }
    });
  }

  return resourceName;
};

export const checkIfAuthExists = (context: any) => {
  const { amplify } = context;
  const { amplifyMeta } = amplify.getProjectDetails();
  let authExists = false;
  const authServiceName = 'Cognito';
  const authCategory = 'auth';

  if (amplifyMeta[authCategory] && Object.keys(amplifyMeta[authCategory]).length > 0) {
    const categoryResources = amplifyMeta[authCategory];

    Object.keys(categoryResources).forEach(resource => {
      if (categoryResources[resource].service === authServiceName) {
        authExists = true;
      }
    });
  }
  return authExists;
};

function migrateCategory(context: any, projectPath: any, resourceName: any){
  const resourceDirPath = path.join(projectPath, 'amplify', 'backend', category, resourceName);

  // Change CFN file

  const cfnFilePath = path.join(resourceDirPath, 's3-cloudformation-template.json');
  const oldCfn = context.amplify.readJsonFile(cfnFilePath);
  const newCfn = {};

  Object.assign(newCfn, oldCfn);

  // Add env parameter
  if (!(newCfn as any).Parameters) {
    (newCfn as any).Parameters = {};
  }

  (newCfn as any).Parameters.env = {
    Type: 'String',
};

  // Add conditions block
  if (!(newCfn as any).Conditions) {
    (newCfn as any).Conditions = {};
  }

  (newCfn as any).Conditions.ShouldNotCreateEnvResources = {
    'Fn::Equals': [
        {
            Ref: 'env',
        },
        'NONE',
    ],
};

  // Add if condition for resource name change
(newCfn as any).Resources.S3Bucket.Properties.BucketName = {
    'Fn::If': [
        'ShouldNotCreateEnvResources',
        {
            Ref: 'bucketName',
        },
        {
            'Fn::Join': [
                '',
                [
                    {
                        Ref: 'bucketName',
                    },
                    {
                        'Fn::Select': [
                            3,
                            {
                                'Fn::Split': [
                                    '-',
                                    {
                                        Ref: 'AWS::StackName',
                                    },
                                ],
                            },
                        ],
                    },
                    '-',
                    {
                        Ref: 'env',
                    },
                ],
            ],
        },
    ],
};

  let jsonString = JSON.stringify(newCfn, null, '\t');

  fs.writeFileSync(cfnFilePath, jsonString, 'utf8');

  // Change Parameters file
  const parametersFilePath = path.join(resourceDirPath, parametersFileName);
  const oldParameters = context.amplify.readJsonFile(parametersFilePath, 'utf8');
  const newParameters = {};

  Object.assign(newParameters, oldParameters);

  (newParameters as any).authRoleName = {
    Ref: 'AuthRoleName',
};

  (newParameters as any).unauthRoleName = {
    Ref: 'UnauthRoleName',
};

  jsonString = JSON.stringify(newParameters, null, '\t');

  fs.writeFileSync(parametersFilePath, jsonString, 'utf8');
};

function convertToCRUD(parameters: any, answers: any) {
  if (parameters.unauthPermissions === 'r') {
    answers.selectedGuestPermissions = ['s3:GetObject', 's3:ListBucket'];
    createPermissionKeys('Guest', answers, answers.selectedGuestPermissions);
  }

  if (parameters.unauthPermissions === 'rw') {
    answers.selectedGuestPermissions = ['s3:GetObject', 's3:ListBucket', 's3:PutObject', 's3:DeleteObject'];
    createPermissionKeys('Guest', answers, answers.selectedGuestPermissions);
  }

  if (parameters.authPermissions === 'r') {
    answers.selectedAuthenticatedPermissions = ['s3:GetObject', 's3:ListBucket'];
    createPermissionKeys('Authenticated', answers, answers.selectedAuthenticatedPermissions);
  }

  if (parameters.authPermissions === 'rw') {
    answers.selectedAuthenticatedPermissions = ['s3:GetObject', 's3:ListBucket', 's3:PutObject', 's3:DeleteObject'];
    createPermissionKeys('Authenticated', answers, answers.selectedAuthenticatedPermissions);
  }
}

export const getIAMPolicies = (resourceName: any, crudOptions: any) => {
  let policy = [];
  let actions = new Set();

  crudOptions.forEach((crudOption: any) => {
    switch (crudOption) {
      case 'create':
        actions.add('s3:PutObject');
        break;
      case 'update':
        actions.add('s3:PutObject');
        break;
      case 'read':
        actions.add('s3:GetObject');
        actions.add('s3:ListBucket');
        break;
      case 'delete':
        actions.add('s3:DeleteObject');
        break;
      default:
        console.log(`${crudOption} not supported`);
    }
  });

  // @ts-expect-error ts-migrate(2740) FIXME: Type 'unknown[]' is missing the following properti... Remove this comment to see the full error message
  actions = Array.from(actions);
  if ((actions as any).includes('s3:ListBucket')) {
    let listBucketPolicy = {};
    listBucketPolicy = {
      Effect: 'Allow',
      Action: 's3:ListBucket',
      Resource: [
        {
          'Fn::Join': [
            '',
            [
              'arn:aws:s3:::',
              {
                Ref: `${category}${resourceName}BucketName`,
              },
            ],
          ],
        },
      ],
    };
    actions = (actions as any).filter((action: any) => action != 's3:ListBucket');
    policy.push(listBucketPolicy);
  }
  let s3ObjectPolicy = {
    Effect: 'Allow',
    Action: actions,
    Resource: [
      {
        'Fn::Join': [
          '',
          [
            'arn:aws:s3:::',
            {
              Ref: `${category}${resourceName}BucketName`,
            },
            '/*',
          ],
        ],
      },
    ],
  };
  policy.push(s3ObjectPolicy);
  const attributes = ['BucketName'];

  return { policy, attributes };
};

function getTriggersForLambdaConfiguration(protectionLevel: any, functionName: any) {
  const triggers = [
    {
      Event: 's3:ObjectCreated:*',
      Filter: {
        S3Key: {
          Rules: [
            {
              Name: 'prefix',
              Value: {
                'Fn::Join': [
                  '',
                  [
                    `${protectionLevel}/`,
                    {
                      Ref: 'AWS::Region',
                    },
                  ],
                ],
              },
            },
          ],
        },
      },
      Function: {
        Ref: `function${functionName}Arn`,
      },
    },
    {
      Event: 's3:ObjectRemoved:*',
      Filter: {
        S3Key: {
          Rules: [
            {
              Name: 'prefix',
              Value: {
                'Fn::Join': [
                  '',
                  [
                    `${protectionLevel}/`,
                    {
                      Ref: 'AWS::Region',
                    },
                  ],
                ],
              },
            },
          ],
        },
      },
      Function: {
        Ref: `function${functionName}Arn`,
      },
    },
  ];
  return triggers;
}


module.exports = {
  addWalkthrough,
  updateWalkthrough,
  migrate: migrateCategory,
  getIAMPolicies,
};

