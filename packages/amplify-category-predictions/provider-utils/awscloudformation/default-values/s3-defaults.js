const uuid = require('uuid');

const getAllS3Defaults = project => {
  const name = project.projectConfig.projectName.toLowerCase();
  const [shortId] = uuid().split('-');

  const authRoleName = {
    Ref: 'AuthRoleName',
  };

  const unauthRoleName = {
    Ref: 'UnauthRoleName',
  };

  const defaults = {
    resourceName: `s3${shortId}`,
    bucketName: `${name}${uuid().replace(/-/g, '')}`,
    authPolicyName: `s3_amplify_${shortId}`,
    unauthPolicyName: `s3_amplify_${shortId}`,

    authRoleName,
    unauthRoleName,
    storageAccess: 'auth',
    selectedGuestPermissions: ['s3:GetObject', 's3:ListBucket'],
    selectedAuthenticatedPermissions: ['s3:GetObject', 's3:ListBucket'],
  };

  return defaults;
};

//policy prefix generator
const generatePolicyPrefix = ( ) => {
  const [policyId] = uuid().split('-');
  return policyId;
}


//Helper functions
const getS3PrivatePolicy = ( policyId ) => `Private_policy_${policyId}`;
const getS3ProtectedPolicy = ( policyId ) => `Protected_policy_${policyId}`;
const getS3PublicPolicy = ( policyId ) => `Protected_policy_${policyId}`;
const getS3ReadPolicy = ( policyId ) => `read_policy_${policyId}`;
const getS3UploadsPolicy = ( policyId ) => `Uploads_policy_${policyId}`;

//idempotent
const getAllAuthDefaults = ( policyId ) => {
  const authAnswers = {
    AuthenticatedAllowList: 'ALLOW',
    GuestAllowList: 'DISALLOW',
    s3PermissionsAuthenticatedPrivate: 's3:PutObject,s3:GetObject,s3:DeleteObject',
    s3PermissionsAuthenticatedProtected: 's3:PutObject,s3:GetObject,s3:DeleteObject',
    s3PermissionsAuthenticatedPublic: 's3:PutObject,s3:GetObject,s3:DeleteObject',
    s3PermissionsAuthenticatedUploads: 's3:PutObject',
    s3PermissionsGuestPublic: 'DISALLOW',
    s3PermissionsGuestUploads: 'DISALLOW',
    s3PrivatePolicy: getS3PrivatePolicy(policyId),
    s3ProtectedPolicy: getS3ProtectedPolicy(policyId),
    s3PublicPolicy: getS3PublicPolicy(policyId),
    s3ReadPolicy: getS3ReadPolicy( policyId ),
    s3UploadsPolicy: getS3UploadsPolicy(policyId),
    selectedAuthenticatedPermissions: ['s3:PutObject', 's3:GetObject', 's3:ListBucket', 's3:DeleteObject'],
  };

  return authAnswers;
};



//idempotent
const getAllAuthAndGuestDefaults = ( policyId ) => {
  const authAndGuestAnswers = {
    AuthenticatedAllowList: 'ALLOW',
    GuestAllowList: 'ALLOW',
    s3PermissionsAuthenticatedPrivate: 's3:PutObject,s3:GetObject,s3:DeleteObject',
    s3PermissionsAuthenticatedProtected: 's3:PutObject,s3:GetObject,s3:DeleteObject',
    s3PermissionsAuthenticatedPublic: 's3:PutObject,s3:GetObject,s3:DeleteObject',
    s3PermissionsAuthenticatedUploads: 's3:PutObject',
    s3PermissionsGuestPublic: 's3:PutObject,s3:GetObject,s3:DeleteObject',
    s3PermissionsGuestUploads: 's3:PutObject',
    s3PrivatePolicy: getS3PrivatePolicy(policyId),
    s3ProtectedPolicy: getS3ProtectedPolicy(policyId),
    s3PublicPolicy: getS3PublicPolicy(policyId),
    s3ReadPolicy: getS3ReadPolicy(policyId),
    s3UploadsPolicy: getS3UploadsPolicy(policyId),
    selectedAuthenticatedPermissions: ['s3:PutObject', 's3:GetObject', 's3:ListBucket', 's3:DeleteObject'],
    selectedGuestPermissions: ['s3:PutObject', 's3:GetObject', 's3:ListBucket', 's3:DeleteObject'],
  };

  return authAndGuestAnswers;
};

module.exports = {
  getAllS3Defaults,
  getAllAuthAndGuestDefaults,
  getAllAuthDefaults,
  generatePolicyPrefix,
};
