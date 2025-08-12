import OpenAI from 'openai';
import type {ResponseStreamEvent} from '../types.js';

export class OpenAIClient {
	private client: OpenAI;

	constructor(apiKey: string) {
		this.client = new OpenAI({
			apiKey,
		});
	}

	async *streamResponse(
		model: string,
		input: string,
		onEvent?: (event: ResponseStreamEvent) => void,
	): AsyncGenerator<ResponseStreamEvent> {
		try {
			const runner = (this.client.responses as any).stream({
				model,
				input,
				text: {},
				reasoning: {summary: 'auto'},
				tools: [{type: 'web_search_preview'}],
			});

			// Listen to events
			runner.on('response.reasoning_text.delta', (diff: any) => {
				const streamEvent: ResponseStreamEvent = {
					type: 'thinking',
					delta: diff.delta,
				};
				onEvent?.(streamEvent);
			});

			runner.on('response.output_text.delta', (diff: any) => {
				const streamEvent: ResponseStreamEvent = {
					type: 'output',
					delta: diff.delta,
				};
				onEvent?.(streamEvent);
			});

			for await (const event of runner) {
				// Handle different event types from the Responses API
				const eventType = event.type || event.event;

				if (eventType === 'response.reasoning_text.delta') {
					yield {
						type: 'thinking',
						delta: (event as any).delta,
					};
				} else if (eventType === 'response.output_text.delta') {
					yield {
						type: 'output',
						delta: (event as any).delta,
					};
				} else if (eventType === 'response.web_search_call.searching') {
					yield {
						type: 'tool_use',
						toolName: 'web_search',
						toolStatus: 'searching',
						content: 'Searching the web...',
					};
				} else if (eventType === 'response.web_search_call.completed') {
					yield {
						type: 'tool_use',
						toolName: 'web_search',
						toolStatus: 'completed',
						content: 'Web search completed',
					};
				} else if (eventType === 'response.completed') {
					yield {
						type: 'complete',
					};
				}
			}
		} catch (error) {
			const streamEvent: ResponseStreamEvent = {
				type: 'error',
				content: error instanceof Error ? error.message : 'Unknown error',
			};
			onEvent?.(streamEvent);
			yield streamEvent;
		}
	}
}
