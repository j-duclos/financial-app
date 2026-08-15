export const MIN_PASSWORD_LENGTH = 8;

export type PasswordFieldErrors = {
  current?: string;
  next?: string;
  confirm?: string;
};

export function clientPasswordErrors(opts: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): PasswordFieldErrors | null {
  const errors: PasswordFieldErrors = {};
  if (!opts.currentPassword) {
    errors.current = "Enter your current password.";
  }
  if (!opts.newPassword) {
    errors.next = "Enter a new password.";
  } else if (opts.newPassword.length < MIN_PASSWORD_LENGTH) {
    errors.next = `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (!opts.confirmPassword) {
    errors.confirm = "Confirm the new password.";
  } else if (opts.newPassword && opts.newPassword !== opts.confirmPassword) {
    errors.confirm = "New password and confirmation do not match.";
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

export function passwordApiFieldErrors(message: string): PasswordFieldErrors {
  const errors: PasswordFieldErrors = {};
  const lower = message.toLowerCase();
  if (lower.includes("current_password") || lower.includes("current password")) {
    errors.current = message.replace(/^current_password:\s*/i, "");
  }
  if (lower.includes("new_password_confirm") || lower.includes("do not match")) {
    errors.confirm = message.replace(/^new_password_confirm:\s*/i, "");
  }
  if (lower.includes("new_password") && !lower.includes("new_password_confirm")) {
    errors.next = message.replace(/^new_password:\s*/i, "");
  }
  return errors;
}
