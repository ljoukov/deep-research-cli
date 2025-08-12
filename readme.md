# Deep Research CLI

A beautiful command-line interface for OpenAI's Responses API with streaming thinking display, built with Ink and TypeScript.

## Features

- 🔬 **Streaming Thinking Display**: Watch the model's reasoning process in real-time
- 🎨 **Beautiful Terminal UI**: Built with Ink for a modern CLI experience
- 🔧 **Tool Usage Visualization**: See when web search and other tools are being used
- 📝 **Multiple Input Modes**: Interactive prompt, direct text, or file input
- 💾 **Output Saving**: Save responses to files for later reference
- 🚀 **Powered by Bun**: Fast TypeScript execution

## Installation

1. Clone the repository:

```bash
git clone https://github.com/ljoukov/deep-research-cli.git
cd deep-research-cli
```

2. Install dependencies with Bun:

```bash
bun install
```

3. Set up your OpenAI API key in `.env`:

```bash
echo "OPENAI_API_KEY=your_api_key_here" > .env
```

## Usage

### Interactive Mode

```bash
bun run start
```

### Direct Request

```bash
bun run start --model o3 --request "What is quantum computing?"
```

### File Input

```bash
bun run start --request-file ./prompt.txt --output-file ./response.md
```

### Command Line Options

- `--model` - Model to use: `o3`, `o3-deep-research`, `o3-pro`, `gpt-5` (default: `o3-deep-research`)
- `--request` - Direct request text
- `--request-file` - Path to file containing the request
- `--output-file` - Path to save the output

## Models

- **o3-deep-research** (default): Optimized for in-depth research tasks
- **o3**: General purpose model with strong reasoning
- **o3-pro**: Enhanced capabilities for complex tasks
- **gpt-5**: Next generation model (when available)

## Development

Built with:

- [Ink](https://github.com/vadimdemedes/ink) - React for CLI apps
- [@inkjs/ui](https://github.com/vadimdemedes/ink-ui) - UI components for Ink
- [Bun](https://bun.sh) - Fast all-in-one JavaScript runtime
- [OpenAI Node SDK](https://github.com/openai/openai-node) - Official OpenAI API client

## License

MIT
