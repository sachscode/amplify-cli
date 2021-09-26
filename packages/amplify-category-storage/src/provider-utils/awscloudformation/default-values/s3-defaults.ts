
import uuid from 'uuid';
import { S3AccessType, S3PermissionType, S3UserInputs } from '../service-walkthrough-types/s3-user-input-types';

export const getAllDefaults = (project: any, shortId : string) : S3UserInputs  => {
  const name = project.projectConfig.projectName.toLowerCase();
  const authRoleName = {
    Ref: 'AuthRoleName',
  };

  const unauthRoleName = {
    Ref: 'UnauthRoleName',
  };

  const defaults : S3UserInputs = {
    resourceName: `s3${shortId}`,
    policyUUID : shortId,
    bucketName: `${name}${uuid().replace(/-/g, '')}`.substr(0, 47), // 63(max) - 10 (envName max) - 4(stack name) - 2(separators)
    storageAccess: S3AccessType.AUTH_ONLY,
    guestAccess: [S3PermissionType.READ, S3PermissionType.LIST],
    authAccess:  [S3PermissionType.CREATE, S3PermissionType.READ, S3PermissionType.LIST],
    triggerFunction : undefined,
    groupAccess : undefined,
    groupList : undefined
  };

  return defaults;
};

module.exports = {
  getAllDefaults,
};
