// Gemini AI-powered batch and on-demand expense categorizer
// Operates on the free tier with rate-limit friendly batching.
// When GEMINI_API_KEY is unset, it cleanly skips without throwing errors.

import { CATEGORY_LIST } from './categories';

const VALID_CATEGORY_IDS = new Set(CATEGORY_LIST.map((c) => c.id));

export interface GeminiClassificationItem {
  description: string;
  category: string;
  confidence: number;
}

export function isGeminiAvailable(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim() !== '');
}

/**
 * Classify a batch of descriptions using Google Gemini 1.5 Flash
 * Free tier friendly (processes in batches of up to 25 items per request)
 */
export async function classifyBatchWithGemini(
  descriptions: string[]
): Promise<Record<string, { category: string; confidence: number }>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || descriptions.length === 0) {
    return {};
  }

  // Deduplicate descriptions
  const uniqueDescs = Array.from(new Set(descriptions.map((d) => d.trim()))).filter(Boolean);
  if (uniqueDescs.length === 0) return {};

  const categoriesPromptList = CATEGORY_LIST.map(
    (c) => `- "${c.id}": ${c.name}`
  ).join('\n');

  const systemPrompt = `Você é um classificador financeiro de alta precisão para transações e despesas no Brasil.
Seu objetivo é associar cada descrição a UMA das categorias pré-definidas.

CATEGORIAS PERMITIDAS:
${categoriesPromptList}

REGRAS RÍGIDAS:
1. Retorne "outros" para transferências genéricas, nomes de pessoas sem contexto ou itens impossíveis de deduzir.
2. Identifique estabelecimentos, marcas e abreviações comuns no Brasil (ex: "Carrefour" -> "mercado", "Enel" -> "moradia", "Outback" -> "restaurante", "Cinemark" -> "lazer", "Drogasil" -> "saude").
3. Retorne estritamente um JSON no formato especificado, sem formatação markdown ao redor.`;

  const payload = {
    contents: [
      {
        parts: [
          { text: systemPrompt },
          {
            text: `Classifique as seguintes descrições:\n${JSON.stringify(
              uniqueDescs
            )}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn(`Gemini API returned status ${response.status}`);
      return {};
    }

    const json = await response.json();
    const candidateText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) return {};

    const parsed = JSON.parse(candidateText);
    const results: Record<string, { category: string; confidence: number }> = {};

    // Support either an array of objects or an object map
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item.description && item.category && VALID_CATEGORY_IDS.has(item.category)) {
          results[item.description] = {
            category: item.category,
            confidence: typeof item.confidence === 'number' ? item.confidence : 0.9,
          };
        }
      }
    } else if (parsed && typeof parsed === 'object') {
      const items = Array.isArray(parsed.classificacoes || parsed.items || parsed.classifications)
        ? (parsed.classificacoes || parsed.items || parsed.classifications)
        : Object.entries(parsed).map(([k, v]) => ({
            description: k,
            category: typeof v === 'string' ? v : (v as { category?: string })?.category,
            confidence: typeof v === 'object' ? (v as { confidence?: number })?.confidence : 0.9,
          }));

      for (const item of items) {
        if (item?.description && item?.category) {
          const cat = String(item.category).toLowerCase().trim();
          if (VALID_CATEGORY_IDS.has(cat)) {
            results[item.description] = {
              category: cat,
              confidence: typeof item.confidence === 'number' ? item.confidence : 0.9,
            };
          }
        }
      }
    }

    return results;
  } catch (error) {
    console.error('Error invoking Gemini categorizer:', error);
    return {};
  }
}
