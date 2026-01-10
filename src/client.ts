import type { z } from 'zod';
import type {
  ParsefyConfig,
  ExtractOptions,
  ExtractResult,
  RawAPIResponse,
} from './types';
import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT, DEFAULT_CONFIDENCE_THRESHOLD } from './types';
import { ParsefyError, APIError, ValidationError } from './errors';
import {
  isNode,
  zodSchemaToJsonSchema,
  prepareFile,
  transformResponse,
  delay,
  getBackoffDelay,
} from './utils';

/**
 * Parsefy client for extracting structured data from financial documents.
 *
 * **Important**: All fields are **required by default**. Use `.optional()` for fields
 * that may not appear in all documents to avoid triggering expensive fallback models.
 *
 * @example
 * ```ts
 * import { Parsefy } from 'parsefy';
 * import * as z from 'zod';
 *
 * const client = new Parsefy('pk_your_api_key');
 *
 * const schema = z.object({
 *   // REQUIRED - fallback triggered if below confidence threshold
 *   invoice_number: z.string(),
 *   total: z.number(),
 *
 *   // OPTIONAL - won't trigger fallback if missing
 *   vendor: z.string().optional(),
 *   notes: z.string().optional(),
 * });
 *
 * const { object, metadata, error } = await client.extract({
 *   file: './invoice.pdf',
 *   schema,
 *   confidenceThreshold: 0.85, // default
 * });
 *
 * // Check per-field confidence and evidence
 * metadata.field_confidence.forEach((fc) => {
 *   console.log(`${fc.field}: ${fc.score} - "${fc.text}"`);
 * });
 * ```
 */
export class Parsefy {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number = 3;

  /**
   * Creates a new Parsefy client.
   *
   * @param configOrApiKey - API key string or configuration object.
   *   If not provided, reads from PARSEFY_API_KEY environment variable.
   *
   * @example
   * ```ts
   * // Using API key directly
   * const client = new Parsefy('pk_your_api_key');
   *
   * // Using configuration object
   * const client = new Parsefy({
   *   apiKey: 'pk_your_api_key',
   *   timeout: 120000,
   * });
   *
   * // Using environment variable
   * const client = new Parsefy();
   * ```
   */
  constructor(configOrApiKey?: string | ParsefyConfig) {
    let config: ParsefyConfig = {};

    if (typeof configOrApiKey === 'string') {
      config = { apiKey: configOrApiKey };
    } else if (configOrApiKey) {
      config = configOrApiKey;
    }

    // Resolve API key
    this.apiKey = config.apiKey || this.getEnvApiKey();
    if (!this.apiKey) {
      throw new ValidationError(
        'API key is required. Provide it in the constructor or set the PARSEFY_API_KEY environment variable.'
      );
    }

    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
  }

  /**
   * Gets the API key from environment variable.
   */
  private getEnvApiKey(): string {
    if (isNode()) {
      return process.env.PARSEFY_API_KEY || '';
    }
    return '';
  }

