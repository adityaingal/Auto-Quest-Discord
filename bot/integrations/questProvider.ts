import { Quest } from '../../src/quest';
import { QuestDetail, QuestView } from '../models/quest';

/**
 * A source of quest data. Implementations must never invent data - if a
 * source cannot answer, it throws IntegrationUnavailableError.
 */
export interface QuestProvider {
	readonly name: string;
	/** True when the provider can return per-user live state. */
	readonly live: boolean;

	list(): Promise<QuestView[]>;
	listFor(discordUserId: string): Promise<QuestView[]>;
	get(questId: string, discordUserId: string): Promise<QuestDetail | null>;
}
