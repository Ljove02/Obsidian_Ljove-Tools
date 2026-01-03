import { App, TFile } from 'obsidian';

export interface ImageProcessResult {
    data: ArrayBuffer;
    type: string;
    filename: string;
    isScreenshot?: boolean;
}

export class ImageService {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Generate an Obsidian-style image filename with timestamp
     */
    public generateObsidianImageName(isScreenshot: boolean = false): string {
        const now = new Date();
        
        if (isScreenshot) {
            // Generate "Screenshot 2025-08-17 at 3.46.33 PM.png" format
            const year = now.getFullYear();
            const month = (now.getMonth() + 1).toString().padStart(2, '0');
            const day = now.getDate().toString().padStart(2, '0');
            const hours = now.getHours();
            const minutes = now.getMinutes().toString().padStart(2, '0');
            const seconds = now.getSeconds().toString().padStart(2, '0');
            const milliseconds = now.getMilliseconds().toString().padStart(3, '0');
            
            // Convert to 12-hour format
            const period = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
            
            return `Screenshot ${year}-${month}-${day} at ${displayHours}.${minutes}.${seconds}.${milliseconds} ${period}.png`;
        } else {
            // Generate "Pasted image 20250818162043123.png" format
            const timestamp = now.getFullYear().toString() +
                             (now.getMonth() + 1).toString().padStart(2, '0') +
                             now.getDate().toString().padStart(2, '0') +
                             now.getHours().toString().padStart(2, '0') +
                             now.getMinutes().toString().padStart(2, '0') +
                             now.getSeconds().toString().padStart(2, '0') +
                             now.getMilliseconds().toString().padStart(3, '0');
            return `Pasted image ${timestamp}.png`;
        }
    }

    /**
     * Generate a unique filename by adding counters if needed
     */
    public async generateUniqueFilename(baseName: string, extension: string): Promise<string> {
        const attachmentFolder = (this.app.vault as any).config?.attachmentFolderPath || '';
        let counter = 0;
        let filename = `${baseName}${extension}`;
        let fullPath = attachmentFolder ? `${attachmentFolder}/${filename}` : filename;
        
        // Check if file exists and increment counter until we find a unique name
        while (await this.app.vault.adapter.exists(fullPath)) {
            counter++;
            filename = `${baseName} ${counter}${extension}`;
            fullPath = attachmentFolder ? `${attachmentFolder}/${filename}` : filename;
        }
        
        return filename;
    }

    /**
     * Save image data to the Obsidian vault
     */
    public async saveImageToVault(imageData: ArrayBuffer, isScreenshot: boolean = false): Promise<TFile> {
        try {
            // Always generate Obsidian-style timestamp names for consistency and uniqueness
            // This ensures no collisions and follows Obsidian's native behavior
            const finalFilename = this.generateObsidianImageName(isScreenshot);
            
            // Get the default attachment folder path
            const attachmentFolder = (this.app.vault as any).config?.attachmentFolderPath || '';
            const fullPath = attachmentFolder ? `${attachmentFolder}/${finalFilename}` : finalFilename;
            
            // Save file to vault
            const file = await this.app.vault.createBinary(fullPath, imageData);
            return file;
        } catch (error) {
            console.error('Error saving image to vault:', error);
            throw error;
        }
    }

    /**
     * Get image from clipboard if available
     */
    public async getImageFromClipboard(): Promise<ImageProcessResult | null> {
        try {
            const clipboardItems = await navigator.clipboard.read();
            for (const item of clipboardItems) {
                for (const type of item.types) {
                    if (type.startsWith('image/')) {
                        const blob = await item.getType(type);
                        const arrayBuffer = await blob.arrayBuffer();
                        
                        // Detect if this is likely a screenshot
                        let isScreenshot = false;
                        if (blob instanceof File && blob.name) {
                            isScreenshot = blob.name.toLowerCase().includes('screenshot') || 
                                          blob.name.toLowerCase().includes('screen shot');
                        } else {
                            // If no filename but image is from clipboard, it's likely a screenshot
                            isScreenshot = true;
                        }
                        
                        return {
                            data: arrayBuffer,
                            type: type,
                            filename: '', // Will be generated later
                            isScreenshot: isScreenshot
                        };
                    }
                }
            }
            return null;
        } catch (error) {
            console.error('Error reading image from clipboard:', error);
            return null;
        }
    }

