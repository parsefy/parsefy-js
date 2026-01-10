<p align="center">
  <img src="/assets/logo.png" alt="Parsefy Logo" width="120" />
</p>

<h1 align="center">Parsefy TypeScript / JavaScript SDK</h1>

<p align="center">
  <strong>Official TypeScript / JavaScript SDK for Parsefy - Financial Document Infrastructure for Developers</strong><br>
  
Turn financial PDFs (invoices, receipts, bills) into structured JSON with validation and risk signals.
</p>

---

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
  // REQUIRED - triggers fallback if below confidence threshold
  invoice_number: z.string().describe('The invoice number'),
  total: z.number().describe('Total amount including tax'),

  // OPTIONAL - won't trigger fallback if missing or low confidence
  vendor: z.string().optional().describe('Vendor name'),
  due_date: z.string().optional().describe('Payment due date'),
});

const { object, metadata, error } = await client.extract({
  file: './invoice.pdf',
  schema,
});

if (!error && object) {
  console.log(object.invoice_number); // Fully typed!

  // Access field-level confidence and evidence
  console.log(`Overall confidence: ${metadata.confidence_score}`);
  metadata.field_confidence.forEach((fc) => {
    console.log(`${fc.field}: ${fc.score} (${fc.reason}) - "${fc.text}"`);
  });
}
```

## ⚠️ Required vs Optional Fields (Important for Billing)

**All fields are required by default.** This is critical to understand:

| User writes (SDK) | SDK converts to (JSON Schema) | API interprets as |
|-------------------|-------------------------------|-------------------|
| `name: z.string()` | `required: ["name"]` | **Required** |
| `name: z.string().optional()` | `required: []` | **Optional** |

### Why This Matters

If a **required** field returns `null` or falls below the `confidenceThreshold`, the API triggers the **fallback model** (Tier 2), which is more expensive.

**To avoid unexpected high billing:**

```typescript
const schema = z.object({
  // REQUIRED - Always present on invoices, keep required
  invoice_number: z.string(),
  total: z.number(),

  // OPTIONAL - May not appear on all documents, mark optional!
  vendor: z.string().optional(),      // Not all invoices have vendor name
  tax_id: z.string().optional(),      // Rarely present
  notes: z.string().optional(),       // Usually empty
  due_date: z.string().optional(),    // Sometimes missing
});
```

**Rule of thumb:** If a field might be missing in >20% of your documents, mark it `.optional()`.

## Confidence Threshold

Control when the fallback model is triggered:

```typescript
const { object, metadata } = await client.extract({
  file: './invoice.pdf',
  schema,
  confidenceThreshold: 0.85, // default
});
```

| Threshold | Behavior |
|-----------|----------|
| Lower (e.g., 0.70) | **Faster** – Accepts Tier 1 results more often |
| Higher (e.g., 0.95) | **More accurate** – Triggers Tier 2 fallback more often |

**Default:** `0.85`

## Response Format

```typescript
interface ExtractResult<T> {
  // Extracted data matching your schema, or null if extraction failed
  object: T | null;

  // Metadata about the extraction
  metadata: {
    processing_time_ms: number;     // Processing time in milliseconds
    input_tokens: number;          // Input tokens used
    output_tokens: number;         // Output tokens generated
    credits: number;              // Credits consumed (1 credit = 1 page)
    fallback_triggered: boolean;   // Whether fallback model was used

    // 🆕 Field-level confidence and evidence
    confidence_score: number;      // Overall confidence (0.0 to 1.0)
    field_confidence: Array<{
      field: string;              // JSON path (e.g., "$.invoice_number")
      score: number;              // Confidence score (0.0 to 1.0)
      reason: string;             // "Exact match", "Inferred from header", etc.
      page: number;               // Page number where found
      text: string;               // Source text evidence
    }>;
    issues: string[];             // Warnings or anomalies detected
  };

  // Error details if extraction failed
  error: {
    code: string;
    message: string;
  } | null;
}
```

### Example Response

```typescript
const { object, metadata } = await client.extract({ file, schema });

// object:
{
  invoice_number: "INV-2024-0042",
  date: "2024-01-15",
  total: 1250.00,
  vendor: "Acme Corp"
}

// metadata.confidence_score: 0.94

// metadata.field_confidence:
[
  { field: "$.invoice_number", score: 0.98, reason: "Exact match", page: 1, text: "Invoice # INV-2024-0042" },
  { field: "$.date", score: 0.95, reason: "Exact match", page: 1, text: "Date: 01/15/2024" },
  { field: "$.total", score: 0.92, reason: "Formatting ambiguous", page: 1, text: "Total: $1,250.00" },
  { field: "$.vendor", score: 0.90, reason: "Inferred from header", page: 1, text: "Acme Corp" }
]

