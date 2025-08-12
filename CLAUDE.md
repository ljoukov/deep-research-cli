# Deep Research CLI - Claude Context

This document provides comprehensive information about the Deep Research CLI project for Claude to understand the codebase structure, OpenAI API usage, and project conventions.

## Project Overview

The Deep Research CLI is a beautiful command-line interface for OpenAI's **Responses API** with streaming thinking display, built with React (Ink), TypeScript, and Bun. It showcases the model's reasoning process in real-time, making it perfect for deep research tasks.

### Key Features

- 🔬 **Streaming Thinking Display**: Real-time visualization of model reasoning
- 🎨 **Beautiful Terminal UI**: Modern CLI experience using Ink (React for CLI)
- 🔧 **Tool Usage Visualization**: Shows when web search and other tools are active
- 📝 **Multiple Input Modes**: Interactive, direct text, or file input
- 💾 **Output Management**: Save responses and conversation history
- 🚀 **High Performance**: Powered by Bun for fast TypeScript execution

## Technology Stack

### Core Dependencies

- **OpenAI SDK**: `openai@5.12.2` - Official OpenAI API client with Responses API support
- **Ink**: `ink@6.1.0` - React for CLI applications
- **@inkjs/ui**: `@inkjs/ui@2.0.0` - UI components for Ink
- **Bun**: JavaScript runtime and package manager
- **TypeScript**: Strong typing throughout the project
- **React**: Component-based UI architecture

### Development Tools

- **Prettier**: Code formatting
- **XO**: ESLint configuration
- **Vitest**: Testing framework
- **TypeScript**: Static type checking

## OpenAI Responses API Integration

### Key Implementation Details

The application uses OpenAI's **Responses API** (not Chat Completions API) specifically for its reasoning capabilities and tool integration.

### OpenAI Documentation Access

The OpenAI Node.js SDK is included as a git submodule in this project for documentation reference:

**Location**: `third_party/openai-node/`

**Key Documentation Files:**

- **`third_party/openai-node/api.md`** - **Primary API reference** with all available methods, types, and examples
- `third_party/openai-node/README.md` - General SDK information
- `third_party/openai-node/MIGRATION.md` - Migration guides and breaking changes
- `third_party/openai-node/realtime.md` - Real-time API documentation
- `third_party/openai-node/azure.md` - Azure OpenAI integration

**Important Usage Guidelines:**

- When working with OpenAI API questions or need to understand available methods/types, always reference `third_party/openai-node/api.md` first as it contains the most comprehensive and up-to-date API documentation
- **DOCUMENTATION ONLY**: The `third_party/` directory is for reference documentation only
- **DO NOT**: Write code that imports or depends on any files in `third_party/`
- **DO NOT**: Use packages, modules, or code from `third_party/` in implementation
- **DO**: Use the actual `openai` package from `node_modules` (installed via package.json) for all code
- The submodule exists solely for accessing up-to-date API documentation and examples

**Example API Reference Format:**

```markdown
# Responses

Methods:

- client.responses.create({ ...params }) -> Response
- client.responses.retrieve(responseID, { ...params }) -> Response
- client.responses.delete(responseID) -> void
- client.responses.cancel(responseID) -> Response
```

#### API Client (`source/api/openai.ts`)

```typescript
// Key imports from OpenAI Responses API
import type {
	ResponseInput,
	EasyInputMessage,
} from 'openai/resources/responses/responses.js';

// Main API call structure
const stream = await this.client.responses.create({
	model,
	input: messages, // ResponseInput type (array of messages)
	stream: true, // Enable streaming
	reasoning: {summary: 'detailed'}, // Enable reasoning display
	tools: [{type: 'web_search_preview'}], // Enable web search tool
});
```

#### Streaming Event Handling

The Responses API provides rich streaming events that the application handles:

**Connection Events:**

- `response.created`: Initial response creation
- `response.in_progress`: Response preparation

**Reasoning Events:**

- `response.output_item.added`: New reasoning section starts
- `response.reasoning_summary_text.delta`: Streaming reasoning content
- `response.reasoning_summary_text.done`: Reasoning section complete

**Output Events:**

- `response.output_text.delta`: Main response content streaming
- `response.completed`: Response finished

**Error Events:**

- Various error states handled with fallbacks

### Model Support

The CLI supports OpenAI's latest reasoning models:

- `o3-deep-research` (default): Optimized for research tasks
- `o3`: General purpose reasoning model
- `o3-pro`: Enhanced capabilities
- `gpt-5` / `gpt-5-mini`: Next generation models

## Project Structure

