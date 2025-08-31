/**
 * Server-side validation utility functions
 * Centralized validation logic with proper error messages
 */

const { isValidAddress } = require('./ethers.js');
const { isNetworkSupported } = require('../config/networks.js');

/**
 * Validation error types
 */
const VALIDATION_ERRORS = {
  REQUIRED: 'This field is required',
  INVALID_ADDRESS: 'Invalid Ethereum address format',
  INVALID_PRIVATE_KEY: 'Invalid private key format',
  INVALID_NONCE: 'Nonce must be a non-negative integer',
  INVALID_AMOUNT: 'Invalid amount format',
  ADDRESSES_MATCH: 'Hacked wallet and safe wallet must be different',
  NETWORK_NOT_SUPPORTED: 'Network is not supported',
  PRIVATE_KEY_LENGTH: 'Private key must be 64 characters (32 bytes)',
  PRIVATE_KEY_FORMAT: 'Private key must be a valid hexadecimal string',
  AMOUNT_TOO_SMALL: 'Amount must be greater than 0',
  AMOUNT_TOO_LARGE: 'Amount is too large',
  INVALID_URL: 'Invalid URL format',
  INVALID_EMAIL: 'Invalid email format',
  PASSWORD_TOO_SHORT: 'Password must be at least 8 characters',
  PASSWORD_MISMATCH: 'Passwords do not match',
  INVALID_NUMBER: 'Must be a valid number',
  NUMBER_TOO_SMALL: 'Number is too small',
  NUMBER_TOO_LARGE: 'Number is too large',
  INVALID_DATE: 'Invalid date format',
  FUTURE_DATE: 'Date cannot be in the future',
  PAST_DATE: 'Date cannot be in the past',
  INVALID_PHONE: 'Invalid phone number format',
  INVALID_ZIP_CODE: 'Invalid ZIP code format',
  INVALID_SSN: 'Invalid SSN format',
  INVALID_CREDIT_CARD: 'Invalid credit card number',
  INVALID_IP_ADDRESS: 'Invalid IP address format',
  INVALID_MAC_ADDRESS: 'Invalid MAC address format',
  INVALID_UUID: 'Invalid UUID format',
  INVALID_HEX_COLOR: 'Invalid hex color format',
  INVALID_FILE_TYPE: 'Invalid file type',
  FILE_TOO_LARGE: 'File is too large',
  INVALID_JSON: 'Invalid JSON format',
  INVALID_BASE64: 'Invalid Base64 format',
  INVALID_SLUG: 'Invalid slug format (letters, numbers, hyphens only)',
  INVALID_USERNAME: 'Username must be 3-20 characters, letters and numbers only',
  INVALID_TAG: 'Tag must be 1-20 characters, letters and numbers only',
  DUPLICATE_ENTRY: 'This entry already exists',
  INVALID_CURRENCY: 'Invalid currency format',
  INVALID_PERCENTAGE: 'Percentage must be between 0 and 100',
  INVALID_DECIMAL: 'Invalid decimal format',
  INVALID_INTEGER: 'Must be a whole number',
  INVALID_RANGE: 'Value is outside the allowed range',
  INVALID_PATTERN: 'Value does not match the required pattern',
  INVALID_LENGTH: 'Length is not within the allowed range',
  INVALID_CHOICE: 'Invalid selection',
  REQUIRED_IF: 'This field is required when the condition is met',
  REQUIRED_UNLESS: 'This field is required unless the condition is met',
  UNIQUE: 'This value must be unique',
  EXISTS: 'This value must exist',
  DOES_NOT_EXIST: 'This value must not exist',
  CONFIRMED: 'This field must be confirmed',
  DIFFERENT: 'This field must be different from the other field',
  SAME: 'This field must be the same as the other field',
  BEFORE: 'This date must be before the specified date',
  AFTER: 'This date must be after the specified date',
  BEFORE_OR_EQUAL: 'This date must be before or equal to the specified date',
  AFTER_OR_EQUAL: 'This date must be after or equal to the specified date',
  BETWEEN: 'This value must be between the specified values',
  NOT_BETWEEN: 'This value must not be between the specified values',
  IN: 'This value must be one of the specified values',
  NOT_IN: 'This value must not be one of the specified values',
  ALPHA: 'This field may only contain letters',
  ALPHA_DASH: 'This field may only contain letters, numbers, dashes and underscores',
  ALPHA_NUM: 'This field may only contain letters and numbers',
  ALPHA_NUM_DASH: 'This field may only contain letters, numbers, dashes and underscores',
  ALPHA_NUM_SPACE: 'This field may only contain letters, numbers and spaces',
  ALPHA_SPACE: 'This field may only contain letters and spaces',
  NUMERIC: 'This field must be numeric',
  INTEGER: 'This field must be an integer',
  DECIMAL: 'This field must be a decimal number',
  BOOLEAN: 'This field must be true or false',
  ARRAY: 'This field must be an array',
  OBJECT: 'This field must be an object',
  STRING: 'This field must be a string',
  NUMBER: 'This field must be a number',
  DATE: 'This field must be a valid date',
  URL: 'This field must be a valid URL',
  EMAIL: 'This field must be a valid email address',
  IP: 'This field must be a valid IP address',
  MAC: 'This field must be a valid MAC address',
  UUID: 'This field must be a valid UUID',
  HEX_COLOR: 'This field must be a valid hex color',
  SLUG: 'This field must be a valid slug',
  USERNAME: 'This field must be a valid username',
  TAG: 'This field must be a valid tag',
  CURRENCY: 'This field must be a valid currency format',
  PERCENTAGE: 'This field must be a valid percentage',
  DECIMAL_RANGE: 'This field must be a valid decimal within the specified range',
  INTEGER_RANGE: 'This field must be a valid integer within the specified range',
  STRING_LENGTH: 'This field must be a string with the specified length',
  ARRAY_LENGTH: 'This field must be an array with the specified length',
  OBJECT_KEYS: 'This field must be an object with the specified keys',
  REGEX: 'This field must match the specified pattern',
  CUSTOM: 'This field failed custom validation'
};

