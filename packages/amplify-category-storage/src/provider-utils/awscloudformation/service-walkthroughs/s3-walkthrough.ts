import * as inquirer from 'inquirer';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';
import _ from 'lodash';
import uuid from 'uuid';
import { printer } from 'amplify-prompts';
import { ResourceDoesNotExistError, ResourceAlreadyExistsError, exitOnNextTick, $TSAny, $TSContext, AmplifyCategories } from 'amplify-cli-core';
import { S3CFNPermissionMapType, S3CLIWalkthroughParams, S3InputState, S3InputStateOptions, S3PermissionMapType } from './s3-user-input-state';
import { pathManager } from 'amplify-cli-core';
import { AmplifyS3ResourceInputParameters } from '../cdk-stack-builder/types';
import { S3ResourceParameters } from '../import/types';
import { S3AccessType, S3UserInputs, S3TriggerFunctionType, S3PermissionType } from '../service-walkthrough-types/s3-user-input-types';
import { AmplifyS3ResourceStackTransform } from  '../cdk-stack-builder/s3-stack-transform'
import { askAndInvokeAuthWorkflow, askResourceNameQuestion, askBucketNameQuestion,
         askWhoHasAccessQuestion, askCRUDQuestion, askUserPoolGroupPermissionSelectionQuestion,
         askUserPoolGroupSelectionQuestion,
         askUpdateTriggerSelection,
         askAuthPermissionQuestion,
         conditionallyAskGuestPermissionQuestion,
         permissionMap,
         askUserPoolGroupSelectionUntilPermissionSelected} from './s3-questions';
import { printErrorAlreadyCreated, printErrorNoResourcesToUpdate } from './s3-errors';


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

function buildPolicyID(){
  const [shortId] = uuid().split('-');
  return shortId;
}

async function addWalkthrough(context: $TSContext, defaultValuesFilename: string){
  console.log("SACPCDEBUG:1: defaultValuesFilename: " , defaultValuesFilename );
  const { amplify } = context;
  const { amplifyMeta } = amplify.getProjectDetails();
  console.log("SACPCDEBUG:2: amplifyMeta: " , JSON.stringify(amplifyMeta, null, 2) );

  //First ask customers to configure Auth on the S3 resource, invoke auth workflow
  await askAndInvokeAuthWorkflow(context);
  const defaultValues = loadS3DefaultValues(context, defaultValuesFilename);
  const resourceName = await getS3ResourceName( context , amplifyMeta );

  if (resourceName) {
    await printErrorAlreadyCreated(context);
    exitOnNextTick(0);
  } else {
    //Ask S3 walkthrough questions
    const policyID = buildPolicyID(); //prefix/suffix for all resources.
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
      triggerFunction : triggerFunction,
      groupAccess : undefined,
      groupList: undefined
    }

    //Save CLI Inputs payload
    const cliInputsState = new S3InputState(cliInputs.resourceName as string, cliInputs);
    cliInputsState.saveCliInputPayload();
    //Generate Cloudformation
    const stackGenerator = new AmplifyS3ResourceStackTransform(cliInputs.resourceName as string);
    stackGenerator.transform();
    return cliInputs.resourceName;
  }
};


async function  updateWalkthrough(context: any, defaultValuesFilename: any, serviceMetada: any){
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
      const defaultValues = loadS3DefaultValues(context, defaultValuesFilename);
      let cliInputsState = new S3InputState(resourceName, undefined);
      const previousUserInput  = cliInputsState.getUserInput();
      let cliInputs : S3UserInputs= Object.assign({}, previousUserInput); //overwrite this with updated params

      //Ask S3 walkthrough questions
      const storageAccess = await askWhoHasAccessQuestion( context, previousUserInput ); //Auth/Guest
      const authAccess = await askAuthPermissionQuestion(context, previousUserInput);
      const guestAccess = await conditionallyAskGuestPermissionQuestion( storageAccess, context, previousUserInput);
      const triggerFunction = await  startUpdateTriggerFunctionFlow( context, resourceName,
                                                                     previousUserInput.policyUUID as string,
                                                                     previousUserInput.triggerFunction );

      //Build userInputs for S3 resources
      cliInputs.storageAccess = storageAccess;
      cliInputs.authAccess = authAccess;
      cliInputs.guestAccess = guestAccess;
      cliInputs.triggerFunction = triggerFunction;

      //Save CLI Inputs payload
      cliInputsState.saveCliInputPayload();
      //Generate Cloudformation
      const stackGenerator = new AmplifyS3ResourceStackTransform(cliInputs.resourceName as string);
      stackGenerator.transform();
      return cliInputs.resourceName;
  }
};



