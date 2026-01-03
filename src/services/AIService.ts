import { GoogleGenerativeAI } from '@google/generative-ai';
import { LjoveSToolsSettings, ImageAttachment, AVAILABLE_MODELS } from '../types';

export class AIService {
    private settings: LjoveSToolsSettings;

    constructor(settings: LjoveSToolsSettings) {
        this.settings = settings;
    }

    public updateSettings(settings: LjoveSToolsSettings) {
        this.settings = settings;
    }

    public getCurrentApiKey(): string {
        const selectedModel = AVAILABLE_MODELS.find(m => m.id === this.settings.model);
        const provider = selectedModel?.provider || 'gemini';
        
        switch (provider) {
            case 'openai':
                return this.settings.openaiApiKey;
            case 'deepseek':
                return this.settings.deepseekApiKey;
            default:
                return this.settings.geminiApiKey;
        }
    }

    public getModelProvider(): string {
        const selectedModel = AVAILABLE_MODELS.find(m => m.id === this.settings.model);
        return selectedModel?.provider || 'gemini';
    }

    public async callAI(prompt: string, provider: string, apiKey: string, images?: ImageAttachment[]): Promise<string | null> {
        try {
            let response: Response;
            
            switch (provider) {
                case 'openai':
                    const content: any[] = [{ type: 'text', text: prompt }];
                    
                    // Add images for OpenAI
                    if (images && images.length > 0) {
                        images.forEach(image => {
                            content.push({
                                type: 'image_url',
                                image_url: {
                                    url: image.data
                                }
                            });
                        });
                    }
                    
                    response = await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify({
                            model: this.settings.model,
                            messages: [{ 
                                role: 'user', 
                                content: content.length === 1 ? prompt : content 
                            }],
                            temperature: 0.7
                        })
                    });
                    break;
                    
                case 'deepseek':
                    response = await fetch('https://api.deepseek.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify({
                            model: this.settings.model,
                            messages: [{ role: 'user', content: prompt }],
                            temperature: 0.7
                        })
                    });
                    break;
                    
                default: // gemini
                    if (images && images.length > 0) {
                        return await this.callGeminiWithFiles(prompt, apiKey, images);
                    } else {
                        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.settings.model}:generateContent?key=${apiKey}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                contents: [{ parts: [{ text: prompt }] }]
                            })
                        });
                    }
                    break;
            }

            if (!response!.ok) {
                throw new Error(`API Error ${response!.status}`);
            }

            const data = await response!.json();
            
            switch (provider) {
                case 'openai':
                case 'deepseek':
                    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                        throw new Error('Invalid response format from OpenAI/DeepSeek API');
                    }
                    return data.choices[0].message.content;
                default: // gemini
                    if (!data.candidates || !Array.isArray(data.candidates)) {
                        throw new Error('Invalid response format from Gemini API');
                    }
                    // Defensive parsing: extract text from all candidates and parts
                    return this.extractTextFromGeminiResponse(data);
            }
        } catch (error) {
            console.error(`Error calling ${provider} API:`, error);
            if (error.message.includes('503')) {
                throw new Error(`${provider.toUpperCase()} API is temporarily unavailable (503). Please try again in a few moments.`);
            }
            throw error;
        }
    }

    public async streamAI(
        prompt: string, 
        provider: string, 
        apiKey: string, 
        onChunk: (chunk: string) => void, 
        images?: ImageAttachment[],
        abortController?: AbortController
    ): Promise<string> {
        let fullResponse = '';
        
        try {
            let response: Response;
            
            switch (provider) {
                case 'openai':
                    const content: any[] = [{ type: 'text', text: prompt }];
                    
                    // Add images for OpenAI
                    if (images && images.length > 0) {
                        images.forEach(image => {
                            content.push({
                                type: 'image_url',
                                image_url: {
                                    url: image.data
                                }
                            });
                        });
                    }
                    
                    response = await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify({
                            model: this.settings.model,
                            messages: [{ 
                                role: 'user', 
                                content: content.length === 1 ? prompt : content 
                            }],
                            temperature: 0.7,
                            stream: true
                        }),
                        signal: abortController?.signal
                    });
                    break;
                    
                case 'deepseek':
                    response = await fetch('https://api.deepseek.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify({
                            model: this.settings.model,
                            messages: [{ role: 'user', content: prompt }],
                            temperature: 0.7,
                            stream: true
                        }),
                        signal: abortController?.signal
                    });
                    break;
                    
                case 'gemini':
                default:
                    // Use real Gemini streaming for both text and image cases
                    return await this.streamGeminiWithFiles(prompt, apiKey, onChunk, images, abortController);
            }

            if (!response.ok) {
                throw new Error(`API Error ${response.status}`);
            }

            const reader = response.body!.getReader();
            const decoder = new TextDecoder();
            let chunkCount = 0;

            console.log(`[AIService] Starting ${provider} streaming...`);

            try {
                while (true) {
                    // Check if cancelled
                    if (abortController?.signal.aborted) {
                        console.log(`[AIService] ${provider} streaming cancelled by user`);
                        break;
                    }

                    const { value, done } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') continue;

                            try {
                                const parsed = JSON.parse(data);
                                const content = parsed.choices?.[0]?.delta?.content;
                                if (content) {
                                    chunkCount++;
                                    console.log(`[AIService] ${provider} chunk ${chunkCount}: ${content.length} chars`);
                                    fullResponse += content;
                                    onChunk(content);
                                }
                            } catch (e) {
                                // Skip malformed JSON chunks
                            }
                        }
                    }
                }
            } finally {
                reader.releaseLock();
                console.log(`[AIService] ${provider} streaming complete. ${chunkCount} chunks, ${fullResponse.length} total chars`);
            }
            
        } catch (error) {
            console.error(`Error streaming ${provider} API:`, error);
            throw error;
        }
        
        return fullResponse;
    }

    private async streamGeminiWithFiles(
        prompt: string,
        apiKey: string,
        onChunk: (chunk: string) => void,
        images?: ImageAttachment[],
        abortController?: AbortController
    ): Promise<string> {
        try {
            // Initialize Google Generative AI
            const genAI = new GoogleGenerativeAI(apiKey);
            
            // Create model instance
            const model = genAI.getGenerativeModel({ model: this.settings.model });
            
            // Prepare request parts
            const parts = [];
            
            // Add images as inline data (base64) for now
            // TODO: Implement proper file upload via Files API when SDK supports it
            if (images && images.length > 0) {
                for (const image of images) {
                    // Strip data URI prefix if present (e.g., "data:image/png;base64,")
                    let base64Data = image.data;
                    if (base64Data.includes('base64,')) {
                        base64Data = base64Data.split('base64,')[1];
                    }

                    parts.push({
                        inlineData: {
                            data: base64Data,
                            mimeType: image.mimeType
                        }
                    });
                }
            }
            
            // Add text prompt
            parts.push({ text: prompt });
            
            // Use real streaming with generateContentStream
            console.log('[AIService] Starting Gemini streaming...');
            const result = await model.generateContentStream(parts);
            let fullResponse = '';
            let chunkCount = 0;

            for await (const chunk of result.stream) {
                // Check if cancelled
                if (abortController?.signal.aborted) {
                    console.log('[AIService] Streaming cancelled by user');
                    break;
                }

                // Defensive parsing: iterate through all candidates and parts
                const textChunk = this.extractTextFromGeminiChunk(chunk);
                if (textChunk) {
                    chunkCount++;
                    console.log(`[AIService] Gemini chunk ${chunkCount}: ${textChunk.length} chars`);
                    fullResponse += textChunk;
                    onChunk(textChunk);
                }
            }

            console.log(`[AIService] Gemini streaming complete. ${chunkCount} chunks, ${fullResponse.length} total chars`);
            return fullResponse;
            
        } catch (error) {
            console.error('Error with Gemini API:', error);
            throw error;
        }
    }

    private async callGeminiWithFiles(prompt: string, apiKey: string, images: ImageAttachment[]): Promise<string> {
        try {
            // Initialize Google Generative AI
            const genAI = new GoogleGenerativeAI(apiKey);
            
            // Create model instance
            const model = genAI.getGenerativeModel({ model: this.settings.model });
            
            // Prepare request parts
            const parts = [];
            
            // Add images as inline data (base64)
            if (images && images.length > 0) {
                for (const image of images) {
                    // Strip data URI prefix if present (e.g., "data:image/png;base64,")
                    let base64Data = image.data;
                    if (base64Data.includes('base64,')) {
                        base64Data = base64Data.split('base64,')[1];
                    }

                    parts.push({
                        inlineData: {
                            data: base64Data,
                            mimeType: image.mimeType
                        }
                    });
                }
            }
            
            // Add text prompt
            parts.push({ text: prompt });
            
            // Generate content
            const result = await model.generateContent(parts);
            const response = await result.response;
            return response.text();
            
        } catch (error) {
            console.error('Error with Gemini Files API:', error);
            throw error;
        }
    }

    private extractTextFromGeminiChunk(chunk: any): string {
        let textContent = '';
        
        // Check if chunk has candidates array
        if (!chunk.candidates || !Array.isArray(chunk.candidates)) {
            return textContent;
        }
        
        // Iterate through all candidates
        for (const candidate of chunk.candidates) {
            // Check if candidate has content and parts
            if (!candidate.content || !candidate.content.parts || !Array.isArray(candidate.content.parts)) {
                continue;
            }
            
            // Iterate through all parts and collect text
            for (const part of candidate.content.parts) {
                if (part && typeof part.text === 'string') {
                    textContent += part.text;
                }
            }
        }
        
        return textContent;
    }

    private extractTextFromGeminiResponse(data: any): string {
        let textContent = '';
        
        // Check if data has candidates array
        if (!data.candidates || !Array.isArray(data.candidates)) {
            throw new Error('Invalid response format from Gemini API: no candidates');
        }
        
        // Iterate through all candidates
        for (const candidate of data.candidates) {
            // Check if candidate has content and parts
            if (!candidate.content || !candidate.content.parts || !Array.isArray(candidate.content.parts)) {
                continue;
            }
            
            // Iterate through all parts and collect text
            for (const part of candidate.content.parts) {
                if (part && typeof part.text === 'string') {
                    textContent += part.text;
                }
            }
        }
        
        // If no text content found, throw error
        if (!textContent) {
            throw new Error('Invalid response format from Gemini API: no text content found');
        }
        
        return textContent;
    }
}