// metadata.issues: []
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

### Extract Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `file` | `File \| Blob \| Buffer \| string` | required | Document to extract from |
| `schema` | `z.ZodType` | required | Zod schema defining extraction structure |
| `confidenceThreshold` | `number` | `0.85` | Minimum confidence before triggering fallback |

## Usage

### File Input Options

The SDK supports multiple file input types. **Files don't need to be on disk** – you can work entirely in memory.

| Input Type | Usage | Environment |
|------------|-------|-------------|
| `string` | File path | Node.js only |
| `Buffer` | In-memory bytes | Node.js |
| `File` | From file input or FormData | Browser, Node.js 20+, Edge |
| `Blob` | Raw binary with MIME type | Universal |

```typescript
// Node.js: File path
const result = await client.extract({
  file: './invoice.pdf',
  schema,
});

// Node.js: Buffer (in-memory)
import { readFileSync } from 'fs';
const result = await client.extract({
  file: readFileSync('./invoice.pdf'),
  schema,
});

// Browser: File input
const fileInput = document.querySelector('input[type="file"]');
const result = await client.extract({
  file: fileInput.files[0],
  schema,
});
```

### Complex Schemas for Financial Documents

Use `.describe()` to guide the AI extraction:

```typescript
const invoiceSchema = z.object({
  // REQUIRED - Core financial data
  invoice_number: z.string().describe('The invoice or receipt number'),
  date: z.string().describe('Invoice date in YYYY-MM-DD format'),
  total: z.number().describe('Total amount due including tax'),
  currency: z.string().describe('3-letter currency code (USD, EUR, etc.)'),

  // REQUIRED - Line items (usually present)
  line_items: z.array(z.object({
    description: z.string().describe('Item description'),
    quantity: z.number().describe('Number of units'),
    unit_price: z.number().describe('Price per unit'),
    amount: z.number().describe('Total amount for this line'),
  })).describe('List of items on the invoice'),

  // OPTIONAL - May not appear on all invoices
  vendor: z.object({
    name: z.string().describe('Company name of the vendor'),
    address: z.string().optional().describe('Full address'),
    tax_id: z.string().optional().describe('Tax ID or VAT number'),
  }).optional(),
  subtotal: z.number().optional().describe('Subtotal before tax'),
  tax: z.number().optional().describe('Tax amount'),
  due_date: z.string().optional().describe('Payment due date'),
  payment_terms: z.string().optional().describe('e.g., Net 30'),
});
```

### Server-Side / API Usage

**Express with Multer:**

```typescript
import express from 'express';
import multer from 'multer';
import { Parsefy } from 'parsefy';

const upload = multer(); // Store in memory
const client = new Parsefy();

app.post('/extract', upload.single('document'), async (req, res) => {
  const { object, metadata, error } = await client.extract({
    file: req.file.buffer,
    schema,
    confidenceThreshold: 0.80, // Adjust based on your needs
  });

  res.json({
    data: object,
    confidence: metadata.confidence_score,
    fieldDetails: metadata.field_confidence,
    error,
  });
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
  const file = formData.get('document');

  const { object, metadata, error } = await client.extract({
    file,
    schema,
  });

  return c.json({
    data: object,
    confidence: metadata.confidence_score,
    issues: metadata.issues,
    error,
  });
});
```

### Error Handling

```typescript
import { Parsefy, APIError, ValidationError, ParsefyError } from 'parsefy';

try {
  const { object, error, metadata } = await client.extract({
    file: './invoice.pdf',
    schema,
  });

  // Extraction-level errors (request succeeded, but extraction failed)
  if (error) {
    console.error(`Extraction failed: [${error.code}] ${error.message}`);
    console.log(`Fallback triggered: ${metadata.fallback_triggered}`);
    console.log(`Issues: ${metadata.issues.join(', ')}`);
    return;
  }

  // Check for low confidence fields
  const lowConfidence = metadata.field_confidence.filter((fc) => fc.score < 0.80);
  if (lowConfidence.length > 0) {
    console.warn('Low confidence fields:', lowConfidence);
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

## TypeScript Types

All types are exported for your convenience:

```typescript
import type {
  ParsefyConfig,
  ExtractOptions,
  ExtractResult,
  ExtractionMetadata,
  FieldConfidence,
  APIErrorResponse,
} from 'parsefy';

import { DEFAULT_CONFIDENCE_THRESHOLD } from 'parsefy'; // 0.85
```

## License

MIT © [Parsefy](https://parsefy.io)
