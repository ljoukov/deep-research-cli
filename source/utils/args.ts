import process from 'node:process';
import yargs from 'yargs';
import {hideBin} from 'yargs/helpers';
import type {CliArgs} from '../types.js';

export function parseArgs(): CliArgs {
	const argv = yargs(hideBin(process.argv))
		.option('model', {
			type: 'string',
			choices: [
				'o3',
				'o3-deep-research',
				'o3-pro',
				'gpt-5',
				'gpt-5-mini',
				'gpt-5-nano',
			],
			description: 'Model to use for the response',
			default: 'gpt-5',
		})
		.option('reasoning-effort', {
			type: 'string',
			choices: ['minimal', 'low', 'medium', 'high'],
			description: 'Reasoning effort',
			default: 'high',
		})
		.option('request', {
			type: 'string',
			description: 'Direct request text',
		})
		.option('request-file', {
			type: 'string',
			description: 'Path to file containing the request',
		})
		.option('output-file', {
			type: 'string',
			description: 'Path to save the output',
		})
		.option('tools', {
			type: 'array',
			choices: ['web_search', 'run_code', 'fetch_urls', 'all'],
			description: 'Tools to use',
			default: ['all'],
		})
		.conflicts('request', 'request-file')
		.help()
		.parseSync();

	return {
		model: argv.model as CliArgs['model'],
		reasoningEffort: argv['reasoning-effort'] as CliArgs['reasoningEffort'],
		request: argv.request,
		requestFile: argv['request-file'],
		outputFile: argv['output-file'],
		tools: argv.tools as CliArgs['tools'],
	};
}
