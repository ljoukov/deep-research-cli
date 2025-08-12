import React from 'react';
import {Box, Text} from 'ink';

interface OutputDisplayProps {
	content: string;
	isStreaming?: boolean;
}

export const OutputDisplay: React.FC<OutputDisplayProps> = ({
	content,
	isStreaming = false,
}) => {
	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text bold color="green">
					Answer:
				</Text>
			</Box>
			<Box marginLeft={2} marginTop={1}>
				<Text>{content}</Text>
				{isStreaming && <Text color="cyan"> ▌</Text>}
			</Box>
		</Box>
	);
};