```
source/
├── api/
│   └── openai.ts          # OpenAI Responses API client implementation
├── ui/
│   ├── input-prompt.tsx   # Interactive input component
│   ├── output-display.tsx # Response content display
│   └── thinking-stream.tsx # Real-time reasoning display
├── utils/
│   ├── args.ts           # CLI argument parsing
│   └── files.ts          # File I/O operations
├── app.tsx               # Main application component
├── cli.tsx               # CLI entry point
└── types.ts              # TypeScript type definitions
```

## Type System

### Core Types

```typescript
// CLI Arguments
type CliArgs = {
	model?: 'o3' | 'o3-deep-research' | 'o3-pro' | 'gpt-5' | 'gpt-5-mini';
	request?: string;
	requestFile?: string;
	outputFile?: string;
};

// Chat Messages
type ChatMessage = {
	role: 'user' | 'assistant';
	content: string;
	timestamp: Date;
};

// Streaming Events (internal mapping from OpenAI events)
type ResponseStreamEvent = {
	type:
		| 'created'
		| 'in_progress'
		| 'thinking'
		| 'output'
		| 'tool_use'
		| 'error'
		| 'complete';
	content?: string;
	delta?: string;
	toolName?: string;
	toolStatus?: string;
	responseId?: string;
	model?: string;
};
```

## Usage Patterns

### Command Line Interface

```bash
# Interactive mode
bun run start

# Direct request
bun run start --model o3 --request "Analyze quantum computing trends"

# File input/output
bun run start --request-file ./prompt.txt --output-file ./response.md
```

### Environment Setup

Required environment variable:

```bash
OPENAI_API_KEY=your_api_key_here
```

## Architecture Patterns

### React Hooks Pattern

- Custom `useStreamingLogic` hook manages all streaming state
- Separation of concerns between UI and business logic
- Clean event handling with proper TypeScript typing

### Streaming State Management

- State progression: `idle` → `created` → `in_progress` → `thinking` → `responding` → `complete`
- Real-time content updates using React state
- Incremental file saving during long responses

### Error Handling

- Comprehensive error boundary for API failures
- Graceful degradation for unsupported events
- User-friendly error messages in terminal

## File I/O Features

### Input Sources

- Direct CLI arguments (`--request`)
- File input (`--request-file`)
- Interactive prompts

### Output Formats

- Terminal display (always)
- File output (`--output-file`)
- Conversation history preservation
- Incremental saving during streaming

## Development Workflow

### Scripts

- `bun run start`: Run the application
- `bun run build`: TypeScript compilation
- `bun run test`: Run tests (Prettier + XO + Vitest)
- `bun run format`: Format code with Prettier

### Running the tool for testing

- `bun run start --request 'please fetch example.com' --output-file response-debug.md --model o3`
- `bun run start --request '<query>' --output-file response-debug.md --model o3`
- `response-debug.md` file won't be included under Git.

### Code Quality

- **Prettier**: Consistent code formatting
- **XO**: ESLint configuration with React support
- **TypeScript**: Strict typing enabled
- **Vitest**: Modern testing framework

## OpenAI API Specifics

### Responses API vs Chat Completions

- **Responses API**: Used for reasoning models with streaming thinking
- **Chat Completions**: Traditional API, not used in this project
- **Key Difference**: Responses API provides `reasoning` field and richer streaming events

### Tool Integration

- Web search tool enabled by default: `{type: 'web_search_preview'}`
- Tool status displayed in real-time
- Extensible architecture for additional tools

### Message Format

- Uses `EasyInputMessage` type for simplified message construction
- Automatic conversation history management
- Proper role assignment (`user`/`assistant`)

## Performance Considerations

### Streaming Optimizations

- Incremental content updates
- Efficient state management with React hooks
- Debounced file saving (every 100 characters during streaming)

### Memory Management

- Conversation history stored in memory
- File I/O only when specified
- Clean component unmounting

## Future Extension Points

### Additional Models

- Easy to add new models in `CliArgs` type
- Model selection impacts reasoning quality and speed

### Enhanced Tools

- Architecture supports additional tool types
- Tool status visualization ready for expansion

### Output Formats

- Current: Plain text and conversation JSON
- Extensible for Markdown, HTML, or other formats

## Testing Strategy

### Current Test Coverage

- Code formatting (Prettier)
- Linting (XO with React rules)
- Unit tests (Vitest with jsdom)

### Test Files Structure

- `test.tsx`: Main test file
- Components tested with React Testing Library
- API mocking for OpenAI interactions

## Dependencies Management

### Package Manager: Bun

- Fast dependency resolution
- TypeScript support out of the box
- Compatible with npm ecosystem

### Version Management

- OpenAI SDK kept current for latest Responses API features
- React ecosystem maintained at latest stable versions
- TypeScript strict mode enabled

This document serves as a comprehensive reference for understanding the Deep Research CLI codebase, its OpenAI API integration patterns, and architectural decisions. The project demonstrates modern CLI development with React, TypeScript, and OpenAI's cutting-edge Responses API.
