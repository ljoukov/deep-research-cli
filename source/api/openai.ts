import OpenAI from 'openai';
import type {
	ResponseInput,
	EasyInputMessage,
	ResponseUsage,
	Tool,
	FunctionTool,
} from 'openai/resources/responses/responses.js';
import type {
	ResponseStreamEvent,
	ChatMessage,
	StreamMetrics,
	UrlFetchResult,
	Usage,
	Model,
	ReasoningEffort,
	CliArgs,
} from '../types.js';
import {z} from 'zod';
import {runModal} from './modal.js';

const modelPricing = {
	'gpt-5': {
		input: 1.25 / 1_000_000,
		output: 10 / 1_000_000,
	},
	'gpt-5-mini': {
		input: 0.25 / 1_000_000,
		output: 2 / 1_000_000,
	},
	'gpt-5-nano': {
		input: 0.05 / 1_000_000,
		output: 0.4 / 1_000_000,
	},
	o3: {
		input: 0.5 / 1_000_000,
		output: 1.5 / 1_000_000,
	},
	'o3-deep-research': {
		input: 1 / 1_000_000,
		output: 3 / 1_000_000,
	},
	'o3-pro': {
		input: 2 / 1_000_000,
		output: 6 / 1_000_000,
	},
};

function calculateUsage(
	model: string,
	usage: ResponseUsage | null | undefined,
): Usage | undefined {
	if (!usage) {
		return undefined;
	}

	const modelKey = model as keyof typeof modelPricing;
	const prices = modelPricing[modelKey];
	let cost: number | undefined;

	const cached_tokens = usage.input_tokens_details?.cached_tokens || 0;
	if (prices) {
		const inputCost = usage.input_tokens * prices.input;
		const cachedInputCost = (cached_tokens * prices.input) / 10;
		const outputCost = usage.output_tokens * prices.output;
		cost = inputCost + cachedInputCost + outputCost;
	}

	return {
		prompt_tokens: usage.input_tokens,
		completion_tokens: usage.output_tokens,
		total_tokens: usage.total_tokens,
		cached_tokens,
		thinking_tokens: usage.output_tokens_details?.reasoning_tokens || 0,
		cost,
	};
}

const fetchUrlsTool: FunctionTool = {
	type: 'function',
	name: 'fetch_urls',
	description:
		'Fetch content from one or more URLs and return them in markdown format. Prefer this tool if you need to obtain contents of 1 or more URLs. It works with regular websites and PDFs. Eg. wit ArXiv https://arxiv.org/pdf/YYMM.xxxxx would return the paper in markdown format',
	parameters: {
		type: 'object',
		properties: {
			urls: {
				type: 'array',
				items: {type: 'string'},
				description: 'Array of URLs to fetch content from',
			},
		},
		required: ['urls'],
		additionalProperties: false,
	},
	strict: true,
};

const runCodeTool: FunctionTool = {
	type: 'function',
	name: 'runCode',
	description:
		'Runs supplied Python3 code as a stand-alone script and returns its standard output',
	parameters: {
		type: 'object',
		properties: {
			code: {
				type: 'string',
				description: 'Python code to execute',
			},
		},
		required: ['code'],
		additionalProperties: false,
	},
	strict: true,
};

const webSearchTool: Tool = {type: 'web_search_preview'};

export class OpenAiClient {
	private readonly client: OpenAI;

	constructor(apiKey: string) {
		this.client = new OpenAI({
			apiKey,
		});
	}

