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

const useStreamingLogic = (args: CliArgs, exit: () => void) => {
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
	const streamingHooks = useStreamingLogic(args, exit);
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
				if (event.delta) {
					const newFinalContent = finalOutputContent + event.delta;
					setFinalOutputContent(newFinalContent);
					setOutputContent(previous => previous + event.delta);

					const newCounter = streamingSaveCounter + event.delta.length;
					setStreamingSaveCounter(newCounter);

					if (shouldSaveStreamingUpdate(streamingSaveCounter, event.delta)) {
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
		let streamingSaveCounter = 0;

		if (args.outputFile && !args.request && !args.requestFile) {
			const initialHistory = [...conversationHistory, userMessage];
			await writeConversationToFile(args.outputFile, initialHistory);
		}

		try {
			const generator = openaiClient.streamResponse(
				args.model ?? 'gpt-5',
				input,
				conversationHistory,
			);

			const setFinalOutputContent = (content: string) => {
				finalOutputContent = content;
			};

			const setStreamingSaveCounter = (counter: number) => {
				streamingSaveCounter = counter;
			};

			for await (const event of generator) {
				await handleStreamEvent(event, {
					finalOutputContent,
					streamingSaveCounter,
					userMessage,
					setFinalOutputContent,
					setStreamingSaveCounter,
				});
			}
		} catch (error_) {
			setStreamingState('error');
			setError(error_ instanceof Error ? error_.message : 'Unknown error');
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
