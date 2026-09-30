import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

function icsDevProxy(): Plugin {
	return {
		name: 'ics-dev-proxy',
		configureServer(server) {
			server.middlewares.use('/api/proxy-calendar', async (req, res) => {
				try {
					const reqUrl = new URL(req.url || '', 'http://localhost:5173');
					const targetUrl = reqUrl.searchParams.get('url');
					if (!targetUrl) {
						res.statusCode = 400;
						res.end('Missing url query parameter');
						return;
					}

					const upstream = await fetch(targetUrl, {
						headers: {
							'User-Agent':
								'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
							Accept: 'text/calendar, text/plain, */*'
						}
					});

					const body = await upstream.text();
					res.setHeader('Access-Control-Allow-Origin', '*');
					res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
					res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
					res.statusCode = upstream.status;
					res.end(body);
				} catch (err: any) {
					res.statusCode = 500;
					res.end(err?.message || 'Proxy error');
				}
			});
		}
	};
}

export default defineConfig({
	plugins: [
		icsDevProxy(),
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	]
});
