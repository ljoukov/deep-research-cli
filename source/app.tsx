import {useState, useEffect} from 'react';
import {Box, Text, useApp} from 'ink';
import {Spinner} from '@inkjs/ui';
import {ThinkingStream} from './ui/ThinkingStream.js';
import {OutputDisplay} from './ui/OutputDisplay.js';
import {InputPrompt} from './ui/InputPrompt.js';
import {OpenAIClient} from './api/openai.js';
import {readInputFile, writeOutputFile, writeConversationToFile} from './utils/files.js';
import type {CliArgs, StreamingState, ChatMessage} from './types.js';

interface AppProps {
	args: CliArgs;
	apiKey: string;
}

export default function App({args, apiKey}: AppProps) {
	const {exit} = useApp();
	const [streamingState, setStreamingState] = useState<StreamingState>('idle');
	const [thinkingContent, setThinkingContent] = useState('');
	const [outputContent, setOutputContent] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [toolStatus, setToolStatus] = useState<string | null>(null);
	const [conversationHistory, setConversationHistory] = useState<ChatMessage[]>([]);

	const openaiClient = new OpenAIClient(apiKey);

	const processRequest = async (input: string) => {
		setStreamingState('created');
		setThinkingContent('');
		setOutputContent('');
		setError(null);
		setToolStatus(null);

		// Add user message to conversation history
		const userMessage: ChatMessage = {
			role: 'user',
			content: input,
			timestamp: new Date(),
		};
		setConversationHistory(prev => [...prev, userMessage]);

		let finalOutputContent = '';
		let streamingSaveCounter = 0;
		const STREAMING_SAVE_THRESHOLD = 100; // Save every 100 bytes

		// Save immediately after user input if output file is specified
		if (args.outputFile && (!args.request && !args.requestFile)) {
			const initialHistory = [...conversationHistory, userMessage];
			await writeConversationToFile(args.outputFile, initialHistory);
		}

		try {
			const generator = openaiClient.streamResponse(
				args.model || 'gpt-5',
				input,
				conversationHistory,
			);

			for await (const event of generator) {
				switch (event.type) {
					case 'created':
						setStreamingState('created');
						break;
					case 'in_progress':
						setStreamingState('in_progress');
						break;
					case 'thinking':
						setStreamingState('thinking');
						if (event.delta) {
							setThinkingContent(prev => prev + event.delta);
						}
						break;
					case 'output':
						setStreamingState('responding');
						if (event.delta) {
							finalOutputContent += event.delta;
							setOutputContent(prev => prev + event.delta);
							
							// Save streaming updates to file periodically
							streamingSaveCounter += event.delta.length;
							if (args.outputFile && (!args.request && !args.requestFile) && streamingSaveCounter >= STREAMING_SAVE_THRESHOLD) {
								streamingSaveCounter = 0;
								const streamingAssistantMessage: ChatMessage = {
									role: 'assistant',
									content: finalOutputContent,
									timestamp: new Date(),
								};
								const streamingHistory = [...conversationHistory, userMessage, streamingAssistantMessage];
								await writeConversationToFile(args.outputFile, streamingHistory, true);
							}
						}
						break;
					case 'tool_use':
						setToolStatus(
							`${event.toolName}: ${event.toolStatus} - ${event.content || ''}`,
						);
						break;
					case 'complete':
						setStreamingState('complete');
						
						// Add assistant message to conversation history with accumulated content
						const assistantMessage: ChatMessage = {
							role: 'assistant',
							content: finalOutputContent,
							timestamp: new Date(),
						};
						
						const updatedHistory = [...conversationHistory, userMessage, assistantMessage];
						setConversationHistory(updatedHistory);
						
						if (args.outputFile) {
							// Write conversation history to file if in interactive mode
							if (!args.request && !args.requestFile) {
								await writeConversationToFile(args.outputFile, updatedHistory, false);
							} else {
								await writeOutputFile(args.outputFile, finalOutputContent);
							}
						}
						if (args.request || args.requestFile) {
							// Non-interactive mode, exit after completion
							exit();
						}
						break;
					case 'error':
						setStreamingState('error');
						setError(event.content || 'Unknown error occurred');
						if (args.request || args.requestFile) {
							exit();
						}
						break;
				}
			}
		} catch (err) {
			setStreamingState('error');
			setError(err instanceof Error ? err.message : 'Unknown error');
			if (args.request || args.requestFile) {
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
				} catch (err) {
					setError(err instanceof Error ? err.message : 'Failed to read file');
					return;
				}
			}

			if (input) {
				await processRequest(input);
			}
		};

		handleInitialRequest();
	}, []);

	const handleSubmit = (value: string) => {
		processRequest(value);
	};

	const isInteractive = !args.request && !args.requestFile;

	return (
		<Box flexDirection="column" paddingY={1}>
			<Box marginBottom={1}>
				<Text bold color="cyan">
					🔬 Deep Research CLI - Model: {args.model || 'o3-deep-research'}
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
					<Spinner label={streamingState === 'created' ? 'Initializing response...' : 'Preparing to respond...'} />
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
					<Text color="green">
						✅ Output saved to {args.outputFile}
					</Text>
				</Box>
			)}
		</Box>
	);
}
