import {promises as fs} from 'node:fs';
import * as path from 'node:path';
import type {ResponseUsage} from 'openai/resources/responses/responses.js';

export interface InteractionMetrics {
	timestamp: Date;
	model: string;
	duration: number; // milliseconds
	usage?: {
		inputTokens: number;
		outputTokens: number;
		cachedTokens: number;
		thinkingTokens: number;
		totalTokens: number;
	};
	urlFetches?: UrlFetchMetrics[];
}

export interface UrlFetchMetrics {
	url: string;
	latency: number; // milliseconds
	sizeBytes: number;
	sizeFormatted: string;
}

export interface SessionStatus {
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
}

export interface CumulativeMetrics {
	totalDuration: number;
	totalInteractions: number;
	completedInteractions: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCachedTokens: number;
	totalThinkingTokens: number;
	totalUrlFetches: number;
	interactions: Array<{
		number: string;
		status: string;
		duration: string;
		input: number;
		output: number;
		cached: number;
		urls: number;
	}>;
}

export class SessionLogger {
	private sessionDir: string;
	private interactionCount: number = 0;
	private sessionStartTime: Date;
	private cumulativeMetrics: CumulativeMetrics;
	private currentMetrics: InteractionMetrics | null = null;
	private currentStatus: SessionStatus;

	constructor() {
		this.sessionStartTime = new Date();
		const timestamp = this.sessionStartTime
			.toISOString()
			.replace(/:/g, '-')
			.replace(/\./g, '-');
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
			interactions: [],
		};

