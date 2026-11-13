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
import { Notifier } from './notifier';
import { UserSession } from '../integrations/userSession';

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
	autoService: AutoService;
	notifier: Notifier;
	client: Client;
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

	// Optional: user sessions let the bot read live quest data and automate
	// the supported quest types. They come either from the USER_TOKEN
	// environment variable or from the user tokens registered with
	// "/token add" (type user). The list is resolved on every use, so a token
	// that was just registered works immediately.
	const autoService = new AutoService(() => {		const sessions: SessionEntry[] = [];

		const envSession = UserSession.fromEnvironment();
		if (envSession) {
			sessions.push({ label: 'USER_TOKEN', session: envSession });
		}

		for (const entry of tokenService.resolveUserSessions()) {
			if (sessions.some((existing) => existing.label === entry.label)) {
				continue;
			}

			sessions.push({
				label: entry.label,
				session: new UserSession(entry.token),
			});
		}

		return sessions;
	});

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
	);
	const adminService = new AdminService(
		repositories,
		database,
		config,
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
		autoService,
		notifier,
		client,
		registerCommands: null,
	};
}
