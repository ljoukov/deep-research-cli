#!/usr/bin/env bun
import {render} from 'ink';
import dotenv from 'dotenv';
import App from './app.js';
import {parseArgs} from './utils/args.js';

// Load environment variables
dotenv.config();

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
