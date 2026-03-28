import fs from 'fs';
import path from 'path';
import { injectMaritimeKnowledge } from './knowledge_loader.js';

/**
 * Loads the orchestrator rules from the standalone Markdown file
 * and injects dynamic maritime knowledge.
 */
export function loadOrchestratorPrompt(): string {
    const PROMPT_PATH = path.join(process.cwd(), 'src/langgraph/prompts/orchestrator_rules.md');
    
    try {
        if (!fs.existsSync(PROMPT_PATH)) {
            console.warn(`[PromptLoader] ⚠️ Orchestrator rules not found at ${PROMPT_PATH}. Falling back to minimal prompt.`);
            return "You are a professional maritime operations orchestrator. Use available tools to answer queries.";
        }

        const rawRules = fs.readFileSync(PROMPT_PATH, 'utf-8');
        const maritimeKnowledge = injectMaritimeKnowledge();

        // Stitch them together with clear separation
        return `${rawRules}\n\n${maritimeKnowledge}\n\n### 🛠️ AVAILABLE MCP TOOLS\n%%TOOL_CONTEXT%%\n`;
    } catch (e: any) {
        console.error(`[PromptLoader] Failed to load orchestrator prompt`, e.message || e);
        return "Error loading system instructions.";
    }
}

/**
 * Loads the summarizer rules from the standalone Markdown file
 * and injects dynamic maritime knowledge.
 */
export function loadSummarizerPrompt(): string {
    const PROMPT_PATH = path.join(process.cwd(), 'src/langgraph/prompts/summarizer_rules.md');
    
    try {
        if (!fs.existsSync(PROMPT_PATH)) {
            console.warn(`[PromptLoader] ⚠️ Summarizer rules not found at ${PROMPT_PATH}. Falling back to minimal prompt.`);
            return "You are a professional maritime operations analyst. Summarize tool results for the user.";
        }

        const rawRules = fs.readFileSync(PROMPT_PATH, 'utf-8');
        const maritimeKnowledge = injectMaritimeKnowledge();

        // Stitch them together with clear separation
        return `${rawRules}\n\n${maritimeKnowledge}\n\n### 🔭 GLOBAL SCHEMA CONTEXT\n%%SCHEMA_CONTEXT%%\n`;
    } catch (e: any) {
        console.error(`[PromptLoader] Failed to load summarizer prompt`, e.message || e);
        return "Error loading analyst instructions.";
    }
}
