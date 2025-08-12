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
	const displayContent = content.slice(-500); // Show last 500 chars to avoid overflow

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Box>
				{isActive && <Spinner label="Thinking" />}
				{!isActive && <Text color="gray">Thought process:</Text>}
			</Box>
			{displayContent && (
				<Box marginLeft={2} marginTop={1}>
					<Text color="gray" dimColor>
						{displayContent}
					</Text>
				</Box>
			)}
		</Box>
	);
};
