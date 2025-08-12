import {useState, useEffect} from 'react';
import {Box, Text, useApp} from 'ink';
import {Spinner} from '@inkjs/ui';
import {ThinkingStream} from './ui/thinking-stream.js';
import {OutputDisplay} from './ui/output-display.js';
import {InputPrompt} from './ui/input-prompt.js';
import {OpenAiClient} from './api/openai.js';
import {
	readInputFile,
	writeOutputFile,
	writeConversationToFile,
} from './utils/files.js';
import {SessionLogger} from './utils/logger.js';
import type {
	CliArgs,
	StreamingState,
	ChatMessage,
	ResponseStreamEvent,
} from './types.js';

type AppProps = {
	args: CliArgs;
	apiKey: string;
};

const useStreamingLogic = () => {
	const [streamingState, setStreamingState] = useState<StreamingState>('idle');
	const [thinkingContent, setThinkingContent] = useState('');
	const [outputContent, setOutputContent] = useState('');
	const [error, setError] = useState<string | undefined>(undefined);
	const [toolStatus, setToolStatus] = useState<string | undefined>(undefined);
	const [conversationHistory, setConversationHistory] = useState<ChatMessage[]>(
		[],
	);

	return {
		streamingState,
		setStreamingState,
		thinkingContent,
		setThinkingContent,
		outputContent,
		setOutputContent,
		error,
		setError,
		toolStatus,
		setToolStatus,
		conversationHistory,
		setConversationHistory,
	};
};

