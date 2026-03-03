import { sveltekit } from '@sveltejs/kit/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

export default defineConfig({
	server: {
		host: true, // listen on 0.0.0.0 so other devices on the network can access
		https: true // required for camera (getUserMedia) on mobile/other devices
	},
	plugins: [
		basicSsl(),
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
