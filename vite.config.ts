import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit(),
		{
			name: 'fix-chess-ts-404',
			configureServer(server) {
				server.middlewares.use((req, res, next) => {
					if (req.url === '/node_modules/src/chess.ts' || req.url?.startsWith('/node_modules/src/chess.ts?')) {
						req.url = '/src/lib/chess.ts' + (req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
					}
					next();
				});
			}
		}
	]
});
