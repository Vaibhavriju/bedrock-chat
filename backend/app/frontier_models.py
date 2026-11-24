"""Explicitly integrated frontier candidates; listing alone does not enable them."""

FRONTIER_MODELS = {
    "claude-v5.5-sonnet": "anthropic.claude-sonnet-5-5",
    "claude-v5.5-opus": "anthropic.claude-opus-5-5",
    "claude-v5.5-haiku": "anthropic.claude-haiku-5-5",
    "gpt-6.2-sol": "openai.gpt-6.2-sol",
    "gpt-6.2-astra": "openai.gpt-6.2-astra",
}
CLAUDE_55 = {key for key in FRONTIER_MODELS if key.startswith("claude-")}
GPT_62 = {key for key in FRONTIER_MODELS if key.startswith("gpt-")}
