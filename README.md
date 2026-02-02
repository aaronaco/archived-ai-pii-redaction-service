# AI PII Redaction Service

A middleware proxy for detecting and redacting Personally Identifiable Information (PII) in LLM request/response streams.

**Status: Experimental / Incomplete**

This was a hobby project to explore building a PII redaction proxy in Node.js. The project encountered significant limitations with the JavaScript NLP ecosystem and is being archived in favor of a Python rewrite.

---

## Project Goal

Build a transparent proxy that sits between clients and LLM providers (OpenAI, Groq, Anthropic, etc.) to:

1. Detect PII in user prompts before sending to the LLM
2. Detect PII in LLM responses before returning to the client
3. Replace PII with deterministic fake data (pseudonymization)
4. Track risk scores per session and block excessive PII exposure

## Architecture Decisions

### What I Chose

| Component       | Choice                     | Rationale                                                                   |
| --------------- | -------------------------- | --------------------------------------------------------------------------- |
| **Framework**   | Fastify                    | Highest throughput Node.js framework (~47k req/s), good for proxy workloads |
| **PII Model**   | Piiranha v1 (DeBERTa-v3)   | 98.27% recall on PII detection, 17 entity types                             |
| **Inference**   | @xenova/transformers       | Promised easy ONNX model loading in Node.js                                 |
| **API Format**  | OpenAI-compatible          | De-facto standard, works with any provider/gateway                          |
| **Replacement** | Faker.js with HMAC seeding | Deterministic pseudonymization for referential integrity                    |
| **Storage**     | In-memory / Redis          | Session tracking and rate limiting                                          |

### What I Built

```
Client -> Proxy (Fastify) -> Upstream LLM
              |
              v
         PII Detection (Piiranha via ONNX)
              |
              v
         Redact & Replace (Faker.js)
```

**Features implemented:**

- OpenAI-compatible `/v1/chat/completions` endpoint
- Non-streaming and streaming (SSE) support
- Input redaction (user messages)
- Output redaction (assistant responses)
- Deterministic replacement with seeded Faker
- Session-based risk scoring
- Rate limiting

---

## What Went Wrong

### The Core Problem: Missing Character Offsets

The `@xenova/transformers` library does not support `offset_mapping` - it cannot tell you WHERE in the original text a detected entity is located.

**What the model returns:**

```json
{
	"entity": "I-USERNAME",
	"word": " margar",
	"score": 0.92,
	"start": null, // <-- Always null
	"end": null // <-- Always null
}
```

**What I needed:**

```json
{
	"entity": "USERNAME",
	"word": "margaret.chen",
	"start": 8, // <-- Character position in original text
	"end": 21
}
```

Without positions, you cannot do `text.slice(start, end)` to replace the PII.

### Workarounds I Tried

1. **Use `aggregation_strategy: 'simple'`** - Option was ignored by the library
2. **Manual BIO tag parsing** - Worked but still no positions
3. **Search for detected text in original string** - Fragile, fails with duplicates
4. **Track token indices to detect gaps** - Partially worked

Each workaround introduced new edge cases. I spent hours debugging issues that wouldn't exist in Python.

### The Real Mistake

The original plan specified using **`onnxruntime-node`** (native C++ bindings) directly. I used **`@xenova/transformers`** instead - a higher-level wrapper that:

- Uses WebAssembly internally (20-50% slower than native)
- Abstracts away the tokenizer (no offset access)
- Has limited/broken pipeline options
- Is designed for browser compatibility, not server-side NLP

---

## Lessons Learned

### 1. The JavaScript NLP Ecosystem is Immature

Python has battle-tested libraries with proper offset mapping:

- `transformers` (Hugging Face) - full offset support
- `spaCy` - production NER with character spans
- `Microsoft Presidio` - purpose-built for PII detection

JavaScript has convenience wrappers that hide critical functionality.

### 2. Read the Library Source, Not Just Docs

The `@xenova/transformers` docs mention `start`/`end` fields as "optional." I assumed they'd be populated. They weren't. Checking GitHub issues earlier would have revealed this is a known limitation.

### 3. Convenience Libraries Have Hidden Costs

`@xenova/transformers` made it easy to load a model and run inference. But it abstracted away:

- Tokenizer access
- Offset mappings
- Aggregation control

For production NLP, you need that control.

### 4. The "Avoid Python IPC" Rationale Was Flawed

The original plan avoided Python to eliminate inter-process communication latency. In practice:

- The JS workarounds introduced more latency than IPC would have
- A Python sidecar or full Python service would have been simpler
- FastAPI + Presidio would have worked in a day, not a week

### 5. Hybrid Approach is Better for PII

Pure ML detection is unreliable. A production system should combine:

- **Regex patterns** for obvious PII (emails, phones, SSNs, credit cards)
- **ML model** for harder cases (names, addresses)

The regex catches 80% reliably; the ML catches the rest.

---

## If You Want to Continue This Project

### Option A: Fix Node.js Implementation

1. Replace `@xenova/transformers` with:
    - `onnxruntime-node` for inference
    - `tokenizers` npm package for tokenization with offsets

2. Workflow:

    ```
    Text -> tokenizers.encode() -> { ids, offsets }
                                        |
    ids -> onnxruntime.run() -> predictions
                                        |
    predictions + offsets -> located entities
    ```

3. This matches the original architectural plan.

### Option B: Rewrite in Python (Recommended)

Use **FastAPI + Microsoft Presidio**:

```python
from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine

analyzer = AnalyzerEngine()
anonymizer = AnonymizerEngine()

# Detect
results = analyzer.analyze(text=input_text, language="en")

# Redact
anonymized = anonymizer.anonymize(text=input_text, analyzer_results=results)
```

Presidio handles:

- Multiple PII types (50+)
- Character offsets (built-in)
- Configurable operators (redact, replace, hash, encrypt)
- Custom recognizers (regex + ML)

---

## Project Structure

```
src/
  engine/
    model-loader.ts      # ONNX model loading via xenova/transformers
    inference-runner.ts  # Token classification and entity extraction
  features/
    redaction/
      redaction.service.ts    # PII detection orchestration
      replacement.utils.ts    # Deterministic Faker replacement
    session/
      session.store.ts        # Redis/in-memory session storage
      risk-engine.service.ts  # Risk scoring logic
    proxy/
      proxy.controller.ts     # Request/response handling
      proxy.routes.ts         # Fastify route definitions
      stream.transformer.ts   # SSE stream processing
  infrastructure/
    config/env.ts        # Environment configuration
    http/server.ts       # Fastify server setup
    store/store-client.ts # Redis/in-memory abstraction
  shared/
    types/               # TypeScript interfaces
```

---

## Running the Project

```bash
# Install dependencies
pnpm install

# Set environment variables
cp .env.example .env
# Edit .env with your upstream URL and API key

# Run in development
pnpm dev

# Test
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3.1-8b-instant",
    "messages": [{"role":"user","content":"My email is test@example.com"}]
  }'
```

**Note:** Detection works but is unreliable due to the offset mapping issues described above.

---

## References

- [Production-Ready PII Middleware Plan](./docs/Production-Ready%20PII%20Middleware%20Plan.md) - Original architectural specification
- [Piiranha v1 Model](https://huggingface.co/iiiorg/piiranha-v1-detect-personal-information) - The PII detection model
- [transformers.js offset mapping issue](https://discuss.huggingface.co/t/transformers-js-need-for-token-to-char-mapping/171412) - HuggingFace forum discussion confirming the limitation
- [Microsoft Presidio](https://github.com/microsoft/presidio) - What to use instead (Python)

---

## License

MIT
