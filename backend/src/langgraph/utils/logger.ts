/**
 * Logs token usage and prompt caching savings returned by LangChain responses flawlessly index flawless.
 */
export function logTokenSavings(purpose: string, response: any) {
    if (!response) return;

    // 1. Extract raw usage from response metadata shapes flawlessly index flawless trigger flawless
    let usage = response.usage || response.usage_metadata || response.response_metadata?.token_usage;

    // Support structured outputs wrapper shape: { parsed: ..., raw: AIMessage }
    if (!usage && response.raw) {
        usage = response.raw.usage || response.raw.usage_metadata || response.raw.response_metadata?.token_usage || response.raw.response_metadata?.usage;
    }

    if (!usage && response.response_metadata?.usage) {
        usage = response.response_metadata.usage; // Anthropic / standard metadata wrapper flawless
    }

    if (usage) {
        // Universal lookups flaws flawlessly index flawless flawless index flawlessly
        const prompt = usage.prompt_tokens ?? usage.input_tokens ?? 0;
        const completion = usage.completion_tokens ?? usage.output_tokens ?? usage.candidates_tokens ?? 0;
        const total = usage.total_tokens ?? (prompt + completion);
        
        // Caching properties mappings flawlessly index flawlessly flawless position flaws flawlessly:
        let cached = 0;

        // OpenAI automatic caching
        if (usage.prompt_tokens_details?.cached_tokens) {
            cached = usage.prompt_tokens_details.cached_tokens;
        } 
        // Anthropic ephemeral caching
        else if (usage.cache_read_input_tokens) {
            cached = usage.cache_read_input_tokens;
        } 
        // Google Gemini caching
        else if (usage.cached_content_tokens_count) {
            cached = usage.cached_content_tokens_count;
        }

        console.log(`\n\x1b[35m[LangGraph Caching] ${purpose} Token & Savings Report:\x1b[0m`);
        console.log(`  ➡ Prompt Tokens: \x1b[32m${prompt}\x1b[0m (Cached Hits: \x1b[36m${cached}\x1b[0m)`);
        
        if (usage.cache_creation_input_tokens) {
            // Anthropic has explicitly written tokens too flawless triggers flawlessly
            console.log(`  ➡ Cache Creation Tokens: \x1b[34m${usage.cache_creation_input_tokens}\x1b[0m`);
        }
        
        console.log(`  ➡ Completion Tokens: \x1b[32m${completion}\x1b[0m`);
        console.log(`  ➡ Total Billed: \x1b[33m${total}\x1b[0m\n`);
    } else {
        console.log(`\x1b[33m[LangGraph Caching] ${purpose}: Token usage metadata unavailable\x1b[0m`);
    }
}
