import crypto from 'crypto';

export function generateSignature(payloadString: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
}
