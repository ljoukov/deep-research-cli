export interface CliArgs {
	model?: 'o3' | 'o3-deep-research' | 'o3-pro' | 'gpt-5';
	request?: string;
	requestFile?: string;
	outputFile?: string;
}

export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
	timestamp: Date;
}

export interface ResponseStreamEvent {
	type: 'created' | 'in_progress' | 'thinking' | 'output' | 'tool_use' | 'error' | 'complete';
	content?: string;
	delta?: string;
	toolName?: string;
	toolStatus?: string;
	responseId?: string;
	model?: string;
}

export type StreamingState =
	| 'idle'
	| 'created'
	| 'in_progress'
	| 'thinking'
	| 'responding'
	| 'error'
	| 'complete';
