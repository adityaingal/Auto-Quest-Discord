import { createServer, Server } from 'node:http';
import { Services } from './services';
import { handleOAuthCallback } from './integrations/oauthCallback';
import { Logger } from './utils/logger';

/**
 * HTTP endpoints: /health for the hosting platform and /oauth/callback for
 * the OAuth2 redirect.
 */
export function startHttpServer(port: number, services: Services): Server {
	const server = createServer((request, response) => {
		const host = request.headers.host ?? `localhost:${port}`;
		const url = new URL(request.url ?? '/', `http://${host}`);

		if (url.pathname === '/health' || url.pathname === '/') {
			// The endpoint is public, so it only reports that the process is
			// alive. Counts of users or accounts would leak how many people
			// use the bot.
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end(
				JSON.stringify({
					status: 'ok',
					uptime: Math.round(process.uptime()),
				}),
			);
			return;
		}

		if (url.pathname === '/oauth/callback') {
			handleOAuthCallback(services, url)
				.then((result) => {
					response.writeHead(result.status, {
						'Content-Type': 'text/html; charset=utf-8',
					});
					response.end(result.html);
				})
				.catch((error: unknown) => {
					Logger.error(
						`OAuth callback failed: ${(error as Error).message}`,
					);
					response.writeHead(500, {
						'Content-Type': 'text/plain; charset=utf-8',
					});
					response.end('Internal error');
				});
			return;
		}

		response.writeHead(404, { 'Content-Type': 'application/json' });
		response.end(JSON.stringify({ error: 'not found' }));
	});

	server.listen(port, () => {
		Logger.info(`HTTP server listening on port ${port}`);
	});

	return server;
}
