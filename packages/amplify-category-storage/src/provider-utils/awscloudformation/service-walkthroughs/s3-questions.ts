import * as inquirer from 'inquirer';
import { ResourceDoesNotExistError, ResourceAlreadyExistsError, exitOnNextTick, $TSAny, $TSContext } from 'amplify-cli-core';
import { printer } from 'amplify-prompts';
import _ from 'lodash';
import { getRoleAccessDefaultValues, S3AccessType, S3PermissionType, S3UserAccessRole, S3UserInputs } from '../service-walkthrough-types/s3-user-input-types';
import { checkIfAuthExists, addTrigger, S3CLITriggerUpdateMenuOptions } from './s3-walkthrough';
import { S3PermissionMapType } from './s3-user-input-state';
import { objectToCloudFormation } from '@aws-cdk/core';

export const permissionMap : S3PermissionMapType = {
    'create/update': [S3PermissionType.CREATE],
    read: [S3PermissionType.READ, S3PermissionType.LIST],
    delete: [S3PermissionType.DELETE],
  };

export function normalizePermissionsMapValue( permissionValue : Array<S3PermissionType>){
    if ( permissionValue.includes(S3PermissionType.READ) ){
      return S3PermissionType.READ;
    } else {
      return permissionValue[0];
    }
}
export function denormalizePermissions( permissionValue : Array<S3PermissionType> ){
  console.log("SACPCDEBUG: DENORMALIZATION : ", permissionValue );
  if ( permissionValue.includes(S3PermissionType.READ) ){
    permissionValue.push(S3PermissionType.LIST);
  }
  return permissionValue;
}

export const possibleCRUDOperations = Object.keys(permissionMap).map(el => ({ name: el,
                                                                              value: normalizePermissionsMapValue(permissionMap[el]) }));

export async function askAndInvokeAuthWorkflow(context: $TSContext){
    while (!checkIfAuthExists(context)) {
      if (
        await context.amplify.confirmPrompt(
          'You need to add auth (Amazon Cognito) to your project in order to add storage for user files. Do you want to add auth now?',
        )
      ) {
        await context.amplify.invokePluginMethod(context, 'auth', null, 'add', [context]);
        break;
      } else {
        context.usageData.emitSuccess();
        exitOnNextTick(0);
      }
    }
}

export async function askResourceNameQuestion(context: $TSContext, defaultValues: any): Promise<string> {
  const { amplify } = context;
  const question = [
    {
      type: 'input',
      name: 'resourceName',
      message: 'Please provide a friendly name for your resource that will be used to label this category in the project:',
      validate: amplify.inputValidation({
        validation: {
          operator: 'regex',
          value: '^[a-zA-Z0-9]+$',
          onErrorMsg: 'Resource name should be alphanumeric',
        },
      }),
      default: () => {
        const defaultValue = defaultValues['resourceName'];
        return defaultValue;
      },
    },
  ];
  const answer = await inquirer.prompt(question);
  return (answer as any).resourceName;
}

export async function askBucketNameQuestion(context: $TSContext, defaultValues: S3UserInputs, resourceName : string): Promise<string> {
  const { amplify } = context;
  const question = [
    {
      type: 'input',
      name: 'bucketName',
      message: 'Please provide bucket name:',
      validate: amplify.inputValidation({
        validation: {
          operator: 'regex',
          value: '^[a-zA-Z0-9]+$',
          onErrorMsg:  'Bucket name can only use the following characters: a-z 0-9 - and should have minimum 3 character and max of 47 character',
        },
      }),
      default: () => {
        return defaultValues['bucketName'];
      },
    },
  ];
  const answer = await inquirer.prompt(question);
  return (answer as any).bucketName
  ;
}

export async function askWhoHasAccessQuestion( context: $TSContext, defaultValues: S3UserInputs ): Promise<S3AccessType>{
  const question = [{
    type: 'list',
    name: 'storageAccess',
    message: 'Who should have access:',
    choices: [
      {
        name: 'Auth users only',
        value: 'auth',
      },
      {
        name: 'Auth and guest users',
        value: 'authAndGuest',
      },
    ],
    default: defaultValues.storageAccess,
  }];
  const answer = await inquirer.prompt(question);
  return (answer as any).storageAccess as S3AccessType;
}



