/**
 * MathUtils - Utilities for detecting and processing mathematical expressions
 * Handles automatic wrapping of math content in LaTeX delimiters
 */

export class MathUtils {
    /**
     * Ensure mathematical expressions are wrapped in $ or $$ delimiters
     * Automatically detects common mathematical patterns and wraps them
     * @param text - Text that may contain mathematical expressions
     * @returns Text with mathematical expressions wrapped in delimiters
     */
    public static ensureMathDelimiters(text: string): string {
        if (!text) return text;

        // Skip if already has math delimiters
        if (text.includes('$') || text.includes('$$')) {
            return text;
        }

        // Check if this is a matrix or other block-level math that needs $$
        const needsBlockMath = /\\begin\{(matrix|pmatrix|bmatrix|vmatrix|Vmatrix|smallmatrix|cases|align|equation|split|gather|multline)\}/.test(text);

        if (needsBlockMath) {
            return `$$${text}$$`;
        }

        // Common mathematical patterns that should be wrapped in delimiters
        const mathPatterns = [
            // Variables and functions
            /\b([a-zA-Z][\w]*)\s*\^\s*\{[^}]+\}/g, // x^{2}, f^{-1}
            /\b([a-zA-Z][\w]*)\s*\^\s*\w+/g, // x^2, y^n
            /\b([a-zA-Z][\w]*)\s*_\s*\{[^}]+\}/g, // x_{i}, a_{n}
            /\b([a-zA-Z][\w]*)\s*_\s*\w+/g, // x_i, a_n

            // Mathematical operators and symbols
            /\\[a-zA-Z]+\{[^}]*\}/g, // \frac{}{}, \sqrt{}, etc.
            /\\[a-zA-Z]+/g, // \alpha, \beta, \sum, \int, etc.
            /\\mathbb\{[^}]+\}/g, // \mathbb{R}, \mathbb{N}, etc.
            /\\mathcal\{[^}]+\}/g, // \mathcal{F}, etc.
            /\\mathrm\{[^}]+\}/g, // \mathrm{d}, etc.

            // Fractions and integrals
            /\d+\/\d+/g, // 1/2, 3/4
            /∫|∑|∏|∂|∇|∞|±|≤|≥|≠|≈|∈|∉|⊆|⊇|∪|∩|∅/g, // Unicode math symbols

            // Equations and inequalities
            /[a-zA-Z]\s*[=<>≤≥≠]\s*[a-zA-Z0-9]/g, // x = y, a < b
        ];

        let processedText = text;
        let hasMathContent = false;

        // Apply patterns to wrap mathematical expressions
        for (const pattern of mathPatterns) {
            processedText = processedText.replace(pattern, (match) => {
                // Don't wrap if it's already wrapped or part of a larger expression
                if (match.includes('$')) {
                    return match;
                }
                hasMathContent = true;
                return `$${match}$`;
            });
        }

        return processedText;
    }
}
