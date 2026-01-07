import type { ExtractionMetadata } from './types';

/**
 * Base error class for all Parsefy errors.
 */
export class ParsefyError extends Error {
  /** Error code, if applicable. */
  public readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ParsefyError';
    this.code = code;
    // Maintains proper stack trace for where error was thrown (only available on V8)
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error thrown when the API returns an HTTP error (4xx/5xx).
 */
export class APIError extends ParsefyError {
  /** HTTP status code of the response. */
  public readonly statusCode: number;
  /** Raw response body, if available. */
  public readonly response?: unknown;

  constructor(message: string, statusCode: number, response?: unknown) {
    super(message);
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.response = response;
  }
}

/**
 * Error thrown when document extraction fails (returned in response.error).
 * This is not an HTTP error - the request succeeded but extraction failed.
 */
export class ExtractionError extends ParsefyError {
  /** Metadata about the extraction attempt. */
  public readonly metadata: ExtractionMetadata;

  constructor(message: string, code: string, metadata: ExtractionMetadata) {
    super(message, code);
    this.name = 'ExtractionError';
    this.metadata = metadata;
  }
}

/**
 * Error thrown for client-side validation failures.
 */
export class ValidationError extends ParsefyError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