/**
 * Validate required field
 * @param {*} value - The value to validate
 * @returns {string|null} Error message or null if valid
 */
const validateRequired = (value) => {
  if (value === null || value === undefined || value === '') {
    return VALIDATION_ERRORS.REQUIRED;
  }
  return null;
};

/**
 * Validate Ethereum address
 * @param {string} address - The address to validate
 * @returns {string|null} Error message or null if valid
 */
const validateAddress = (address) => {
  if (!address) return null; // Allow empty addresses (use required validation separately)
  
  if (!isValidAddress(address)) {
    return VALIDATION_ERRORS.INVALID_ADDRESS;
  }
  return null;
};

/**
 * Validate private key format
 * @param {string} privateKey - The private key to validate
 * @returns {string|null} Error message or null if valid
 */
const validatePrivateKey = (privateKey) => {
  if (!privateKey) return null; // Allow empty private keys (use required validation separately)
  
  // Remove '0x' prefix if present
  const cleanKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  
  // Check length (32 bytes = 64 hex characters)
  if (cleanKey.length !== 64) {
    return VALIDATION_ERRORS.PRIVATE_KEY_LENGTH;
  }
  
  // Check if it's a valid hex string
  if (!/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
    return VALIDATION_ERRORS.PRIVATE_KEY_FORMAT;
  }
  
  return null;
};

/**
 * Validate nonce
 * @param {*} nonce - The nonce to validate
 * @returns {string|null} Error message or null if valid
 */
const validateNonce = (nonce) => {
  if (!nonce || nonce === '') return null; // Allow empty nonces
  
  const num = Number(nonce);
  if (isNaN(num) || !Number.isInteger(num) || num < 0) {
    return VALIDATION_ERRORS.INVALID_NONCE;
  }
  
  return null;
};

