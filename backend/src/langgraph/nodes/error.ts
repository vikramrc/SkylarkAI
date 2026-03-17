import { ChatOpenAI } from "@langchain/openai";
import type { SkylarkState } from "../state.js";

/**
 * nodeError handles describing caught exceptions gracefully inside the safe stream outputs layout layout layout flawlessly flawlessly flawlessly.
 */
export async function nodeError(state: SkylarkState): Promise<Partial<SkylarkState>> {
    console.log(`[LangGraph] 🚨 Error Node invoked`);
    const errorMessage = state.error || "An unknown error occurred.";
    
    return {
        messages: [{ role: "assistant", content: `⚠️ **System Error**: ${errorMessage}` } as any],
        error: undefined // Clear error flag so it completes flawlessly flawless.
    };
}
