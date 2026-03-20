import { pipeline, env } from '@xenova/transformers';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

env.allowLocalModels = false;
env.useBrowserCache = false;

let embeddingPipeline: any = null;

export class EmbeddingService {
  private modelName: string;

  constructor(modelName?: string) {
    this.modelName = modelName || MODEL_NAME;
  }

  private async getPipeline(): Promise<any> {
    if (!embeddingPipeline) {
      embeddingPipeline = await pipeline('feature-extraction', this.modelName);
    }
    return embeddingPipeline;
  }

  async embed(text: string): Promise<number[]> {
    const pipe = await this.getPipeline();
    
    const result = await pipe(text, {
      pooling: 'mean',
      normalize: true,
    });

    return Array.from(result.data) as number[];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const pipe = await this.getPipeline();
    
    const results = await Promise.all(
      texts.map(text => 
        pipe(text, {
          pooling: 'mean',
          normalize: true,
        })
      )
    );

    return results.map(r => Array.from(r.data) as number[]);
  }

  getEmbeddingDimension(): number {
    return 384;
  }

  async isReady(): Promise<boolean> {
    try {
      await this.getPipeline();
      return true;
    } catch {
      return false;
    }
  }
}

let embeddingServiceInstance: EmbeddingService | null = null;

export function getEmbeddingService(modelName?: string): EmbeddingService {
  if (!embeddingServiceInstance) {
    embeddingServiceInstance = new EmbeddingService(modelName);
  }
  return embeddingServiceInstance;
}
