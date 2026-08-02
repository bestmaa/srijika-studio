import type { ErrorObject } from 'ajv';
import type { TSchema } from '@sinclair/typebox';
import { Value, ValueErrorType, type ValueError } from '@sinclair/typebox/value';

import {
  LiteralValueSchema,
  SutraProjectSchema,
  UiDocumentSchema,
  ValueExpressionSchema,
  ValueShapeSchema,
  type SutraProject,
  type UiDocument,
} from './schemas';

export interface ValidationResult<T> {
  valid: boolean;
  value?: T;
  errors: readonly ErrorObject[];
}

function keywordFor(error: ValueError): string {
  if (error.type === ValueErrorType.ObjectAdditionalProperties) return 'additionalProperties';
  if (error.type === ValueErrorType.ObjectRequiredProperty) return 'required';
  return ValueErrorType[error.type] ?? 'schema';
}

function toErrorObject(error: ValueError): ErrorObject {
  return {
    keyword: keywordFor(error),
    instancePath: error.path,
    schemaPath: '',
    params: {},
    message: error.message,
  };
}

function runValidation<T>(
  schema: TSchema,
  references: readonly TSchema[],
  value: unknown,
): ValidationResult<T> {
  if (Value.Check(schema, [...references], value)) {
    return { valid: true, value: value as T, errors: [] };
  }

  return {
    valid: false,
    errors: [...Value.Errors(schema, [...references], value)].map(toErrorObject),
  };
}

export function validateUiDocument(value: unknown): ValidationResult<UiDocument> {
  return runValidation(
    UiDocumentSchema,
    [LiteralValueSchema, ValueExpressionSchema, ValueShapeSchema],
    value,
  );
}

export function validateSutraProject(value: unknown): ValidationResult<SutraProject> {
  return runValidation(SutraProjectSchema, [], value);
}

export function assertUiDocument(value: unknown): asserts value is UiDocument {
  const result = validateUiDocument(value);
  if (!result.valid) {
    const message = result.errors
      .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
      .join('; ');
    throw new Error(`Invalid Sutra UI document: ${message}`);
  }
}
