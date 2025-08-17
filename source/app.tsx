import {useState, useEffect} from 'react';
import {Box, Text, useApp} from 'ink';
import {Spinner} from '@inkjs/ui';
import {OutputDisplay} from './ui/output-display.js';
import {InputPrompt} from './ui/input-prompt.js';
import {streamResponse} from './api/ai.js';
import {readInputFile, writeOutputFile} from './utils/files.js';
import type {CliArgs, ChatMessage} from './types.js';

type AppProps = {
	args: CliArgs;
	apiKey: string;
};

export default function App({args, apiKey}: AppProps) {
	const {exit} = useApp();
	const [streamingState, setStreamingState] = useState<
		'idle' | 'streaming' | 'error' | 'complete'
	>('idle');
	const [outputContent, setOutputContent] = useState('');
	const [error, setError] = useState<string | undefined>(undefined);
	const [toolStatus, setToolStatus] = useState<string | undefined>(undefined);
	const [conversationHistory, setConversationHistory] = useState<ChatMessage[]>(
		[],
	);

	const processRequest = async (input: string) => {
		setStreamingState('streaming');
		setOutputContent('');
setError(undefined);
		setToolStatus(undefined);

		const userMessage: ChatMessage = {
			role: 'user',
			content: input,
		};
		const currentConversation = [...conversationHistory, userMessage];
		setConversationHistory(currentConversation);

		try {
			const result = await streamResponse(
				apiKey,
				args.model,
				args.reasoningEffort,
				input,
				conversationHistory,
				args.tools,
			);

			let fullResponse = '';
			for await (const delta of result.textStream) {
				fullResponse += delta;
				setOutputContent(fullResponse);
			}

			const assistantMessage: ChatMessage = {
				role: 'assistant',
				content: fullResponse,
			};
			setConversationHistory([...currentConversation, assistantMessage]);

			if (args.outputFile) {
				await writeOutputFile(args.outputFile, fullResponse);
			}

			setStreamingState('complete');

			if (args.request ?? args.requestFile) {
				exit();
			}
		} catch (error_) {
			const error =
				error_ instanceof Error ? error_ : new Error(String(error_));
			setStreamingState('error');
			setError(error.message);
			if (args.request ?? args.requestFile) {
				exit();
			}
		}
	};

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
					🔬 Deep Research CLI - Model: {args.model}
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

			{streamingState === 'streaming' && <Spinner label="Responding..." />}

			<OutputDisplay
				content={outputContent}
				isStreaming={streamingState === 'streaming'}
			/>

			{isInteractive && streamingState !== 'streaming' && (
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