		this.currentStatus = {
			state: 'starting',
			currentInteraction: 0,
			elapsedTime: 0,
		};
	}

	private async ensureDirectory(): Promise<void> {
		try {
			await fs.mkdir(this.sessionDir, {recursive: true});
		} catch (error) {
			console.error('Failed to create log directory:', error);
		}
	}

	private formatFileNumber(num: number): string {
		return num.toString().padStart(5, '0');
	}

	private formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes}B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
		if (bytes < 1024 * 1024 * 1024)
			return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
	}

	private formatDuration(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		const seconds = Math.floor(ms / 1000);
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		if (minutes < 60) return `${minutes}min ${remainingSeconds}s`;
		const hours = Math.floor(minutes / 60);
		const remainingMinutes = minutes % 60;
		return `${hours}h ${remainingMinutes}min`;
	}

	async startInteraction(model: string): Promise<void> {
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

	async logRequest(content: string): Promise<void> {
		const filename = `${this.formatFileNumber(this.interactionCount)}-request.md`;
		const filepath = path.join(this.sessionDir, filename);
		await fs.writeFile(filepath, content, 'utf8');
	}

	async logResponse(content: string, append: boolean = false): Promise<void> {
		const filename = `${this.formatFileNumber(this.interactionCount)}-response.md`;
		const filepath = path.join(this.sessionDir, filename);

		if (append) {
			await fs.appendFile(filepath, content, 'utf8');
		} else {
			await fs.writeFile(filepath, content, 'utf8');
		}
	}

	async logReasoning(content: string, append: boolean = false): Promise<void> {
		const filename = `${this.formatFileNumber(this.interactionCount)}-response-reasoning.md`;
		const filepath = path.join(this.sessionDir, filename);

		if (append) {
			await fs.appendFile(filepath, content, 'utf8');
		} else {
			await fs.writeFile(filepath, content, 'utf8');
		}
	}

	async logUrlFetchRequest(urls: string[]): Promise<void> {
		const filename = `${this.formatFileNumber(this.interactionCount)}-response-url-fetch.md`;
		const filepath = path.join(this.sessionDir, filename);

		let content = '# URL Fetch Request\n\n';
		content += 'The model requested to fetch the following URLs:\n\n';
		urls.forEach((url, index) => {
			content += `${index + 1}. ${url}\n`;
		});

		await fs.writeFile(filepath, content, 'utf8');
	}

	async logUrlFetchResult(
		index: number,
		url: string,
		content: string,
		metrics: UrlFetchMetrics,
	): Promise<void> {
		// Log individual URL result
		const filename = `${this.formatFileNumber(this.interactionCount)}-request-url-fetch-${index}.md`;
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
			if (!this.currentMetrics.urlFetches) {
				this.currentMetrics.urlFetches = [];
			}
			this.currentMetrics.urlFetches.push(metrics);
		}

		this.cumulativeMetrics.totalUrlFetches++;
		await this.updateGlobalStats();
	}

	async logCombinedUrlFetch(combinedContent: string): Promise<void> {
		const filename = `${this.formatFileNumber(this.interactionCount)}-request-url-fetch.md`;
		const filepath = path.join(this.sessionDir, filename);
		await fs.writeFile(filepath, combinedContent, 'utf8');
	}

	async updateMetrics(
		usage: ResponseUsage | null,
		duration: number,
	): Promise<void> {
		if (this.currentMetrics) {
			this.currentMetrics.duration = duration;

			if (usage) {
				const thinkingTokens =
					usage.output_tokens_details?.reasoning_tokens || 0;
				this.currentMetrics.usage = {
					inputTokens: usage.input_tokens,
					outputTokens: usage.output_tokens,
					cachedTokens: usage.input_tokens_details?.cached_tokens || 0,
					thinkingTokens,
					totalTokens: usage.total_tokens,
				};

				// Update cumulative
				this.cumulativeMetrics.totalInputTokens += usage.input_tokens;
				this.cumulativeMetrics.totalOutputTokens += usage.output_tokens;
				this.cumulativeMetrics.totalCachedTokens +=
					usage.input_tokens_details?.cached_tokens || 0;
				this.cumulativeMetrics.totalThinkingTokens += thinkingTokens;
			}
		}
	}

	async logInteractionStats(): Promise<void> {
		if (!this.currentMetrics) return;

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
		}

		if (
			this.currentMetrics.urlFetches &&
			this.currentMetrics.urlFetches.length > 0
		) {
			content += '## URL Fetches\n';
			this.currentMetrics.urlFetches.forEach((fetch, index) => {
				content += `${index + 1}. **${fetch.url}**\n`;
				content += `   - Latency: ${fetch.latency}ms\n`;
				content += `   - Size: ${fetch.sizeFormatted}\n`;
			});
		} else {
			content += '## URL Fetches\nNone\n';
		}

		await fs.writeFile(filepath, content, 'utf8');

		// Add to interactions summary
		this.cumulativeMetrics.interactions.push({
			number: this.formatFileNumber(this.interactionCount),
			status: '✅ Complete',
			duration: this.formatDuration(this.currentMetrics.duration),
			input: this.currentMetrics.usage?.inputTokens || 0,
			output: this.currentMetrics.usage?.outputTokens || 0,
			cached: this.currentMetrics.usage?.cachedTokens || 0,
			urls: this.currentMetrics.urlFetches?.length || 0,
		});

		this.cumulativeMetrics.completedInteractions++;
		this.currentStatus.state = 'complete';
		await this.updateGlobalStats();
	}

	async setCurrentState(
		state: SessionStatus['state'],
		progress?: string,
	): Promise<void> {
		this.currentStatus.state = state;
		this.currentStatus.progress = progress;
		const elapsed = Date.now() - this.sessionStartTime.getTime();
		this.currentStatus.elapsedTime = elapsed;
		await this.updateGlobalStats();
	}

	async updateGlobalStats(): Promise<void> {
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
			this.cumulativeMetrics.totalOutputTokens;
		content += `**Total Tokens:** ${totalTokens.toLocaleString()}\n`;
		content += `- Input: ${this.cumulativeMetrics.totalInputTokens.toLocaleString()}\n`;
		content += `- Output: ${this.cumulativeMetrics.totalOutputTokens.toLocaleString()}\n`;
		if (this.cumulativeMetrics.totalCachedTokens > 0) {
			content += `- Cached: ${this.cumulativeMetrics.totalCachedTokens.toLocaleString()}\n`;
		}
		if (this.cumulativeMetrics.totalThinkingTokens > 0) {
			content += `**Total Thinking Tokens:** ${this.cumulativeMetrics.totalThinkingTokens.toLocaleString()}\n`;
		}
		content += `**Total URL Fetches:** ${this.cumulativeMetrics.totalUrlFetches}\n\n`;

		// Interactions Summary
		if (this.cumulativeMetrics.interactions.length > 0) {
			content += '## Interactions Summary\n';
			content += '| # | Status | Duration | Input | Output | Cached | URLs |\n';
			content += '|---|--------|----------|-------|--------|--------|------|\n';

			for (const interaction of this.cumulativeMetrics.interactions) {
				content += `| ${interaction.number} | ${interaction.status} | ${interaction.duration} | ${interaction.input} | ${interaction.output} | ${interaction.cached} | ${interaction.urls} |\n`;
			}

			// Add current in-progress interaction if any
			if (
				this.currentStatus.state !== 'complete' &&
				this.currentStatus.currentInteraction >
					this.cumulativeMetrics.completedInteractions
			) {
				const currentNum = this.formatFileNumber(
					this.currentStatus.currentInteraction,
				);
				const currentElapsed =
					Date.now() - (this.currentMetrics?.timestamp.getTime() || Date.now());
				content += `| ${currentNum} | 🔄 In Progress | ${this.formatDuration(currentElapsed)} | ... | ... | ... | ... |\n`;
			}
		}

		await fs.writeFile(filepath, content, 'utf8');
	}

	private getStatusText(state: SessionStatus['state']): string {
		switch (state) {
			case 'starting':
				return 'Starting...';
			case 'thinking':
				return 'Thinking...';
			case 'tool_calling':
				return 'Calling Tool...';
			case 'fetching_urls':
				return 'Fetching URLs...';
			case 'responding':
				return 'Responding...';
			case 'complete':
				return 'Complete';
			case 'error':
				return 'Error';
			default:
				return 'Unknown';
		}
	}

	formatBytesForMetrics(bytes: number): UrlFetchMetrics['sizeFormatted'] {
		return this.formatBytes(bytes);
	}

	getCurrentInteractionNumber(): number {
		return this.interactionCount;
	}

	async logUrlMetrics(metrics: UrlFetchMetrics[]): Promise<void> {
		// Update current metrics
		if (this.currentMetrics) {
			if (!this.currentMetrics.urlFetches) {
				this.currentMetrics.urlFetches = [];
			}
			this.currentMetrics.urlFetches.push(...metrics);
			this.cumulativeMetrics.totalUrlFetches += metrics.length;
			await this.updateGlobalStats();
		}
	}

	async createSessionLog(): Promise<void> {
		const filename = `session.md`;
		const filepath = path.join(this.sessionDir, filename);

		let content = `# Deep Research Session Log\n\n`;
		content += `**Session Started:** ${this.sessionStartTime.toISOString()}\n`;
		content += `**Session Duration:** ${this.formatDuration(this.cumulativeMetrics.totalDuration)}\n`;
		content += `**Total Response Time:** ${this.formatDuration(
			this.cumulativeMetrics.interactions.reduce((sum, i) => {
				const match = i.duration.match(/(\d+)(?:min\s*)?(\d+)?s?/);
				if (match) {
					const mins =
						match[1] && i.duration.includes('min') ? parseInt(match[1]) : 0;
					const secs = match[2]
						? parseInt(match[2])
						: i.duration.includes('s') &&
							  !i.duration.includes('min') &&
							  match[1]
							? parseInt(match[1])
							: 0;
					return sum + mins * 60 * 1000 + secs * 1000;
				}
				return sum;
			}, 0),
		)}\n\n`;

		content += `## Session Summary\n\n`;
		content += `- **Total Interactions:** ${this.cumulativeMetrics.totalInteractions}\n`;
		content += `- **Total Input Tokens:** ${this.cumulativeMetrics.totalInputTokens.toLocaleString()}\n`;
		content += `- **Total Output Tokens:** ${this.cumulativeMetrics.totalOutputTokens.toLocaleString()}\n`;
		content += `- **Total Cached Tokens:** ${this.cumulativeMetrics.totalCachedTokens.toLocaleString()}\n`;
		content += `- **Total Thinking Tokens:** ${this.cumulativeMetrics.totalThinkingTokens.toLocaleString()}\n`;
		content += `- **Total URL Fetches:** ${this.cumulativeMetrics.totalUrlFetches}\n\n`;

		// Read and include all interaction data
		for (let i = 1; i <= this.interactionCount; i++) {
			const interNum = this.formatFileNumber(i);
			content += `---\n\n`;
			content += `## Interaction ${i}\n\n`;

			// Get the interaction metrics from our stored data
			const interactionData = this.cumulativeMetrics.interactions[i - 1];
			if (interactionData) {
				content += `**Timestamp:** ${new Date(this.sessionStartTime.getTime() + (i - 1) * 60000).toISOString()}\n`;
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
					`${interNum}-request.md`,
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
					`${interNum}-response-reasoning.md`,
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
					`${interNum}-response.md`,
				);
				const responseContent = await fs.readFile(responseFile, 'utf8');
				content += `### Response\n\n${responseContent}\n\n`;
			} catch {
				// File might not exist
			}

			// Include URL fetch details if any
			if (interactionData && interactionData.urls > 0) {
				content += `### URL Fetch Details\n\n`;
				for (let j = 1; j <= interactionData.urls; j++) {
					const urlFetchFile = `${interNum}-request-url-fetch-${j}.md`;
					content += `- [${urlFetchFile}](./${urlFetchFile})\n`;
				}
				content += '\n';
			}
		}

		await fs.writeFile(filepath, content, 'utf8');
	}
}
