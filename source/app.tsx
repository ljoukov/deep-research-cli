import {useState, useEffect, useRef, useCallback} from 'react';
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
	Usage,
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

	// Debouncing for output content updates to improve performance
	const outputContentRef = useRef('');
	const debouncedUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	const setOutputContentDebounced = useCallback(
		(updater: string | ((previous: string) => string)) => {
			const newContent =
				typeof updater === 'function'
					? updater(outputContentRef.current)
					: updater;
			outputContentRef.current = newContent;

			// Clear existing timeout
			if (debouncedUpdateTimeoutRef.current) {
				clearTimeout(debouncedUpdateTimeoutRef.current);
			}

			// Debounce updates to every 50ms during streaming
			debouncedUpdateTimeoutRef.current = setTimeout(() => {
				setOutputContent(newContent);
			}, 50);
		},
		[],
	);

	// Immediate update (for non-streaming scenarios)
	const setOutputContentImmediate = useCallback(
		(updater: string | ((previous: string) => string)) => {
			const newContent =
				typeof updater === 'function'
					? updater(outputContentRef.current)
					: updater;
			outputContentRef.current = newContent;
			setOutputContent(newContent);

			// Clear any pending debounced update
			if (debouncedUpdateTimeoutRef.current) {
				clearTimeout(debouncedUpdateTimeoutRef.current);
				debouncedUpdateTimeoutRef.current = null;
			}
		},
		[],
	);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (debouncedUpdateTimeoutRef.current) {
				clearTimeout(debouncedUpdateTimeoutRef.current);
			}
		};
	}, []);

	return {
		streamingState,
		setStreamingState,
		thinkingContent,
		setThinkingContent,
		outputContent,
		setOutputContent: setOutputContentDebounced,
		setOutputContentImmediate,
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
		setOutputContentImmediate,
		error,
		setError,
		toolStatus,
		setToolStatus,
		conversationHistory,
		setConversationHistory,
	} = streamingHooks;

	const openaiClient = new OpenAiClient(apiKey);
	const [logger] = useState(() => new SessionLogger());

	// Create session log on exit
	useEffect(() => {
		const handleExit = async () => {
			try {
				await logger.createSessionLog();
			} catch (error) {
				console.error('Failed to create session log:', error);
			}
		};

		// For synchronous exit event
		process.on('beforeExit', code => {
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
				// Ensure final content is displayed immediately on completion
				setOutputContentImmediate(finalOutputContent);
				await handleCompletion(finalOutputContent, userMessage);
				return;
			}

			case 'error': {
				setStreamingState('error');
				const errorMessage = event.content ?? 'Unknown error occurred';
				setError(errorMessage);
				if (event.error) {
					await logger.logError(event.error, undefined, 'Stream Error');
				}
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
		setOutputContentImmediate('');
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
		let usage: Usage | undefined;
		const startTime = Date.now();

		// Start logging
		await logger.startInteraction(args.model);
		await logger.logRequest(input);
		await logger.setCurrentState('starting');

		if (args.outputFile && !args.request && !args.requestFile) {
			const initialHistory = [...conversationHistory, userMessage];
			await writeConversationToFile(args.outputFile, initialHistory);
		}

		try {
			const generator = openaiClient.streamResponse(
				args.model,
				args.reasoningEffort,
				input,
				conversationHistory,
			);

			const setFinalOutputContent = (content: string) => {
				finalOutputContent = content;
			};

			const setStreamingSaveCounter = (counter: number) => {
				streamingSaveCounter = counter;
			};

			let toolCallInProgress = false;
			let reasoningLogged = false;
			let toolResponseLogged = false;

			const processEvent = async (event: ResponseStreamEvent) => {
				// Update logger state based on event
				switch (event.type) {
					case 'thinking':
						await logger.setCurrentState(
							'thinking',
							'Processing reasoning tokens',
						);
						if (!reasoningLogged) {
							await logger.logReasoning(event.delta ?? '', false);
							reasoningLogged = true;
						} else if (event.delta) {
							await logger.logReasoning(event.delta, true);
						}

						if (event.delta) {
							finalThinkingContent += event.delta;
						}
						await logger.updateGlobalStats();
						break;
					case 'output':
						await logger.setCurrentState('responding');
						if (event.delta) {
							await logger.logResponse(event.delta, true);
						}
						await logger.updateGlobalStats();
						break;
					case 'tool_use':
						if (
							event.toolName === 'fetch_urls' &&
							event.toolStatus === 'executing' &&
							!toolCallInProgress
						) {
							toolCallInProgress = true;
							await logger.setCurrentState('tool_calling');
							if (event.content) {
								const urlMatch = event.content.match(
									/Fetching \d+ URL\(s\): (.+)/,
								);
								if (urlMatch?.[1]) {
									requestedUrls = urlMatch[1]
										.split(', ')
										.filter(u => u && u !== '...');
									if (requestedUrls.length > 0) {
										// Log immediately as a fallback to ensure 00001-response.md exists
										if (!toolResponseLogged) {
											await logger.logToolCall('fetch_urls', {
												urls: requestedUrls,
											});
											toolResponseLogged = true;
										}
									}
								}
							}
						} else if (event.toolStatus === 'completed') {
							toolCallInProgress = false;
						}
						break;
					case 'tool_continuation':
						// This is the major change: handle the continuation
						// 1. Finalize the first interaction (the tool request)
						if (!toolResponseLogged) {
							const urlsFromContinuation =
								event.urlFetchResults?.map(r => r.url).filter(u => !!u) ?? [];
							const urls =
								requestedUrls.length > 0 ? requestedUrls : urlsFromContinuation;
							await logger.logToolCall('fetch_urls', {urls});
							toolResponseLogged = true;
						}

						await logger.updateMetrics(
							event.usage || undefined,
							Date.now() - startTime,
						);
						await logger.logInteractionStats();

						// 2. Start a new interaction for the tool response
						await logger.startInteraction(args.model);
						reasoningLogged = false; // Reset for the new interaction
						await logger.setCurrentState('fetching_urls');

						// 3. Log the combined fetch result as the new "request"
						if (event.urlFetchResults) {
							await logger.logRequestFromUrlFetches(event.urlFetchResults);
						}

						// 4. Log individual URL fetch results
						if (event.urlFetchResults) {
							for (const [index, result] of event.urlFetchResults.entries()) {
								await logger.logUrlFetchResult(
									index + 1,
									result.url,
									result.content,
									result.metrics,
								);
							}
						}

						// 5. Continue the stream with the tool results
						const continuationHistory: ChatMessage[] = [
							...conversationHistory,
							userMessage,
							{
								role: 'assistant',
								content: 'I will fetch the content of the URLs.',
								timestamp: new Date(),
							},
							{
								role: 'user',
								content: event.toolResult ?? '',
								timestamp: new Date(),
							},
						];

						const continuationGenerator = openaiClient.continueStreamResponse(
							args.model,
							args.reasoningEffort,
							continuationHistory,
						);
						for await (const contEvent of continuationGenerator) {
							await processEvent(contEvent); // Recursively process events
						}
						return; // Exit after handling continuation

					case 'complete':
						// Store usage for final metrics
						usage = event.usage;
						break;
				}

				// Pass to UI handler
				await handleStreamEvent(event, {
					finalOutputContent,
					streamingSaveCounter,
					userMessage,
					setFinalOutputContent,
					setStreamingSaveCounter,
				});
			};

			for await (const event of generator) {
				await processEvent(event);
			}

			// Log final metrics for the last interaction
			if (logger.getCurrentState() !== 'error') {
				const duration = Date.now() - startTime;
				await logger.updateMetrics(usage, duration);
				await logger.logInteractionStats();
			}

			// Create session log for non-interactive sessions
			if (args.request || args.requestFile) {
				await logger.createSessionLog();
			}
		} catch (error_) {
			// Errors from the stream are handled by the 'error' event in handleStreamEvent.
			// This catch block is for any other unexpected errors during the processRequest execution.
			const error =
				error_ instanceof Error ? error_ : new Error(String(error_));
			setStreamingState('error');
			setError(error.message);
			await logger.logError(error, undefined, 'ProcessRequest Error');

			// Create session log even on error
			if (args.request || args.requestFile) {
				await logger.createSessionLog();
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
				<Box marginBottom={1} padding={1} borderStyle="round" borderColor="red">
					<Text color="red">
						<Text bold>❌ Error:</Text> {error}
					</Text>
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
