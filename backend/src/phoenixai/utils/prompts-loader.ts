import {
    AMBIGUITY_RESOLVER_SYSTEM_PROMPT,
    AMBIGUITY_RESOLVER_SYSTEM_PROMPT2,
    BC_SUMMARY_SYSTEM_PROMPT,
    INTENT_SELECTOR_SCHEMA_HINT,
    INTENT_SELECTOR_SYSTEM_PROMPT,
    KEYWORD_EXTRACTOR_SYSTEM_PROMPT,
    QUERY_GENERATION_SYSTEM_PROMPT,
} from '../prompts.js';

export const PHOENIX_PROMPTS = Object.freeze({
    AMBIGUITY_RESOLVER_SYSTEM_PROMPT,
    AMBIGUITY_RESOLVER_SYSTEM_PROMPT2,
    BC_SUMMARY_SYSTEM_PROMPT,
    INTENT_SELECTOR_SCHEMA_HINT,
    INTENT_SELECTOR_SYSTEM_PROMPT,
    KEYWORD_EXTRACTOR_SYSTEM_PROMPT,
    QUERY_GENERATION_SYSTEM_PROMPT,
});

export type PhoenixPromptName = keyof typeof PHOENIX_PROMPTS;

export function loadPrompts() {
    return PHOENIX_PROMPTS;
}

export function getPrompt(name: string) {
    if (!(name in PHOENIX_PROMPTS)) {
        throw new Error(`Prompt not found: ${name}`);
    }

    return PHOENIX_PROMPTS[name as PhoenixPromptName];
}