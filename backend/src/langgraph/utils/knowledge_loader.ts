import { KNOWLEDGE_GRAPH } from '../knowledge/phoenix_knowledge_graph.js';

/**
 * Loads the Phoenix PMS Knowledge Graph and formats it for LLM consumption.
 * Decided: Markdown format for better reasoning accuracy.
 */
export function injectMaritimeKnowledge(): string {
    try {
        const knowledge = KNOWLEDGE_GRAPH;

        let markdown = `\n### 🏗️ PHOENIX PMS KNOWLEDGE GRAPH (Mental Model)\n`;
        markdown += `*System: ${knowledge.system} | Version: ${knowledge.version}*\n\n`;

        if (knowledge.USAGE_PREAMBLE) {
            markdown += `> **USAGE**: ${knowledge.USAGE_PREAMBLE}\n\n`;
        }

        markdown += `#### 🏛️ DOMAIN HIERARCHIES (Vertical Map)\n`;
        Object.entries(knowledge.DOMAIN_HIERARCHIES).forEach(([name, path]) => {
            markdown += `- **${name}**: ${path}\n`;
        });
        markdown += `\n`;

        markdown += `#### 🔗 ENTITY RELATIONSHIPS (Horizontal Connectors)\n`;
        knowledge.ENTITY_RELATIONSHIPS.forEach((rel: any) => {
            markdown += `- **${rel.from}** → **${rel.to}** (\`${rel.key}\`): ${rel.relation}\n`;
        });
        markdown += `\n`;

        markdown += `#### 🛰️ REASONING INFERENCE MAP (Keyword Compass)\n`;
        Object.entries(knowledge.REASONING_INFERENCE_MAP).forEach(([domain, keywords]) => {
            markdown += `- **${domain}**: ${keywords.join(', ')}\n`;
        });

        return markdown;
    } catch (e: any) {
        console.error(`[KnowledgeLoader] Failed to load knowledge graph`, e.message || e);
        return "";
    }
}
