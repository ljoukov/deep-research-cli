import {promises as fs} from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import type {Usage} from '../types.js';

export type InteractionMetrics = {
	timestamp: Date;
	model: string;
	duration: number; // Milliseconds
	usage?: {
		inputTokens: number;
		outputTokens: number;
		cachedTokens: number;
		thinkingTokens: number;
		totalTokens: number;
		cost?: {
			input: number;
			output: number;
			total: number;
		};
	};
	urlFetches?: UrlFetchMetrics[];
};

export type UrlFetchMetrics = {
	url: string;
	latency: number; // Milliseconds
	sizeBytes: number;
	sizeFormatted: string;
};

export type SessionStatus = {
	state:
		| 'starting'
		| 'thinking'
		| 'tool_calling'
		| 'fetching_urls'
		| 'responding'
		| 'complete'
		| 'error';
	currentInteraction: number;
	progress?: string;
	elapsedTime: number;
};

export type CumulativeMetrics = {
	totalDuration: number;
	totalInteractions: number;
	completedInteractions: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCachedTokens: number;
	totalThinkingTokens: number;
	totalCost: number;
	totalUrlFetches: number;
	interactions: Array<{
		number: string;
		status: string;
		duration: string;
		model: string;
		input: number;
		output: number;
		cached: number;
		urls: number;
		cost: string;
	}>;
};

export class SessionLogger {
	private readonly sessionDir: string;
	private interactionCount = 0;
	private readonly sessionStartTime: Date;
	private readonly cumulativeMetrics: CumulativeMetrics;
	private currentMetrics: InteractionMetrics | undefined;
	private currentStatus: SessionStatus;

	constructor() {
		this.sessionStartTime = new Date();
		const timestamp = this.sessionStartTime
			.toISOString()
			.replaceAll(':', '-')
			.replaceAll('.', '-')
			.replaceAll('/', '-')
			.replaceAll('Z', '');
		this.sessionDir = `logs-${timestamp}`;

		this.cumulativeMetrics = {
			totalDuration: 0,
			totalInteractions: 0,
			completedInteractions: 0,
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalCachedTokens: 0,
			totalThinkingTokens: 0,
			totalUrlFetches: 0,
			totalCost: 0,
			interactions: [],
		};

		this.currentStatus = {
			state: 'starting',
			currentInteraction: 0,
			elapsedTime: 0,
		};
	}

	public async startInteraction(model: string): Promise<void> {
		await this.ensureDirectory();
		this.interactionCount++;
		this.cumulativeMetrics.totalInteractions++;

		this.currentMetrics = {
			timestamp: new Date(),
			model,
			duration: 0,
		};

		this.currentStatus = {
			state: 'starting',
			currentInteraction: this.interactionCount,
			elapsedTime: 0,
		};

		await this.updateGlobalStats();
	}

	public async logRequest(content: string): Promise<void> {
		const filename = `${this.formatFileNumber(this.interactionCount)}-request.md`;
		const filepath = path.join(this.sessionDir, filename);
		await fs.writeFile(filepath, content, 'utf8');
	}

	public async logRequestFromUrlFetches(
		urlFetchResults: Array<{url: string; content: string; metrics: any}>,
	): Promise<void> {
		const filename = `${this.formatFileNumber(this.interactionCount)}-request.md`;
		const filepath = path.join(this.sessionDir, filename);
		let content = '# Fetched Content\n\n';
		for (const [index, result] of urlFetchResults.entries()) {
			const fetchFile = `${this.formatFileNumber(this.interactionCount)}-tool-fetch_url-${index + 1}.md`;
			content += `- [${result.url}](./${fetchFile})\n`;
		}

		await fs.writeFile(filepath, content, 'utf8');
	}

	public async logToolCall(toolName: string, args: any): Promise<void> {
		const filename = `${this.formatFileNumber(this.interactionCount)}-response.md`;
		const filepath = path.join(this.sessionDir, filename);

		let content = '';
		if (toolName === 'fetch_urls') {
			const urls: string[] = Array.isArray(args?.urls) ? args.urls : [];
			content += `Tool Call: Fetch URLs\n\n`;
			for (const url of urls) {
				content += `- [${url}](${url})\n`;
			}
		} else {
			content += `Tool Call: ${toolName}\n`;
			// Render simple key/values without JSON blocks
			if (args && typeof args === 'object') {
				for (const [key, value] of Object.entries(args)) {
					if (Array.isArray(value)) {
						content += `- ${key}: ${value.join(', ')}\n`;
					} else if (
						typeof value === 'string' ||
						typeof value === 'number' ||
						typeof value === 'boolean'
					) {
						content += `- ${key}: ${value}\n`;
					} else {
						// Fallback stringify for complex values
						content += `- ${key}: ${JSON.stringify(value)}\n`;
					}
				}
			}
		}

		await fs.writeFile(filepath, content, 'utf8');
	}

