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
		| 'error'
		| 'complete';
	content?: string;
	delta?: string;
	toolName?: string;
	toolStatus?: string;
	responseId?: string;
	model?: string;
};

export type StreamingState =
	| 'idle'
	| 'created'
	| 'in_progress'
	| 'thinking'
	| 'responding'
	| 'error'
	| 'complete';
