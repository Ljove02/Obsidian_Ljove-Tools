import { App, TFile, FuzzySuggestModal } from 'obsidian';

export class NoteSuggester extends FuzzySuggestModal<TFile> {
    private targetInput: HTMLInputElement;

    constructor(app: App, targetInput: HTMLInputElement) {
        super(app);
        this.targetInput = targetInput;
    }

    getItems(): TFile[] {
        return this.app.vault.getMarkdownFiles();
    }

    getItemText(item: TFile): string {
        return item.basename;
    }

    onChooseItem(item: TFile, evt: MouseEvent | KeyboardEvent) {
        this.targetInput.value = item.basename;
        this.targetInput.focus();
    }
}

export class ChatNoteSuggester extends FuzzySuggestModal<TFile | string> {
    private targetInput: HTMLTextAreaElement;

    constructor(app: App, targetInput: HTMLTextAreaElement) {
        super(app);
        this.targetInput = targetInput;
        this.setPlaceholder('Search for a note to reference...');
    }

    getItems(): (TFile | string)[] {
        const files = this.app.vault.getMarkdownFiles();
        return files.map(file => file.basename);
    }

    getItemText(item: TFile | string): string {
        return typeof item === 'string' ? item : item.basename;
    }

    onChooseItem(item: TFile | string, evt: MouseEvent | KeyboardEvent) {
        const noteName = typeof item === 'string' ? item : item.basename;
        
        // Replace the [[ that triggered this with [[noteName]]
        const currentValue = this.targetInput.value;
        const cursorPosition = this.targetInput.selectionStart || 0;
        
        // Find the last [[ before cursor position
        const beforeCursor = currentValue.substring(0, cursorPosition);
        const lastBracketIndex = beforeCursor.lastIndexOf('[[');
        
        if (lastBracketIndex !== -1) {
            const beforeBrackets = currentValue.substring(0, lastBracketIndex);
            const afterCursor = currentValue.substring(cursorPosition);
            
            this.targetInput.value = beforeBrackets + `[[${noteName}]]` + afterCursor;
            
            // Position cursor after the closing brackets
            const newPosition = lastBracketIndex + noteName.length + 4;
            this.targetInput.setSelectionRange(newPosition, newPosition);
        }
        
        this.targetInput.focus();
    }
}