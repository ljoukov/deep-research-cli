import React from 'react';
import {Box, Text} from 'ink';
import {Spinner} from '@inkjs/ui';

interface ThinkingStreamProps {
	content: string;
	isActive: boolean;
}

export const ThinkingStream: React.FC<ThinkingStreamProps> = ({
	content,
	isActive,
}) => {
	// Show last 1000 chars to avoid overflow while allowing more context
	const displayContent = content.slice(-1000);

	return (
		<Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor="gray" padding={1}>
			<Box>
				{isActive && <Spinner label="Thinking..." />}
				{!isActive && <Text color="cyan">🤔 Thought process:</Text>}
			</Box>
			{displayContent && (
				<Box marginLeft={2} marginTop={1}>
					<Text color="gray" dimColor wrap="wrap">
						{displayContent}
					</Text>
				</Box>
			)}
			{!displayContent && isActive && (
				<Box marginLeft={2} marginTop={1}>
					<Text color="gray" dimColor>
						Initializing reasoning...
					</Text>
				</Box>
			)}
		</Box>
	);
};
