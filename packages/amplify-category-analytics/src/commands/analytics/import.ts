import {
  $TSAny, $TSContext, AmplifyCategories, CLISubCommands, ServiceSelection,
} from 'amplify-cli-core';
import { printer } from 'amplify-prompts';

const subcommand = CLISubCommands.IMPORT;
const category = AmplifyCategories.ANALYTICS;

/**
 * Import an analytics resource to your local backend
 */
export const run = async (context : $TSContext):Promise<$TSAny> => {
  const { amplify } = context;
  const servicesMetadata = amplify.readJsonFile(`${__dirname}/../../provider-utils/supported-services.json`);
  const serviceSelectionData: ServiceSelection = await amplify.serviceSelectionPrompt(context, category, servicesMetadata, 'Select an Analytics provider');
  const options = { service: serviceSelectionData.service, providerPlugin: serviceSelectionData.providerName };
  const providerController = await import(`../../provider-utils/${serviceSelectionData.providerName}/index`);
  if (!providerController) {
    printer.error('Provider not configured for this category');
    return;
  }
  const importResourceName = await providerController.importResource(context, category, serviceSelectionData.service);
  if (importResourceName) {
    try {
      amplify.updateamplifyMetaAfterResourceAdd(category, importResourceName, options);
      printer.success(`Successfully added resource ${importResourceName} locally`);
      printer.info('');
      printer.success('Some next steps:');
      printer.info('"amplify push" builds all of your local backend resources and provisions them in the cloud');
      printer.info(
        '"amplify publish" builds all your local backend and front-end resources (if you have hosting category added) and provisions them in the cloud',
      );
      printer.info('');
    } catch (err) {
      printer.info(err.stack);
      printer.error('There was an error adding the analytics resource');
      context.usageData.emitError(err);
      process.exitCode = 1;
    }
  }
};
module.exports = {
  name: subcommand,
  run,
};