	public async logResponse(content: string, append = false): Promise<void> {
		const filename = `${this.formatFileNumber(this.interactionCount)}-response.md`;
		const filepath = path.join(this.sessionDir, filename);

		if (append) {
			await fs.appendFile(filepath, content, 'utf8');
		} else {
			await fs.writeFile(filepath, content, 'utf8');
		}
	}

	public async logReasoning(content: string, append = false): Promise<void> {
		const filename = `${this.formatFileNumber(this.interactionCount)}-response-reasoning.md`;
		const filepath = path.join(this.sessionDir, filename);

		if (append) {
			await fs.appendFile(filepath, content, 'utf8');
		} else {
			await fs.writeFile(filepath, content, 'utf8');
		}
	}

	public async logUrlFetchRequest(urls: string[]): Promise<void> {
		const filename = `${this.formatFileNumber(this.interactionCount)}-response-url-fetch.md`;
		const filepath = path.join(this.sessionDir, filename);

		let content = '# URL Fetch Request\n\n';
		content += 'The model requested to fetch the following URLs:\n\n';
		for (const [index, url] of urls.entries()) {
			content += `${index + 1}. ${url}\n`;
		}

		await fs.writeFile(filepath, content, 'utf8');
	}

	public async logUrlFetchResult(
		index: number,
		url: string,
		content: string,
		metrics: UrlFetchMetrics,
	): Promise<void> {
		// Log individual URL result
		const filename = `${this.formatFileNumber(this.interactionCount)}-tool-fetch_url-${index}.md`;
		const filepath = path.join(this.sessionDir, filename);

		let fileContent = `# URL Fetch Result ${index}\n\n`;
		fileContent += `**URL:** ${url}\n`;
		fileContent += `**Latency:** ${metrics.latency}ms\n`;
		fileContent += `**Size:** ${metrics.sizeFormatted}\n\n`;
		fileContent += '---\n\n';
		fileContent += content;

		await fs.writeFile(filepath, fileContent, 'utf8');

		// Update current metrics
		if (this.currentMetrics) {
			this.currentMetrics.urlFetches ??= [];
			this.currentMetrics.urlFetches.push(metrics);
		}

		this.cumulativeMetrics.totalUrlFetches++;
		await this.updateGlobalStats();
	}

	public async logCombinedUrlFetch(combinedContent: string): Promise<void> {
		const filename = `${this.formatFileNumber(this.interactionCount)}-request-url-fetch.md`;
		const filepath = path.join(this.sessionDir, filename);
		await fs.writeFile(filepath, combinedContent, 'utf8');
	}

	public async updateMetrics(
		usage: Usage | undefined,
		duration: number,
	): Promise<void> {
		if (this.currentMetrics) {
			this.currentMetrics.duration = duration;

			if (usage) {
				const promptTokens = usage.prompt_tokens ?? 0;
				const completionTokens = usage.completion_tokens ?? 0;
				const cachedTokens = usage.cached_tokens ?? 0;
				const thinkingTokens = usage.thinking_tokens ?? 0;
				const totalTokens = usage.total_tokens ?? 0;
				const cost = usage.cost ?? 0;

				this.currentMetrics.usage = {
					inputTokens: promptTokens,
					outputTokens: completionTokens,
					cachedTokens,
					thinkingTokens,
					totalTokens,
					cost: {
						input: 0,
						output: 0,
						total: cost,
					},
				};

				// Update cumulative
				this.cumulativeMetrics.totalInputTokens += promptTokens;
				this.cumulativeMetrics.totalOutputTokens += completionTokens;
				this.cumulativeMetrics.totalCachedTokens += cachedTokens;
				this.cumulativeMetrics.totalThinkingTokens += thinkingTokens;
				this.cumulativeMetrics.totalCost += cost;
			}
		}
	}

