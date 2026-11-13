import {
	ButtonBuilder,
	ButtonStyle,
	MessageFlags,
	SlashCommandSubcommandBuilder,
} from 'discord.js';
import { CommandContext, group } from './types';
import {
	buildQuestActions,
	buildQuestPages,
	buildQuestSelect,
	buildPagingRow,
	buildStartConfirmRow,
} from '../ui/components';
import { questDetailEmbed, questListEmbed, questQueueEmbed } from '../ui/embeds';
import { renderQuestPanel } from '../ui/panel';
import type { QueueEntry } from '../ui/embeds';
import { infoEmbed, successEmbed } from '../ui/embeds';
import { ELIGIBILITY_LABELS, PLATFORM_NAMES } from '../models/enums';
import { toUserMessage } from '../utils/errors';

function questOption(sub: SlashCommandSubcommandBuilder): void {
	sub.addStringOption((option) =>
		option
			.setName('quest')
			.setDescription('Quest id or name')
			.setRequired(true)
			.setAutocomplete(true),
	);
}

/**
 * The account the command works with. Without it the account that was
 * selected with "/quest switch" is used - and if none is selected, every
 * account works at the same time.
 */
function accountOption(sub: SlashCommandSubcommandBuilder): void {
	sub.addStringOption((option) =>
		option
			.setName('account')
			.setDescription('The account to use - every account when omitted')
			.setRequired(false)
			.setAutocomplete(true),
	);
}

