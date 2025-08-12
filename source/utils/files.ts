import {promises as fs} from 'fs';

export async function readInputFile(path: string): Promise<string> {
	try {
		const content = await fs.readFile(path, 'utf-8');
		return content.trim();
	} catch (error) {
		throw new Error(`Failed to read file ${path}: ${error}`);
	}
}

export async function writeOutputFile(
	path: string,
	content: string,
): Promise<void> {
	try {
		await fs.writeFile(path, content, 'utf-8');
	} catch (error) {
		throw new Error(`Failed to write file ${path}: ${error}`);
	}
}
