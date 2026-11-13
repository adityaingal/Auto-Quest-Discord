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
			const stats = services.adminService.stats();

			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end(
				JSON.stringify({
					status: 'ok',
					uptime: stats.uptimeSeconds,
					users: stats.users,
					quests: stats.quests,
					linkedAccounts: stats.links,
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
