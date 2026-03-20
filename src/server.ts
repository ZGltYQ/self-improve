import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as path from 'path';
import * as os from 'os';

import { MetadataStore } from './storage/metadata-store.js';
import { VectorStore } from './storage/vector-store.js';
import { RemoteVectorStore } from './storage/remote-vector-store.js';
import { IVectorStore } from './types/vector-store.js';
import { EmbeddingService } from './storage/embedding-service.js';
import { ContextBuilder } from './storage/context-builder.js';
import { ContextStore } from './storage/context-store.js';

import { storeCorrection } from './tools/store-correction.js';
import { queryRules } from './tools/query-rules.js';
import { pruneRules } from './tools/prune-rules.js';
import { setProjectContext } from './tools/set-project-context.js';
import { getProjectContext } from './tools/get-project-context.js';

import { 
  StoreCorrectionInput, 
  QueryRulesInput, 
  PruneRulesInput,
  SetProjectContextInput,
  GetProjectContextInput,
} from './types/mcp-types.js';

function getDefaultDataDir(): string {
  return path.join(os.homedir(), '.self-improve');
}

class CodingKnowledgeServer {
  public server: Server;
  private metadataStore: MetadataStore;
  private contextStore: ContextStore;
  private vectorStore: IVectorStore | null;
  private embeddingService: EmbeddingService;
  private contextBuilder: ContextBuilder;
  private rateLimitMap: Map<string, { count: number; resetTime: number }> = new Map();

  private readonly RATE_LIMIT_WINDOW_MS = 60000;
  private readonly RATE_LIMIT_MAX_REQUESTS = 60;

  private checkRateLimit(toolName: string): void {
    const now = Date.now();
    const key = toolName;
    const entry = this.rateLimitMap.get(key);
    
    if (!entry || now > entry.resetTime) {
      this.rateLimitMap.set(key, { count: 1, resetTime: now + this.RATE_LIMIT_WINDOW_MS });
      return;
    }
    
    entry.count++;
    if (entry.count > this.RATE_LIMIT_MAX_REQUESTS) {
      throw new Error(`Rate limit exceeded for ${toolName}. Try again later.`);
    }
  }

  constructor() {
    const dataDir = process.env.DATA_DIR || getDefaultDataDir();
    this.metadataStore = new MetadataStore(dataDir);
    this.contextStore = new ContextStore(dataDir);
    this.embeddingService = new EmbeddingService();
    this.vectorStore = null;

    this.contextBuilder = new ContextBuilder(this.metadataStore, null);

    this.server = new Server(
      {
        name: 'self-improve',
        version: '1.1.1',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      }
    );

    this.setupHandlers();
  }

