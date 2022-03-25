/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable max-len */
/* eslint-disable jsdoc/require-description */
/* eslint-disable no-param-reassign */
/* eslint-disable prefer-arrow/prefer-arrow-functions */
/* eslint-disable spellcheck/spell-checker */
/* eslint-disable no-restricted-syntax */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable func-style */
import {
  $TSAny, $TSContext, exitOnNextTick, ResourceDoesNotExistError, ServiceSelection,
} from 'amplify-cli-core';
import * as inquirer from 'inquirer';

import { getProjectConfig } from './get-project-config';
import { getProviderPlugins } from './get-provider-plugins';

type ServiceSelectionOption = {
  name: string;
  value: ServiceSelection;
};

function filterServicesByEnabledProviders(context: $TSContext, enabledProviders: string[], supportedServices: { [x: string]: { provider: any; alias: any; }; } | undefined) {
  const providerPlugins = getProviderPlugins(context);

  const filteredServices: $TSAny[] = [];

  if (supportedServices !== undefined && enabledProviders !== undefined) {
    Object.keys(supportedServices).forEach(serviceName => {
      const { provider, alias } = supportedServices[serviceName];

      if (enabledProviders.includes(provider)) {
        filteredServices.push({
          service: serviceName,
          providerPlugin: providerPlugins[provider],
          providerName: provider,
          alias,
        });
      }
    });
  }

  return filteredServices;
}

async function serviceQuestionWalkthrough(
  context: $TSContext,
  supportedServices: any,
  category: string,
  customQuestion = null,
  optionNameOverrides?: Record<string, string>,
): Promise<ServiceSelection> {
  const options: ServiceSelectionOption[] = [];
  for (const supportedService of supportedServices) {
    let optionName = supportedService.alias || `${supportedService.providerName}:${supportedService.service}`;

    if (optionNameOverrides && optionNameOverrides[supportedService.service]) {
      optionName = optionNameOverrides[supportedService.service];
    }

    options.push({
      name: optionName,
      value: {
        provider: supportedService.providerPlugin,
        service: supportedService.service,
        providerName: supportedService.providerName,
      },
    });
  }

  if (options.length === 0) {
    const errMessage = `No services defined by configured providers for category: ${category}`;
    context.print.error(errMessage);
    await context.usageData.emitError(new ResourceDoesNotExistError(errMessage));
    exitOnNextTick(1);
  }

  if (options.length === 1) {
    // No need to ask questions
    context.print.info(`Using service: ${options[0].value.service}, provided by: ${options[0].value.providerName}`);
    return new Promise(resolve => {
      resolve(options[0].value);
    });
  }

  const question = [
    {
      name: 'service',
      message: customQuestion || 'Select from one of the below mentioned services:',
      type: 'list',
      choices: options,
    },
  ];

  const answer = await inquirer.prompt<{ service: ServiceSelection }>(question);

  return answer.service;
}

/**
 *
 */
export function serviceSelectionPrompt(
  context: $TSContext,
  category: string,
  supportedServices: $TSAny,
  customQuestion: $TSAny = null,
  optionNameOverrides?: Record<string, string>,
): Promise<ServiceSelection> {
  const { providers } = getProjectConfig();
  supportedServices = filterServicesByEnabledProviders(context, providers, supportedServices);
  const serviceSelected = serviceQuestionWalkthrough(context, supportedServices, category, customQuestion, optionNameOverrides);
  return serviceSelected;
}
