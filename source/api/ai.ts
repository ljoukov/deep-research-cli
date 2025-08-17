import {createOpenAI} from '@ai-sdk/openai';
import {streamText, tool} from 'ai';
import {z} from 'zod';
import {runModal} from './modal.js';
import type {ChatMessage, CliArgs, Model, ReasoningEffort} from '../types.js';

async function fetchUrls(urls: string[]): Promise<string> {
	const fetchPromises = urls.map(async url => {
		try {
			const jinaUrl = `http://127.0.0.1:3000/${url}`;
			const response = await fetch(jinaUrl);

			if (!response.ok) {
				return `Error fetching ${url}: ${response.status} ${response.statusText}`;
			}

			const content = await response.text();
			return `# Content from ${url}\n\n${content}`;
		} catch (error: unknown) {
			return `Error fetching ${url}: ${
				error instanceof Error ? error.message : 'Unknown error'
			}`;
		}
	});

	const individualContent = await Promise.all(fetchPromises);
	return individualContent.join('\n\n---\n\n');
}

export async function streamResponse(
	apiKey: string,
	model: Model,
	reasoningEffort: ReasoningEffort,
	input: string,
	conversationHistory: ChatMessage[] = [],
	tools: CliArgs['tools'],
) {
	// Reasoning effort is currently unused but kept for API shape consistency.
	// Mark as used to satisfy noUnusedParameters.
	void reasoningEffort;
	const openai = createOpenAI({
		apiKey,
	});

	const messages = [
		...conversationHistory,
		{
			role: 'user' as const,
			content: input,
		},
	];

	const allTools = {
		fetch_urls: tool({
			description:
				'Fetch content from one or more URLs and return them in markdown format. Prefer this tool if you need to obtain contents of 1 or more URLs. It works with regular websites and PDFs. Eg. wit ArXiv https://arxiv.org/pdf/YYMM.xxxxx would return the paper in markdown format',
			inputSchema: z.object({
				urls: z
					.array(z.string())
					.describe('Array of URLs to fetch content from'),
			}),
			execute: async ({urls}) => fetchUrls(urls),
		}),
		runCode: tool({
			description:
				'Runs supplied Python3 code as a stand-alone script and returns its standard output',
			inputSchema: z.object({
				code: z.string().describe('Python code to execute'),
			}),
			execute: async ({code}) => runModal(code),
		}),
	};

	const mapCliToolToSdkTool = (
		t: CliArgs['tools'][number] | undefined,
	): keyof typeof allTools | 'auto' => {
		switch (t) {
			case 'fetch_urls':
				return 'fetch_urls';
			case 'run_code':
				return 'runCode';
			default:
				return 'auto';
		}
	};

	const mappedTool = mapCliToolToSdkTool(tools[0]);

	const result = await streamText({
		model: openai(model),
		messages,
		tools: allTools,
		toolChoice:
			mappedTool === 'auto' ? 'auto' : {type: 'tool', toolName: mappedTool},
	});

	return result;
}