  async initialize(): Promise<void> {
    await this.metadataStore.initialize();
    await this.contextStore.initialize();
    
    const qdrantUrl = process.env.QDRANT_URL;

    try {
      if (qdrantUrl) {
        // Remote mode: connect to Qdrant
        if (!(await this.embeddingService.isReady())) {
          throw new Error('Embedding service required for remote vector store');
        }
        this.vectorStore = new RemoteVectorStore(this.embeddingService, {
          url: qdrantUrl,
          apiKey: process.env.QDRANT_API_KEY,
          collection: process.env.QDRANT_COLLECTION || 'coding-knowledge',
        });
        await this.vectorStore.initialize();
        this.contextBuilder = new ContextBuilder(this.metadataStore, this.vectorStore);
        console.error(`Remote vector store initialized (Qdrant: ${qdrantUrl})`);
      } else if (await this.embeddingService.isReady()) {
        // Local mode: file-based vector store
        this.vectorStore = new VectorStore(this.embeddingService);
        await this.vectorStore.initialize();
        this.contextBuilder = new ContextBuilder(this.metadataStore, this.vectorStore);
        console.error('Local vector store initialized');
      }
    } catch (error) {
      console.error('Vector store initialization failed, using metadata-only search:', error);
    }
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'add_rule',
          description: 'Save a new coding rule when the user corrects you or teaches you something new. Call this IMMEDIATELY when the user says you did something wrong. Example: user says "use Zod for validation" → call add_rule to remember this.',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short name like "Use Zod for validation"' },
              description: { type: 'string', description: 'What this rule does' },
              what_was_wrong: { type: 'string', description: 'What code you wrote that was wrong (optional for declarative rules)' },
              what_is_right: { type: 'string', description: 'How to fix it' },
              why: { type: 'string', description: 'Why this matters' },
              file_paths: { type: 'array', items: { type: 'string' }, description: 'Files this applies to, e.g. ["src/**/*.ts"]' },
              tech_stack: { type: 'array', items: { type: 'string' }, description: 'Tech like ["typescript", "zod"]' },
              tags: { type: 'array', items: { type: 'string' }, description: 'Tags like ["validation", "security"]' },
              scope: { type: 'string', enum: ['global', 'project'], description: '"global" for all projects, "project" for this project only' },
              project_name: { type: 'string', description: 'Project name if scope is project' },
              bad_example: { type: 'string', description: 'Wrong code example' },
              good_example: { type: 'string', description: 'Correct code example' },
            },
            required: ['title', 'description', 'what_is_right', 'why', 'scope', 'good_example'],
          },
        },
        {
          name: 'find_rules',
          description: 'MANDATORY FIRST STEP: You MUST call this tool BEFORE doing anything else when you receive a new user message. Search the knowledge base for coding rules and project context. Pass the user\'s question as the query. This prevents you from making known mistakes.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'The user\'s question or what you are about to do. Example: "fix the login bug" or "add validation to API"' },
              current_file: { type: 'string', description: 'File you are editing, e.g. "src/handler.ts"' },
              tech_stack: { type: 'array', items: { type: 'string' }, description: 'Technologies, e.g. ["typescript", "express"]' },
              project_name: { type: 'string', description: 'Project name if known' },
              limit: { type: 'number', description: 'Max rules to return (default 5)' },
            },
            required: ['query'],
          },
        },
        {
          name: 'prune_rules',
          description: 'Remove duplicate or unused rules. Use dry_run=true first to see what would be deleted.',
          inputSchema: {
            type: 'object',
            properties: {
              dry_run: { type: 'boolean', description: 'If true, only show what would be deleted without actually deleting' },
              delete_unused_days: { type: 'number', description: 'Delete rules not used in X days' },
              similarity_threshold: { type: 'number', description: '0-1. Higher means stricter matching. Rules above this similarity will be merged or deleted' },
            },
          },
        },
        {
          name: 'set_project_context',
          description: 'Store or update essential project context information. Call this to record project architecture, services, tech stack, conventions, dependencies, deployment info, and inter-service relationships. Data is stored as discrete knowledge chunks for RAG retrieval. If an entry with the same project_name + title already exists, it will be updated (arrays merge, strings replace). Keep each entry focused on one topic (200-500 words ideal).',
          inputSchema: {
            type: 'object',
            properties: {
              project_name: { type: 'string', description: 'Project name, e.g. "dlm" or "my-app"' },
              category: {
                type: 'string',
                enum: ['architecture', 'service', 'dependency', 'convention', 'deployment', 'integration', 'general'],
                description: 'Category of context: "service" for individual services/components, "architecture" for high-level patterns, "integration" for how things connect, "dependency" for key external deps, "convention" for coding standards, "deployment" for infra/CI/CD, "general" for anything else',
              },
              title: { type: 'string', description: 'Descriptive title for this context entry, e.g. "Auth Service", "MQTT Communication Pattern", "Database Schema"' },
              content: { type: 'string', description: 'The actual context information. Be specific and include key details that help understand the project. Ideal: 200-500 words per entry.' },
              related_services: {
                type: 'array',
                items: { type: 'string' },
                description: 'Related services or components, e.g. ["ocpp-proxy", "mqtt-broker", "dlm"]. Enables cross-referencing.',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags for categorization, e.g. ["mqtt", "microservice", "typescript"]',
              },
            },
            required: ['project_name', 'category', 'title', 'content'],
          },
        },
        {
          name: 'get_project_context',
          description: 'Retrieve stored project context entries. Returns architecture, services, conventions, and other essential project information. Use query parameter for semantic search within a project context.',
          inputSchema: {
            type: 'object',
            properties: {
              project_name: { type: 'string', description: 'Project name to retrieve context for' },
              category: {
                type: 'string',
                enum: ['architecture', 'service', 'dependency', 'convention', 'deployment', 'integration', 'general'],
                description: 'Filter by category (optional)',
              },
              query: { type: 'string', description: 'Semantic search query to find relevant context entries (optional)' },
              limit: { type: 'number', description: 'Max entries to return (default 10)' },
            },
            required: ['project_name'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const argsObj = args as Record<string, unknown>;

      this.checkRateLimit(name);

      try {
        switch (name) {
          case 'add_rule': {
            const input = argsObj as unknown as StoreCorrectionInput;
            const result = await storeCorrection(this.metadataStore, input);
            
            if (this.vectorStore) {
              await this.vectorStore.addRule(result);
            }
            
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'find_rules': {
            const input = argsObj as unknown as QueryRulesInput;
            const results = await queryRules(
              this.metadataStore,
              this.vectorStore,
              this.contextStore,
              input
            );
            return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
          }

          case 'prune_rules': {
            const input = argsObj as unknown as PruneRulesInput;
            const result = await pruneRules(this.metadataStore, this.vectorStore, input);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'set_project_context': {
            const input = argsObj as unknown as SetProjectContextInput;
            const result = await setProjectContext(
              this.contextStore,
              this.vectorStore,
              input
            );
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'get_project_context': {
            const input = argsObj as unknown as GetProjectContextInput;
            const results = await getProjectContext(
              this.contextStore,
              this.vectorStore,
              input
            );
            return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
          isError: true,
        };
      }
    });
  }
}

export async function main(): Promise<void> {
  const server = new CodingKnowledgeServer();
  await server.initialize();
  const transport = new StdioServerTransport();
  await server.server.connect(transport);
  console.error('Self-Improve MCP Server running on stdio');
}
