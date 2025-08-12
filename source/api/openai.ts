import OpenAI from 'openai';
import type {
	ResponseInput,
	EasyInputMessage,
	ResponseUsage,
} from 'openai/resources/responses/responses.js';
import type {
	ResponseStreamEvent,
	ChatMessage,
	StreamMetrics,
	UrlFetchResult,
	Usage,
} from '../types.js';

const modelPricing = {
	'gpt-5': {
		input: 1.25 / 1_000_000,
		output: 10 / 1_000_000,
	},
	'gpt-5-mini': {
		input: 0.25 / 1_000_000,
		output: 2 / 1_000_000,
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

	if (prices) {
		const inputCost = usage.input_tokens * prices.input;
		const outputCost = usage.output_tokens * prices.output;
		cost = inputCost + outputCost;
	}

	return {
		prompt_tokens: usage.input_tokens,
		completion_tokens: usage.output_tokens,
		total_tokens: usage.total_tokens,
		cached_tokens: usage.input_tokens_details?.cached_tokens || 0,
		thinking_tokens: usage.output_tokens_details?.reasoning_tokens || 0,
		cost,
	};
}

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
				const jinaUrl = `https://r.jina.ai/${url}`;
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
			} catch (error) {
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
		model: string,
		input: string,
		conversationHistory: ChatMessage[] = [],
	): AsyncGenerator<ResponseStreamEvent> {
		const metrics: StreamMetrics = {
			startTime: Date.now(),
			urlFetches: [],
		};

		let responseUsage: ResponseUsage | null = null;

		try {
			// Build properly typed conversation input
			let messages: ResponseInput = [
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

			// Track tool calls and their results for continuation
			const toolCallResults: Array<{
				toolName: string;
				args: any;
				result: string;
				results: UrlFetchResult[];
			}> = [];

			// Flag to track if we need to continue after tool calls
			let needsContinuation = false;

			// Store requested URLs for logging
			let requestedUrls: string[] = [];

			const stream = await this.client.responses.create({
				model,
				input: messages,
				stream: true,
				reasoning: {summary: 'detailed'},
				tools: [
					{type: 'web_search_preview'},
					{
						type: 'function',
						name: 'fetch_urls',
						description:
							'Fetch content from one or more URLs and return them in markdown format',
						parameters: {
							type: 'object',
							properties: {
								urls: {
									type: 'array',
									items: {
										type: 'string',
									},
									description: 'Array of URLs to fetch content from',
								},
							},
							required: ['urls'],
							additionalProperties: false,
						},
						strict: true,
					},
				],
			});

			for await (const event of stream) {
				// Handle incremental text content
				// eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
				switch (event.type) {
					// Connection and initialization events
					case 'response.created': {
						const streamEvent: ResponseStreamEvent = {
							type: 'created',
							responseId: event.response?.id,
							model: event.response?.model,
							content: 'Response created',
						};

						yield streamEvent;
						break;
					}

					case 'response.in_progress': {
						const streamEvent: ResponseStreamEvent = {
							type: 'in_progress',
							responseId: event.response?.id,
							content: 'Response in progress',
						};

						yield streamEvent;
						break;
					}

					// Reasoning/thinking events
					case 'response.output_item.added': {
						// New reasoning item started
						if (event.item?.type === 'reasoning') {
							const streamEvent: ResponseStreamEvent = {
								type: 'thinking',
								content: '',
							};

							yield streamEvent;
						}

						break;
					}

					case 'response.reasoning_summary_part.added': {
						// New summary part added
						break;
					}

					case 'response.reasoning_summary_text.delta': {
						const streamEvent: ResponseStreamEvent = {
							type: 'thinking',
							delta: event.delta,
						};

						yield streamEvent;
						break;
					}

					case 'response.reasoning_summary_text.done': {
						// Thinking section is complete
						break;
					}

					// Regular output events
					case 'response.output_text.delta': {
						const streamEvent: ResponseStreamEvent = {
							type: 'output',
							delta: event.delta,
						};

						yield streamEvent;
						break;
					}

					// Function tool call events
					case 'response.function_call_arguments.delta': {
						const streamEvent: ResponseStreamEvent = {
							type: 'tool_use',
							toolName: 'fetch_urls',
							toolStatus: 'processing',
							delta: event.delta,
						};

						yield streamEvent;
						break;
					}

					case 'response.function_call_arguments.done': {
						// Function call arguments are complete, execute the function
						// The event has arguments but no function name/id in this event type
						// We'll assume this is for our fetch_urls function since it's the only one we defined
						const streamEvent: ResponseStreamEvent = {
							type: 'tool_use',
							toolName: 'fetch_urls',
							toolStatus: 'executing',
							content: 'Fetching URLs...',
						};

						yield streamEvent;

						try {
							// Parse arguments and execute function
							const args = JSON.parse(event.arguments || '{}');
							const urls = args.urls || [];

							const urlsPreview =
								urls.join(', ').slice(0, 100) +
								(urls.join(', ').length > 100 ? '...' : '');
							const streamEvent: ResponseStreamEvent = {
								type: 'tool_use',
								toolName: 'fetch_urls',
								toolStatus: 'executing',
								content: `Fetching ${urls.length} URL(s): ${urlsPreview}`,
							};

							yield streamEvent;

							// Store requested URLs for logging
							requestedUrls = urls;

							const fetchResult = await this.fetchUrls(urls);

							// Add URL metrics to overall metrics
							const urlMetrics = fetchResult.results.map(r => ({
								url: r.url,
								startTime: 0, // These are calculated in fetchUrls now
								endTime: 0,
								sizeBytes: r.metrics.sizeBytes,
							}));
							metrics.urlFetches = [
								...(metrics.urlFetches || []),
								...urlMetrics,
							];

							// Store the tool call result for continuation
							toolCallResults.push({
								toolName: 'fetch_urls',
								args,
								result: fetchResult.combinedContent,
								results: fetchResult.results,
							});

							// Mark that we need continuation
							needsContinuation = true;

							// Create completion status event with metrics
							const completedEvent: ResponseStreamEvent = {
								type: 'tool_use',
								toolName: 'fetch_urls',
								toolStatus: 'completed',
								content: `Fetched ${urls.length} URL(s) - ${fetchResult.combinedContent.length} chars: ${urlsPreview}`,
								urlMetrics,
							};

							yield completedEvent;
						} catch (error) {
							const errorEvent: ResponseStreamEvent = {
								type: 'tool_use',
								toolName: 'fetch_urls',
								toolStatus: 'error',
								content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
							};

							yield errorEvent;
						}
						break;
					}

					case 'response.completed': {
						// Extract usage information
						if (event.response?.usage) {
							responseUsage = event.response.usage as ResponseUsage;
						}

						// Don't yield complete yet if we need to continue with tool results
						if (!needsContinuation) {
							metrics.endTime = Date.now();
							const finalUsage = calculateUsage(model, responseUsage);
							metrics.usage = finalUsage;

							yield {
								type: 'complete',
								usage: finalUsage,
							};
						}
						break;
					}

					default: {
						// Uncomment if need to debug unhandled event types
						// console.log('Unhandled event type:', event.type, event);
						break;
					}
				}
			}

			// If tools were called, yield a continuation event
			if (needsContinuation && toolCallResults.length > 0) {
				const toolResult = toolCallResults[0];
				if (toolResult) {
					const continuationEvent: ResponseStreamEvent = {
						type: 'tool_continuation',
						toolName: toolResult.toolName,
						toolResult: toolResult.result,
						requestedUrls,
						urlMetrics: metrics.urlFetches,
						urlFetchResults: toolResult.results,
						usage: calculateUsage(model, responseUsage),
					};
					yield continuationEvent;
				}
			}
		} catch (error) {
			console.error('OpenAI streaming error:', error);
			const streamEvent: ResponseStreamEvent = {
				type: 'error',
				content: error instanceof Error ? error.message : 'Unknown error',
			};

			yield streamEvent;
		}
	}

	async *continueStreamResponse(
		model: string,
		conversation: ChatMessage[],
	): AsyncGenerator<ResponseStreamEvent> {
		let responseUsage: ResponseUsage | null = null;

		try {
			const messages: ResponseInput = conversation.map(
				msg =>
					({
						role: msg.role,
						content: msg.content,
					}) satisfies EasyInputMessage,
			);

			const stream = await this.client.responses.create({
				model,
				input: messages,
				stream: true,
				reasoning: {summary: 'detailed'},
				tools: [
					{type: 'web_search_preview'},
					{
						type: 'function',
						name: 'fetch_urls',
						description:
							'Fetch content from one or more URLs and return them in markdown format',
						parameters: {
							type: 'object',
							properties: {
								urls: {
									type: 'array',
									items: {
										type: 'string',
									},
									description: 'Array of URLs to fetch content from',
								},
							},
							required: ['urls'],
							additionalProperties: false,
						},
						strict: true,
					},
				],
			});

			for await (const event of stream) {
				// eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
				switch (event.type) {
					case 'response.created':
					case 'response.in_progress':
						// We can ignore these in continuation
						break;

					case 'response.output_item.added': {
						if (event.item?.type === 'reasoning') {
							yield {type: 'thinking', content: ''};
						}
						break;
					}

					case 'response.reasoning_summary_text.delta': {
						yield {type: 'thinking', delta: event.delta};
						break;
					}

					case 'response.output_text.delta': {
						yield {type: 'output', delta: event.delta};
						break;
					}

					case 'response.completed': {
						if (event.response?.usage) {
							responseUsage = event.response.usage as ResponseUsage;
						}
						yield {
							type: 'complete',
							usage: calculateUsage(model, responseUsage),
						};
						break;
					}
				}
			}
		} catch (error) {
			console.error('OpenAI streaming error:', error);
			const streamEvent: ResponseStreamEvent = {
				type: 'error',
				content: error instanceof Error ? error.message : 'Unknown error',
			};

			yield streamEvent;
		}
	}
}
