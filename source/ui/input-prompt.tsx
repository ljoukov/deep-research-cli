import React from 'react';
import {Box} from 'ink';
import {TextInput} from '@inkjs/ui';

type InputPromptProps = {
	onSubmit: (value: string) => void;
};

export const InputPrompt: React.FC<InputPromptProps> = ({onSubmit}) => {
	const handleSubmit = (value: string) => {
		if (value.trim()) {
			onSubmit(value);
		}
	};

	return (
		<Box>
			<TextInput placeholder="Enter your prompt..." onSubmit={handleSubmit} />
		</Box>
	);
};
