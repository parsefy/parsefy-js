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
 * Default confidence threshold for extraction.
 * Fields below this threshold on required fields will trigger the fallback model.
 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.85;

/**
 * Options for the extract method.
 */
export interface ExtractOptions<T extends z.ZodType> {
  /** The document file to extract data from. Supports File, Blob, Buffer, or file path (Node.js only). */
  file: File | Blob | Buffer | string;
  /** Zod schema defining the structure of data to extract. */
  schema: T;
  /**
   * Confidence threshold for extraction (0.0 to 1.0). Defaults to 0.85.
   *
   * If a **required** field's confidence falls below this threshold (or returns null),
   * the fallback model is triggered for higher accuracy.
   *
   * **Tip**: Lower threshold = faster (accepts Tier 1 more often).
   * Higher threshold = more accurate (triggers Tier 2 fallback more often).
   *
   * **Important**: Mark fields as `.optional()` in your Zod schema if they might not
   * appear in all documents. This prevents unnecessary fallback triggers and reduces costs.
   */
  confidenceThreshold?: number;
}

/**
 * Confidence details for a single extracted field.
 * Provides evidence and explanation for each extraction.
 */
export interface FieldConfidence {
  /** JSON path to the field (e.g., "$.invoice_number"). */
  field: string;
  /** Confidence score for this field (0.0 to 1.0). */
  score: number;
  /** Explanation of how the value was extracted (e.g., "Exact match", "Inferred from header"). */
  reason: string;
  /** Page number where the field was found. */
  page: number;
  /** Source text evidence from the document. */
  text: string;
}

/**
 * Metadata about the extraction process.
 */
export interface ExtractionMetadata {
  /** Time taken to process the document in milliseconds. */
  processing_time_ms: number;
  /** Number of input tokens used. */
  input_tokens: number;
  /** Number of output tokens generated. */
  output_tokens: number;
  /** Number of credits consumed (1 credit = 1 page). */
  credits: number;
  /** Whether the fallback model was triggered for higher accuracy. */
  fallback_triggered: boolean;
  /** Overall confidence score for the extraction (0.0 to 1.0). */
  confidence_score: number;
  /** Per-field confidence details with evidence and explanations. */
  field_confidence: FieldConfidence[];
  /** List of issues or warnings encountered during extraction. */
  issues: string[];
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
 * Raw field confidence as received from the API.
 * @internal
 */
export interface RawFieldConfidence {
  field: string;
  score: number;
  reason: string;
  page: number;
  text: string;
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
  _meta?: {
    confidence_score: number;
    field_confidence: RawFieldConfidence[];
    issues: string[];
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

