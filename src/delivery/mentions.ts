import type { MessageMentionOptions } from "discord.js";
import { categoryOf, type EventType } from "../config/events.js";
import type { TrackedRepo } from "../db/types.js";

export interface MentionPlan {
	/** Text display prepended to the message, or undefined when no rule matched. */
	line?: string;
	allowedMentions: MessageMentionOptions;
}

/** Nothing is ever pinged unless a rule explicitly asks for it. */
const SILENT: MessageMentionOptions = { parse: [], roles: [], users: [] };

export function planMentions(tracked: TrackedRepo, eventType: EventType): MentionPlan {
	const rules = tracked.mentionRules;
	const roles = rules[eventType] ?? rules[categoryOf(eventType)] ?? [];
	const unique = Array.from(new Set(roles.filter(Boolean))).slice(0, 5);

	if (unique.length === 0) return { allowedMentions: SILENT };

	return {
		line: unique.map((roleId) => `<@&${roleId}>`).join(" "),
		allowedMentions: { parse: [], users: [], roles: unique },
	};
}
