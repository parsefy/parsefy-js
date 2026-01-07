import type { z } from 'zod';
import type {
  ParsefyConfig,
  ExtractOptions,
  ExtractResult,
  RawAPIResponse,
} from './types';
import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT } from './types';
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
 * Parsefy client for extracting structured data from documents.
 *
 * @example
 * ```ts
 * import { Parsefy } from 'parsefy';
 * import * as z from 'zod';
 *
 * const client = new Parsefy('pk_your_api_key');
 *
 * const schema = z.object({
 *   name: z.string(),
 *   total: z.number(),
 * });
 *
 * const { object, error } = await client.extract({
 *   file: './invoice.pdf',
 *   schema,
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
   * Extracts structured data from a document using the provided Zod schema.
   *
   * @param options - Extraction options including file and schema.
   * @returns Promise resolving to the extraction result with typed data.
   *
   * @example
   * ```ts
   * const schema = z.object({
   *   invoice_number: z.string().describe('The invoice number'),
   *   total: z.number().describe('Total amount'),
   * });
   *
   * const { object, metadata, error } = await client.extract({
   *   file: './invoice.pdf',
   *   schema,
   * });
   *
   * if (!error && object) {
   *   console.log(object.invoice_number); // Fully typed!
   * }
   * ```
   */
  async extract<T extends z.ZodType>(
    options: ExtractOptions<T>
  ): Promise<ExtractResult<z.infer<T>>> {
    const { file, schema } = options;

    // Convert Zod schema to JSON Schema
    const jsonSchema = zodSchemaToJsonSchema(schema);

    // Prepare the file for upload
    const preparedFile = await prepareFile(file);

    // Build form data
    const formData = new FormData();
    formData.append('file', preparedFile);
    formData.append('output_schema', JSON.stringify(jsonSchema));

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
      const rawResponse: RawAPIResponse = await response.json();

      // Transform snake_case to camelCase
      return transformResponse<T>(rawResponse);
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

      // Handle network errors
      if (error instanceof TypeError) {
        throw new ParsefyError(
          'Network error: Unable to connect to the Parsefy API',
          'NETWORK_ERROR'
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

