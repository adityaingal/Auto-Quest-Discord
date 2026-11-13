import { Client } from 'discord.js';
import { Config } from '../config';
import { Database } from '../database';
import { Repositories } from '../database/repositories';
import { TokenVault } from '../utils/crypto';
import { DiscordOAuth2 } from '../integrations/oauth2';
import { CatalogProvider } from '../integrations/catalogProvider';
import { LinkedAccountProvider } from '../integrations/linkedAccountProvider';
import { AccountService } from './accountService';
import { ProgressService } from './progressService';
import { QuestService } from './questService';
import { RewardService } from './rewardService';
import { NotificationService } from './notificationService';
import { AdminService } from './adminService';
import { TokenService } from './tokenService';
import { AutoService, SessionEntry } from './autoService';
import { RoomService } from './roomService';
import { Notifier } from './notifier';
import { UserSession } from '../integrations/userSession';
import { AccountScope, scopeKey } from './scope';
import { parseWebhookUrl } from '../integrations/webhook';
import { Logger } from '../utils/logger';

/** The configuration key that holds the account the commands work with. */
export const DEFAULT_ACCOUNT_KEY = 'auto.default_account';

export type Services = {
	config: Config;
	database: Database;
	repositories: Repositories;
	catalog: CatalogProvider;
	linked: LinkedAccountProvider;
	accountService: AccountService;
	questService: QuestService;
	progressService: ProgressService;
	rewardService: RewardService;
	notificationService: NotificationService;
	adminService: AdminService;
	tokenService: TokenService;
	roomService: RoomService;
	autoService: AutoService;
	notifier: Notifier;
	client: Client;
	/** Builds the scope of a user - it decides what the user may reach. */
	scopeFor: (userId: string) => AccountScope;
	/** Injected by the entry point to avoid a circular import. */
	registerCommands: (() => Promise<number>) | null;
};

export function createServices(
	config: Config,
	client: Client,
): Services {
	const database = new Database(config.databasePath);
	database.migrate();

	const repositories = new Repositories(database);
	const vault = new TokenVault(config.encryptionKey);

	const oauth2 = new DiscordOAuth2({
		clientId: config.clientId,
		clientSecret: config.clientSecret ?? '',
		redirectUri: config.redirectUri ?? '',
		scopes: ['identify'],
	});

	const catalog = new CatalogProvider(config.questCatalogPath);

	const accountService = new AccountService(
		repositories,
		oauth2,
		vault,
	);

	const linked = new LinkedAccountProvider((discordUserId) =>
		accountService.resolveAccessToken(discordUserId),
	);

	const tokenService = new TokenService(repositories, vault);

	// The developer guild webhook receives every room event (room created,
	// account added, account removed). It is configured via WEBHOOK_URL -
	// and only in the developer guild, not for every user.
	const devWebhook = config.webhookUrl ? parseWebhookUrl(config.webhookUrl) : null;

	if (config.webhookUrl && !devWebhook) {
		Logger.warn(
			'WEBHOOK_URL is set but does not look like a Discord webhook URL - it will not be used. ' +
				'It has to look like https://discord.com/api/webhooks/<id>/<token>.',
		);
	} else if (devWebhook) {
		Logger.info('Developer guild webhook configured - room events will be mirrored there');
	}

	const roomService = new RoomService(repositories, vault, undefined, devWebhook);

	const adminService = new AdminService(
		repositories,
		database,
		config,
	);

	/**
	 * The scope of a user. Only the owner and the members of the admin role
	 * may use the operator level accounts that are registered with
	 * "/token add"; everybody else only reaches the accounts of their own
	 * rooms.
	 */
	const scopeFor = (userId: string): AccountScope => {
		const isOperator =
			Boolean(config.ownerId && config.ownerId === userId) ||
			adminService.isWhitelistedAdmin(userId);

		return { userId, isOperator };
	};

	// The session objects are cached per label, so the encrypted tokens are
	// not decrypted again for every single request. A token that was replaced
	// under the same label gets a new session.
	const sessionCache = new Map<string, { token: string; session: UserSession }>();

	const sessionFor = (
		label: string,
		token: string,
	): UserSession => {
		const cached = sessionCache.get(label);

		if (!cached || cached.token !== token) {
			sessionCache.set(label, {
				token,
				session: new UserSession(token),
			});
		}

		return sessionCache.get(label)!.session;
	};

	const autoService = new AutoService(
		(scope: AccountScope): SessionEntry[] => {
			const sessions: SessionEntry[] = [];

			// The accounts of the rooms of this user. They are always private
			// to their owner.
			for (const entry of roomService.accountsWithTokens(
				scope.userId,
			)) {
				sessions.push({
					label: entry.label,
					session: sessionFor(entry.label, entry.token),
				});
			}

			// The operator level accounts are only reachable for the owner
			// and the admins.
			if (scope.isOperator) {
				const envSession = UserSession.fromEnvironment();

				if (envSession) {
					sessions.push({
						label: 'USER_TOKEN',
						session: envSession,
					});
				}

				for (const entry of tokenService.resolveUserSessions()) {
					if (
						sessions.some(
							(existing) => existing.label === entry.label,
						)
					) {
						continue;
					}

					sessions.push({
						label: entry.label,
						session: sessionFor(entry.label, entry.token),
					});
				}
			}

			return sessions;
		},
		{
			// The account the commands work with. It survives a restart and
			// belongs to the user, so one user never changes the selection of
			// another one.
			readDefaultAccount: (scope) =>
				repositories.getConfig(scopeKey(scope)) || null,
			writeDefaultAccount: (scope, label) => {
				repositories.setConfig(scopeKey(scope), label ?? '');
			},
		},
	);

	const questService = new QuestService(
		repositories,
		catalog,
		linked,
		autoService,
	);
	const progressService = new ProgressService(repositories);
	const rewardService = new RewardService(repositories, linked);
	const notificationService = new NotificationService(
		client,
		repositories,
		questService,
		progressService,
		scopeFor,
		roomService,
	);

	const notifier = new Notifier();

	return {
		config,
		database,
		repositories,
		catalog,
		linked,
		accountService,
		questService,
		progressService,
		rewardService,
		notificationService,
		adminService,
		tokenService,
		roomService,
		autoService,
		notifier,
		client,
		scopeFor,
		registerCommands: null,
	};
}
