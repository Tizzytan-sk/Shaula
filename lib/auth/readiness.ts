export type ProviderReadinessCategory =
  | "usable"
  | "missing_credential"
  | "model_not_found"
  | "quota_or_resources"
  | "timeout"
  | "provider_error"
  | "configuration_error";

export interface ProviderReadinessClassification {
  category: ProviderReadinessCategory;
  userMessage: string;
}

export function classifyProviderReadiness(input: {
  ok?: boolean;
  error?: string;
  status?: number;
}): ProviderReadinessClassification {
  if (input.ok) {
    return {
      category: "usable",
      userMessage: "Provider is configured and usable.",
    };
  }

  const error = String(input.error ?? "");
  const text = error.toLowerCase();
  const status = input.status;

  if (/model not found|no model registered/i.test(error)) {
    return {
      category: "model_not_found",
      userMessage: "Model is not registered for this provider.",
    };
  }

  if (
    /no api key|oauth token|missing.*key|auth failed|unauthorized|invalid api key/i.test(
      error
    ) ||
    status === 401 ||
    status === 403
  ) {
    return {
      category: "missing_credential",
      userMessage: "Credential is missing, expired, or not accepted.",
    };
  }

  if (
    status === 429 ||
    /quota|billing|balance|insufficient|resource package|rate limit/.test(text) ||
    /余额不足|资源包|充值|额度|欠费|限流/.test(error)
  ) {
    return {
      category: "quota_or_resources",
      userMessage: "Credential is present, but quota or resource package is unavailable.",
    };
  }

  if (/timed out|timeout|aborted/.test(text)) {
    return {
      category: "timeout",
      userMessage: "Provider test timed out.",
    };
  }

  if (!error.trim()) {
    return {
      category: "configuration_error",
      userMessage: "Provider configuration could not be verified.",
    };
  }

  return {
    category: "provider_error",
    userMessage: "Provider returned an error.",
  };
}
