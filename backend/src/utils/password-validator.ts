export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePasswordStrength(password: string, email?: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 10) {
    errors.push('Минимум 10 символов');
  }
  if (!/[a-zA-Zа-яА-ЯёЁ]/.test(password)) {
    errors.push('Хотя бы одна буква');
  }
  if (!/\d/.test(password)) {
    errors.push('Хотя бы одна цифра');
  }
  if (email) {
    const localPart = email.split('@')[0]?.toLowerCase();
    if (localPart && localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
      errors.push('Пароль не должен содержать email');
    }
  }

  return { valid: errors.length === 0, errors };
}
