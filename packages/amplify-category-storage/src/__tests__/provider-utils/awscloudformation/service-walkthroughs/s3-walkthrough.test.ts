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
import { UserPermissionTypeOptions } from '../../../../provider-utils/awscloudformation/service-walkthroughs/s3-questions';

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


describe('update s3 permission walkthrough tests', () => {
  let mockContext: $TSContext;
  beforeEach(() => {
    //Mock: UUID generation
    jest.spyOn(uuid, 'v4').mockReturnValue(S3MockDataBuilder.mockPolicyUUID);

    //Mock: Context/Amplify-Meta
    mockContext = {
      amplify: {
        getUserPoolGroupList: () => [],
        getProjectDetails: () => {
          return {
            projectConfig: {
              projectName: 'mockProject',
            },
            amplifyMeta: {
              auth: S3MockDataBuilder.mockAuthMeta,
              storage : {
                [S3MockDataBuilder.mockResourceName]: {
                  "service": "S3",
                  "providerPlugin": "awscloudformation",
                  "dependsOn": []
                }
              }
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
  /**
   * Update Auth + Guest Tests
   */
  it('updateWalkthrough() simple-auth + update auth-permission', async () => {
    const mockDataBuilder = new S3MockDataBuilder(undefined);
    const currentCLIInputs = mockDataBuilder.removeMockTriggerFunction().getCLIInputs();
    jest.spyOn(S3InputState.prototype, 'cliInputFileExists').mockImplementation(() => true); //CLI Input exists
    jest.spyOn(S3InputState.prototype, 'getUserInput').mockImplementation(()=> currentCLIInputs); //simple-auth 
    jest.spyOn(S3InputState.prototype, 'saveCliInputPayload').mockImplementation(() => true);
    jest.spyOn(AmplifyS3ResourceStackTransform.prototype, 'transform').mockImplementation(() => Promise.resolve());

    //**Set Auth permissions in Expected Output (without Delete permissions)
    const expectedCLIInputsJSON: S3UserInputs = mockDataBuilder.removeAuthPermission( S3PermissionType.DELETE ).getCLIInputs();

    //Update CLI walkthrough (update auth permission)
    prompter.pick = jest
      .fn()
      .mockResolvedValueOnce(S3AccessType.AUTH_ONLY) // who should have access
      .mockResolvedValueOnce([S3PermissionType.CREATE, S3PermissionType.READ]); /** Update Auth Permission in CLI */

    prompter.confirmContinue = jest.fn().mockReturnValueOnce(false); // Do you want to add a Lambda Trigger ?
    stateManager.getMeta = jest.fn().mockReturnValue( S3MockDataBuilder.mockAmplifyMetaForUpdateWalkthrough );
    const returnedResourcename = await updateWalkthrough(mockContext);
    expect(returnedResourcename).toEqual(S3MockDataBuilder.mockResourceName);
    expect(S3InputState.prototype.saveCliInputPayload).toHaveBeenCalledWith(expectedCLIInputsJSON);
  });

  it('updateWalkthrough() simple-auth + update auth+guest permission', async () => {
    const mockDataBuilder = new S3MockDataBuilder(undefined);
    const currentCLIInputs = mockDataBuilder.removeMockTriggerFunction().getCLIInputs();
    jest.spyOn(S3InputState.prototype, 'cliInputFileExists').mockImplementation(() => true); //CLI Input exists
    jest.spyOn(S3InputState.prototype, 'getUserInput').mockImplementation(()=> currentCLIInputs); //simple-auth 
    jest.spyOn(S3InputState.prototype, 'saveCliInputPayload').mockImplementation(() => true);
    jest.spyOn(AmplifyS3ResourceStackTransform.prototype, 'transform').mockImplementation(() => Promise.resolve());

    //**Set Auth permissions in Expected Output (without Delete permissions)
    const expectedCLIInputsJSON: S3UserInputs = mockDataBuilder
                                                .removeAuthPermission(S3PermissionType.DELETE)
                                                .addGuestAccess([S3PermissionType.READ, S3PermissionType.LIST])
                                                .getCLIInputs();

    //Update CLI walkthrough (update auth permission)
    prompter.pick = jest
      .fn()
      .mockResolvedValueOnce(S3AccessType.AUTH_AND_GUEST) // who should have access
      .mockResolvedValueOnce([S3PermissionType.CREATE, S3PermissionType.READ]) /** Update Auth Permission in CLI */
      .mockResolvedValueOnce([S3PermissionType.READ]); /** Update Guest Permission in CLI */

    prompter.confirmContinue = jest.fn().mockReturnValueOnce(false); // Do you want to add a Lambda Trigger ?
    stateManager.getMeta = jest.fn().mockReturnValue( S3MockDataBuilder.mockAmplifyMetaForUpdateWalkthrough );
    const returnedResourcename = await updateWalkthrough(mockContext);
    expect(returnedResourcename).toEqual(S3MockDataBuilder.mockResourceName);
    expect(S3InputState.prototype.saveCliInputPayload).toHaveBeenCalledWith(expectedCLIInputsJSON);
  });

  it('updateWalkthrough() auth+guest + update remove guest permission ', async () => {
    const mockDataBuilder = new S3MockDataBuilder(undefined);
    //start with auth+guest permissions
    const currentCLIInputs = mockDataBuilder
                             .removeMockTriggerFunction()
                             .addGuestAccess(undefined) //default guest access permissions
                             .getCLIInputs();
    jest.spyOn(S3InputState.prototype, 'cliInputFileExists').mockImplementation(() => true); //CLI Input exists
    jest.spyOn(S3InputState.prototype, 'getUserInput').mockImplementation(()=> currentCLIInputs); //simple-auth 
    jest.spyOn(S3InputState.prototype, 'saveCliInputPayload').mockImplementation(() => true);
    jest.spyOn(AmplifyS3ResourceStackTransform.prototype, 'transform').mockImplementation(() => Promise.resolve());

    //**Set Auth permissions in Expected Output (without Delete permissions)
    const expectedCLIInputsJSON: S3UserInputs = mockDataBuilder
                                                .removeGuestAccess()
                                                .getCLIInputs();

    //Update CLI walkthrough (update auth permission)
    prompter.pick = jest
      .fn()
      .mockResolvedValueOnce(S3AccessType.AUTH_ONLY) // who should have access
      .mockResolvedValueOnce(mockDataBuilder.defaultAuthPerms) /** Update Auth Permission in CLI */

    prompter.confirmContinue = jest.fn().mockReturnValueOnce(false); // Do you want to add a Lambda Trigger ?
    stateManager.getMeta = jest.fn().mockReturnValue( S3MockDataBuilder.mockAmplifyMetaForUpdateWalkthrough );
    const returnedResourcename = await updateWalkthrough(mockContext);
    expect(returnedResourcename).toEqual(S3MockDataBuilder.mockResourceName);
    expect(S3InputState.prototype.saveCliInputPayload).toHaveBeenCalledWith(expectedCLIInputsJSON);
  });

  /**
   * Update Group Permission Checks
   */
  it('updateWalkthrough() simple-auth + update add group(individual) permission ', async () => {
    const mockDataBuilder = new S3MockDataBuilder(undefined);
    //start with simple auth permissions
    const currentCLIInputs = mockDataBuilder
                             .removeMockTriggerFunction()
                             .getCLIInputs();
    //Update Group list function in context
    mockContext.amplify.getUserPoolGroupList = ()=>Object.keys( mockDataBuilder.mockGroupAccess );

    jest.spyOn(S3InputState.prototype, 'cliInputFileExists').mockImplementation(() => true); //CLI Input exists
    jest.spyOn(S3InputState.prototype, 'getUserInput').mockImplementation(()=> currentCLIInputs); //simple-auth 
    jest.spyOn(S3InputState.prototype, 'saveCliInputPayload').mockImplementation(() => true);
    jest.spyOn(AmplifyS3ResourceStackTransform.prototype, 'transform').mockImplementation(() => Promise.resolve());

    //**Set Auth permissions in Expected Output (without Delete permissions)
    const expectedCLIInputsJSON: S3UserInputs = mockDataBuilder
                                                .removeAuthAccess()
                                                .addGroupAccess()
                                                .getCLIInputs();

    //Update CLI walkthrough (update auth permission)
    prompter.pick = jest
      .fn()
      .mockResolvedValueOnce( UserPermissionTypeOptions.INDIVIDUAL_GROUPS ) // Restrict Access By
      .mockResolvedValueOnce( ['mockAdminGroup', 'mockGuestGroup'] ) //Select Groups
      .mockResolvedValueOnce( [S3PermissionType.CREATE, S3PermissionType.READ, S3PermissionType.DELETE] ) //what kind of access do you want for the admin group
      .mockResolvedValueOnce( [S3PermissionType.READ] ) //what kind of access fo you want for the guest group

    prompter.confirmContinue = jest.fn().mockReturnValueOnce(false); // Do you want to add a Lambda Trigger ?
    stateManager.getMeta = jest.fn().mockReturnValue( S3MockDataBuilder.mockAmplifyMetaForUpdateWalkthrough );
    const returnedResourcename = await updateWalkthrough(mockContext);
    expect(returnedResourcename).toEqual(S3MockDataBuilder.mockResourceName);
    expect(S3InputState.prototype.saveCliInputPayload).toHaveBeenCalledWith(expectedCLIInputsJSON);
  });
  it('addWalkthrough() simple-auth + update add (both) group and auth+guest permission ', async () => {
    const mockDataBuilder = new S3MockDataBuilder(undefined);
    //start with simple auth permissions
    const currentCLIInputs = mockDataBuilder
                             .removeMockTriggerFunction()
                             .getCLIInputs();
    //Update Group list function in context
    mockContext.amplify.getUserPoolGroupList = ()=>Object.keys( mockDataBuilder.mockGroupAccess );

    jest.spyOn(S3InputState.prototype, 'cliInputFileExists').mockImplementation(() => true); //CLI Input exists
    jest.spyOn(S3InputState.prototype, 'getUserInput').mockImplementation(()=> currentCLIInputs); //simple-auth 
    jest.spyOn(S3InputState.prototype, 'saveCliInputPayload').mockImplementation(() => true);
    jest.spyOn(AmplifyS3ResourceStackTransform.prototype, 'transform').mockImplementation(() => Promise.resolve());

    //** Add GuestAccess, GroupAccess
    const expectedCLIInputsJSON: S3UserInputs = mockDataBuilder
                                                .addGuestAccess(undefined)
                                                .addGroupAccess()
                                                .getCLIInputs();

    //Update CLI walkthrough (update auth permission)
    prompter.pick = jest
      .fn()
      .mockResolvedValueOnce( UserPermissionTypeOptions.BOTH ) // Restrict Access By
      .mockResolvedValueOnce( S3AccessType.AUTH_AND_GUEST ) // Restrict Access By
      .mockResolvedValueOnce( [S3PermissionType.CREATE, S3PermissionType.READ, S3PermissionType.DELETE] ) //select Auth permissions
      .mockResolvedValueOnce( [S3PermissionType.CREATE, S3PermissionType.READ] ) //select Guest permissions
      .mockResolvedValueOnce( ['mockAdminGroup', 'mockGuestGroup'] ) //Select Groups
      .mockResolvedValueOnce( [S3PermissionType.CREATE, S3PermissionType.READ, S3PermissionType.DELETE] ) //select admin group permissions
      .mockResolvedValueOnce( [S3PermissionType.READ] ) //select guest group permissions

    prompter.confirmContinue = jest.fn().mockReturnValueOnce(false); // Do you want to add a Lambda Trigger ?
    stateManager.getMeta = jest.fn().mockReturnValue( S3MockDataBuilder.mockAmplifyMetaForUpdateWalkthrough );
    const returnedResourcename = await updateWalkthrough(mockContext);
    expect(returnedResourcename).toEqual(S3MockDataBuilder.mockResourceName);
    expect(S3InputState.prototype.saveCliInputPayload).toHaveBeenCalledWith(expectedCLIInputsJSON);
  });

});



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
  static mockAmplifyMetaForUpdateWalkthrough = {
    auth: {
      mockAuthName: S3MockDataBuilder.mockAuthMeta,
    },
    storage : {
      [S3MockDataBuilder.mockResourceName]: {
        service : 'S3',
        providerPlugin: 'awscloudformation',
        dependsOn: []
      }
    }
  }
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

  removeGuestAccess() : S3MockDataBuilder {
    this.cliInputs.storageAccess = S3AccessType.AUTH_ONLY;
    this.cliInputs.guestAccess = [];
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

  removeAuthPermission( permissionToBeRemoved : S3PermissionType ): S3MockDataBuilder {
    const newPermissions = this.defaultAuthPerms.filter( permission => permission !== permissionToBeRemoved );
    this.cliInputs.authAccess = newPermissions;
    return this
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
