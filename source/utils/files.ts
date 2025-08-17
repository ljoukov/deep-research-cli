import {promises as fs} from 'node:fs';
import type {ChatMessage} from '../types.js';

export async function readInputFile(path: string): Promise<string> {
	try {
		const content = await fs.readFile(path, 'utf8');
		return content.trim();
	} catch (error) {
		throw new Error(
			`Failed to read file ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function writeOutputFile(
	path: string,
	content: string,
): Promise<void> {
	try {
		await fs.writeFile(path, content, 'utf8');
	} catch (error) {
		throw new Error(
			`Failed to write file ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function writeConversationToFile(
	path: string,
	conversation: ChatMessage[],
	isStreamingIncomplete?: boolean,
): Promise<void> {
	try {
		let content = `# Conversation History\n\n`;

		for (let i = 0; i < conversation.length; i++) {
			const message = conversation[i];
			if (!message) continue;

			const timestamp = message.timestamp.toLocaleString();
			const separator = '---'.repeat(20);
			const roleLabel = message.role === 'user' ? 'USER' : 'ASSISTANT';
			const isLastMessage = i === conversation.length - 1;
			const isIncomplete =
				isStreamingIncomplete && isLastMessage && message.role === 'assistant';

			content += `${separator}\n`;
			content += `${roleLabel} [${timestamp}]${isIncomplete ? ' (STREAMING...)' : ''}\n`;
			content += `${separator}\n\n`;
			content += `${message.content}${isIncomplete ? '\n\n[Response still streaming...]' : ''}\n\n`;
		}

		await fs.writeFile(path, content, 'utf8');
	} catch (error) {
		throw new Error(
			`Failed to write conversation file ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
