/**
 * Discord protects `POST /quests/{id}/claim-reward` with an hCaptcha challenge.
 * The challenge is returned as a 400 with a `captcha_key` payload; the request
 * has to be retried with the solved token in the `X-Captcha-Key` header.
 *
 * Solving requires a captcha service (2captcha / anti-captcha) and its API key.
 * Without a key the claim simply stays manual.
 */

export type CaptchaChallenge = {
	sitekey: string;
	rqdata: string;
	sessionId?: string;
};

type CaptchaErrorBody = {
	captcha_key?: string[];
	captcha_sitekey?: string;
	captcha_rqdata?: string;
	captcha_session_id?: string;
};

export function getCaptchaChallenge(error: unknown): CaptchaChallenge | null {
	const body = (error as { rawError?: CaptchaErrorBody })?.rawError;
	if (!body?.captcha_key?.includes('captcha-required')) return null;
	if (!body.captcha_sitekey || !body.captcha_rqdata) return null;

	return {
		sitekey: body.captcha_sitekey,
		rqdata: body.captcha_rqdata,
		sessionId: body.captcha_session_id,
	};
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function solveWith2Captcha(
	challenge: CaptchaChallenge,
	userAgent: string,
	apiKey: string,
): Promise<string | null> {
	const query = new URLSearchParams({
		key: apiKey,
		method: 'hcaptcha',
		sitekey: challenge.sitekey,
		rqdata: challenge.rqdata,
		json: '1',
		invisible: '1',
		userAgent,
	});

	const createResponse = await fetch(
		`https://2captcha.com/in.php?${query.toString()}`,
	);
	const created = (await createResponse.json()) as {
		status?: number;
		request?: string;
	};
	if (created.status !== 1 || !created.request) {
		throw new Error(`2captcha rejected the task: ${created.request}`);
	}

	for (let attempt = 0; attempt < 40; attempt++) {
		await sleep(5000);

		const pollResponse = await fetch(
			`http://api.2captcha.com/res.php?key=${apiKey}&action=get&id=${created.request}&json=1`,
		);
		const result = (await pollResponse.json()) as {
			status?: number;
			request?: string;
		};

		if (result.status === 1 && result.request) return result.request;
		if (result.request && !result.request.startsWith('CAPCHA_NOT_READY')) {
			throw new Error(`2captcha error: ${result.request}`);
		}
	}

	return null;
}

async function solveWithAntiCaptcha(
	challenge: CaptchaChallenge,
	userAgent: string,
	apiKey: string,
): Promise<string | null> {
	const createResponse = await fetch(
		'https://api.anti-captcha.com/createTask',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				clientKey: apiKey,
				task: {
					type: 'HCaptchaTaskProxyless',
					websiteURL: 'https://discord.com',
					websiteKey: challenge.sitekey,
					userAgent,
					isInvisible: true,
					enterprisePayload: challenge.rqdata,
				},
			}),
		},
	);
	const created = (await createResponse.json()) as {
		errorId?: number;
		errorDescription?: string;
		taskId?: number;
	};
	if (created.errorId) {
		throw new Error(`anti-captcha error: ${created.errorDescription}`);
	}

	for (let attempt = 0; attempt < 40; attempt++) {
		await sleep(5000);

		const pollResponse = await fetch(
			'https://api.anti-captcha.com/getTaskResult',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					clientKey: apiKey,
					taskId: created.taskId,
				}),
			},
		);
		const result = (await pollResponse.json()) as {
			errorId?: number;
			errorDescription?: string;
			status?: string;
			solution?: { gToken?: string };
		};

		if (result.errorId) {
			throw new Error(`anti-captcha error: ${result.errorDescription}`);
		}
		if (result.status === 'ready' && result.solution?.gToken) {
			return result.solution.gToken;
		}
	}

	return null;
}

/**
 * Solves the hCaptcha challenge and returns the token for `X-Captcha-Key`.
 * Returns null when no captcha service is configured.
 */
export async function solveCaptcha(
	challenge: CaptchaChallenge,
	userAgent: string,
): Promise<string | null> {
	const apiKey = process.env.CAPTCHA_API_KEY?.trim();
	if (!apiKey) return null;

	const service = (process.env.CAPTCHA_SERVICE ?? '2captcha')
		.trim()
		.toLowerCase();

	if (service === 'anti-captcha' || service === 'anticaptcha') {
		return solveWithAntiCaptcha(challenge, userAgent, apiKey);
	}

	return solveWith2Captcha(challenge, userAgent, apiKey);
}
