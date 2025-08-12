import React from 'react';
import {Box, Text} from 'ink';

type OutputDisplayProps = {
	content: string;
	isStreaming?: boolean;
};

export const OutputDisplay: React.FC<OutputDisplayProps> = ({
	content,
	isStreaming = false,
}) => {
	// During streaming, show only the last 2000 characters to improve performance
	// When complete, show full content
	const displayContent = isStreaming ? content.slice(-2000) : content;

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text bold color="green">
					Answer:
				</Text>
			</Box>
			<Box marginLeft={2} marginTop={1}>
				<Text>{displayContent}</Text>
				{isStreaming && <Text color="cyan"> ▌</Text>}
			</Box>
		</Box>
	);
};
