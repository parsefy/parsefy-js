import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  MIME_TYPES,
  MAX_FILE_SIZE,
  type SupportedMimeType,
  type RawAPIResponse,
  type ExtractResult,
} from './types';
import { ValidationError } from './errors';

/**
 * Checks if the code is running in a Node.js environment.
 * @internal
 */
export function isNode(): boolean {
  return typeof process !== 'undefined' && process.versions?.node !== undefined;
}

/**
 * Converts a Zod schema to JSON Schema format for the API.
 * Preserves .describe() annotations which guide the AI extraction.
 *
 * **Important**: All fields are required by default in the generated JSON Schema.
 * Use `.optional()` on fields that may not appear in all documents to avoid
 * triggering expensive fallback models unnecessarily.
 *
 * @example
 * ```ts
 * const schema = z.object({
 *   // REQUIRED - Will trigger fallback if below confidence threshold
 *   invoice_number: z.string(),
 *   total: z.number(),
 *
 *   // OPTIONAL - Won't trigger fallback if missing or low confidence
 *   vendor: z.string().optional(),
 *   notes: z.string().optional(),
 * });
 * ```
 *
 * @internal
 */
export function zodSchemaToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = zodToJsonSchema(schema, {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  }) as Record<string, unknown>;

  // Remove $schema URL as some APIs find it strict/unnecessary
  if ('$schema' in jsonSchema) {
    delete jsonSchema['$schema'];
  }

  return jsonSchema;
}

/**
 * Gets the MIME type for a file based on its extension.
 * @internal
 */
export function getMimeType(filename: string): SupportedMimeType | null {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!ext) return null;
  return MIME_TYPES[ext] || null;
}

/**
 * Validates that a file extension is supported.
 * @internal
 */
export function validateFileExtension(filename: string): void {
  const mimeType = getMimeType(filename);
  if (!mimeType) {
    const supportedExtensions = Object.keys(MIME_TYPES).join(', ');
    throw new ValidationError(
      `Unsupported file type. Supported types: ${supportedExtensions}`
    );
  }
}

/**
 * Validates that a file size is within limits.
 * @internal
 */
export function validateFileSize(size: number): void {
  if (size === 0) {
    throw new ValidationError('File is empty');
  }
  if (size > MAX_FILE_SIZE) {
    const maxMB = MAX_FILE_SIZE / (1024 * 1024);
    throw new ValidationError(`File size exceeds maximum limit of ${maxMB}MB`);
  }
}

/**
 * Transforms snake_case API response to camelCase SDK response.
 * Handles both old API responses (without _meta) and new API responses (with _meta).
 * @internal
 */
export function transformResponse<T>(raw: RawAPIResponse): ExtractResult<T> {
  // Handle legacy API responses that don't include _meta
  const meta = raw._meta || {
    confidence_score: 1.0,
    field_confidence: [],
    issues: [],
  };

  return {
    object: raw.object as T | null,
    metadata: {
      processingTimeMs: raw.metadata.processing_time_ms,
      inputTokens: raw.metadata.input_tokens,
      outputTokens: raw.metadata.output_tokens,
      credits: raw.metadata.credits,
      fallbackTriggered: raw.metadata.fallback_triggered,
      confidenceScore: meta.confidence_score,
      fieldConfidence: meta.field_confidence.map((fc) => ({
        field: fc.field,
        score: fc.score,
        reason: fc.reason,
        page: fc.page,
        text: fc.text,
      })),
      issues: meta.issues,
    },
    error: raw.error,
  };
}

/**
 * Creates a File object from a Buffer with the given filename.
 * Works in both Node.js and browser environments.
 * @internal
 */
export function bufferToFile(buffer: Buffer, filename: string): File | Blob {
  const mimeType = getMimeType(filename) || 'application/octet-stream';
  
  // Convert Buffer to ArrayBuffer for cross-platform compatibility
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
  
  // In Node.js 18+, File is available globally
  if (typeof File !== 'undefined') {
    return new File([arrayBuffer], filename, { type: mimeType });
  }
  
  // Fallback to Blob if File is not available
  return new Blob([arrayBuffer], { type: mimeType });
}

/**
 * Reads a file from the filesystem (Node.js only).
 * @internal
 */
export async function readFileFromPath(
  filePath: string
): Promise<{ buffer: Buffer; filename: string }> {
  if (!isNode()) {
    throw new ValidationError(
      'File path strings are only supported in Node.js. Use File or Blob in the browser.'
    );
  }

  // Dynamic import for Node.js modules
  const fs = await import('fs');
  const path = await import('path');

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    throw new ValidationError(`File not found: ${filePath}`);
  }

  const filename = path.basename(filePath);
  validateFileExtension(filename);

  const buffer = fs.readFileSync(filePath);
  validateFileSize(buffer.length);

  return { buffer, filename };
}

/**
 * Prepares a file input for upload, handling all supported input types.
 * Returns a File or Blob ready to be appended to FormData.
 * @internal
 */
export async function prepareFile(
  input: File | Blob | Buffer | string
): Promise<File | Blob> {
  // String input = file path (Node.js only)
  if (typeof input === 'string') {
    const { buffer, filename } = await readFileFromPath(input);
    return bufferToFile(buffer, filename);
  }

  // Buffer input (Node.js)
  if (Buffer.isBuffer(input)) {
    validateFileSize(input.length);
    // For buffers, we need a filename - default to document.pdf
    return bufferToFile(input, 'document.pdf');
  }

  // File input (has name property)
  if (input instanceof File) {
    validateFileExtension(input.name);
    validateFileSize(input.size);
    return input;
  }

  // Blob input
  if (input instanceof Blob) {
    validateFileSize(input.size);
    // For blobs without a name, we can't validate extension
    // The API will validate the actual content
    return input;
  }

  throw new ValidationError(
    'Invalid file input. Expected File, Blob, Buffer, or file path string.'
  );
}

/**
 * Delay helper for retry logic.
 * @internal
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculates exponential backoff delay with jitter.
 * @internal
 */
export function getBackoffDelay(attempt: number, baseDelay = 1000): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 0.1 * exponentialDelay;
  return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
}

