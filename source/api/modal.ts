import {App} from 'modal';

export async function runModal(pythonCode: string): Promise<string> {
	const app = await App.lookup('libmodal-example', {createIfMissing: true});
	const image = await app.imageFromRegistry('python:3.13-slim');

	const sb = await app.createSandbox(image);
	console.log('Started sandbox:', sb.sandboxId);

	const p = await sb.exec(['python', '-c', pythonCode]);
	const result = await p.stdout.readText(); // => "7"
	await p.wait(); // => exit code: 0

	await sb.terminate();
	return result;
}
