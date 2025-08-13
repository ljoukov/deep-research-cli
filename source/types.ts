export type Model =
	| 'o3'
	| 'o3-deep-research'
	| 'o3-pro'
	| 'gpt-5'
	| 'gpt-5-mini';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export type CliArgs = {
	model: Model;
	reasoningEffort: ReasoningEffort;
	request?: string;
	requestFile?: string;
	outputFile?: string;
};

export type ChatMessage = {
	role: 'user' | 'assistant';
	content: string;
	timestamp: Date;
};

export type Usage = {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	cached_tokens?: number;
	thinking_tokens?: number;
	cost?: number;
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
	usage?: Usage;
	urlMetrics?: Array<{
		url: string;
		startTime: number;
		endTime: number;
		sizeBytes: number;
	}>;
	toolResult?: string;
	requestedUrls?: string[];
	urlFetchResults?: UrlFetchResult[];
	error?: Error;
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

export type StreamMetrics = {
	startTime: number;
	endTime?: number;
	usage?: Usage;
	urlFetches?: Array<{
		url: string;
		startTime: number;
		endTime: number;
		sizeBytes: number;
	}>;
};
