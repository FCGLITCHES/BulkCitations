import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@shared': path.resolve(import.meta.dirname, 'shared'),
            '@server': path.resolve(import.meta.dirname, 'server'),
            '@': path.resolve(import.meta.dirname, 'client', 'src'),
        },
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['**/*.test.ts'],
        reporters: ['verbose'],
    },
});
