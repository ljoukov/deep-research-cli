export interface CliArgs {
	model?: 'o3' | 'o3-deep-research' | 'o3-pro' | 'gpt-5';
	request?: string;
	requestFile?: string;
	outputFile?: string;
}

export interface ResponseStreamEvent {
	type: 'thinking' | 'output' | 'tool_use' | 'error' | 'complete';
	content?: string;
	delta?: string;
	toolName?: string;
	toolStatus?: string;
}

export type StreamingState =
	| 'idle'
	| 'thinking'
	| 'responding'
	| 'error'
	| 'complete';
