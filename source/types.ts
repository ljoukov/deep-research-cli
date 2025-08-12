export type CliArgs = {
	model?: 'o3' | 'o3-deep-research' | 'o3-pro' | 'gpt-5' | 'gpt-5-mini';
	request?: string;
	requestFile?: string;
	outputFile?: string;
};

export type ChatMessage = {
	role: 'user' | 'assistant';
	content: string;
	timestamp: Date;
};

export type ResponseStreamEvent = {
	type:
		| 'created'
		| 'in_progress'
		| 'thinking'
		| 'output'
		| 'tool_use'
		| 'tool_continuation'
		| 'error'
		| 'complete';
	content?: string;
	delta?: string;
	toolName?: string;
	toolStatus?: string;
	responseId?: string;
	model?: string;
	usage?: {
		completion_tokens: number;
		prompt_tokens: number;
		total_tokens: number;
		cost?: {
			prompt: number;
			completion: number;
			total: number;
		};
	};
	urlMetrics?: Array<{
		url: string;
		startTime: number;
		endTime: number;
		sizeBytes: number;
	}>;
	toolResult?: string;
	requestedUrls?: string[];
	urlFetchResults?: UrlFetchResult[];
};

export type UrlFetchResult = {
	url: string;
	content: string;
	metrics: {
		url: string;
		latency: number;
		sizeBytes: number;
		sizeFormatted: string;
	};
};

export type StreamingState =
	| 'idle'
	| 'created'
	| 'in_progress'
	| 'thinking'
	| 'responding'
	| 'error'
	| 'complete';

export interface StreamMetrics {
	startTime: number;
	endTime?: number;
	usage?: {
		completion_tokens: number;
		prompt_tokens: number;
		total_tokens: number;
		cost?: {
			prompt: number;
			completion: number;
			total: number;
		};
	};
	urlFetches?: Array<{
		url: string;
		startTime: number;
		endTime: number;
		sizeBytes: number;
	}>;
}
