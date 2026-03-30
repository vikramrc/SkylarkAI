import { injectMaritimeKnowledge } from './knowledge_loader.js';
import { ORCHESTRATOR_RULES } from '../prompts/orchestrator_rules.js';
import { SUMMARIZER_RULES } from '../prompts/summarizer_rules.js';

/**
 * Loads the orchestrator rules from the standalone configuration
 * and injects dynamic maritime knowledge.
 */
export function loadOrchestratorPrompt(): string {
    try {
        const rawRules = ORCHESTRATOR_RULES;
        const maritimeKnowledge = injectMaritimeKnowledge();

        // Stitch them together with clear separation
        return `${rawRules}\n\n${maritimeKnowledge}\n\n### 🛠️ AVAILABLE MCP TOOLS\n%%TOOL_CONTEXT%%\n`;
    } catch (e: any) {
        console.error(`[PromptLoader] Failed to load orchestrator prompt`, e.message || e);
        return "Error loading system instructions.";
    }
}

/**
 * Loads the summarizer rules from the standalone configuration
 * and injects dynamic maritime knowledge.
 */
export function loadSummarizerPrompt(): string {
    try {
        const rawRules = SUMMARIZER_RULES;
        const maritimeKnowledge = injectMaritimeKnowledge();

        // Stitch them together with clear separation
        return `${rawRules}\n\n${maritimeKnowledge}\n\n### 🔭 GLOBAL SCHEMA CONTEXT\n%%SCHEMA_CONTEXT%%\n`;
    } catch (e: any) {
        console.error(`[PromptLoader] Failed to load summarizer prompt`, e.message || e);
        return "Error loading analyst instructions.";
    }
}