	public async logInteractionStats(): Promise<void> {
		if (!this.currentMetrics) {
			return;
		}

		const filename = `${this.formatFileNumber(this.interactionCount)}-stats.md`;
		const filepath = path.join(this.sessionDir, filename);

		let content = `# Interaction ${this.formatFileNumber(this.interactionCount)} Statistics\n\n`;
		content += `**Timestamp:** ${this.currentMetrics.timestamp.toISOString()}\n`;
		content += `**Model:** ${this.currentMetrics.model}\n`;
		content += `**Duration:** ${this.formatDuration(this.currentMetrics.duration)}\n\n`;

		if (this.currentMetrics.usage) {
			content += '## Tokens\n';
			content += `- Input: ${this.currentMetrics.usage.inputTokens}`;
			if (this.currentMetrics.usage.cachedTokens > 0) {
				content += ` (cached: ${this.currentMetrics.usage.cachedTokens})`;
			}

			content += '\n';
			content += `- Output: ${this.currentMetrics.usage.outputTokens}\n`;
			if (this.currentMetrics.usage.thinkingTokens > 0) {
				content += `- Thinking: ${this.currentMetrics.usage.thinkingTokens}\n`;
			}

			content += `- Total: ${this.currentMetrics.usage.totalTokens}\n\n`;

			const formatCurrency = new Intl.NumberFormat('en-US', {
				style: 'currency',
				currency: 'USD',
				minimumFractionDigits: 6,
			}).format;
			content += '## Cost\n';
			content += `- Total: ${formatCurrency(this.currentMetrics.usage.cost?.total ?? 0)}\n\n`;
		}

		if (
			this.currentMetrics.urlFetches &&
			this.currentMetrics.urlFetches.length > 0
		) {
			content += '## URL Fetches\n';
			for (const [index, fetch] of this.currentMetrics.urlFetches.entries()) {
				content += `${index + 1}. **${fetch.url}**\n`;
				content += `   - Latency: ${fetch.latency}ms\n`;
				content += `   - Size: ${fetch.sizeFormatted}\n`;
			}
		} else {
			content += '## URL Fetches\nNone\n';
		}

		await fs.writeFile(filepath, content, 'utf8');

		// Add to interactions summary
		const formatCurrency = new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			minimumFractionDigits: 6,
		}).format;
		this.cumulativeMetrics.interactions.push({
			number: this.formatFileNumber(this.interactionCount),
			status: '✅ Complete',
			duration: this.formatDuration(this.currentMetrics.duration),
			model: this.currentMetrics.model,
			input: this.currentMetrics.usage?.inputTokens ?? 0,
			output: this.currentMetrics.usage?.outputTokens ?? 0,
			cached: this.currentMetrics.usage?.cachedTokens ?? 0,
			urls: this.currentMetrics.urlFetches?.length ?? 0,
			cost: formatCurrency(this.currentMetrics.usage?.cost?.total ?? 0),
		});

		this.cumulativeMetrics.completedInteractions++;
		this.currentStatus.state = 'complete';
		await this.updateGlobalStats();
	}

	public async setCurrentState(
		state: SessionStatus['state'],
		progress?: string,
	): Promise<void> {
		this.currentStatus.state = state;
		this.currentStatus.progress = progress;
		const elapsed = Date.now() - this.sessionStartTime.getTime();
		this.currentStatus.elapsedTime = elapsed;
		await this.updateGlobalStats();
	}

	public async updateGlobalStats(): Promise<void> {
		const filepath = path.join(this.sessionDir, 'stats.md');

		const elapsed = Date.now() - this.sessionStartTime.getTime();
		this.cumulativeMetrics.totalDuration = elapsed;

		let content = '# Session Statistics\n';
		content += `**Started:** ${this.sessionStartTime.toISOString()}\n`;
		content += `**Log Directory:** ${this.sessionDir}\n\n`;

		// Current Status
		content += '## Current Status\n';
		const statusEmoji = {
			starting: '🔄',
			thinking: '🤔',
			tool_calling: '🔧',
			fetching_urls: '⬇️',
			responding: '💬',
			complete: '✅',
			error: '❌',
		};
		content += `**State:** ${statusEmoji[this.currentStatus.state]} ${this.getStatusText(this.currentStatus.state)}\n`;
		if (this.currentMetrics) {
			content += `**Model:** ${this.currentMetrics.model}\n`;
		}

		content += `**Current Interaction:** ${this.formatFileNumber(this.currentStatus.currentInteraction)}\n`;
		if (this.currentStatus.progress) {
			content += `**Progress:** ${this.currentStatus.progress}\n`;
		}

		content += `**Elapsed Time:** ${this.formatDuration(this.currentStatus.elapsedTime)}\n\n`;

		// Session Totals
		content += '## Session Totals\n';
		content += `**Total Duration:** ${this.formatDuration(this.cumulativeMetrics.totalDuration)}\n`;
		content += `**Total Interactions:** ${this.cumulativeMetrics.totalInteractions}`;
		content += ` (${this.cumulativeMetrics.completedInteractions} completed`;
		if (
			this.cumulativeMetrics.totalInteractions >
			this.cumulativeMetrics.completedInteractions
		) {
			content += ', 1 in progress';
		}

		content += ')\n';

		const totalTokens =
			this.cumulativeMetrics.totalInputTokens +
			this.cumulativeMetrics.totalOutputTokens +
			this.cumulativeMetrics.totalCachedTokens +
			this.cumulativeMetrics.totalThinkingTokens;
		content += `**Total Tokens:** ${totalTokens.toLocaleString()}\n`;
		content += `- Input: ${this.cumulativeMetrics.totalInputTokens.toLocaleString()}\n`;
		content += `- Output: ${this.cumulativeMetrics.totalOutputTokens.toLocaleString()}\n`;
		if (this.cumulativeMetrics.totalCachedTokens > 0) {
			content += `- Cached: ${this.cumulativeMetrics.totalCachedTokens.toLocaleString()}\n`;
		}

		if (this.cumulativeMetrics.totalThinkingTokens > 0) {
			content += `**Total Thinking Tokens:** ${this.cumulativeMetrics.totalThinkingTokens.toLocaleString()}\n`;
		}

		const formatCurrency = new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			minimumFractionDigits: 6,
		}).format;
		content += `**Total Cost:** ${formatCurrency(this.cumulativeMetrics.totalCost)}\n`;
		content += `**Total URL Fetches:** ${this.cumulativeMetrics.totalUrlFetches}\n\n`;

		// Interactions Summary
		if (this.cumulativeMetrics.interactions.length > 0) {
			content += '## Interactions Summary\n';
			content +=
				'| # | Status | Duration | Model | Input | Output | Cached | URLs | Cost |\n';
			content +=
				'|---|---|----------|-------|-------|--------|--------|------|------|\n';

			for (const interaction of this.cumulativeMetrics.interactions) {
				content += `| ${interaction.number} | ${interaction.status} | ${interaction.duration} | ${interaction.model} | ${interaction.input} | ${interaction.output} | ${interaction.cached} | ${interaction.urls} | ${interaction.cost} |\n`;
			}

			// Add current in-progress interaction if any
			const interactionLogged = this.cumulativeMetrics.interactions.find(
				i =>
					i.number ===
					this.formatFileNumber(this.currentStatus.currentInteraction),
			);

			if (!interactionLogged) {
				const currentInteractionNumber = this.formatFileNumber(
					this.currentStatus.currentInteraction,
				);
				const currentElapsed =
					Date.now() - (this.currentMetrics?.timestamp.getTime() ?? Date.now());
				content += `| ${currentInteractionNumber} | 🔄 In Progress | ${this.formatDuration(
					currentElapsed,
				)}\n | ${this.currentMetrics?.model ?? ''} | ... | ... | ... | ... | ... |\n`;
			}
		}

		await fs.writeFile(filepath, content, 'utf8');
	}

	public formatBytesForMetrics(
		bytes: number,
	): UrlFetchMetrics['sizeFormatted'] {
		return this.formatBytes(bytes);
	}

	public getCurrentInteractionNumber(): number {
		return this.interactionCount;
	}

	public getCurrentState(): SessionStatus['state'] {
		return this.currentStatus.state;
	}

	public async logError(
		error: Error,
		interactionNumber_?: number,
		context?: string,
	): Promise<void> {
		await this.ensureDirectory();
		const timestamp = new Date().toISOString();
		const interactionNumber =
			interactionNumber_ ?? this.currentStatus.currentInteraction;
		const logFilename = `error-${timestamp}.log`;
		const filepath = path.join(this.sessionDir, logFilename);

		let content = `Timestamp: ${timestamp}\n`;
		content += `Interaction: ${this.formatFileNumber(interactionNumber)}\n`;
		if (context) {
			content += `Context: ${context}\n`;
		}

		content += `\n--- ERROR MESSAGE ---\n`;
		content += `${error.message}\n`;
		content += `\n--- STACK TRACE ---\n`;
		content += `${error.stack ?? 'No stack trace available'}\n`;

		await fs.writeFile(filepath, content, 'utf8');

		// Also update the main stats file
		this.currentStatus.state = 'error';
		this.currentStatus.progress = `Error logged to ${logFilename}`;

		// Add a FAILED entry to the interactions summary, if not already present for this interaction
		const interactionAlreadyLogged = this.cumulativeMetrics.interactions.some(
			i => i.number === this.formatFileNumber(interactionNumber),
		);

		if (!interactionAlreadyLogged && this.currentMetrics) {
			const formatCurrency = new Intl.NumberFormat('en-US', {
				style: 'currency',
				currency: 'USD',
				minimumFractionDigits: 6,
			}).format;
			this.cumulativeMetrics.interactions.push({
				number: this.formatFileNumber(this.interactionCount),
				status: '❌ Failed',
				duration: this.formatDuration(
					Date.now() - this.currentMetrics.timestamp.getTime(),
				),
				model: this.currentMetrics.model,
				input: this.currentMetrics.usage?.inputTokens ?? 0,
				output: this.currentMetrics.usage?.outputTokens ?? 0,
				cached: this.currentMetrics.usage?.cachedTokens ?? 0,
				urls: this.currentMetrics.urlFetches?.length ?? 0,
				cost: formatCurrency(this.currentMetrics.usage?.cost?.total ?? 0),
			});
		}

		await this.updateGlobalStats();
	}

	public async logFatalError(error: Error): Promise<void> {
		console.error(
			chalk.red.bold('\n\n❌ A fatal error occurred. Session terminated.\n'),
		);
		console.error(chalk.red(error.stack ?? error.message));

		await this.ensureDirectory();
		const timestamp = new Date().toISOString();
		const logFilename = `fatal-error-${timestamp}.log`;
		const filepath = path.join(this.sessionDir, logFilename);

		let content = `FATAL ERROR\n`;
		content += `Timestamp: ${timestamp}\n`;
		content += `\n--- ERROR MESSAGE ---\n`;
		content += `${error.message}\n`;
		content += `\n--- STACK TRACE ---\n`;
		content += `${error.stack ?? 'No stack trace available'}\n`;

		try {
			await fs.writeFile(filepath, content, 'utf8');
			console.error(
				chalk.yellow(
					`\n📋 Full error details have been logged to: ${filepath}`,
				),
			);
		} catch (error_: unknown) {
			console.error(
				chalk.red.bold(
					'Additionally, failed to write the fatal error log file.',
				),
			);
			console.error(error_);
		}
	}

	public async logUrlMetrics(metrics: UrlFetchMetrics[]): Promise<void> {
		// Update current metrics
		if (this.currentMetrics) {
			this.currentMetrics.urlFetches ??= [];
			this.currentMetrics.urlFetches.push(...metrics);
			this.cumulativeMetrics.totalUrlFetches += metrics.length;
			await this.updateGlobalStats();
		}
	}

	public async createSessionLog(): Promise<void> {
		const filename = `session.md`;
		const filepath = path.join(this.sessionDir, filename);

		let content = `# Deep Research Session Log\n\n`;
		content += `**Session Started:** ${this.sessionStartTime.toISOString()}\n`;
		content += `**Session Duration:** ${this.formatDuration(this.cumulativeMetrics.totalDuration)}\n`;

		let totalResponseTime = 0;
		for (const i of this.cumulativeMetrics.interactions) {
			const match = /(\d+)(?:min\s*)?(\d+)?s?/.exec(i.duration);
			if (match) {
				const mins =
					match[1] && i.duration.includes('min')
						? Number.parseInt(match[1], 10)
						: 0;
				const secs = match[2]
					? Number.parseInt(match[2], 10)
					: i.duration.includes('s') && !i.duration.includes('min') && match[1]
						? Number.parseInt(match[1], 10)
						: 0;
				totalResponseTime += mins * 60 * 1000 + secs * 1000;
			}
		}

		content += `**Total Response Time:** ${this.formatDuration(totalResponseTime)}\n\n`;

		content += `## Session Summary\n\n`;
		content += `- **Total Interactions:** ${this.cumulativeMetrics.totalInteractions}\n`;
		content += `- **Total Input Tokens:** ${this.cumulativeMetrics.totalInputTokens.toLocaleString()}\n`;
		content += `- **Total Output Tokens:** ${this.cumulativeMetrics.totalOutputTokens.toLocaleString()}\n`;
		content += `- **Total Cached Tokens:** ${this.cumulativeMetrics.totalCachedTokens.toLocaleString()}\n`;
		content += `- **Total Thinking Tokens:** ${this.cumulativeMetrics.totalThinkingTokens.toLocaleString()}\n`;
		content += `- **Total URL Fetches:** ${this.cumulativeMetrics.totalUrlFetches}\n\n`;

		// Read and include all interaction data
		const interactionPromises = [];
		for (let i = 1; i <= this.interactionCount; i++) {
			interactionPromises.push(this.getInteractionLog(i));
		}

		const interactionLogs = await Promise.all(interactionPromises);
		content += interactionLogs.join('');

		await fs.writeFile(filepath, content, 'utf8');
	}

	private async getInteractionLog(interactionNumber: number): Promise<string> {
		const interactionNumber_ = this.formatFileNumber(interactionNumber);
		let content = `---\n\n`;
		content += `## Interaction ${interactionNumber}\n\n`;

		// Get the interaction metrics from our stored data
		const interactionData =
			this.cumulativeMetrics.interactions[interactionNumber - 1];
		if (interactionData) {
			content += `**Timestamp:** ${new Date(this.sessionStartTime.getTime() + (interactionNumber - 1) * 60_000).toISOString()}\n`;
			content += `**Model:** ${interactionData.model}\n`;
			content += `**Duration:** ${interactionData.duration}\n`;
			content += `**Tokens:** Input: ${interactionData.input}, Output: ${interactionData.output}, Cached: ${interactionData.cached}\n`;
			if (interactionData.urls > 0) {
				content += `**URL Fetches:** ${interactionData.urls}\n`;
			}

			content += '\n';
		}

		// Include request
		try {
			const requestFile = path.join(
				this.sessionDir,
				`${interactionNumber_}-request.md`,
			);
			const requestContent = await fs.readFile(requestFile, 'utf8');
			content += `### Request\n\n${requestContent}\n\n`;
		} catch {
			// File might not exist
		}

		// Include reasoning if exists
		try {
			const reasoningFile = path.join(
				this.sessionDir,
				`${interactionNumber_}-response-reasoning.md`,
			);
			const reasoningContent = await fs.readFile(reasoningFile, 'utf8');
			content += `### Reasoning\n\n${reasoningContent}\n\n`;
		} catch {
			// File might not exist
		}

		// Include response
		try {
			const responseFile = path.join(
				this.sessionDir,
				`${interactionNumber_}-response.md`,
			);
			const responseContent = await fs.readFile(responseFile, 'utf8');
			content += `### Response\n\n${responseContent}\n\n`;
		} catch {
			// File might not exist
		}

		return content;
	}

	private async ensureDirectory(): Promise<void> {
		try {
			await fs.mkdir(this.sessionDir, {recursive: true});
		} catch (error: unknown) {
			console.error('Failed to create log directory:', error);
		}
	}

	private formatFileNumber(number_: number): string {
		return number_.toString().padStart(5, '0');
	}

	private formatBytes(bytes: number): string {
		if (bytes < 1024) {
			return `${bytes}B`;
		}

		if (bytes < 1024 * 1024) {
			return `${(bytes / 1024).toFixed(1)}KB`;
		}

		if (bytes < 1024 * 1024 * 1024) {
			return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
		}

		return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
	}

	private formatDuration(milliseconds: number): string {
		if (milliseconds < 1000) {
			return `${milliseconds}ms`;
		}

		const seconds = Math.floor(milliseconds / 1000);
		if (seconds < 60) {
			return `${seconds}s`;
		}

		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		if (minutes < 60) {
			return `${minutes}min ${remainingSeconds}s`;
		}

		const hours = Math.floor(minutes / 60);
		const remainingMinutes = minutes % 60;
		return `${hours}h ${remainingMinutes}min`;
	}

	private getStatusText(state: SessionStatus['state']): string {
		switch (state) {
			case 'starting': {
				return 'Starting...';
			}

			case 'thinking': {
				return 'Thinking...';
			}

			case 'tool_calling': {
				return 'Calling Tool...';
			}

			case 'fetching_urls': {
				return 'Fetching URLs...';
			}

			case 'responding': {
				return 'Responding...';
			}

			case 'complete': {
				return 'Complete';
			}

			case 'error': {
				return 'Error';
			}

			default: {
				return 'Unknown';
			}
		}
	}
}
