/**
 * OpenRouter Image Generation Adapter
 *
 * Uses OpenRouter's OpenAI-compatible chat/completions endpoint with
 * modalities: ['image', 'text'] to generate images via models like
 * google/gemini-3.1-flash-image-preview.
 *
 * Endpoint: https://openrouter.ai/api/v1/chat/completions
 * Authentication: Bearer token
 */

import type {
  ImageGenerationConfig,
  ImageGenerationOptions,
  ImageGenerationResult,
} from '../types';

const DEFAULT_MODEL = 'google/gemini-3.1-flash-image-preview';
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

interface OpenRouterImage {
  image_url: {
    url: string; // base64 data URL
  };
}

interface OpenRouterChoice {
  message: {
    content?: string;
    images?: OpenRouterImage[];
  };
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Lightweight connectivity test -- lists models to validate API key.
 */
export async function testOpenRouterConnectivity(
  config: ImageGenerationConfig,
): Promise<{ success: boolean; message: string }> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const model = config.model || DEFAULT_MODEL;

  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });

    if (response.ok) {
      return { success: true, message: `Connected to OpenRouter (${model})` };
    }

    const text = await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        message: `Invalid API key or unauthorized (${response.status}). Check your OpenRouter API Key.`,
      };
    }
    return {
      success: false,
      message: `OpenRouter connectivity failed (${response.status}): ${text}`,
    };
  } catch (_err) {
    return {
      success: false,
      message: `Network error: unable to reach ${baseUrl}. Check your Base URL and network connection.`,
    };
  }
}

export async function generateWithOpenRouter(
  config: ImageGenerationConfig,
  options: ImageGenerationOptions,
): Promise<ImageGenerationResult> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const model = config.model || DEFAULT_MODEL;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: options.prompt }],
      modalities: ['image', 'text'],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter image generation failed (${response.status}): ${text}`);
  }

  const data: OpenRouterResponse = await response.json();

  if (data.error) {
    throw new Error(`OpenRouter error: ${data.error.code} - ${data.error.message}`);
  }

  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new Error('OpenRouter returned empty response');
  }

  const images = message.images;
  if (!images || images.length === 0) {
    throw new Error(
      `OpenRouter did not return an image. Response text: ${message.content || 'none'}`,
    );
  }

  // Extract base64 from data URL (e.g. "data:image/png;base64,iVBOR...")
  const dataUrl = images[0].image_url.url;
  const base64Match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
  const base64 = base64Match ? base64Match[1] : dataUrl;

  return {
    base64,
    width: options.width || 1024,
    height: options.height || 1024,
  };
}
