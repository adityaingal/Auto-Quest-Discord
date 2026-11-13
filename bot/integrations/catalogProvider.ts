import { readFileSync } from 'node:fs';
import { Quest } from '../../src/quest';
import { AllQuestsResponse } from '../../src/interface';
import { QuestDetail, QuestView } from '../models/quest';
import { toQuestDetail, toQuestView } from '../services/questAdapter';
import { QuestProvider } from './questProvider';
import { NotFoundError } from '../utils/errors';

/**
 * Reads the bundled quest catalogue (quest.json - a captured, public quest
 * configuration snapshot). This source works without any authorization and
 * never touches a live endpoint.
 */
export class CatalogProvider implements QuestProvider {
	public readonly name = 'catalogue';
	public readonly live = false;

	private quests: Quest[] | null = null;

	constructor(private readonly catalogPath: string) {}

	private load(): Quest[] {
		if (this.quests) return this.quests;

		const raw = readFileSync(this.catalogPath, 'utf8');
		const parsed = JSON.parse(raw) as AllQuestsResponse;

		this.quests = (parsed.quests ?? []).map((quest) => Quest.create(quest));

		return this.quests;
	}

	async list(): Promise<QuestView[]> {
		return this.load().map((quest) => toQuestView(quest, this.name));
	}

	async listFor(): Promise<QuestView[]> {
		return this.list();
	}

	async get(
		questId: string,
		_discordUserId?: string,
	): Promise<QuestDetail | null> {
		const quest = this.load().find((entry) => entry.id === questId);
		if (!quest) return null;

		return toQuestDetail(quest, this.name);
	}

	async require(questId: string): Promise<QuestDetail> {
		const quest = await this.get(questId);
		if (!quest) {
			throw new NotFoundError(`Quest \`${questId}\` is not in the catalogue.`);
		}
		return quest;
	}
}
