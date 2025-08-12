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
} from '../types.js';

export class OpenAiClient {
	private readonly client: OpenAI;

	constructor(apiKey: string) {
		this.client = new OpenAI({
			apiKey,
		});
	}

	private async fetchUrls(
		urls: string[],
		metrics: StreamMetrics,
	): Promise<{content: string; urlMetrics: StreamMetrics['urlFetches']}> {
		const urlMetrics: NonNullable<StreamMetrics['urlFetches']> = [];

		const fetchPromises = urls.map(async url => {
			const startTime = Date.now();
			try {
				const jinaUrl = `https://r.jina.ai/${url}`;
				const response = await fetch(jinaUrl);
				const endTime = Date.now();

				if (!response.ok) {
					urlMetrics.push({
						url,
						startTime,
						endTime,
						sizeBytes: 0,
					});
					return `Error fetching ${url}: ${response.status} ${response.statusText}`;
				}

				const content = await response.text();
				const sizeBytes = new TextEncoder().encode(content).length;

				urlMetrics.push({
					url,
					startTime,
					endTime,
					sizeBytes,
				});

				return `# Content from ${url}\n\n${content}`;
			} catch (error) {
				const endTime = Date.now();
				urlMetrics.push({
					url,
					startTime,
					endTime,
					sizeBytes: 0,
				});
				return `Error fetching ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`;
			}
		});

		const results = await Promise.all(fetchPromises);
		return {
			content: results.join('\n\n---\n\n'),
			urlMetrics,
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

							const fetchResult = await this.fetchUrls(urls, metrics);

							// Add URL metrics to overall metrics
							if (fetchResult.urlMetrics) {
								metrics.urlFetches = [
									...(metrics.urlFetches || []),
									...fetchResult.urlMetrics,
								];
							}

							// Store the tool call result for continuation
							toolCallResults.push({
								toolName: 'fetch_urls',
								args,
								result: fetchResult.content,
							});

							// Mark that we need continuation
							needsContinuation = true;

							// Create completion status event with metrics
							const completedEvent: ResponseStreamEvent = {
								type: 'tool_use',
								toolName: 'fetch_urls',
								toolStatus: 'completed',
								content: `Fetched ${urls.length} URL(s) - ${fetchResult.content.length} chars: ${urlsPreview}`,
								urlMetrics: fetchResult.urlMetrics,
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
							metrics.usage = responseUsage || undefined;

							yield {
								type: 'complete',
								usage: responseUsage || undefined,
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

			// If tools were called, continue the conversation with the tool results
			if (needsContinuation && toolCallResults.length > 0) {
				// Add tool results to the conversation
				for (const toolResult of toolCallResults) {
					// Add the assistant's tool call message
					messages.push({
						role: 'assistant' as const,
						content: `I'll fetch the requested content for you.`,
					} satisfies EasyInputMessage);

					// Add the tool result as a user message (this is how we pass tool results back)
					messages.push({
						role: 'user' as const,
						content: `Tool result for ${toolResult.toolName}:\n${toolResult.result}`,
					} satisfies EasyInputMessage);
				}

				// Create a continuation stream with the updated conversation
				const continuationStream = await this.client.responses.create({
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

				// Stream the continuation response
				for await (const event of continuationStream) {
					// eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
					switch (event.type) {
						case 'response.created': {
							// Skip re-emitting created event
							break;
						}

						case 'response.in_progress': {
							// Skip re-emitting in_progress event
							break;
						}

						case 'response.output_item.added': {
							if (event.item?.type === 'reasoning') {
								const streamEvent: ResponseStreamEvent = {
									type: 'thinking',
									content: '',
								};
								yield streamEvent;
							}
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

						case 'response.output_text.delta': {
							const streamEvent: ResponseStreamEvent = {
								type: 'output',
								delta: event.delta,
							};
							yield streamEvent;
							break;
						}

						case 'response.completed': {
							// Extract usage information from continuation
							if (event.response?.usage) {
								responseUsage = event.response.usage as ResponseUsage;
							}

							metrics.endTime = Date.now();
							metrics.usage = responseUsage || undefined;

							yield {
								type: 'complete',
								usage: responseUsage || undefined,
							};
							break;
						}

						default: {
							// Handle other events as needed
							break;
						}
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