function loadS3DefaultValues(context : $TSContext, defaultValuesFilename : string ){
  const { amplify } = context;
  const defaultValuesSrc = path.join(__dirname, '..', 'default-values', defaultValuesFilename);
  const { getAllDefaults } = require(defaultValuesSrc);
  return getAllDefaults(amplify.getProjectDetails());
}

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
  const { amplify } = context;
  let triggerFunction = existingTriggerFunction;

  //Update Trigger Flow
  let continueWithTriggerOperationQuestion = true;
  do {
      const triggerOperationAnswer = await askUpdateTriggerSelection();
      switch (triggerOperationAnswer) {
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
            await removeTrigger(context, resourceName, triggerFunction);
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
  console.log("ZACKPCDEBUG: StorageResources: ", storageResources );
  if ( storageResources ) {
    if (Object.keys(storageResources).length === 0) {
      return undefined;
    }
    const [resourceName] = Object.keys(storageResources); //only one resource is allowed
    return resourceName
  }
  return undefined;
}

/*************

async function configure(context: $TSContext, defaultValuesFilename: string,
                         serviceMetadata: any, resourceName: string|undefined,
                         options: S3CLIWalkthroughParams|undefined) {
  const { amplify } = context;
  let { inputs } = serviceMetadata;
  const defaultValuesSrc = path.join(__dirname, '..', 'default-values', defaultValuesFilename);
  const { getAllDefaults } = require(defaultValuesSrc);

  const defaultValues = getAllDefaults(amplify.getProjectDetails());
  const projectBackendDirPath = context.amplify.pathManager.getBackendDirPath();
  let parameters : AmplifyS3ResourceInputParameters  = {};

  let userInputs : S3UserInputs|undefined = undefined;
  let cliInputState : S3InputState;

  //Update workflow
  if (resourceName) {
    //read previously generated user inputs
    cliInputState = S3InputState.getInstance({ resourceName });
    userInputs = cliInputState.getUserInput();

    inputs = inputs.filter((input: any) => input.key !== 'resourceName');
    const resourceDirPath = path.join(projectBackendDirPath, category, resourceName);
    const parametersFilePath = path.join(resourceDirPath, parametersFileName);
    try {
      parameters = amplify.readJsonFile(parametersFilePath);
    } catch (e) {
      parameters = {};
    }
    parameters.resourceName = resourceName;
    Object.assign(defaultValues, parameters);
  }

  const userPoolGroupList = await context.amplify.getUserPoolGroupList(context);
  const permissionSelected = await askUserPoolGroupSelectionUntilPermissionSelected(context);
  let allowUnauthenticatedIdentities; // default to undefined since if S3 does not require unauth access the IdentityPool can still have that enabled

  let answers = {};
  if (permissionSelected === 'Both' || permissionSelected === 'Auth/Guest Users') {
    const whoHasAccess = await askWhoHasAccessQuestion( context, defaultValues );

    // auth permissions
    const selectedAuthenticatedPermissions = await askWhatKindOfAccess('Authenticated', context, answers, parameters);
    let selectedGuestPermissions = undefined;
    if (whoHasAccess === 'authAndGuest') {
      selectedGuestPermissions = await askWhatKindOfAccess('Guest', context, answers, parameters);
      allowUnauthenticatedIdentities = true;
    }
  }

  if (permissionSelected === 'Both' || permissionSelected === 'Individual Groups') {
    if (permissionSelected === 'Individual Groups') {
      removeAuthUnauthAccess(answers);
    }

    let defaultSelectedGroups: any = [];

    if (userInputs) {
      defaultSelectedGroups = userInputs.groupList;
    }
    const selectedUserPoolGroupList : string[] = await askUserPoolGroupSelectionQuestion( userPoolGroupList, defaultSelectedGroups)


    const groupPermissionMap = {};
    const groupPolicyMap = {};

    for (let i = 0; i < selectedUserPoolGroupList.length; i += 1) {
      let defaults = [];

      if (storageParams && (storageParams as any).groupPermissionMap) {
        defaults = (storageParams as any).groupPermissionMap[selectedUserPoolGroupList[i]];
      }

      const whatKindOfGroupAccess = await askCRUDQuestion( selectedUserPoolGroupList[i], context, defaults);

      // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      groupPermissionMap[selectedUserPoolGroupList[i]] = whatKindOfGroupAccess.permissions;
      // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      groupPolicyMap[selectedUserPoolGroupList[i]] = whatKindOfGroupAccess.policies;
    }

    // Get auth resources

    let authResources = (await context.amplify.getResourceStatus('auth')).allResources;

    authResources = authResources.filter((resource: any) => resource.service === 'Cognito');

    if (authResources.length === 0) {
      throw new Error('No auth resource found. Please add it using amplify add auth');
    }

    const authResourceName = authResources[0].resourceName;

    // add to storage params
(storageParams as any).groupPermissionMap = groupPermissionMap;

    if (!resourceName) {
      // add to depends
      if (!options.dependsOn) {
        options.dependsOn = [];
      }

      options.dependsOn.push({
        category: 'auth',
        resourceName: authResourceName,
        attributes: ['UserPoolId'],
      });

      selectedUserPoolGroupList.forEach((group: any) => {
        options.dependsOn.push({
          category: 'auth',
          resourceName: 'userPoolGroups',
          attributes: [`${group}GroupRole`],
        });
      });
      // add to props

      defaultValues.authResourceName = authResourceName;
      defaultValues.groupList = selectedUserPoolGroupList;
      defaultValues.groupPolicyMap = groupPolicyMap;
    } else {
      // In the update flow
      await updateCfnTemplateWithGroups(
        context,
        defaultSelectedGroups,
        selectedUserPoolGroupList,
        groupPolicyMap,
        resourceName,
        authResourceName,
      );
    }
  }



  // Ask Lambda trigger question

  if (!parameters || !(parameters as any).triggerFunction || (parameters as any).triggerFunction === 'NONE') {
    if (await amplify.confirmPrompt('Do you want to add a Lambda Trigger for your S3 Bucket?', false)) {
      try {
        (answers as any).triggerFunction = await addTrigger(context, (parameters as any).resourceName, undefined, (parameters as any).adminTriggerFunction, options);
      } catch (e) {
        printer.error(e.message);
      }
    } else {
      (answers as any).triggerFunction = 'NONE';
    }
  } else {
    const triggerOperationQuestion = {
      type: 'list',
      name: 'triggerOperation',
      message: 'Select from the following options',
      choices: ['Update the Trigger', 'Remove the trigger', 'Skip Question'],
    };

    let continueWithTriggerOperationQuestion = true;

    while (continueWithTriggerOperationQuestion) {
      const triggerOperationAnswer = await inquirer.prompt([triggerOperationQuestion]);

      switch (triggerOperationAnswer.triggerOperation) {
        case 'Update the Trigger': {
          try {
            (answers as any).triggerFunction = await addTrigger(context, (parameters as any).resourceName, (parameters as any).triggerFunction, (parameters as any).adminTriggerFunction, options);
            continueWithTriggerOperationQuestion = false;
          } catch (e) {
            printer.error(e.message);
            continueWithTriggerOperationQuestion = true;
          }
          break;
        }
        case 'Remove the trigger': {
          (answers as any).triggerFunction = 'NONE';
          await removeTrigger(context, (parameters as any).resourceName, (parameters as any).triggerFunction);
          continueWithTriggerOperationQuestion = false;
          break;
        }
        case 'Skip Question': {
          if (!(parameters as any).triggerFunction) {
            (answers as any).triggerFunction = 'NONE';
          }
          continueWithTriggerOperationQuestion = false;
          break;
        }
        default:
          printer.error(`${triggerOperationAnswer.triggerOperation} not supported`);
      }
    }
  }

  const storageRequirements = { authSelections: 'identityPoolAndUserPool', allowUnauthenticatedIdentities };

  const checkResult = await context.amplify.invokePluginMethod(context, 'auth', undefined, 'checkRequirements', [
    storageRequirements,
    context,
    'storage',
    (answers as any).resourceName,
]);

  // If auth is imported and configured, we have to throw the error instead of printing since there is no way to adjust the auth
  // configuration.
  if (checkResult.authImported === true && checkResult.errors && checkResult.errors.length > 0) {
    throw new Error(checkResult.errors.join(os.EOL));
  }

  if (checkResult.errors && checkResult.errors.length > 0) {
    printer.warn(checkResult.errors.join(os.EOL));
  }

  // If auth is not imported and there were errors, adjust or enable auth configuration
  if (!checkResult.authEnabled || !checkResult.requirementsMet) {
    try {
      // If this is not set as requirement, then explicitly configure it to disabled.
      if (storageRequirements.allowUnauthenticatedIdentities === undefined) {
        storageRequirements.allowUnauthenticatedIdentities = false;
      }

      await context.amplify.invokePluginMethod(context, 'auth', undefined, 'externalAuthEnable', [
    context,
    category,
    (answers as any).resourceName,
    storageRequirements,
]);
    } catch (error) {
      printer.error(error);
      throw error;
    }
  }

  // At this point we have a valid auth configuration either imported or added/updated.

  Object.assign(defaultValues, answers);

  const resource = defaultValues.resourceName;
  const resourceDirPath = path.join(projectBackendDirPath, category, resource);

  fs.ensureDirSync(resourceDirPath);

  let props = { ...defaultValues };

  if (!(parameters as any).resourceName) {
    if (options) {
      props = { ...defaultValues, ...options };
    }
    // Generate CFN file on add
    await copyCfnTemplate( context, category, resource, props as S3CLIWalkthroughParams );
  }

  delete defaultValues.resourceName;
  delete defaultValues.storageAccess;
  delete defaultValues.groupPolicyMap;
  delete defaultValues.groupList;
  delete defaultValues.authResourceName;

  const parametersFilePath = path.join(resourceDirPath, parametersFileName);
  const jsonString = JSON.stringify(defaultValues, null, 4);

  fs.writeFileSync(parametersFilePath, jsonString, 'utf8');

  const storageParamsFilePath = path.join(resourceDirPath, storageParamsFileName);
  const storageParamsString = JSON.stringify(storageParams, null, 4);

  fs.writeFileSync(storageParamsFilePath, storageParamsString, 'utf8');

  return resource;
}
***/

//Generate CLIInputs.json
function saveCLIInputsData( options : S3CLIWalkthroughParams ){
  //create inputManager
  const props:S3InputStateOptions = S3InputState.cliWalkThroughToCliInputParams(options);
  const cliInputManager: S3InputState = S3InputState.getInstance( props );

  //save cliInputs.json
  cliInputManager.saveCliInputPayload(); //Save input data
}

async function copyCfnTemplate(context: $TSContext, categoryName: string, resourceName: string, options: S3CLIWalkthroughParams) {
  const { amplify } = context;
  const targetDir = amplify.pathManager.getBackendDirPath();
  const pluginDir = __dirname;
  saveCLIInputsData( options );

  const copyJobs = [
    {
      dir: pluginDir,
      template: path.join('..', '..', '..', '..', 'resources', 'cloudformation-templates', templateFileName),
      target: path.join(targetDir, categoryName, resourceName, 's3-cloudformation-template.json'),
    },
  ];

  // copy over the files
  return await context.amplify.copyBatch(context, copyJobs, options);
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
//Has to Stay
async function createNewLambdaAndUpdateCFN( context: $TSContext, policyUUID : string ) : Promise<string>{
    const targetDir = context.amplify.pathManager.getBackendDirPath();
    const newFunctionName = `S3Trigger${policyUUID}`;
    const pluginDir = __dirname;

    const defaults = {
      functionName: `${newFunctionName}`,
      roleName: `${newFunctionName}LambdaRole${policyUUID}`,
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

async function getExistingFunctionsForTrigger( context: $TSContext, excludeFunctionName: string | undefined ) : Promise<Array<string>>{
  let lambdaResourceNames : Array<string> = await getLambdaFunctions(context);
  if (excludeFunctionName) {
    lambdaResourceNames = lambdaResourceNames.filter((lambdaResource: any) => lambdaResource !== excludeFunctionName);
  }
  if (lambdaResourceNames.length === 0) {
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

export enum S3CLICognitoUserRole{
  AUTH = 'Authenticated',
  GUEST = 'Guest',
  GROUP = 'Group'
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
      if(existingTriggerFunction){
        return S3CLITriggerStateEvent.ERROR; //Adding a new function when a trigger already exists
      } else {
        return S3CLITriggerStateEvent.REPLACE_TRIGGER; //Update function should not be
      }
    } else { //REMOVE Flow
      if( existingTriggerFunction ){
        return S3CLITriggerStateEvent.DELETE_TRIGGER;
      } else {
        return S3CLITriggerStateEvent.NO_OP;
      }
    }
  }
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
      let functionName = undefined;
      const triggerStateEvent = getCLITriggerStateEvent( triggerFlowType , existingTriggerFunction );

      switch( triggerStateEvent ) {
          case  S3CLITriggerStateEvent.ERROR :
            throw new Error("Lambda Trigger is already enabled, please use 'amplify update storage'")
            break;
          case S3CLITriggerStateEvent.ADD_NEW_TRIGGER :
            // Create a new lambda trigger and update cloudformation
            functionName = await createNewLambdaAndUpdateCFN( context, policyID);
            await askAndOpenFunctionEditor( context, functionName );
            return functionName
          case S3CLITriggerStateEvent.REPLACE_TRIGGER :
            const triggerTypeAnswer : S3TriggerFunctionType = await askTriggerFunctionTypeQuestion();
            let lambdaResources = undefined;
            switch(triggerTypeAnswer){
                case S3TriggerFunctionType.EXISTING_FUNCTION:
                  //Get all available lambdas - [ exclude the existing triggerFunction ]
                  lambdaResources = await getExistingFunctionsForTrigger(context, existingTriggerFunction);
                  //Select the function to add trigger
                  const selectedFunction = await askSelectExistingFunctionToAddTrigger( lambdaResources );

                  //User selected the currently configured trigger function. Hence CFN not updated.
                  if ( selectedFunction === existingTriggerFunction) {
                    return existingTriggerFunction;
                  }
                  //remove existing trigger from CFN and add selectedFunction
                  await replaceLambdaTriggerInCFN(context, resourceName, existingTriggerFunction, selectedFunction);

                  //exportFunctionExecutionRoleInCFN(context, selectedFunction);
                  return selectedFunction;
                case S3TriggerFunctionType.NEW_FUNCTION:
                  //Create a new lambda trigger and update cloudformation
                  const newTriggerFunction = await createNewLambdaAndUpdateCFN( context, policyID );
                  await askAndOpenFunctionEditor( context, newTriggerFunction );
                  return newTriggerFunction;
            } //Existing function or New function
            break;
          case S3CLITriggerStateEvent.DELETE_TRIGGER:
                await deleteLambdaTriggerInCFN(context, resourceName, existingTriggerFunction);
                return undefined;

      } // END - TriggerState event

  }

//   // If updating an already existing S3 resource
//   if (resourceName) {
//     // Update Cloudformation file
//     const projectBackendDirPath = context.amplify.pathManager.getBackendDirPath();
//     const storageCFNFilePath = path.join(projectBackendDirPath, category, resourceName, 's3-cloudformation-template.json');
//     const amplifyMetaFilePath = path.join(projectBackendDirPath, amplifyMetaFilename);
//     const amplifyMetaFile = context.amplify.readJsonFile(amplifyMetaFilePath);
//     let storageCFNFile = context.amplify.readJsonFile(storageCFNFilePath);

//     //Add reference for the new functionName in CFN . (Remove reference to old triggerFunction if exists)
//     storageCFNFile = addNewTriggerFunctionStorageCFNParameters(storageCFNFile, functionName, existingTriggerFunction);
//     storageCFNFile = addNewTriggerFunctionInS3TriggerBucketPolicyRoles(storageCFNFile, functionName, existingTriggerFunction);

//     if (adminTriggerFunction && !existingTriggerFunction) {
//       storageCFNFile = addTriggerPermissionsInS3BucketDependsOn(storageCFNFile)
//       //Update Notification configuration
//       storageCFNFile = updateNotificationConfigurationFunction(storageCFNFile,functionName)

//       //Add functionName's Lambda Execution Role as dependency on Amplify-Meta
//       saveDependsOnToAmplifyMeta(context, amplifyMetaFile, resourceName, functionName);

//     } else if (adminTriggerFunction && existingTriggerFunction !== 'NONE') {
//       storageCFNFile = addFunctionInTriggerPermissions(storageCFNFile, functionName);

//       // eslint-disable-next-line max-len
//       storageCFNFile.Resources.S3Bucket.Properties.NotificationConfiguration.LambdaConfigurations.forEach((lambdaConf: any) => {
//         if (
//           !(typeof lambdaConf.Filter.S3Key.Rules[0].Value === 'string' && lambdaConf.Filter.S3Key.Rules[0].Value.includes('index-faces'))
//         ) {
//           lambdaConf.Function.Ref = `function${functionName}Arn`;
//         }
//       });

//       const dependsOnResources = amplifyMetaFile.storage[resourceName].dependsOn;

//       dependsOnResources.forEach((resource: any) => {
//         if (resource.resourceName === existingTriggerFunction) {
//           resource.resourceName = functionName;
//         }
//       });

//       context.amplify.updateamplifyMetaAfterResourceUpdate(category, resourceName, 'dependsOn', dependsOnResources);
//     } else {
//       storageCFNFile.Resources.S3Bucket.Properties.NotificationConfiguration = {
//         LambdaConfigurations: [
//           {
//             Event: 's3:ObjectCreated:*',
//             Function: {
//               Ref: `function${functionName}Arn`,
//             },
//           },
//           {
//             Event: 's3:ObjectRemoved:*',
//             Function: {
//               Ref: `function${functionName}Arn`,
//             },
//           },
//         ],
//       };

//       storageCFNFile.Resources.S3Bucket.DependsOn = ['TriggerPermissions'];

//       storageCFNFile.Resources.S3TriggerBucketPolicy = {
//         Type: 'AWS::IAM::Policy',
//         DependsOn: ['S3Bucket'],
//         Properties: {
//           PolicyName: 's3-trigger-lambda-execution-policy',
//           Roles: [
//             {
//               Ref: `function${functionName}LambdaExecutionRole`,
//             },
//           ],
//           PolicyDocument: {
//             Version: '2012-10-17',
//             Statement: [
//               {
//                 Effect: 'Allow',
//                 Action: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'],
//                 Resource: [
//                   {
//                     'Fn::Join': [
//                       '',
//                       [
//                         'arn:aws:s3:::',
//                         {
//                           Ref: 'S3Bucket',
//                         },
//                         '/*',
//                       ],
//                     ],
//                   },
//                 ],
//               },
//               {
//                 Effect: 'Allow',
//                 Action: 's3:ListBucket',
//                 Resource: [
//                   {
//                     'Fn::Join': [
//                       '',
//                       [
//                         'arn:aws:s3:::',
//                         {
//                           Ref: 'S3Bucket',
//                         },
//                       ],
//                     ],
//                   },
//                 ],
//               },
//             ],
//           },
//         },
//       };

//       // Update DependsOn
//       const dependsOnResources = amplifyMetaFile.storage[resourceName].dependsOn || [];

//       dependsOnResources.filter((resource: any) => {
//         return resource.resourceName !== existingTriggerFunction;
//       });

//       dependsOnResources.push({
//         category: 'function',
//         resourceName: functionName,
//         attributes: ['Name', 'Arn', 'LambdaExecutionRole'],
//       });

//       context.amplify.updateamplifyMetaAfterResourceUpdate(category, resourceName, 'dependsOn', dependsOnResources);
//     }

//     storageCFNFile.Resources.TriggerPermissions = {
//       Type: 'AWS::Lambda::Permission',
//       Properties: {
//         Action: 'lambda:InvokeFunction',
//         FunctionName: {
//           Ref: `function${functionName}Name`,
//         },
//         Principal: 's3.amazonaws.com',
//         SourceAccount: {
//           Ref: 'AWS::AccountId',
//         },
//         SourceArn: {
//           'Fn::Join': [
//             '',
//             [
//               'arn:aws:s3:::',
//               {
//                 'Fn::If': [
//                   'ShouldNotCreateEnvResources',
//                   {
//                     Ref: 'bucketName',
//                   },
//                   {
//                     'Fn::Join': [
//                       '',
//                       [
//                         {
//                           Ref: 'bucketName',
//                         },
//                         {
//                           'Fn::Select': [
//                             3,
//                             {
//                               'Fn::Split': [
//                                 '-',
//                                 {
//                                   Ref: 'AWS::StackName',
//                                 },
//                               ],
//                             },
//                           ],
//                         },
//                         '-',
//                         {
//                           Ref: 'env',
//                         },
//                       ],
//                     ],
//                   },
//                 ],
//               },
//             ],
//           ],
//         },
//       },
//     };

//     const storageCFNString = JSON.stringify(storageCFNFile, null, 4);

//     fs.writeFileSync(storageCFNFilePath, storageCFNString, 'utf8');
//   }

//   // else {
//   //   // New resource
//   //   if (!options.dependsOn) {
//   //     options.dependsOn = [];
//   //   }

//   //   // options.dependsOn.push({
//   //   //   category: 'function',
//   //   //   resourceName: functionName,
//   //   //   attributes: ['Name', 'Arn', 'LambdaExecutionRole'],
//   //   // });
//   // }

//   return functionName;
// }

async function getLambdaFunctions(context: any) {
  const { allResources } = await context.amplify.getResourceStatus();
  const lambdaResources = allResources
    .filter((resource: any) => resource.service === FunctionServiceNameLambdaFunction)
    .map((resource: any) => resource.resourceName);

  return lambdaResources;
}

async function askWhatKindOfAccess(userType: any, context: any, answers: any, parameters: any) {
  const defaults: any = [];

  if (parameters[`selected${userType}Permissions`]) {
    Object.values(permissionMap).forEach((el, index) => {
      if (el.every(i => parameters[`selected${userType}Permissions`].includes(i))) {
        defaults.push(Object.keys(permissionMap)[index]);
      }
    });
  }

  const selectedPermissions = await context.amplify.crudFlow(userType, permissionMap, defaults);

  createPermissionKeys(userType, answers, selectedPermissions);

  return selectedPermissions;
}

function createPermissionKeys(userType: any, answers: any, selectedPermissions: any) {
  const [policyId] = uuid().split('-');

  // max arrays represent highest possibly privileges for particular S3 keys
  const maxPermissions = ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'];
  const maxPublic = maxPermissions;
  const maxUploads = ['s3:PutObject'];
  const maxPrivate = userType === S3CLICognitoUserRole.AUTH ? maxPermissions : [];
  const maxProtected = userType === S3CLICognitoUserRole.AUTH ? maxPermissions : ['s3:GetObject'];

  function addPermissionKeys(key: any, possiblePermissions: any) {
    const permissions = _.intersection(selectedPermissions, possiblePermissions).join();

    answers[`s3Permissions${userType}${key}`] = !permissions ? 'DISALLOW' : permissions;
    answers[`s3${key}Policy`] = `${key}_policy_${policyId}`;
  }

  addPermissionKeys('Public', maxPublic);
  addPermissionKeys('Uploads', maxUploads);

  if (userType !== 'Guest') {
    addPermissionKeys('Protected', maxProtected);
    addPermissionKeys('Private', maxPrivate);
  }

  answers[`${userType}AllowList`] = selectedPermissions.includes('s3:GetObject') ? 'ALLOW' : 'DISALLOW';
  answers.s3ReadPolicy = `read_policy_${policyId}`;

  // double-check to make sure guest is denied
  if (answers.storageAccess !== 'authAndGuest') {
    answers.s3PermissionsGuestPublic = 'DISALLOW';
    answers.s3PermissionsGuestUploads = 'DISALLOW';
    answers.GuestAllowList = 'DISALLOW';
  }
}

function removeAuthUnauthAccess(answers: any) {
  answers.s3PermissionsGuestPublic = 'DISALLOW';
  answers.s3PermissionsGuestUploads = 'DISALLOW';
  answers.GuestAllowList = 'DISALLOW';

  answers.s3PermissionsAuthenticatedPublic = 'DISALLOW';
  answers.s3PermissionsAuthenticatedProtected = 'DISALLOW';
  answers.s3PermissionsAuthenticatedPrivate = 'DISALLOW';
  answers.s3PermissionsAuthenticatedUploads = 'DISALLOW';
  answers.AuthenticatedAllowList = 'DISALLOW';
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


function replaceLambdaTriggerInCFN(context: $TSContext, resourceName: string, existingTriggerFunction: string | undefined, selectedFunction: string) {
  throw new Error('Function not implemented.');
}


function deleteLambdaTriggerInCFN(context: $TSContext, resourceName: string, existingTriggerFunction: string | undefined) {
  throw new Error('Function not implemented.');
}