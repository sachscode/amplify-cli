/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable jsdoc/require-description */
/* eslint-disable spellcheck/spell-checker */
/* eslint-disable max-len */
/* eslint-disable consistent-return */
import { $TSContext } from 'amplify-cli-core';
import { categoryName } from '../../constants';
import {
  FunctionSecretsStateManager,
  getLocalFunctionSecretNames,
} from '../../provider-utils/awscloudformation/secrets/functionSecretsStateManager';
import { ServiceName } from '../../provider-utils/awscloudformation/utils/constants';
import { isFunctionPushed } from '../../provider-utils/awscloudformation/utils/funcionStateUtils';
import { removeLayerArtifacts } from '../../provider-utils/awscloudformation/utils/storeResources';
import { removeResource } from '../../provider-utils/awscloudformation/service-walkthroughs/removeFunctionWalkthrough';
import { removeWalkthrough } from '../../provider-utils/awscloudformation/service-walkthroughs/removeLayerWalkthrough';

const subcommand = 'remove';

module.exports = {
  name: subcommand,
  /**
   *
   */
  run: async (context: $TSContext) => {
    const { amplify, parameters } = context;

    let resourceName = parameters.first;
    let resourceToBeDeleted = '';

    const removeResourceResponse = await removeResource(resourceName);

    if (removeResourceResponse.isLambdaLayer) {
      context.print.info(
        'When you delete a layer version, you can no longer configure functions to use it.\nHowever, any function that already uses the layer version continues to have access to it.',
      );

      // eslint-disable-next-line spellcheck/spell-checker
      resourceToBeDeleted = await removeWalkthrough(context, removeResourceResponse.resourceName);
      context.usageData.flow.pushOption({ removeResourceResponse, resourceToBeDeleted });
      if (!resourceToBeDeleted) {
        return;
      }

      resourceName = resourceToBeDeleted;
    } else {
      resourceName = removeResourceResponse.resourceName;
      context.usageData.flow.pushOption({ removeResourceResponse });
    }

    let hasSecrets = false;

    const resourceNameCallback = async (removedResourceName: string) => {
      hasSecrets = getLocalFunctionSecretNames(removedResourceName).length > 0;
    };

    return amplify
      .removeResource(context, categoryName, resourceName, undefined, resourceNameCallback)
      .then(async (resource: { service: string; resourceName: string }) => {
        if (resource?.service === ServiceName.LambdaLayer) {
          removeLayerArtifacts(context, resource.resourceName);
        }

        // if the resource has not been pushed and it has secrets, we need to delete them now -- otherwise we will orphan the secrets in the cloud
        if (!isFunctionPushed(resourceName) && hasSecrets) {
          await (await FunctionSecretsStateManager.getInstance(context)).deleteAllFunctionSecrets(resourceName);
        }
      })
      .catch(err => {
        if (err.stack) {
          context.print.info(err.stack);
          context.print.error('An error occurred when removing the function resource');
        }

        context.usageData.emitError(err);
        process.exitCode = 1;
      });
  },
};
