/* eslint-disable @typescript-eslint/no-unsafe-call */
import {defineConfig} from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		globals: true,
		include: ['**/*.{test,spec}.{ts,tsx}', 'test.tsx'],
		exclude: ['third_party/**/*', 'node_modules/**/*', 'dist/**/*'],
	},
});
