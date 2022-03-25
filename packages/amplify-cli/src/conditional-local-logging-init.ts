/* eslint-disable max-classes-per-file */
/* eslint-disable spellcheck/spell-checker */
/* eslint-disable func-style */
/* eslint-disable prefer-arrow/prefer-arrow-functions */
import { $TSAny, JSONUtilities } from 'amplify-cli-core';
import { logger, Redactor } from 'amplify-cli-logger';
import { Input } from './domain/input';

/**
 * Log the input command and generate the command reported
 */
export function logInput(input: Input): void {
  logger.logInfo({
    message: `amplify ${input.command ? input.command : ''} \
    ${input.plugin ? input.plugin : ''} \
    ${input.subCommands ? input.subCommands.join(' ') : ''} \
    ${input.options ? Redactor(JSONUtilities.stringify(input.options, { minify: true })) : ''}`,
  });
}
