/* eslint-disable spellcheck/spell-checker */
/* eslint-disable jsdoc/require-description */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable func-style */
/* eslint-disable prefer-arrow/prefer-arrow-functions */
import { stateManager } from 'amplify-cli-core';
import * as _ from 'lodash';
import { init } from './app-config';
import { attachExtentions } from './context-extensions';
import { NoUsageData, UsageData } from './domain/amplify-usageData';
import { ProjectSettings } from './domain/amplify-usageData/UsageDataPayload';
import { Context } from './domain/context';
import { Input } from './domain/input';
import { PluginPlatform } from './domain/plugin-platform';
import { getAmplifyVersion } from './extensions/amplify-helpers/get-amplify-version';

/**
 *
 */
export function constructContext(pluginPlatform: PluginPlatform, input: Input): Context {
  const context = new Context(pluginPlatform, input);
  context.amplifyVersion = getAmplifyVersion();
  attachExtentions(context);
  return context;
}

/**
 *
 */
export async function attachUsageData(context: Context) {
  const { AMPLIFY_CLI_ENABLE_USAGE_DATA } = process.env;
  const config = init(context);
  const usageTrackingEnabled = AMPLIFY_CLI_ENABLE_USAGE_DATA
    ? AMPLIFY_CLI_ENABLE_USAGE_DATA === 'true'
    : config.usageDataConfig.isUsageTrackingEnabled;
  if (usageTrackingEnabled) {
    context.usageData = UsageData.Instance;
  } else {
    context.usageData = NoUsageData.Instance;
  }
  const accountId = getSafeAccountId();
  context.usageData.init(config.usageDataConfig.installationUuid, getVersion(context), context.input, accountId, getProjectSettings());
}

const getSafeAccountId = () => {
  if (stateManager.metaFileExists()) {
    const amplifyMeta = stateManager.getMeta();
    const stackId = _.get(amplifyMeta, ['providers', 'awscloudformation', 'StackId']) as string;
    if (stackId) {
      const splitString = stackId.split(':');
      if (splitString.length > 4) {
        return splitString[4];
      }
    }
  }

  return '';
};

const getVersion = (context: Context) => context.pluginPlatform.plugins.core[0].packageVersion;

const getProjectSettings = (): ProjectSettings => {
  const projectSettings: ProjectSettings = {};
  if (stateManager.projectConfigExists()) {
    const projectConfig = stateManager.getProjectConfig();
    const { frontend } = projectConfig;
    projectSettings.frontend = frontend;
    projectSettings.framework = projectConfig?.[frontend]?.framework;
  }

  if (stateManager.localEnvInfoExists()) {
    const { defaultEditor } = stateManager.getLocalEnvInfo();
    projectSettings.editor = defaultEditor;
  }

  return projectSettings;
};
