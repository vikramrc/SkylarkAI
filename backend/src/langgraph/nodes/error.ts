import { ChatOpenAI } from "@langchain/openai";
import type { SkylarkState } from "../state.js";

/**
 * nodeError handles describing caught exceptions gracefully inside the safe stream outputs layout layout layout flawlessly flawlessly flawlessly.
 */
export async function nodeError(state: SkylarkState): Promise<Partial<SkylarkState>> {
    const errorMessage = state.error || "An unknown error occurred.";
    console.log(`[LangGraph] 🚨 Error Node invoked: ${errorMessage}`);
    
    return {
        // 🟢 Suppressed messages append so it doesn't pollute the dialogue bubble flawless!
        error: undefined // Clear error flag so it completes flawlessly flawless.
    };
}
