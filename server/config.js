// Central configuration. Every integration degrades to a clearly labelled demo
// mode when its credentials are missing, so the app always runs locally.

const env = process.env;

function pickAiProvider() {
  const requested = (env.AI_PROVIDER || '').toLowerCase();
  if (requested === 'anthropic' && env.ANTHROPIC_API_KEY) return 'anthropic';
  if (requested === 'openai' && env.OPENAI_API_KEY) return 'openai';
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.OPENAI_API_KEY) return 'openai';
  return 'demo';
}

const aiProvider = pickAiProvider();

export const config = {
  port: Number(env.PORT) || 3000,
  dataDir: env.DATA_DIR || 'data',
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),

  ai: {
    provider: aiProvider,
    model:
      env.AI_MODEL ||
      (aiProvider === 'anthropic' ? 'claude-sonnet-5-5' : aiProvider === 'openai' ? 'gpt-4.1-mini' : 'rules'),
    openaiKey: env.OPENAI_API_KEY,
    anthropicKey: env.ANTHROPIC_API_KEY,
    // Simple spend guard for a public demo deployment.
    dailyLimit: Number(env.AI_DAILY_LIMIT) || 300,
  },

  paypal: {
    mode: env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET ? 'sandbox' : 'simulated',
    clientId: env.PAYPAL_CLIENT_ID,
    clientSecret: env.PAYPAL_CLIENT_SECRET,
    baseUrl: 'https://api-m.sandbox.paypal.com', // sandbox only, by design
    webhookId: env.PAYPAL_WEBHOOK_ID || '',
    invoicerEmail: env.PAYPAL_INVOICER_EMAIL || '',
    defaultRecipientEmail: env.PAYPAL_SANDBOX_BUYER_EMAIL || env.PAYPAL_RECIPIENT_EMAIL || '',
    businessName: env.INVOICER_BUSINESS_NAME || 'Jamie Lee Studio',
  },
};

export function capabilities() {
  return {
    ai: { provider: config.ai.provider, model: config.ai.model, live: config.ai.provider !== 'demo' },
    payments: {
      mode: config.paypal.mode,
      live: config.paypal.mode === 'sandbox',
      webhooks: Boolean(config.paypal.webhookId),
    },
  };
}