/**
 * Validate amount
 * @param {string} amount - The amount to validate
 * @param {number} min - Minimum amount (optional)
 * @param {number} max - Maximum amount (optional)
 * @returns {string|null} Error message or null if valid
 */
const validateAmount = (amount, min = 0, max = null) => {
  if (!amount || amount === '') return null; // Allow empty amounts
  
  const num = parseFloat(amount);
  if (isNaN(num)) {
    return VALIDATION_ERRORS.INVALID_AMOUNT;
  }
  
  if (num <= min) {
    return VALIDATION_ERRORS.AMOUNT_TOO_SMALL;
  }
  
  if (max !== null && num > max) {
    return VALIDATION_ERRORS.AMOUNT_TOO_LARGE;
  }
  
  return null;
};

/**
 * Validate that two addresses are different
 * @param {string} address1 - First address
 * @param {string} address2 - Second address
 * @returns {string|null} Error message or null if valid
 */
const validateDifferentAddresses = (address1, address2) => {
  if (!address1 || !address2) return null; // Allow empty addresses
  
  if (address1.toLowerCase() === address2.toLowerCase()) {
    return VALIDATION_ERRORS.ADDRESSES_MATCH;
  }
  
  return null;
};

/**
 * Validate network
 * @param {string} network - The network to validate
 * @param {Array} supportedNetworks - Array of supported network IDs
 * @returns {string|null} Error message or null if valid
 */
const validateNetwork = (network, supportedNetworks = []) => {
  if (!network) return null; // Allow empty networks
  
  if (supportedNetworks.length > 0 && !supportedNetworks.includes(network)) {
    return VALIDATION_ERRORS.NETWORK_NOT_SUPPORTED;
  }
  
  if (!isNetworkSupported(network)) {
    return VALIDATION_ERRORS.NETWORK_NOT_SUPPORTED;
  }
  
  return null;
};

/**
 * Validate email format
 * @param {string} email - The email to validate
 * @returns {string|null} Error message or null if valid
 */
const validateEmail = (email) => {
  if (!email) return null; // Allow empty emails
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return VALIDATION_ERRORS.INVALID_EMAIL;
  }
  
  return null;
};

/**
 * Validate URL format
 * @param {string} url - The URL to validate
 * @returns {string|null} Error message or null if valid
 */
const validateUrl = (url) => {
  if (!url) return null; // Allow empty URLs
  
  try {
    new URL(url);
    return null;
  } catch {
    return VALIDATION_ERRORS.INVALID_URL;
  }
};

/**
 * Validate number range
 * @param {*} value - The value to validate
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {string|null} Error message or null if valid
 */
const validateNumberRange = (value, min, max) => {
  if (!value || value === '') return null; // Allow empty values
  
  const num = Number(value);
  if (isNaN(num)) {
    return VALIDATION_ERRORS.INVALID_NUMBER;
  }
  
  if (num < min) {
    return VALIDATION_ERRORS.NUMBER_TOO_SMALL;
  }
  
  if (num > max) {
    return VALIDATION_ERRORS.NUMBER_TOO_LARGE;
  }
  
  return null;
};

/**
 * Validate string length
 * @param {string} value - The value to validate
 * @param {number} min - Minimum length
 * @param {number} max - Maximum length
 * @returns {string|null} Error message or null if valid
 */
const validateStringLength = (value, min, max) => {
  if (!value) return null; // Allow empty values
  
  const length = value.length;
  if (length < min || length > max) {
    return VALIDATION_ERRORS.INVALID_LENGTH;
  }
  
  return null;
};

/**
 * Validate regex pattern
 * @param {string} value - The value to validate
 * @param {RegExp} pattern - The regex pattern
 * @returns {string|null} Error message or null if valid
 */
const validatePattern = (value, pattern) => {
  if (!value) return null; // Allow empty values
  
  if (!pattern.test(value)) {
    return VALIDATION_ERRORS.INVALID_PATTERN;
  }
  
  return null;
};

/**
 * Validate recovery form data
 * @param {Object} data - The form data to validate
 * @returns {Object} Validation result with errors object
 */
