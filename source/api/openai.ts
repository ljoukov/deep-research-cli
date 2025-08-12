import OpenAI from 'openai';
import type {ResponseStreamEvent, ChatMessage} from '../types.js';
import type {
	ResponseInput,
	EasyInputMessage,
} from 'openai/resources/responses/responses.js';

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
		conversationHistory: ChatMessage[] = [],
		onEvent?: (event: ResponseStreamEvent) => void,
	): AsyncGenerator<ResponseStreamEvent> {
		try {
			// Build properly typed conversation input
			const messages: ResponseInput = [
				...conversationHistory.map(
					msg =>
						({
							role: msg.role,
							content: msg.content,
						}) as EasyInputMessage,
				),
				{
					role: 'user' as const,
					content: input,
				} as EasyInputMessage,
			];

			const stream = await this.client.responses.create({
				model: model,
				input: messages,
				stream: true,
				reasoning: {summary: 'detailed'},
				tools: [{type: 'web_search_preview'}],
			});

			for await (const event of stream) {
				// Handle incremental text content
				switch (event.type) {
					// Connection and initialization events
					case 'response.created': {
						const streamEvent: ResponseStreamEvent = {
							type: 'created',
							responseId: event.response?.id,
							model: event.response?.model,
							content: 'Response created',
						};
						onEvent?.(streamEvent);
						yield streamEvent;
						break;
					}
					case 'response.in_progress': {
						const streamEvent: ResponseStreamEvent = {
							type: 'in_progress',
							responseId: event.response?.id,
							content: 'Response in progress',
						};
						onEvent?.(streamEvent);
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
							onEvent?.(streamEvent);
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
						onEvent?.(streamEvent);
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
						onEvent?.(streamEvent);
						yield streamEvent;
						break;
					}
					case 'response.completed': {
						yield {
							type: 'complete',
						};
						break;
					}
					default: {
						// Uncomment if need to debug
						// console.log('Unhandled event type:', event.type, event);
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
			onEvent?.(streamEvent);
			yield streamEvent;
		}
	}
}
