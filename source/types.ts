export type Model =
	| 'o3'
	| 'o3-deep-research'
	| 'o3-pro'
	| 'gpt-5'
	| 'gpt-5-mini'
	| 'gpt-5-nano';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export type Tool = 'web_search' | 'run_code' | 'fetch_urls' | 'all';

export type CliArgs = {
	model: Model;
	reasoningEffort: ReasoningEffort;
	request?: string;
	requestFile?: string;
	outputFile?: string;
	tools: Tool[];
};

export type ChatMessage = {
	role: 'user' | 'assistant';
	content: string;
	timestamp?: Date;
};

export type Usage = {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	cached_tokens?: number;
	thinking_tokens?: number;
	cost?: number;
};
