import fs from 'fs';
import path from 'path';

/**
 * Loads the Phoenix PMS Knowledge Graph and formats it for LLM consumption.
 * Decided: Markdown format for better reasoning accuracy.
 */
export function injectMaritimeKnowledge(): string {
    const KNOWLEDGE_PATH = path.join(process.cwd(), 'src/langgraph/knowledge/phoenix_knowledge_graph.json');
    
    try {
        if (!fs.existsSync(KNOWLEDGE_PATH)) {
            console.warn(`[KnowledgeLoader] ⚠️ Knowledge graph not found at ${KNOWLEDGE_PATH}`);
            return "";
        }

        const rawData = fs.readFileSync(KNOWLEDGE_PATH, 'utf-8');
        const knowledge = JSON.parse(rawData);

        let markdown = `\n### 🏗️ PHOENIX PMS KNOWLEDGE GRAPH (Mental Model)\n`;
        markdown += `*System: ${knowledge.system} | Version: ${knowledge.version}*\n\n`;

        knowledge.domains.forEach((domain: any) => {
            markdown += `#### 🏛️ Domain: ${domain.name}\n`;
            if (domain.hierarchy) markdown += `**Hierarchy**: ${domain.hierarchy}\n`;
            markdown += `**Description**: ${domain.description}\n`;
            
            markdown += `**Core Models & Logic**:\n`;
            Object.entries(domain.core_models).forEach(([model, desc]) => {
                markdown += `- **${model}**: ${desc}\n`;
            });

            if (domain.extended_concepts) {
                markdown += `**Operational Context**: ${domain.extended_concepts.join(', ')}\n`;
            }
            markdown += `\n`;
        });

        return markdown;
    } catch (e: any) {
        console.error(`[KnowledgeLoader] Failed to load knowledge graph`, e.message || e);
        return "";
    }
}
