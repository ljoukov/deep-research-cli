/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment */
import process from 'node:process';
import {describe, it, expect} from 'vitest';
import {parseArgs} from './source/utils/args.js';

describe('basic functionality', () => {
	it('should perform basic arithmetic correctly', () => {
		expect(2 + 2).toBe(4);
	});

	it('should concatenate strings correctly', () => {
		const hello = 'hello';
		const world = ' world';
		expect(hello + world).toBe('hello world');
	});

	it('should handle array operations correctly', () => {
		const array_ = [1, 2, 3];
		expect(array_.length).toBe(3);
		expect(array_.includes(2)).toBe(true);
	});
});

describe('parseArgs function', () => {
	it('should parse arguments with default model', () => {
		// Mock process.argv for this test
		const originalArgv = process.argv;
		process.argv = ['node', 'script.js'];

		const result = parseArgs();

		expect(result.model).toBe('gpt-5');
		expect(result.request).toBeUndefined();
		expect(result.requestFile).toBeUndefined();
		expect(result.outputFile).toBeUndefined();

		// Restore original argv
		process.argv = originalArgv;
	});
});