	private async fetchUrls(urls: string[]): Promise<{
		combinedContent: string;
		results: UrlFetchResult[];
	}> {
		const results: UrlFetchResult[] = [];

		const fetchPromises = urls.map(async url => {
			const startTime = Date.now();
			try {
				const jinaUrl = `http://127.0.0.1:3000/${url}`;
				const response = await fetch(jinaUrl);
				const endTime = Date.now();
				const latency = endTime - startTime;

				if (!response.ok) {
					const errorContent = `Error fetching ${url}: ${response.status} ${response.statusText}`;
					results.push({
						url,
						content: errorContent,
						metrics: {url, latency, sizeBytes: 0, sizeFormatted: '0B'},
					});
					return errorContent;
				}

				const content = await response.text();
				const sizeBytes = new TextEncoder().encode(content).length;
				const sizeFormatted =
					sizeBytes < 1024
						? `${sizeBytes}B`
						: `${(sizeBytes / 1024).toFixed(1)}KB`;

				results.push({
					url,
					content,
					metrics: {url, latency, sizeBytes, sizeFormatted},
				});
				return `# Content from ${url}\n\n${content}`;
			} catch (error: unknown) {
				const endTime = Date.now();
				const latency = endTime - startTime;
				const errorContent = `Error fetching ${url}: ${
					error instanceof Error ? error.message : 'Unknown error'
				}`;
				results.push({
					url,
					content: errorContent,
					metrics: {url, latency, sizeBytes: 0, sizeFormatted: '0B'},
				});
				return errorContent;
			}
		});

		const individualContent = await Promise.all(fetchPromises);
		const combinedContent = individualContent.join('\n\n---\n\n');

		return {
			combinedContent,
			results,
		};
	}

	async *streamResponse(
		model: Model,
		reasoningEffort: ReasoningEffort,
		input: string,
		conversationHistory: ChatMessage[] = [],
		tools: CliArgs['tools'],
	): AsyncGenerator<ResponseStreamEvent> {
		const messages: ResponseInput = [
			...conversationHistory.map(
				message =>
					({
						role: message.role,
						content: message.content,
					}) satisfies EasyInputMessage,
			),
			{
				role: 'user' as const,
				content: input,
			} satisfies EasyInputMessage,
		];

		yield* this._streamHandler(model, reasoningEffort, messages, false, tools);
	}

	async *continueStreamResponse(
		model: Model,
		reasoningEffort: ReasoningEffort,
		conversation: ChatMessage[],
		tools: CliArgs['tools'],
	): AsyncGenerator<ResponseStreamEvent> {
		const messages: ResponseInput = conversation.map(
			msg =>
				({
					role: msg.role,
					content: msg.content,
				}) satisfies EasyInputMessage,
		);

		yield* this._streamHandler(model, reasoningEffort, messages, true, tools);
	}

