#!/usr/bin/env bun
import process from 'node:process';
import {render} from 'ink';
import App from './app.js';
import {parseArgs} from './utils/args.js';
import {SessionLogger} from './utils/logger.js';
import chalk from 'chalk';

const main = async () => {
	const logger = new SessionLogger();
	try {
		// Parse arguments
		const args = parseArgs();

		// Check for API key
		const apiKey = process.env['OPENAI_API_KEY'];
		if (!apiKey) {
			console.error(
				chalk.red.bold(
					'❌ Error: OPENAI_API_KEY not found in environment variables',
				),
			);
			console.error(
				chalk.yellow('Please add OPENAI_API_KEY to your .env file'),
			);
			process.exit(1);
		}

		// Render the app
		const app = render(<App args={args} apiKey={apiKey} />);
		await app.waitUntilExit();
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error));
		await logger.logFatalError(err);
		process.exit(1);
	}
};

main().catch(error => {
	// This is a fallback for any error that might slip through main's try/catch
	console.error(
		chalk.red.bold('An unexpected error occurred in the CLI:'),
		error,
	);
	process.exit(1);
});