export async function askCRUDQuestion( role: S3UserAccessRole, context: $TSContext, defaultValues: S3UserInputs): Promise<Array<S3PermissionType>>{
  const roleDefaultValues = getRoleAccessDefaultValues(role, defaultValues);
  console.log("SACPCDEBUG: Ask CRUD Question: defaultValues: ",possibleCRUDOperations, " default: ", roleDefaultValues );
  const question = [{
    name: 'permissions',
    type: 'checkbox',
    message: `What kind of access do you want for ${role} users?`,
    choices: possibleCRUDOperations,
    default: roleDefaultValues,
    validate: (inputs : any[]) => {
      if (inputs.length === 0) {
        return 'Select at least one option';
      }
      return true;
    }}];
  const answers = await inquirer.prompt(question); //multi-select checkbox
  const results: S3PermissionType[] = denormalizePermissions(answers.permissions as Array<S3PermissionType>);
  console.log(`SACPCDEBUG: askCRUDQuestion: ${JSON.stringify(results)}` )
  return results;
}

export async function askUserPoolGroupSelectionQuestion( userPoolGroupList : string[], defaultSelectedGroups: any): Promise<string[]> {
    const question = [
      {
        name: 'userpoolGroups',
        type: 'checkbox',
        message: 'Select groups:',
        choices: userPoolGroupList,
        default: defaultSelectedGroups,
        validate: (selectedAnswers: any) => {
          if (selectedAnswers.length === 0) {
            return 'Select at least one option';
          }
          return true;
        },
      },
    ];
    const answers = await inquirer.prompt(question); //multi-select checkbox
    const results:string[] = answers.userpoolGroups as string[];
    return results;
}

export async function askUserPoolGroupPermissionSelectionQuestion() : Promise<string>{
  const question = [{
    name: 'selection',
    type: 'list',
    message: 'Restrict access by?',
    choices: ['Auth/Guest Users', 'Individual Groups', 'Both', 'Learn more'],
    default: 'Auth/Guest Users',
  }];
  const answer = await inquirer.prompt(question); //select
  const result:string = answer.selection as string;
  return result;
}

export async function askUpdateTriggerSelection( currentTriggerFunction : string|undefined = undefined ): Promise<S3CLITriggerUpdateMenuOptions>{
  let choices = [];
  if (currentTriggerFunction === undefined ){
    choices = [S3CLITriggerUpdateMenuOptions.ADD,
               S3CLITriggerUpdateMenuOptions.SKIP]
  } else {
    choices = [S3CLITriggerUpdateMenuOptions.UPDATE,
               S3CLITriggerUpdateMenuOptions.REMOVE,
               S3CLITriggerUpdateMenuOptions.SKIP]
  }
   const triggerOperationQuestion = [{
    type: 'list',
    name: 'triggerOperation',
    message: 'Select from the following options',
    choices,
    default : S3CLITriggerUpdateMenuOptions.SKIP
  }];
  const triggerOperationAnswer = await inquirer.prompt(triggerOperationQuestion);
  return triggerOperationAnswer.triggerOperation as S3CLITriggerUpdateMenuOptions;
}

export async function askAuthPermissionQuestion( context : $TSContext ,
                                                  defaultValues : S3UserInputs ){
  const permissions: S3PermissionType[] = await askCRUDQuestion( S3UserAccessRole.AUTH, context, defaultValues );
  return permissions;
}

export async function conditionallyAskGuestPermissionQuestion( storageAccess : S3AccessType, context : $TSContext, defaultValues : any):Promise<S3PermissionType[]>{
  if (storageAccess === S3AccessType.AUTH_AND_GUEST) {
    const permissions: S3PermissionType[] = await askCRUDQuestion( S3UserAccessRole.GUEST, context, defaultValues );
    return permissions;
  } else {
    return [];
  }
}

export async function askGroupPermissionQuestion( context : $TSContext ,
  defaultValues : any ){
  const permissions: S3PermissionType[] = await askCRUDQuestion( S3UserAccessRole.GROUP, context, defaultValues );
  return permissions;
}

export async function askUserPoolGroupSelectionUntilPermissionSelected( context: $TSContext ) : Promise<string>{
  const userPoolGroupList = await context.amplify.getUserPoolGroupList(context);
  let permissionSelected = 'Auth/Guest Users';
  if (userPoolGroupList.length > 0) {
    do {
      if (permissionSelected === 'Learn more') {
        printer.info('');
        printer.info(
          'You can restrict access using CRUD policies for Authenticated Users, Guest Users, or on individual Groups that users belong to in a User Pool. If a user logs into your application and is not a member of any group they will use policy set for “Authenticated Users”, however if they belong to a group they will only get the policy associated with that specific group.',
        );
        printer.info('');
      }
      permissionSelected = await askUserPoolGroupPermissionSelectionQuestion()
    } while (permissionSelected === 'Learn more');
  }
  return permissionSelected;
}