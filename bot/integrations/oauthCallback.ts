import { Services } from '../services';
import { Logger } from '../utils/logger';

export type CallbackResult = {
	status: number;
	html: string;
};

function page(title: string, message: string, success: boolean): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
	body { background:#1e1f22; color:#dbdee1; font-family:Segoe UI,system-ui,sans-serif;
	       display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
	.card { background:#2b2d31; padding:32px 40px; border-radius:12px; max-width:520px;
	        border-left:4px solid ${success ? '#57f287' : '#ed4245'}; }
	h1 { margin-top:0; font-size:20px; }
	p { line-height:1.5; }
</style>
</head>
<body>
<div class="card">
	<h1>${title}</h1>
	<p>${message}</p>
</div>
</body>
</html>`;
}

/**
 * Handles the OAuth2 redirect. The state is single use and bound to the
 * Discord user that started the flow, so a link cannot be used by somebody
 * else.
 */
export async function handleOAuthCallback(
	services: Services,
	url: URL,
): Promise<CallbackResult> {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const error = url.searchParams.get('error');

	const received = [...url.searchParams.keys()].filter(
		(key) => key !== 'code',
	);
	Logger.info(
		`OAuth callback reached with parameters: ${
			received.length > 0 ? received.join(', ') : 'none'
		}${code ? ' (+code)' : ''}`,
	);

	if (error) {
		return {
			status: 400,
			html: page(
				'Authorization failed',
				`Discord reported: <code>${error}</code>. You can close this window and try again.`,
				false,
			),
		};
	}

	if (!code || !state) {
		// The page was opened directly instead of through the Discord
		// redirect - show how it is supposed to work.
		return {
			status: 200,
			html: page(
				'Link your account',
				'This page is the end of the Discord OAuth2 flow - it is not meant to be opened directly.<br><br>' +
					'<strong>How to link your account:</strong><br>' +
					'1. Open Discord and run <code>/account link</code><br>' +
					'2. Click the <strong>Authorise with Discord</strong> button<br>' +
					'3. Approve the request - Discord sends you back here automatically<br><br>' +
					'Nothing is stored until that approval happens.',
				false,
			),
		};
	}

	try {
		const result = await services.accountService.completeLink(state, code);

		return {
			status: 200,
			html: page(
				'Account linked',
				`The account <strong>${result.username}</strong> is now linked. You can close this window and use <code>/account status</code> in Discord.`,
				true,
			),
		};
	} catch (caught) {
		const message = (caught as Error).message;

		Logger.error(`OAuth2 callback failed: ${message}`);

		return {
			status: 400,
			html: page(
				'Authorization failed',
				`${message}<br><br>You can close this window and run <code>/account link</code> again.`,
				false,
			),
		};
	}
}