export default function App({args, apiKey}: AppProps) {
	const {exit} = useApp();
	const streamingHooks = useStreamingLogic();
	const {
		streamingState,
		setStreamingState,
		thinkingContent,
		setThinkingContent,
		outputContent,
		setOutputContent,
		error,
		setError,
		toolStatus,
		setToolStatus,
		conversationHistory,
		setConversationHistory,
	} = streamingHooks;

	const openaiClient = new OpenAiClient(apiKey);
	const [logger] = useState(() => new SessionLogger());

	// Create comprehensive log on exit
	useEffect(() => {
		const handleExit = async () => {
			try {
				await logger.createComprehensiveLog();
			} catch (error) {
				console.error('Failed to create comprehensive log:', error);
			}
		};

		// For synchronous exit event
		process.on('beforeExit', (code) => {
			if (code === 0) {
				handleExit().then(() => process.exit(code));
			}
		});

		// For interrupt signals
		process.on('SIGINT', () => {
			handleExit().then(() => process.exit(0));
		});

		process.on('SIGTERM', () => {
			handleExit().then(() => process.exit(0));
		});

		return () => {
			process.removeAllListeners('beforeExit');
			process.removeAllListeners('SIGINT');
			process.removeAllListeners('SIGTERM');
		};
	}, [logger]);

	const shouldSaveStreamingUpdate = (
		streamingSaveCounter: number,
		delta: string,
	) => {
		const streamingSaveThreshold = 100;
		return (
			args.outputFile &&
			!args.request &&
			!args.requestFile &&
			streamingSaveCounter + delta.length >= streamingSaveThreshold
		);
	};

	const saveStreamingUpdate = async (
		finalOutputContent: string,
		userMessage: ChatMessage,
	) => {
		if (!args.outputFile) return;

		const streamingAssistantMessage: ChatMessage = {
			role: 'assistant',
			content: finalOutputContent,
			timestamp: new Date(),
		};
		const streamingHistory = [
			...conversationHistory,
			userMessage,
			streamingAssistantMessage,
		];
		await writeConversationToFile(args.outputFile, streamingHistory, true);
	};

	const handleStreamEvent = async (
		event: ResponseStreamEvent,
		streamData: {
			finalOutputContent: string;
			streamingSaveCounter: number;
			userMessage: ChatMessage;
			setFinalOutputContent: (content: string) => void;
			setStreamingSaveCounter: (counter: number) => void;
		},
	) => {
		const {
			finalOutputContent,
			streamingSaveCounter,
			userMessage,
			setFinalOutputContent,
			setStreamingSaveCounter,
		} = streamData;
		switch (event.type) {
			case 'created': {
				setStreamingState('created');
				break;
			}

			case 'in_progress': {
				setStreamingState('in_progress');
				break;
			}

			case 'thinking': {
				setStreamingState('thinking');
				if (event.delta) {
					setThinkingContent(previous => previous + event.delta);
				}

				break;
			}

			case 'output': {
				setStreamingState('responding');
				let newContent = '';
				if (event.delta) {
					newContent = event.delta;
				} else if (event.content) {
					newContent = event.content;
				}

				if (newContent) {
					const newFinalContent = finalOutputContent + newContent;
					setFinalOutputContent(newFinalContent);
					setOutputContent(previous => previous + newContent);

					const newCounter = streamingSaveCounter + newContent.length;
					setStreamingSaveCounter(newCounter);

					if (shouldSaveStreamingUpdate(streamingSaveCounter, newContent)) {
						setStreamingSaveCounter(0);
						await saveStreamingUpdate(newFinalContent, userMessage);
					}
				}
				break;
			}

			case 'tool_use': {
				setToolStatus(
					`${event.toolName}: ${event.toolStatus} - ${event.content ?? ''}`,
				);
				break;
			}

			case 'complete': {
				await handleCompletion(finalOutputContent, userMessage);
				return;
			}

			case 'error': {
				setStreamingState('error');
				setError(event.content ?? 'Unknown error occurred');
				if (args.request ?? args.requestFile) {
					exit();
				}

				break;
			}
		}
	};

	const handleCompletion = async (
		finalOutputContent: string,
		userMessage: ChatMessage,
	) => {
		setStreamingState('complete');

		const assistantMessage: ChatMessage = {
			role: 'assistant',
			content: finalOutputContent,
			timestamp: new Date(),
		};

		const updatedHistory = [
			...conversationHistory,
			userMessage,
			assistantMessage,
		];
		setConversationHistory(updatedHistory);

		if (args.outputFile) {
			await (!args.request && !args.requestFile
				? writeConversationToFile(args.outputFile, updatedHistory, false)
				: writeOutputFile(args.outputFile, finalOutputContent));
		}

		if (args.request ?? args.requestFile) {
			exit();
		}
	};

	const processRequest = async (input: string) => {
		setStreamingState('created');
		setThinkingContent('');
		setOutputContent('');
		setError(undefined);
		setToolStatus(undefined);

		const userMessage: ChatMessage = {
			role: 'user',
			content: input,
			timestamp: new Date(),
		};
		setConversationHistory(previous => [...previous, userMessage]);

		let finalOutputContent = '';
		let finalThinkingContent = '';
		let streamingSaveCounter = 0;
		let requestedUrls: string[] = [];
		let urlFetchResults: Array<{url: string; content: string; metrics: any}> = [];
		let usage: any = null;
		const startTime = Date.now();
		
		// Start logging
		const model = args.model ?? 'o3-deep-research';
		await logger.startInteraction(model);
		await logger.logRequest(input);
		await logger.setCurrentState('starting');

		if (args.outputFile && !args.request && !args.requestFile) {
			const initialHistory = [...conversationHistory, userMessage];
			await writeConversationToFile(args.outputFile, initialHistory);
		}

		try {
			const generator = openaiClient.streamResponse(
				model,
				input,
				conversationHistory,
			);

			const setFinalOutputContent = (content: string) => {
				finalOutputContent = content;
			};

			const setStreamingSaveCounter = (counter: number) => {
				streamingSaveCounter = counter;
			};

			let isInToolCall = false;
			let toolCallInProgress = false;
			
			for await (const event of generator) {
				// Update logger state based on event
				switch (event.type) {
					case 'thinking':
						await logger.setCurrentState('thinking', `Processing reasoning tokens`);
						if (event.delta) {
							finalThinkingContent += event.delta;
							await logger.logReasoning(event.delta, true);
						}
						break;
					case 'output':
						await logger.setCurrentState('responding');
						if (event.delta) {
							await logger.logResponse(event.delta, true);
						}
						break;
					case 'tool_use':
						if (event.toolName === 'fetch_urls' && event.toolStatus === 'executing' && !toolCallInProgress) {
							toolCallInProgress = true;
							await logger.setCurrentState('tool_calling');
							// Extract URLs from the event content if available
							if (event.content) {
								const urlMatch = event.content.match(/Fetching \d+ URL\(s\): (.+)/);
								if (urlMatch && urlMatch[1]) {
									requestedUrls = urlMatch[1].split(', ').filter(u => u && u !== '...');
									if (requestedUrls.length > 0) {
										await logger.logUrlFetchRequest(requestedUrls);
									}
								}
							}
						} else if (event.toolStatus === 'completed') {
							toolCallInProgress = false;
							// Capture URL fetch metrics when tool completes
							if (event.urlMetrics && event.urlMetrics.length > 0) {
								// Convert metrics to the format expected by the logger
								const formattedMetrics = event.urlMetrics.map(urlMetric => ({
									url: urlMetric.url,
									latency: urlMetric.endTime - urlMetric.startTime,
									sizeBytes: urlMetric.sizeBytes,
									sizeFormatted: logger.formatBytesForMetrics(urlMetric.sizeBytes)
								}));
								
								// Update the logger's current metrics directly
								if (logger['currentMetrics']) {
									if (!logger['currentMetrics'].urlFetches) {
										logger['currentMetrics'].urlFetches = [];
									}
									logger['currentMetrics'].urlFetches.push(...formattedMetrics);
									logger['cumulativeMetrics'].totalUrlFetches += formattedMetrics.length;
									await logger.updateGlobalStats();
								}
							}
						}
						break;
					case 'complete':
						usage = event.usage;
						break;
				}
				
				await handleStreamEvent(event, {
					finalOutputContent,
					streamingSaveCounter,
					userMessage,
					setFinalOutputContent,
					setStreamingSaveCounter,
				});
			}
			
			// Log final metrics
			const duration = Date.now() - startTime;
			await logger.updateMetrics(usage, duration);
			await logger.logInteractionStats();
			
			// Create comprehensive log for non-interactive sessions
			if (args.request || args.requestFile) {
				await logger.createComprehensiveLog();
			}
			
		} catch (error_) {
			setStreamingState('error');
			setError(error_ instanceof Error ? error_.message : 'Unknown error');
			await logger.setCurrentState('error', error_ instanceof Error ? error_.message : 'Unknown error');
			
			// Create comprehensive log even on error
			if (args.request || args.requestFile) {
				await logger.createComprehensiveLog();
			}
			
			if (args.request ?? args.requestFile) {
				exit();
			}
		}
	};

	// Handle initial request from command line
	useEffect(() => {
		const handleInitialRequest = async () => {
			let input: string | undefined;

			if (args.request) {
				input = args.request;
			} else if (args.requestFile) {
				try {
					input = await readInputFile(args.requestFile);
				} catch (error_) {
					setError(
						error_ instanceof Error ? error_.message : 'Failed to read file',
					);
					return;
				}
			}

			if (input) {
				await processRequest(input);
			}
		};

		void handleInitialRequest();
	}, []);

	const handleSubmit = (value: string) => {
		void processRequest(value);
	};

	const isInteractive = !args.request && !args.requestFile;

	return (
		<Box flexDirection="column" paddingY={1}>
			<Box marginBottom={1}>
				<Text bold color="cyan">
					🔬 Deep Research CLI - Model: {args.model ?? 'o3-deep-research'}
				</Text>
			</Box>

			{error && (
				<Box marginBottom={1}>
					<Text color="red">❌ Error: {error}</Text>
				</Box>
			)}

			{toolStatus && (
				<Box marginBottom={1}>
					<Text color="yellow">🔧 {toolStatus}</Text>
				</Box>
			)}

			{(streamingState === 'created' || streamingState === 'in_progress') && (
				<Box marginBottom={1}>
					<Spinner
						label={
							streamingState === 'created'
								? 'Initializing response...'
								: 'Preparing to respond...'
						}
					/>
				</Box>
			)}

			{streamingState === 'thinking' && (
				<ThinkingStream content={thinkingContent} isActive={true} />
			)}

			{streamingState === 'complete' && thinkingContent && (
				<ThinkingStream content={thinkingContent} isActive={false} />
			)}

			{(streamingState === 'responding' ||
				streamingState === 'complete' ||
				outputContent) && (
				<OutputDisplay
					content={outputContent}
					isStreaming={streamingState === 'responding'}
				/>
			)}

			{streamingState === 'idle' && !isInteractive && (
				<Box>
					<Spinner label="Initializing..." />
				</Box>
			)}

			{isInteractive &&
				streamingState !== 'created' &&
				streamingState !== 'in_progress' &&
				streamingState !== 'thinking' &&
				streamingState !== 'responding' && (
					<Box marginTop={1}>
						<InputPrompt onSubmit={handleSubmit} />
					</Box>
				)}

			{args.outputFile && streamingState === 'complete' && (
				<Box marginTop={1}>
					<Text color="green">✅ Output saved to {args.outputFile}</Text>
				</Box>
			)}
		</Box>
	);
}
