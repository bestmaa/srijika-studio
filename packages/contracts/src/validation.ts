import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';

import {
  LiteralValueSchema,
  SutraProjectSchema,
  UiDocumentSchema,
  ValueExpressionSchema,
  type SutraProject,
  type UiDocument,
} from './schemas';

const ajv = new Ajv({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
});

ajv.addSchema(LiteralValueSchema);
ajv.addSchema(ValueExpressionSchema);
const validateDocumentInternal = ajv.compile<UiDocument>(UiDocumentSchema);
const validateProjectInternal = ajv.compile<SutraProject>(SutraProjectSchema);

export interface ValidationResult<T> {
  valid: boolean;
  value?: T;
  errors: readonly ErrorObject[];
}

function runValidation<T>(validator: ValidateFunction<T>, value: unknown): ValidationResult<T> {
  if (validator(value)) {
    return { valid: true, value, errors: [] };
  }

  return {
    valid: false,
    errors: validator.errors ? [...validator.errors] : [],
  };
}

export function validateUiDocument(value: unknown): ValidationResult<UiDocument> {
  return runValidation(validateDocumentInternal, value);
}

export function validateSutraProject(value: unknown): ValidationResult<SutraProject> {
  return runValidation(validateProjectInternal, value);
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