  /**
   * Extracts structured data from a financial document using the provided Zod schema.
   *
   * ** Billing Warning**: All fields are **required by default**. If a required field
   * returns `null` or falls below the `confidenceThreshold`, the fallback model is triggered,
   * which is more expensive. Use `.optional()` for fields that may not appear in all documents.
   *
   * @param options - Extraction options including file, schema, and confidence threshold.
   * @returns Promise resolving to the extraction result with typed data and field-level confidence.
   *
   * @example
   * ```ts
   * const schema = z.object({
   *   // REQUIRED - triggers fallback if confidence < threshold
   *   invoice_number: z.string().describe('The invoice number'),
   *   total: z.number().describe('Total amount including tax'),
   *
   *   // OPTIONAL - won't trigger fallback if missing or low confidence
   *   vendor: z.string().optional().describe('Vendor/supplier name'),
   *   due_date: z.string().optional().describe('Payment due date'),
   * });
   *
   * const { object, metadata, error } = await client.extract({
   *   file: './invoice.pdf',
   *   schema,
   *   confidenceThreshold: 0.85, // Lower = faster, Higher = more accurate
   * });
   *
   * if (!error && object) {
   *   console.log(object.invoice_number); // Fully typed!
   *
   *   // Access field-level confidence and evidence
   *   console.log(`Overall confidence: ${metadata.confidence_score}`);
   *   metadata.field_confidence.forEach((fc) => {
   *     console.log(`${fc.field}: ${fc.score} (${fc.reason}) - "${fc.text}"`);
   *   });
   * }
   * ```
   */
  async extract<T extends z.ZodType>(
    options: ExtractOptions<T>
  ): Promise<ExtractResult<z.infer<T>>> {
    const { file, schema, confidenceThreshold } = options;

    // Convert Zod schema to JSON Schema
    const jsonSchema = zodSchemaToJsonSchema(schema);

    // Prepare the file for upload
    const preparedFile = await prepareFile(file);

    // Build form data
    const formData = new FormData();
    formData.append('file', preparedFile);
    formData.append('output_schema', JSON.stringify(jsonSchema));
    formData.append(
      'confidence_threshold',
      String(confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD)
    );

    // Make the request with retry logic
    return this.makeRequestWithRetry<z.infer<T>>(formData);
  }

  /**
   * Makes a request with retry logic for rate limiting.
   */
  private async makeRequestWithRetry<T>(
    formData: FormData,
    attempt = 0
  ): Promise<ExtractResult<T>> {
    try {
      return await this.makeRequest<T>(formData);
    } catch (error) {
      // Retry on rate limit (429) with exponential backoff
      if (
        error instanceof APIError &&
        error.statusCode === 429 &&
        attempt < this.maxRetries
      ) {
        const backoffMs = getBackoffDelay(attempt);
        await delay(backoffMs);
        return this.makeRequestWithRetry<T>(formData, attempt + 1);
      }
      throw error;
    }
  }

  /**
   * Makes the actual HTTP request to the API.
   */
  private async makeRequest<T>(formData: FormData): Promise<ExtractResult<T>> {
    const url = `${this.baseUrl}/v1/extract`;

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle HTTP errors
      if (!response.ok) {
        const errorBody = await this.parseErrorResponse(response);
        throw new APIError(
          errorBody.message || `API request failed with status ${response.status}`,
          response.status,
          errorBody
        );
      }

      // Parse successful response
      let rawResponse: RawAPIResponse;
      try {
        rawResponse = await response.json();
      } catch (jsonError) {
        throw new ParsefyError(
          'Failed to parse API response as JSON. The API may have returned an invalid response.',
          'PARSE_ERROR'
        );
      }

      // Transform snake_case to camelCase
      try {
        return transformResponse<T>(rawResponse);
      } catch (transformError) {
        throw new ParsefyError(
          `Failed to transform API response: ${transformError instanceof Error ? transformError.message : String(transformError)}`,
          'TRANSFORM_ERROR'
        );
      }
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle abort (timeout)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ParsefyError(
          `Request timed out after ${this.timeout}ms`,
          'TIMEOUT'
        );
      }

      // Re-throw Parsefy errors
      if (error instanceof ParsefyError) {
        throw error;
      }

      // Handle fetch network errors (connection refused, DNS failure, etc.)
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new ParsefyError(
          `Network error: Unable to connect to the Parsefy API. ${error.message}`,
          'NETWORK_ERROR'
        );
      }

      // Handle other TypeErrors (might be from JSON parsing or other issues)
      if (error instanceof TypeError) {
        throw new ParsefyError(
          `Type error: ${error.message}. This may indicate an API response format issue.`,
          'TYPE_ERROR'
        );
      }

      // Unknown error
      throw new ParsefyError(
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        'UNKNOWN_ERROR'
      );
    }
  }

  /**
   * Parses error response body safely.
   */
  private async parseErrorResponse(
    response: Response
  ): Promise<{ message?: string; code?: string }> {
    try {
      const body = await response.json();
      return body;
    } catch {
      // If JSON parsing fails, try text
      try {
        const text = await response.text();
        return { message: text || response.statusText };
      } catch {
        return { message: response.statusText };
      }
    }
  }
}