export const questCommand = group(
	'quest',
	'Inspect Discord quests, their requirements and rewards.',
	[
		{
			name: 'list',
			description: 'List the quests that are currently available.',
			build: accountOption,
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const account = services.autoService.resolveAccount(
					scope,
					interaction.options.getString('account'),
				);
				const result = await services.questService.list(
					scope,
					account,
				);
				const pages = buildQuestPages(result.quests);
				const page = 0;

				await interaction.reply({
					embeds: [
						questListEmbed(result.quests, result.source, result.live),
					],
					components: [
						buildQuestSelect(pages[page], page),
						buildPagingRow(page, pages.length),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'info',
			description: 'Show every detail of one quest.',
			build: (sub) => {
				questOption(sub);
				accountOption(sub);
			},
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const questId = interaction.options.getString('quest', true);
				const account = services.autoService.resolveAccount(
					scope,
					interaction.options.getString('account'),
				);
				const quest = await services.questService.get(
					questId,
					scope,
					account,
				);

				await interaction.reply({
					embeds: [questDetailEmbed(quest)],
					components: [buildQuestActions(quest.id)],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'start',
			description: 'Start a quest (enrolment happens in the Discord client).',
			build: questOption,
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const questId = interaction.options.getString('quest', true);
				const quest = await services.questService.get(questId, scope);

				await interaction.reply({
					embeds: [questDetailEmbed(quest)],
					components: [buildStartConfirmRow(quest.id)],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'progress',
			description: 'Show the progress recorded for your account.',
			run: async (context: CommandContext) => {
				const { interaction, services, userId } = context;
				const entries = services.progressService.list(userId);

				const { progressEmbed } = await import('../ui/embeds');

				await interaction.reply({
					embeds: [
						progressEmbed(
							entries.map((entry) => ({
								questId: entry.quest_id,
								questName: entry.quest_id,
								status:
									ELIGIBILITY_LABELS[
										entry.status as keyof typeof ELIGIBILITY_LABELS
									] ?? entry.status,
								value: entry.value,
								target: entry.target,
								percent: entry.percent,
								updatedAt: entry.updated_at,
							})),
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'status',
			description: 'Show the status of one quest for your account.',
			build: (sub) => {
				questOption(sub);
				accountOption(sub);
			},
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const questId = interaction.options.getString('quest', true);
				const account = services.autoService.resolveAccount(
					scope,
					interaction.options.getString('account'),
				);
				const quest = await services.questService.status(
					questId,
					scope,
					account,
				);

				await interaction.reply({
					embeds: [questDetailEmbed(quest)],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'sessions',
			description:
				'Show the accounts (sessions) of your rooms - no token is revealed.',
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;

				if (!services.autoService.enabled(scope)) {
					await interaction.reply({
						content:
							'You have no account yet. Add one with `/token add` (owner only).',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				const sessions = await services.autoService.describeSessions(
					scope,
				);
				const selected = services.autoService.defaultAccount(scope);

				const lines = sessions.map((session) => {
					const state = session.ok
						? '🟢 active'
						: `🔴 ${session.error ?? 'not usable'}`;
					const marker = session.label === selected ? ' ⭐' : '';

					return `**${session.label}**${marker} - ${
						session.username ?? 'unknown account'
					} (\`${session.accountId ?? '?'}\`)\n${state} - ${
						session.quests
					} quests available`;
				});

				await interaction.reply({
					embeds: [
						infoEmbed(
							'USER SESSIONS',
							lines.length
								? lines.join('\n\n')
								: 'No user session is configured.',
							[
								{
									name: 'Selected account',
									value: selected
										? `**${selected}** - only this account is used.`
										: 'none - every account is used and all quests start at the same time.',
								},
								{
									name: 'Switching',
									value:
										'`/quest switch account:<label>` selects one account, `/quest switch account:all` uses every account again.',
								},
								{
									name: 'Privacy',
									value:
										'The tokens are encrypted on disk and are never displayed.',
								},
							],
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'switch',
			description:
				'Choose the account of your rooms the bot works with ("all" uses every account).',
			build: (sub) => {
				sub.addStringOption((option) =>
					option
						.setName('account')
						.setDescription('The account label or "all"')
						.setRequired(true)
						.setAutocomplete(true),
				);
			},
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;

				const value = (
					interaction.options.getString('account', true) ?? ''
				).trim();

				if (value.toLowerCase() === 'all') {
					services.autoService.setDefaultAccount(scope, null);
					await interaction.reply({
						embeds: [
							successEmbed(
								'Every account is used again - the quests of all accounts start at the same time.',
							),
						],
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				services.autoService.setDefaultAccount(scope, value);
				await interaction.reply({
					embeds: [
						successEmbed(
							`The bot now works with the account **${value}**. Every other account stays available through \`/quest all account:<label>\`.`,
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'refresh',
			description: 'Refresh the quest information the bot knows about.',
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const result = await services.questService.refresh(scope);

				for (const quest of result.quests.slice(0, 50)) {
					services.questService.recordProgress(scope.userId, quest);
				}

				await interaction.reply({
					content:
						`Refreshed **${result.quests.length}** quests from the **${result.source}** source.`,
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'panel',
			description:
				'Open the main quest interface - banner, dropdown and actions.',
			build: (sub) => {
				accountOption(sub);
				sub.addStringOption((option) =>
					option
						.setName('category')
						.setDescription('Which quests to show')
						.setRequired(false)
						.addChoices(
							{ name: 'all quests', value: 'all' },
							{ name: 'videos only', value: 'videos' },
							{ name: 'games only', value: 'games' },
						),
				);
			},
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const account = interaction.options.getString('account');
				const category = interaction.options.getString('category');
				const selected = services.autoService.resolveAccount(
					scope,
					account,
				);

				const filter =
					category === 'videos' || category === 'games'
						? category
						: 'all';

				const payload = await renderQuestPanel(
					services,
					scope,
					null,
					selected ?? null,
					0,
					filter,
				);

				await interaction.reply({
					...payload,
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'access',
			description: 'Authorise the bot to use your account for your quests.',
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const status = services.accountService.status(scope.userId);

				if (!status.linked) {
					const url = await services.accountService.beginLink(
						scope.userId,
					);

					await interaction.reply({
						embeds: [
							infoEmbed(
								'QUEST ACCOUNT ACCESS',
								'Authorise this bot against your Discord account.\n\n' +
									'Account: **Not linked**\n' +
									'Authorization: **Missing**\n' +
									'Quest Access: **Unavailable**',
								[
									{
										name: 'Why authorise',
										value:
											'The bot needs the `identify` scope to associate the quests of your account with you.',
									},
								],
							),
						],
						components: [
							{
								type: 1,
								components: [
									new ButtonBuilder()
										.setLabel('Authorise with Discord')
										.setStyle(ButtonStyle.Link)
										.setURL(url),
								],
							},
						],
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				const embed = status.expired
					? infoEmbed(
							'QUEST ACCOUNT ACCESS',
							[
								'QUEST ACCOUNT ACCESS',
								'',
								`Account: **${status.discordUsername ?? 'unknown'}**`,
								'Authorization: **Expired**',
								'Quest Access: **Unavailable**',
							].join('\n'),
							[
								{
									name: 'What to do',
									value:
										'The authorization of your linked account expired. Run `/account link` again to renew it.',
								},
							],
						)
					: infoEmbed(
							'QUEST ACCOUNT ACCESS',
							[
								'QUEST ACCOUNT ACCESS',
								'',
								`Account: **${status.discordUsername ?? 'unknown'}**`,
								'Authorization: **Active**',
								'Quest Access: **Available**',
							].join('\n'),
							[
								{
									name: 'Linked',
									value: `${status.discordUsername ?? 'unknown'} (\`${status.discordAccountId}\`)`,
								},
								{
									name: 'Authorization expires',
									value: status.expiresAt ?? 'unknown',
								},
							],
						);

				await interaction.reply({
					embeds: [embed],
					components: [
					{
						type: 1,
						components: [
							new ButtonBuilder()
								.setCustomId('quest:access:disconnect')
								.setLabel('Disconnect')
								.setStyle(ButtonStyle.Danger),
						],
					},
				],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'select',
			description: 'Select a quest and open the main interface.',
			build: (sub) => {
				questOption(sub);
				sub.addStringOption((option) =>
					option
						.setName('category')
						.setDescription('Which quests to show')
						.setRequired(false)
						.addChoices(
							{ name: 'all quests', value: 'all' },
							{ name: 'videos only', value: 'videos' },
							{ name: 'games only', value: 'games' },
						),
				);
			},
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const questId = interaction.options.getString('quest', true);
				const category = interaction.options.getString('category');

				const filter =
					category === 'videos' || category === 'games'
						? category
						: 'all';

				const payload = await renderQuestPanel(
					services,
					scope,
					questId,
					null,
					0,
					filter,
				);

				await interaction.reply({
					...payload,
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'search',
			description: 'Search the available quests by title.',
			build: (sub) => {
				sub.addStringOption((option) =>
					option
						.setName('name')
						.setDescription('Part of the quest name')
						.setRequired(true),
				);
			},
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const query = interaction.options
					.getString('name', true)
					.trim()
					.toLowerCase();
				const { quests } = await services.questService.list(scope);

				const matches = quests.filter(
					(quest) =>
						quest.name.toLowerCase().includes(query) ||
						quest.id.includes(query) ||
						(quest.applicationName ?? '').toLowerCase().includes(query),
				);

				if (matches.length === 0) {
					await interaction.reply({
						embeds: [
							infoEmbed(
								'NO MATCH',
								`No quest matches "${query}". Try another spelling or wait for the next batch of quests.`,
							),
						],
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				const selected =
					matches.find(
						(quest) => quest.name.toLowerCase() === query,
					) ?? matches[0];
				const payload = await renderQuestPanel(
					services,
					scope,
					selected.id,
					null,
					0,
				);

				await interaction.reply({
					embeds: [
						payload.embeds[0],
						infoEmbed(
							'MATCHES',
							`Found ${matches.length} quest(s) matching "${query}". Showing the closest one - use the dropdown to pick another.`,
						),
					],
					components: payload.components,
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'categories',
			description: 'Show the available quests grouped by platform.',
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const { quests } = await services.questService.list(scope);

				const byPlatform = new Map<number, number>();

				for (const quest of quests) {
					for (const platform of quest.platforms) {
						byPlatform.set(
							platform,
							(byPlatform.get(platform) ?? 0) + 1,
						);
					}
				}

				const lines = quests.length
					? [
							...new Set(
								quests.flatMap((quest) => quest.platforms),
							),
						]
							.sort((a, b) => a - b)
							.map(
								(platform) =>
									`**${PLATFORM_NAMES[platform] ?? `Platform ${platform}`}** - ${byPlatform.get(platform)} quest(s)`,
							)
							.join('\n')
					: 'No quests available.';

				const games = [
					...new Set(
						quests
							.map((quest) => quest.gameTitle ?? quest.applicationName)
							.filter(Boolean),
					),
				];

				await interaction.reply({
					embeds: [
						infoEmbed('QUEST CATEGORIES', lines, [
							{
								name: 'Games',
								value:
									games.slice(0, 20).join(', ') || 'none',
							},
							{
								name: 'Total',
								value: `${quests.length} quests`,
							},
						]),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'history',
			description: 'Show your recent quest activity.',
			run: async (context: CommandContext) => {
				const { interaction, services, userId } = context;
				const history = services.questService.history(userId, 15);

				const lines = history.length
					? history
							.map(
								(entry) =>
									`\`${entry.created_at}\` **${entry.event_type}** ${
										entry.quest_id ?? ''
									} ${entry.detail ?? ''}`.trim(),
							)
							.join('\n')
					: 'No activity recorded yet.';

				await interaction.reply({
					embeds: [
						{
							color: 0x5865f2,
							title: 'HISTORY',
							description: lines.slice(0, 4000),
						},
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
	],
);
