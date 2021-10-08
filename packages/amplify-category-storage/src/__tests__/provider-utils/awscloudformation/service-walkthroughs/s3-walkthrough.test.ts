import { $TSContext, AmplifySupportedService, stateManager } from 'amplify-cli-core';
import { prompter } from 'amplify-prompts';
import * as uuid from 'uuid';
import { S3InputState } from '../../../../provider-utils/awscloudformation/service-walkthroughs/s3-user-input-state';
import { AmplifyS3ResourceStackTransform } from '../../../../provider-utils/awscloudformation/cdk-stack-builder/s3-stack-transform';
import { addWalkthrough, updateWalkthrough } from '../../../../provider-utils/awscloudformation/service-walkthroughs/s3-walkthrough';
import {
  S3AccessType,
  S3PermissionType,
  S3TriggerFunctionType,
  S3UserInputs,
} from '../../../../provider-utils/awscloudformation/service-walkthrough-types/s3-user-input-types';

jest.mock('amplify-cli-core');
jest.mock('amplify-prompts');
jest.mock('../../../../provider-utils/awscloudformation/service-walkthroughs/s3-user-input-state');
jest.mock('../../../../provider-utils/awscloudformation/cdk-stack-builder/s3-stack-transform');
jest.mock('uuid');

describe('add s3 walkthrough tests', () => {
  let mockContext: $TSContext;

  beforeEach(() => {
    //Mock: UUID generation
    jest.spyOn(uuid, 'v4').mockReturnValue(S3MockDataBuilder.mockPolicyUUID);

    //Mock: Context/Amplify-Meta
    mockContext = {
      amplify: {
        getProjectDetails: () => {
          return {
            projectConfig: {
              projectName: 'mockProject',
            },
            amplifyMeta: {
              auth: S3MockDataBuilder.mockAuthMeta,
            },
          };
        },
        // eslint-disable-next-line
        getResourceStatus: () => {
          return { allResources: S3MockDataBuilder.getMockGetAllResourcesNoExistingLambdas() };
        }, //eslint-disable-line
        copyBatch : jest.fn().mockReturnValue( new Promise((resolve, reject) => resolve(true) ) ),
        updateamplifyMetaAfterResourceAdd : jest.fn().mockReturnValue( new Promise((resolve, reject) => resolve(true) ) ),
        pathManager: {
          getBackendDirPath: jest.fn().mockReturnValue("mockTargetDir")
        }
      }
    } as unknown as $TSContext;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('addWalkthrough() simple-auth test', async () => {
    jest.spyOn(S3InputState.prototype, 'saveCliInputPayload').mockImplementation(() => true);
    jest.spyOn(AmplifyS3ResourceStackTransform.prototype, 'transform').mockImplementation(() => Promise.resolve());

    const mockDataBuilder = new S3MockDataBuilder(undefined);
    const expectedCLIInputsJSON: S3UserInputs = mockDataBuilder.getCLIInputs();

    //Simple Auth CLI walkthrough
    prompter.input = jest
      .fn()
      .mockReturnValueOnce(S3MockDataBuilder.mockResourceName) // Provide a friendly name
      .mockResolvedValueOnce(S3MockDataBuilder.mockBucketName) // Provide bucket name
      .mockResolvedValueOnce(false); // Do you want to add Lambda Trigger

    prompter.pick = jest
      .fn()
      .mockResolvedValueOnce(S3AccessType.AUTH_ONLY) // who should have access
      .mockResolvedValueOnce([S3PermissionType.CREATE, S3PermissionType.READ, S3PermissionType.DELETE]); // What kind of permissions

    prompter.confirmContinue = jest.fn().mockReturnValueOnce(false); // Do you want to add a Lambda Trigger ?

    stateManager.getMeta = jest.fn().mockReturnValue(S3MockDataBuilder.mockAmplifyMeta);

    let options = {};
    const returnedResourcename = await addWalkthrough(mockContext, S3MockDataBuilder.mockFilePath, mockContext, options);

    expect(returnedResourcename).toEqual(S3MockDataBuilder.mockResourceName);
    expect(S3InputState.prototype.saveCliInputPayload).toHaveBeenCalledWith(expectedCLIInputsJSON);
  });
  it('addWalkthrough() simple-auth+guest test', async () => {
    jest.spyOn(S3InputState.prototype, 'saveCliInputPayload').mockImplementation(() => true);
    jest.spyOn(AmplifyS3ResourceStackTransform.prototype, 'transform').mockImplementation(() => Promise.resolve());

    const mockDataBuilder = new S3MockDataBuilder(undefined);
    const expectedCLIInputsJSON: S3UserInputs = mockDataBuilder.addGuestAccess(undefined).getCLIInputs();

    //Simple Auth CLI walkthrough
    prompter.input = jest
      .fn()
      .mockReturnValueOnce(S3MockDataBuilder.mockResourceName) // Provide a friendly name
      .mockResolvedValueOnce(S3MockDataBuilder.mockBucketName) // Provide bucket name
      .mockResolvedValueOnce(false); // Do you want to add Lambda Trigger

    prompter.pick = jest
      .fn()
      .mockResolvedValueOnce(S3AccessType.AUTH_AND_GUEST) // who should have access
      .mockResolvedValueOnce([S3PermissionType.CREATE, S3PermissionType.READ, S3PermissionType.DELETE]) // What kind of permissions (Auth)
      .mockResolvedValueOnce([S3PermissionType.CREATE, S3PermissionType.READ,]); // What kind of permissions (Guest)

    prompter.confirmContinue = jest.fn().mockReturnValueOnce(false); // Do you want to add a Lambda Trigger ?

    stateManager.getMeta = jest.fn().mockReturnValue(S3MockDataBuilder.mockAmplifyMeta);

    let options = {};
    const returnedResourcename = await addWalkthrough(mockContext, S3MockDataBuilder.mockFilePath, mockContext, options);

    expect(returnedResourcename).toEqual(S3MockDataBuilder.mockResourceName);
    expect(S3InputState.prototype.saveCliInputPayload).toHaveBeenCalledWith(expectedCLIInputsJSON);
  });
  it('addWalkthrough() simple-auth + trigger (new function) test', async () => {
    jest.spyOn(S3InputState.prototype, 'saveCliInputPayload').mockImplementation(() => true);
    jest.spyOn(AmplifyS3ResourceStackTransform.prototype, 'transform').mockImplementation(() => Promise.resolve());

    const mockDataBuilder = new S3MockDataBuilder(undefined);
    const expectedCLIInputsJSON: S3UserInputs = mockDataBuilder.addMockTriggerFunction(undefined).getCLIInputs();
    
    //Simple Auth CLI walkthrough
    prompter.input = jest
      .fn()
      .mockReturnValueOnce(S3MockDataBuilder.mockResourceName) // Provide a friendly name
      .mockResolvedValueOnce(S3MockDataBuilder.mockBucketName) // Provide bucket name
      .mockResolvedValueOnce(false); 

    prompter.pick = jest
      .fn()
      .mockResolvedValueOnce(S3AccessType.AUTH_ONLY) // who should have access
      .mockResolvedValueOnce([S3PermissionType.CREATE, S3PermissionType.READ, S3PermissionType.DELETE]) // What kind of permissions (Auth)
  

    prompter.confirmContinue = jest
    .fn()
    .mockReturnValueOnce(true) //Do you want to add a Lambda Trigger ?
    .mockResolvedValueOnce(false); //Do you want to edit the lamdba function now?

    stateManager.getMeta = jest.fn().mockReturnValue(S3MockDataBuilder.mockAmplifyMeta);

    let options = {};
    const returnedResourcename = await addWalkthrough(mockContext, S3MockDataBuilder.mockFilePath, mockContext, options);

    expect(returnedResourcename).toEqual(S3MockDataBuilder.mockResourceName);
    expect(S3InputState.prototype.saveCliInputPayload).toHaveBeenCalledWith(expectedCLIInputsJSON);
  });
  it('addWalkthrough() simple-auth + trigger (existing function) test', async () => {
    jest.spyOn(S3InputState.prototype, 'saveCliInputPayload').mockImplementation(() => true);
    jest.spyOn(AmplifyS3ResourceStackTransform.prototype, 'transform').mockImplementation(() => Promise.resolve());
    //Add Existing Lambda functions in resource status
    mockContext.amplify.getResourceStatus = () => {
      return { allResources: S3MockDataBuilder.getMockGetAllResources2ExistingLambdas() };
    }

    const mockDataBuilder = new S3MockDataBuilder(undefined);
    //Select the first existing function from the list presented above in allResources
    const expectedCLIInputsJSON: S3UserInputs = mockDataBuilder.addMockTriggerFunction( S3MockDataBuilder.mockExistingFunctionName1 ).getCLIInputs();
    //Simple Auth CLI walkthrough
    prompter.input = jest
      .fn()
      .mockReturnValueOnce(S3MockDataBuilder.mockResourceName) // Provide a friendly name
      .mockResolvedValueOnce(S3MockDataBuilder.mockBucketName) // Provide bucket name
      .mockResolvedValueOnce(false); 

    prompter.pick = jest
      .fn()
      .mockResolvedValueOnce(S3AccessType.AUTH_ONLY) // who should have access
      .mockResolvedValueOnce([S3PermissionType.CREATE, S3PermissionType.READ, S3PermissionType.DELETE]) // What kind of permissions (Auth)
      .mockResolvedValueOnce(S3TriggerFunctionType.EXISTING_FUNCTION)
      .mockResolvedValueOnce(S3MockDataBuilder.mockExistingFunctionName1 ); //Selected the First Existing function from the list.

    prompter.confirmContinue = jest
    .fn()
    .mockReturnValueOnce(true) //Do you want to add a Lambda Trigger ?
    .mockResolvedValueOnce(false); //Do you want to edit the lamdba function now?

    stateManager.getMeta = jest.fn().mockReturnValue(S3MockDataBuilder.mockAmplifyMeta);

    let options = {};
    const returnedResourcename = await addWalkthrough(mockContext, S3MockDataBuilder.mockFilePath, mockContext, options);

    expect(returnedResourcename).toEqual(S3MockDataBuilder.mockResourceName);
    expect(S3InputState.prototype.saveCliInputPayload).toHaveBeenCalledWith(expectedCLIInputsJSON);
  });

});

// describe('update s3 walkthrough tests', () => {
//   let mockContext: $TSContext;

//   beforeEach(() => {
//     jest.mock('amplify-prompts');
//     mockContext = {
//       amplify: {
//         getProjectDetails: () => {
//           return {
//             projectConfig: {
//               projectName: 'mockProject',
//             },
//           };
//         },
//       },
//     } as unknown as $TSContext;
//   });

//   afterEach(() => {
//     jest.clearAllMocks();
//   });

//   it('updateWalkthrough() test to add gsi', async () => {
//     let mockAmplifyMeta = {
//       storage: {
//         mockresourcename: {
//           service: 'DynamoDB',
//           providerPlugin: 'awscloudformation',
//         },
//         dynamoefb50875: {
//           service: 'DynamoDB',
//           providerPlugin: 'awscloudformation',
//         },
//       },
//     };

//     stateManager.getMeta = jest.fn().mockReturnValue(mockAmplifyMeta);

//     const currentCLIInputsJSON: DynamoDBCLIInputs = {
//       resourceName: 'mockresourcename',
//       tableName: 'mocktablename',
//       partitionKey: {
//         fieldName: 'id',
//         fieldType: FieldType.string,
//       },
//       sortKey: {
//         fieldName: 'name',
//         fieldType: FieldType.number,
//       },
//       gsi: [
//         {
//           name: 'gsiname',
//           partitionKey: {
//             fieldName: 'name',
//             fieldType: FieldType.number,
//           },
//         },
//       ],
//       triggerFunctions: [],
//     };

//     jest.spyOn(DynamoDBInputState.prototype, 'getCliInputPayload').mockImplementation(() => currentCLIInputsJSON);

//     jest.spyOn(DynamoDBInputState.prototype, 'saveCliInputPayload').mockImplementation(() => true);
//     jest.spyOn(DynamoDBInputState.prototype, 'cliInputFileExists').mockImplementation(() => true);
//     jest.spyOn(DDBStackTransform.prototype, 'transform').mockImplementation(() => Promise.resolve());

//     prompter.input = jest
//       .fn()
//       .mockResolvedValueOnce('col') // What would you like to name this column
//       .mockResolvedValueOnce('updategsiname'); // Provide the GSI name

//     prompter.pick = jest
//       .fn()
//       .mockReturnValueOnce('mockresourcename') // Specify the resource that you would want to update
//       .mockReturnValueOnce('string') // Choose the data type
//       .mockReturnValueOnce('col') // Choose partition key for the GSI
//       .mockReturnValueOnce('name'); // Choose sort key for the GSI

//     prompter.yesOrNo = jest
//       .fn()
//       .mockReturnValueOnce(true) // Would you like to add another column
//       .mockReturnValueOnce(false) // Would you like to add another column
//       .mockReturnValueOnce(true) // Do you want to keep existing global seconday indexes created on your table?
//       .mockReturnValueOnce(true) // Do you want to add global secondary indexes to your table?
//       .mockReturnValueOnce(false) // Do you want to add a sort key to your global secondary index
//       .mockReturnValueOnce(false); // Do you want to add more global secondary indexes to your table?

//     prompter.confirmContinue = jest.fn().mockReturnValueOnce(false); // Do you want to add a Lambda Trigger for your Table?

//     const returnedCLIInputs = await updateWalkthrough(mockContext);

//     const expectedCLIInputsJSON: DynamoDBCLIInputs = {
//       resourceName: 'mockresourcename',
//       tableName: 'mocktablename',
//       partitionKey: {
//         fieldName: 'id',
//         fieldType: FieldType.string,
//       },
//       sortKey: {
//         fieldName: 'name',
//         fieldType: FieldType.number,
//       },
//       gsi: [
//         {
//           name: 'gsiname',
//           partitionKey: {
//             fieldName: 'name',
//             fieldType: FieldType.number,
//           },
//         },
//         {
//           name: 'updategsiname',
//           partitionKey: {
//             fieldName: 'col',
//             fieldType: FieldType.string,
//           },
//         },
//       ],
//       triggerFunctions: [],
//     };

//     expect(returnedCLIInputs).toEqual(expectedCLIInputsJSON);
//     expect(DynamoDBInputState.prototype.saveCliInputPayload).toHaveBeenCalledWith(expectedCLIInputsJSON);
//   });
// });

//Helper class to start with Simple Auth and mutate the CLI Inputs based on Test-Case
class S3MockDataBuilder {
  static mockBucketName = 'mockBucketName';
  static mockResourceName = 'mockResourceName';
  static mockPolicyUUID = 'cafe2021';
  static mockFunctionName = `S3Trigger${S3MockDataBuilder.mockPolicyUUID}`;
  static mockExistingFunctionName1 = 'triggerHandlerFunction1';
  static mockExistingFunctionName2 = 'triggerHandlerFunction2';
  static mockFilePath = '';
  static mockAuthMeta = {
    service: 'Cognito',
    providerPlugin: 'awscloudformation',
    dependsOn: [],
    customAuth: false,
    frontendAuthConfig: {
      loginMechanisms: ['PREFERRED_USERNAME'],
      signupAttributes: ['EMAIL'],
      passwordProtectionSettings: {
        passwordPolicyMinLength: 8,
        passwordPolicyCharacters: [],
      },
      mfaConfiguration: 'OFF',
      mfaTypes: ['SMS'],
      verificationMechanisms: ['EMAIL'],
    },
  };
  static mockAmplifyMeta = {
    auth: {
      mockAuthName: S3MockDataBuilder.mockAuthMeta,
    },
  };
  mockGroupAccess = {
    mockAdminGroup: [S3PermissionType.CREATE, S3PermissionType.READ, S3PermissionType.DELETE, S3PermissionType.LIST],
    mockGuestGroup: [S3PermissionType.READ, S3PermissionType.LIST],
  };
  defaultAuthPerms = [S3PermissionType.CREATE, S3PermissionType.READ, S3PermissionType.DELETE, S3PermissionType.LIST];
  defaultGuestPerms = [S3PermissionType.CREATE, S3PermissionType.READ, S3PermissionType.LIST];

  simpleAuth: S3UserInputs = {
    resourceName: S3MockDataBuilder.mockResourceName,
    bucketName: S3MockDataBuilder.mockBucketName,
    policyUUID: S3MockDataBuilder.mockPolicyUUID,
    storageAccess: S3AccessType.AUTH_ONLY,
    guestAccess: [],
    authAccess: this.defaultAuthPerms,
    groupAccess: {},
    groupList: [],
    triggerFunction: 'NONE',
  };
  cliInputs: S3UserInputs = {
    resourceName: undefined,
    bucketName: undefined,
    policyUUID: undefined,
    storageAccess: undefined,
    guestAccess: [],
    authAccess: [],
    triggerFunction: undefined,
    groupAccess: undefined,
    groupList: undefined,
  };

  constructor(startCliInputState: S3UserInputs | undefined) {
    if (startCliInputState) {
      this.cliInputs = startCliInputState;
    } else {
      Object.assign(this.cliInputs, this.simpleAuth);
    }
  }

  static getMockGetAllResources2ExistingLambdas(){
    return [
              { service: 'Cognito', 
                serviceType: 'managed' }, 

              {
                service : AmplifySupportedService.LAMBDA,
                resourceName : S3MockDataBuilder.mockExistingFunctionName1
              },
              {
                service : AmplifySupportedService.LAMBDA,
                resourceName : S3MockDataBuilder.mockExistingFunctionName2
              }
      ]
  }
  static getMockGetAllResourcesNoExistingLambdas(){
    return [
              { service: 'Cognito', 
                serviceType: 'managed' }, 
      ]
  }


  addGuestAccess(guestAccess: Array<S3PermissionType> | undefined): S3MockDataBuilder {
    this.cliInputs.storageAccess = S3AccessType.AUTH_AND_GUEST;
    if (guestAccess) {
      this.cliInputs.guestAccess = guestAccess;
    } else {
      this.cliInputs.guestAccess = this.defaultGuestPerms;
    }
    return this;
  }

  addMockTriggerFunction(customMockFunctionName : string | undefined): S3MockDataBuilder {
    if (customMockFunctionName){
      this.cliInputs.triggerFunction = customMockFunctionName;
    } else {
      this.cliInputs.triggerFunction = S3MockDataBuilder.mockFunctionName;
    }
    return this;
  }

  removeMockTriggerFunction(): S3MockDataBuilder {
    this.cliInputs.triggerFunction = undefined;
    return this;
  }

  removeAuthAccess(): S3MockDataBuilder {
    this.cliInputs.authAccess = [];
    return this;
  }

  addGroupAccess(): S3MockDataBuilder {
    this.cliInputs.groupAccess = this.mockGroupAccess;
    this.cliInputs.groupList = Object.keys(this.mockGroupAccess);
    return this;
  }

  removeGroupAccess(): S3MockDataBuilder {
    this.cliInputs.groupAccess = undefined;
    this.cliInputs.groupList = undefined;
    return this;
  }

  getCLIInputs(): S3UserInputs {
    return this.cliInputs;
  }
}