	private async *_streamHandler(
		model: Model,
		reasoningEffort: ReasoningEffort,
		messages: ResponseInput,
		isContinuation: boolean,
		cliTools: CliArgs['tools'],
	): AsyncGenerator<ResponseStreamEvent> {
		const metrics: StreamMetrics = {
			startTime: Date.now(),
			urlFetches: [],
		};
		let responseUsage: ResponseUsage | null = null;

		try {
			const toolCallResults: Array<{
				toolName: string;
				args: any;
				result: string;
				results: UrlFetchResult[];
			}> = [];
			let needsContinuation = false;
			let requestedUrls: string[] = [];

			const availableTools: Tool[] = [];
			if (
				reasoningEffort !== 'minimal' &&
				(cliTools.includes('web_search') || cliTools.includes('all'))
			) {
				availableTools.push(webSearchTool);
			}
			if (
				model !== 'o3-deep-research' &&
				(cliTools.includes('fetch_urls') || cliTools.includes('all'))
			) {
				availableTools.push(fetchUrlsTool);
			}
			if (
				model !== 'o3-deep-research' &&
				(cliTools.includes('run_code') || cliTools.includes('all'))
			) {
				availableTools.push(runCodeTool);
			}

			const stream = await this.client.responses.create({
				model,
				input: messages,
				stream: true,
				reasoning: {summary: 'detailed', effort: reasoningEffort},
				tools: availableTools,
			});
			let currentToolName: string | undefined;

			for await (const event of stream) {
				switch (event.type) {
					case 'response.created':
						if (!isContinuation) {
							yield {
								type: 'created',
								responseId: event.response?.id,
								model: event.response?.model,
								content: 'Response created',
							};
						}
						break;

					case 'response.in_progress':
						if (!isContinuation) {
							yield {
								type: 'in_progress',
								responseId: event.response?.id,
								content: 'Response in progress',
							};
						}
						break;

					case 'response.output_item.added':
						if (event.item.type == 'function_call') {
							currentToolName = event.item.name;
							yield {
								type: 'tool_use',
								toolName: currentToolName,
								toolStatus: 'processing',
								delta: '',
							};
						} else {
							currentToolName = undefined;
						}
						if (event.item.type == 'reasoning') {
							yield {type: 'thinking', content: ''};
						}
						break;

					case 'response.reasoning_summary_part.added':
						yield {type: 'thinking', delta: '\n\n'};
						break;

					case 'response.reasoning_summary_text.delta':
						yield {type: 'thinking', delta: event.delta};
						break;

					case 'response.reasoning_summary_text.done':
						break;

					case 'response.output_text.delta':
						yield {type: 'output', delta: event.delta};
						break;

					case 'response.function_call_arguments.delta':
						if (!isContinuation) {
							yield {
								type: 'tool_use',
								toolName: currentToolName,
								toolStatus: 'processing',
								delta: event.delta,
							};
						}
						break;

					case 'response.output_item.done':
						if (event.item.type === 'function_call' && !isContinuation) {
							const toolName = event.item.name;
							switch (event.item.name) {
								case fetchUrlsTool.name:
									{
										yield {
											type: 'tool_use',
											toolName,
											toolStatus: 'executing',
											content: 'Fetching URLs...',
										};
										try {
											const args = JSON.parse(event.item.arguments || '{}');
											const urls = args.urls || [];
											const urlsPreview =
												urls.join(', ').slice(0, 100) +
												(urls.join(', ').length > 100 ? '...' : '');
											yield {
												type: 'tool_use',
												toolName,
												toolStatus: 'executing',
												content: `Fetching ${urls.length} URL(s): ${urlsPreview}`,
											};

											requestedUrls = urls;
											const fetchResult = await this.fetchUrls(urls);
											const urlMetrics = fetchResult.results.map(r => ({
												url: r.url,
												startTime: 0,
												endTime: 0,
												sizeBytes: r.metrics.sizeBytes,
											}));
											metrics.urlFetches = [
												...(metrics.urlFetches || []),
												...urlMetrics,
											];

											toolCallResults.push({
												toolName,
												args,
												result: fetchResult.combinedContent,
												results: fetchResult.results,
											});
											needsContinuation = true;

											yield {
												type: 'tool_use',
												toolName,
												toolStatus: 'completed',
												content: `Fetched ${urls.length} URL(s) - ${fetchResult.combinedContent.length} chars: ${urlsPreview}`,
												urlMetrics,
											};
										} catch (error: unknown) {
											yield {
												type: 'tool_use',
												toolName,
												toolStatus: 'error',
												content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
											};
										}
									}
									break;
								case runCodeTool.name:
									{
										yield {
											type: 'tool_use',
											toolName,
											toolStatus: 'executing',
											content: 'Running the code...',
										};
										const runCodeArgsSchema = z.object({
											code: z.string(),
										});
										try {
											const args = runCodeArgsSchema.parse(
												JSON.parse(event.item.arguments || '{}'),
											);
											const codeResult = await runModal(args.code);
											toolCallResults.push({
												toolName,
												args,
												result: codeResult,
												results: [],
											});
											needsContinuation = true;

											yield {
												type: 'tool_use',
												toolName,
												toolStatus: 'completed',
												content: 'Executed the code',
											};
										} catch (err) {
											yield {
												type: 'tool_use',
												toolName,
												toolStatus: 'error',
												content: `Invalid arguments for runCode: ${err instanceof Error ? err.message : 'Unknown error'}`,
											};
										}
										//										console.dir({event});
									}
									break;
							}
						}

						break;

					case 'response.completed':
						if (event.response?.usage) {
							responseUsage = event.response.usage as ResponseUsage;
						}

						if (!needsContinuation) {
							metrics.endTime = Date.now();
							const finalUsage = calculateUsage(model, responseUsage);
							metrics.usage = finalUsage;
							yield {type: 'complete', usage: finalUsage};
						}
						break;

					default:
						break;
				}
			}

			if (needsContinuation && toolCallResults.length > 0) {
				const toolResult = toolCallResults[0];
				if (toolResult) {
					yield {
						type: 'tool_continuation',
						toolName: toolResult.toolName,
						toolResult: toolResult.result,
						requestedUrls,
						urlMetrics: metrics.urlFetches,
						urlFetchResults: toolResult.results,
						usage: calculateUsage(model, responseUsage),
					};
				}
			}
		} catch (error: unknown) {
			yield {
				type: 'error',
				content: error instanceof Error ? error.message : 'Unknown error',
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}
}