    /**
     * Process a dropped image file
     */
    public async processDroppedImage(file: File): Promise<ImageProcessResult> {
        const arrayBuffer = await file.arrayBuffer();
        
        // Detect if this is a screenshot based on filename
        const isScreenshot = file.name && (
            file.name.toLowerCase().includes('screenshot') || 
            file.name.toLowerCase().includes('screen shot')
        );
        
        return {
            data: arrayBuffer,
            type: file.type,
            filename: '', // Will be generated later
            isScreenshot: isScreenshot
        };
    }

    /**
     * Handle file URLs from drag and drop (attempt to load file content)
     */
    public async handleFileUrl(url: string, addImageCallback: (file: File) => Promise<void>): Promise<boolean> {
        try {
            // Clean up the URL and handle different formats
            let filePath = url.trim();
            if (filePath.startsWith('file://')) {
                filePath = decodeURIComponent(filePath.slice(7));
            }
            
            // Check if it's an image file by extension
            const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff'];
            const isImage = imageExtensions.some(ext => filePath.toLowerCase().endsWith(ext));
            
            if (!isImage) return false;
            
            // In Obsidian's Electron environment, try multiple approaches
            try {
                // Method 1: Use Electron's fs if available
                const fs = (window as any).require?.('fs');
                if (fs && fs.readFileSync) {
                    try {
                        const buffer = fs.readFileSync(filePath);
                        const blob = new Blob([buffer]);
                        const fileName = filePath.split('/').pop() || 'image.png';
                        const file = new File([blob], fileName, { 
                            type: this.getMimeType(fileName)
                        });
                        await addImageCallback(file);
                        return true;
                    } catch (fsError) {
                        console.warn('fs.readFileSync failed:', fsError);
                    }
                }
                
                // Method 2: Use fetch with file:// protocol
                const response = await fetch(`file://${filePath}`);
                if (response.ok) {
                    const blob = await response.blob();
                    const fileName = filePath.split('/').pop() || 'image.png';
                    const file = new File([blob], fileName, { 
                        type: blob.type || this.getMimeType(fileName)
                    });
                    await addImageCallback(file);
                    return true;
                }
            } catch (error) {
                console.warn('File reading methods failed:', error);
                
                // Method 3: Fallback - try to use the app's adapter if available
                try {
                    const adapter = (this.app as any).vault?.adapter;
                    if (adapter && adapter.fs && adapter.fs.readFileSync) {
                        const buffer = adapter.fs.readFileSync(filePath);
                        const blob = new Blob([buffer]);
                        const fileName = filePath.split('/').pop() || 'image.png';
                        const file = new File([blob], fileName, { 
                            type: this.getMimeType(fileName)
                        });
                        await addImageCallback(file);
                        return true;
                    }
                } catch (adapterError) {
                    console.warn('Adapter method failed:', adapterError);
                }
            }
            
            return false;
        } catch (error) {
            console.error('Error handling file URL:', error);
            return false;
        }
    }

    /**
     * Get MIME type based on file extension
     */
    public getMimeType(fileName: string): string {
        const ext = fileName.toLowerCase().split('.').pop();
        const mimeTypes: { [key: string]: string } = {
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'bmp': 'image/bmp',
            'tiff': 'image/tiff'
        };
        return mimeTypes[ext || ''] || 'image/png';
    }

    /**
     * Convert blob to base64 data URL
     */
    public blobToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Convert File to base64 data URL
     */
    public fileToBase64(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
}