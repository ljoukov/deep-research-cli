#!/usr/bin/env bun
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import dotenv from 'dotenv';
import App from './app.js';
import {parseArgs} from './utils/args.js';

// Load environment variables
dotenv.config();

const cli = meow(
	`
	Usage
	  $ deep-research

	Options
	  --model            Model to use (o3, o3-deep-research, o3-pro, gpt-5)
	  --request          Direct request text
	  --request-file     Path to file containing the request
	  --output-file      Path to save the output

	Examples
	  $ deep-research --model o3 --request "What is quantum computing?"
	  $ deep-research --request-file ./prompt.txt --output-file ./response.md
	  $ deep-research  # Interactive mode
`,
	{
		importMeta: import.meta,
		flags: {
			model: {
				type: 'string',
				default: 'o3-deep-research',
			},
			request: {
				type: 'string',
			},
			requestFile: {
				type: 'string',
			},
			outputFile: {
				type: 'string',
			},
		},
	},
);

// Parse arguments
const args = parseArgs();

// Check for API key
const apiKey = process.env['OPENAI_API_KEY'];
if (!apiKey) {
	console.error('❌ Error: OPENAI_API_KEY not found in environment variables');
	console.error('Please add OPENAI_API_KEY to your .env file');
	process.exit(1);
}

// Render the app
render(<App args={args} apiKey={apiKey} />);
