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
