# Parsefy

Official TypeScript SDK for [Parsefy](https://parsefy.io) – AI-powered document data extraction.

Extract structured data from PDFs and DOCX files using Zod schemas with full TypeScript type inference.

## Installation

```bash
npm install parsefy zod
```

## Quick Start

```typescript
import { Parsefy } from 'parsefy';
import * as z from 'zod';

const client = new Parsefy('pk_your_api_key');

const schema = z.object({
  invoice_number: z.string().describe('The invoice number'),
  date: z.string().describe('Invoice date in YYYY-MM-DD format'),
  total: z.number().describe('Total amount'),
});

const { object, error } = await client.extract({
  file: './invoice.pdf',
  schema,
});

if (!error && object) {
  console.log(object.invoice_number); // Fully typed!
}
```

## Configuration

### API Key

```typescript
// Option 1: Pass API key directly
const client = new Parsefy('pk_your_api_key');

// Option 2: Use environment variable
// Set PARSEFY_API_KEY in your environment
const client = new Parsefy();

// Option 3: Configuration object
const client = new Parsefy({
  apiKey: 'pk_your_api_key',
  timeout: 120000, // 2 minutes
});
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | `process.env.PARSEFY_API_KEY` | Your Parsefy API key |
| `timeout` | `number` | `60000` | Request timeout in ms |

## Usage

### Basic Extraction

```typescript
import { Parsefy } from 'parsefy';
import * as z from 'zod';

const client = new Parsefy();

const schema = z.object({
  name: z.string(),
  email: z.string().email(),
  phone: z.string().optional(),
});

const { object, metadata, error } = await client.extract({
  file: './contact.pdf',
  schema,
});

if (error) {
  console.error(`Error: [${error.code}] ${error.message}`);
} else {
  console.log('Extracted:', object);
  console.log(`Processed in ${metadata.processingTimeMs}ms`);
  console.log(`Credits used: ${metadata.credits}`);
}
```

### File Input Options

The SDK supports multiple file input types. **Files don't need to be on disk** – you can work entirely in memory, which is ideal for building APIs and serverless functions.

| Input Type | Usage | Environment |
|------------|-------|-------------|
| `string` | File path | Node.js only |
| `Buffer` | In-memory bytes | Node.js |
| `File` | From file input or FormData | Browser, Node.js 20+, Edge |
| `Blob` | Raw binary with MIME type | Universal |
| `ArrayBuffer` | Wrap in `Blob` first | Universal |

```typescript
// Node.js: File path (convenience for scripts/CLI)
const result = await client.extract({
  file: './document.pdf',
  schema,
});

// Node.js: Buffer (in-memory)
import { readFileSync } from 'fs';
const result = await client.extract({
  file: readFileSync('./document.pdf'),
  schema,
});

// Browser: File input
const fileInput = document.querySelector('input[type="file"]');
const result = await client.extract({
  file: fileInput.files[0],
  schema,
});

// Universal: Blob (with explicit MIME type)
const result = await client.extract({
  file: new Blob([arrayBuffer], { type: 'application/pdf' }),
  schema,
});
```

### Server-Side / API Usage

When building APIs that receive file uploads, files are typically kept in memory. The SDK handles this seamlessly:

**Express with Multer:**

```typescript
import express from 'express';
import multer from 'multer';
import { Parsefy } from 'parsefy';

const upload = multer(); // Store in memory, not disk
const client = new Parsefy();

app.post('/extract', upload.single('document'), async (req, res) => {
  const { object, error } = await client.extract({
    file: req.file.buffer, // Buffer from multer
    schema,
  });
  res.json({ data: object, error });
});
```

**Fastify:**

```typescript
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { Parsefy } from 'parsefy';

const fastify = Fastify();
await fastify.register(multipart);
const client = new Parsefy();

fastify.post('/extract', async (request) => {
  const data = await request.file();
  const buffer = await data.toBuffer();

  const { object, error } = await client.extract({
    file: buffer,
    schema,
  });
  return { data: object, error };
});
```

**Hono / Cloudflare Workers:**

```typescript
import { Hono } from 'hono';
import { Parsefy } from 'parsefy';

const app = new Hono();
const client = new Parsefy();

app.post('/extract', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('document'); // File object

  const { object, error } = await client.extract({
    file, // File from FormData works directly
    schema,
  });
  return c.json({ data: object, error });
});
```

### Complex Schemas

Use `.describe()` to guide the AI extraction:

```typescript
const invoiceSchema = z.object({
  invoice_number: z.string().describe('The invoice or receipt number'),
  date: z.string().describe('Invoice date in YYYY-MM-DD format'),
  vendor: z.object({
    name: z.string().describe('Company name of the vendor'),
    address: z.string().describe('Full address of the vendor'),
  }),
  line_items: z.array(z.object({
    description: z.string().describe('Item description'),
    quantity: z.number().describe('Number of units'),
    unit_price: z.number().describe('Price per unit'),
    amount: z.number().describe('Total amount for this line'),
  })).describe('List of items on the invoice'),
  subtotal: z.number().describe('Subtotal before tax'),
  tax: z.number().describe('Tax amount'),
  total: z.number().describe('Total amount due'),
  currency: z.string().describe('3-letter currency code (USD, EUR, etc.)'),
});

const { object } = await client.extract({
  file: './invoice.pdf',
  schema: invoiceSchema,
});
```

### Error Handling

```typescript
import { Parsefy, APIError, ValidationError, ParsefyError } from 'parsefy';

try {
  const { object, error, metadata } = await client.extract({
    file: './document.pdf',
    schema,
  });

  // Extraction-level errors (request succeeded, but extraction failed)
  if (error) {
    console.error(`Extraction failed: [${error.code}] ${error.message}`);
    console.log(`Tokens used: ${metadata.inputTokens} in, ${metadata.outputTokens} out`);
    return;
  }

  console.log('Success:', object);
} catch (err) {
  // HTTP/Network errors
  if (err instanceof APIError) {
    console.error(`API Error ${err.statusCode}: ${err.message}`);
  } else if (err instanceof ValidationError) {
    console.error(`Validation Error: ${err.message}`);
  } else if (err instanceof ParsefyError) {
    console.error(`Parsefy Error: ${err.message}`);
  }
}
```

## Response Format

```typescript
interface ExtractResult<T> {
  // Extracted data matching your schema, or null if extraction failed
  object: T | null;

  // Metadata about the extraction
  metadata: {
    processingTimeMs: number;    // Processing time in milliseconds
    inputTokens: number;         // Input tokens used
    outputTokens: number;        // Output tokens generated
    credits: number;             // Credits consumed (1 credit = 1 page)
    fallbackTriggered: boolean;  // Whether fallback model was used
  };

  // Error details if extraction failed
  error: {
    code: string;    // EXTRACTION_FAILED, LLM_ERROR, PARSING_ERROR, TIMEOUT_ERROR
    message: string;
  } | null;
}
```

## Error Types

| Error Class | Description |
|-------------|-------------|
| `ParsefyError` | Base error class for all Parsefy errors |
| `APIError` | HTTP errors (4xx/5xx responses) |
| `ExtractionError` | Extraction failed (returned in response) |
| `ValidationError` | Client-side validation errors |

## Supported File Types

- **PDF** (`.pdf`) – up to 10MB
- **DOCX** (`.docx`) – up to 10MB

## Rate Limits

The API allows 1 request per second. The SDK automatically retries with exponential backoff on rate limit errors (HTTP 429).

## Requirements

- Node.js 18+ (for native `fetch` and `FormData`)
- Zod 3.x (peer dependency)

## License

MIT © [Parsefy](https://parsefy.io)

