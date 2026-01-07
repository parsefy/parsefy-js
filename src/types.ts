import type { z } from 'zod';

/**
 * Configuration options for the Parsefy client.
 */
export interface ParsefyConfig {
  /** API key for authentication. If not provided, reads from PARSEFY_API_KEY environment variable. */
  apiKey?: string;
  /** Base URL for the API. Defaults to https://api.parsefy.io */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 60000 (60 seconds). */
  timeout?: number;
}

/**
 * Options for the extract method.
 */
export interface ExtractOptions<T extends z.ZodType> {
  /** The document file to extract data from. Supports File, Blob, Buffer, or file path (Node.js only). */
  file: File | Blob | Buffer | string;
  /** Zod schema defining the structure of data to extract. */
  schema: T;
}

/**
 * Metadata about the extraction process.
 */
export interface ExtractionMetadata {
  /** Time taken to process the document in milliseconds. */
  processingTimeMs: number;
  /** Number of input tokens used. */
  inputTokens: number;
  /** Number of output tokens generated. */
  outputTokens: number;
  /** Number of credits consumed (1 credit = 1 page). */
  credits: number;
  /** Whether the fallback model was triggered for higher accuracy. */
  fallbackTriggered: boolean;
}

/**
 * Error response from the API.
 */
export interface APIErrorResponse {
  /** Error code identifying the type of error. */
  code: string;
  /** Human-readable error message. */
  message: string;
}

/**
 * Result of an extraction operation.
 */
export interface ExtractResult<T> {
  /** Extracted data matching the schema, or null if extraction failed. */
  object: T | null;
  /** Metadata about the extraction process. */
  metadata: ExtractionMetadata;
  /** Error details if extraction failed, or null on success. */
  error: APIErrorResponse | null;
}

/**
 * Raw API response with snake_case keys (as received from the server).
 * @internal
 */
export interface RawAPIResponse {
  object: Record<string, unknown> | null;
  metadata: {
    processing_time_ms: number;
    input_tokens: number;
    output_tokens: number;
    credits: number;
    fallback_triggered: boolean;
  };
  error: APIErrorResponse | null;
}

/**
 * Supported MIME types for document uploads.
 * @internal
 */
export type SupportedMimeType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * File extension to MIME type mapping.
 * @internal
 */
export const MIME_TYPES: Record<string, SupportedMimeType> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * Maximum file size in bytes (10MB).
 * @internal
 */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Default API base URL.
 * @internal
 */
export const DEFAULT_BASE_URL = 'https://api.parsefy.io';

/**
 * Default request timeout in milliseconds.
 * @internal
 */
export const DEFAULT_TIMEOUT = 60000;