const validateRecoveryForm = (data) => {
  const errors = {};
  
  // Validate hacked wallet
  const hackedWalletError = validateRequired(data.hackedWallet) || validateAddress(data.hackedWallet);
  if (hackedWalletError) {
    errors.hackedWallet = hackedWalletError;
  }
  
  // Validate safe wallet
  const safeWalletError = validateRequired(data.safeWallet) || validateAddress(data.safeWallet);
  if (safeWalletError) {
    errors.safeWallet = safeWalletError;
  }
  
  // Validate that addresses are different
  if (!errors.hackedWallet && !errors.safeWallet) {
    const differentError = validateDifferentAddresses(data.hackedWallet, data.safeWallet);
    if (differentError) {
      errors.safeWallet = differentError;
    }
  }
  
  // Validate network
  const networkError = validateRequired(data.network) || validateNetwork(data.network);
  if (networkError) {
    errors.network = networkError;
  }
  
  // Validate nonce (optional)
  if (data.nonce !== undefined && data.nonce !== '') {
    const nonceError = validateNonce(data.nonce);
    if (nonceError) {
      errors.nonce = nonceError;
    }
  }
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

/**
 * Validate auto rescue form data
 * @param {Object} data - The form data to validate
 * @returns {Object} Validation result with errors object
 */
const validateAutoRescueForm = (data) => {
  const errors = {};
  
  // Validate private key
  const privateKeyError = validateRequired(data.hackedWalletPrivateKey) || validatePrivateKey(data.hackedWalletPrivateKey);
  if (privateKeyError) {
    errors.hackedWalletPrivateKey = privateKeyError;
  }
  
  // Validate safe wallet
  const safeWalletError = validateRequired(data.safeWallet) || validateAddress(data.safeWallet);
  if (safeWalletError) {
    errors.safeWallet = safeWalletError;
  }
  
  // Validate network
  const networkError = validateRequired(data.network) || validateNetwork(data.network);
  if (networkError) {
    errors.network = networkError;
  }
  
  // Validate nonce (optional)
  if (data.nonce !== undefined && data.nonce !== '') {
    const nonceError = validateNonce(data.nonce);
    if (nonceError) {
      errors.nonce = nonceError;
    }
  }
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

/**
 * Validate token approval form data
 * @param {Object} data - The form data to validate
 * @returns {Object} Validation result with errors object
 */
const validateTokenApprovalForm = (data) => {
  const errors = {};
  
  // Validate token address
  const tokenAddressError = validateRequired(data.tokenAddress) || validateAddress(data.tokenAddress);
  if (tokenAddressError) {
    errors.tokenAddress = tokenAddressError;
  }
  
  // Validate recovery contract address
  const contractAddressError = validateRequired(data.recoveryContractAddress) || validateAddress(data.recoveryContractAddress);
  if (contractAddressError) {
    errors.recoveryContractAddress = contractAddressError;
  }
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

/**
 * Get first validation error from an errors object
 * @param {Object} errors - The errors object
 * @returns {string|null} First error message or null
 */
const getFirstError = (errors) => {
  if (!errors || typeof errors !== 'object') {
    return null;
  }
  
  const firstKey = Object.keys(errors)[0];
  return firstKey ? errors[firstKey] : null;
};

/**
 * Check if a form has any errors
 * @param {Object} errors - The errors object
 * @returns {boolean} True if there are errors
 */
const hasErrors = (errors) => {
  return errors && typeof errors === 'object' && Object.keys(errors).length > 0;
};

module.exports = {
  VALIDATION_ERRORS,
  validateRequired,
  validateAddress,
  validatePrivateKey,
  validateNonce,
  validateAmount,
  validateDifferentAddresses,
  validateNetwork,
  validateEmail,
  validateUrl,
  validateNumberRange,
  validateStringLength,
  validatePattern,
  validateRecoveryForm,
  validateAutoRescueForm,
  validateTokenApprovalForm,
  getFirstError,
  hasErrors
}; 