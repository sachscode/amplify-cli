/* eslint-disable spellcheck/spell-checker */
/* eslint-disable jsdoc/require-description */
/* eslint-disable import/no-cycle */
/* eslint-disable spellcheck/spell-checker */
import { Input } from './input';
import { AmplifyToolkit } from './amplify-toolkit';
import { PluginPlatform } from './plugin-platform';
import { IUsageData } from './amplify-usageData';

/**
 *
 */
export class Context {
  amplify!: AmplifyToolkit;
  amplifyVersion!: string;
  usageData!: IUsageData;
  public pluginPlatform! : PluginPlatform;
  public input!: Input;
  constructor(pluginPlatform:PluginPlatform, input:Input) {
    this.amplify = new AmplifyToolkit();
    this.pluginPlatform = pluginPlatform;
    this.input = input;
  }

  // ToDo: this is to attach gluegun extensions and other attached properties
  // already used by the plugins.
  // After the new platform is stablized, we probably should disallow arbituary
  // properties to be attached to the context object.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
