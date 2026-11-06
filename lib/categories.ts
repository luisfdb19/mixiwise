// Robust, multi-tier financial transaction classification engine
// Inspired by Actual Budget, Firefly III and open-banking transaction parsers

export interface CategoryInfo {
  id: string;
  name: string;
  icon: string;
  color: string;
  bgLight: string;
  textColor: string;
  borderColor: string;
}

export const CATEGORIES: Record<string, CategoryInfo> = {
  mercado: {
    id: 'mercado',
    name: 'Alimentação & Mercado',
    icon: 'ShoppingCart',
    color: '#10B981',
    bgLight: 'bg-emerald-50',
    textColor: 'text-emerald-700',
    borderColor: 'border-emerald-200',
  },
  restaurante: {
    id: 'restaurante',
    name: 'Restaurantes & Delivery',
    icon: 'Utensils',
    color: '#F97316',
    bgLight: 'bg-orange-50',
    textColor: 'text-orange-700',
    borderColor: 'border-orange-200',
  },
  moradia: {
    id: 'moradia',
    name: 'Moradia & Contas',
    icon: 'Home',
    color: '#3B82F6',
    bgLight: 'bg-blue-50',
    textColor: 'text-blue-700',
    borderColor: 'border-blue-200',
  },
  transporte: {
    id: 'transporte',
    name: 'Transporte',
    icon: 'Car',
    color: '#EAB308',
    bgLight: 'bg-yellow-50',
    textColor: 'text-yellow-700',
    borderColor: 'border-yellow-200',
  },
  lazer: {
    id: 'lazer',
    name: 'Lazer & Viagem',
    icon: 'Plane',
    color: '#8B5CF6',
    bgLight: 'bg-purple-50',
    textColor: 'text-purple-700',
    borderColor: 'border-purple-200',
  },
  assinaturas: {
    id: 'assinaturas',
    name: 'Serviços & Assinaturas',
    icon: 'Tv',
    color: '#06B6D4',
    bgLight: 'bg-cyan-50',
    textColor: 'text-cyan-700',
    borderColor: 'border-cyan-200',
  },
  saude: {
    id: 'saude',
    name: 'Saúde & Farmácia',
    icon: 'Pill',
    color: '#EF4444',
    bgLight: 'bg-red-50',
    textColor: 'text-red-700',
    borderColor: 'border-red-200',
  },
  casa: {
    id: 'casa',
    name: 'Casa & Manutenção',
    icon: 'Wrench',
    color: '#6B7280',
    bgLight: 'bg-gray-100',
    textColor: 'text-gray-700',
    borderColor: 'border-gray-200',
  },
  outros: {
    id: 'outros',
    name: 'Outros',
    icon: 'Package',
    color: '#9CA3AF',
    bgLight: 'bg-slate-100',
    textColor: 'text-slate-600',
    borderColor: 'border-slate-200',
  },
};

export const CATEGORY_LIST: CategoryInfo[] = Object.values(CATEGORIES);
export const DEFAULT_CATEGORY = 'outros';

export function getCategoryInfo(categoryId?: string | null): CategoryInfo {
  if (!categoryId) return CATEGORIES.outros;
  const key = categoryId.toLowerCase().trim();
  if (CATEGORIES[key]) return CATEGORIES[key];
  const found = CATEGORY_LIST.find(
    (c) => c.name.toLowerCase() === key || c.id === key
  );
  return found || CATEGORIES.outros;
}

/**
 * 1. Preprocessing & Noise Sanitization
 * Strips card gateways (MP*, PAG*, IFOOD*), installments, dates, document numbers
 */
export function sanitizeTransactionDescription(raw: string): string {
  if (!raw) return '';

  let text = raw;

  // Remove common payment gateway noise prefixes (e.g. "PG *MERCHANT", "MP *MERCHANT", "PAG*MERCHANT")
  text = text.replace(/\b(pg|pag|pagseguro|mp|mercadopago|picpay|stone|cielo|rede|getnet|sumup)\s*[*_ -]+/gi, ' ');

  // Remove transaction type noise words
  text = text.replace(/\b(pix\s+(enviado|recebido|transferencia)|ted|doc|compra\s+debito|compra\s+credito|pgto|pagto|pagamento)\b/gi, ' ');

  // Remove installment markers e.g. (1/12), 01/10, etc.
  text = text.replace(/\(?\d{1,2}\s*[\/]\s*\d{1,2}\)?/g, ' ');

  // Remove dates in descriptions like 12/04, 2024-05-01
  text = text.replace(/\b\d{1,4}[-\/]\d{1,2}(?:[-\/]\d{1,4})?\b/g, ' ');

  // Remove card mask like *1234 or final 1234
  text = text.replace(/[*#]+\d{4}\b/g, ' ');
  text = text.replace(/\bfinal\s+\d{4}\b/gi, ' ');

  // Strip accents & diacritics
  text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Lowercase & clean extra whitespace
  text = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  return text;
}

/**
 * High-precision word-boundary regex rules.
 * Uses \b to prevent false positive substring clashes (e.g. 'bar' inside 'embarque').
 */
const TOKEN_RULES: { categoryId: string; regex: RegExp; weight: number }[] = [
  {
    categoryId: 'mercado',
    weight: 0.95,
    regex: /\b(mercado|supermercado|hipermercado|carrefour|pao de acucar|extra|feira|acougue|hortifruti|sacolao|atacadao|assai|sams club|compras|padaria|mercearia|quitanda|horta|zaffari|muffato|bistek|condor|dia|super|varejo alimenticio|mercearia)\b/i,
  },
  {
    categoryId: 'restaurante',
    weight: 0.95,
    regex: /\b(ifood|rappi|restaurante|pizzaria|pizza|hamburguer|burger|boteco|choperia|chopp|cerveja|cervejaria|starbucks|mcdonalds|mc donalds|burger king|bk|subway|habibs|madero|outback|giraffas|bobs|coco bambu|churrasco|churrascaria|sushi|temaki|temakeria|acai|sorveteria|gelato|almoco|jantar|lanche|refeicao|bar\b|lanchonete|bistro|cafeteria|cafe\b)\b/i,
  },
  {
    categoryId: 'moradia',
    weight: 0.95,
    regex: /\b(aluguel|condominio|enel|cpfl|cemig|copel|eletropaulo|sabesp|saneago|sanepar|copasa|embasa|caesb|cedae|gas\b|ultragaz|supergasbras|liquigas|nacional gas|internet|claro|vivo|tim|oi|fibra|iptu|energia eletrica|taxa condominial|seguro residencial)\b/i,
  },
  {
    categoryId: 'transporte',
    weight: 0.95,
    regex: /\b(uber|99\b|99pop|taxi|gasolina|etanol|diesel|combustivel|posto shell|posto ipiranga|posto br|ipiranga|petrobras|pedagio|sem parar|conectcar|veloe|taggy|estacionamento|valet|zona azul|metro|bilhete unico|top transporte|onibus|passagem rodoviaria|revisao carro|mecanico|troca de oleo|pneu|borracharia)\b/i,
  },
  {
    categoryId: 'lazer',
    weight: 0.90,
    regex: /\b(viagem|airbnb|booking|hotel|pousada|resort|hostel|cinema|cinemark|cinepolis|ingresso|sympla|eventim|show|teatro|museu|parque|praia|passeio|voo|passagem aerea|latam|gol|azul|decolar|hurb|cvc|trip|turismo|jogos|steam|playstation|xbox|nintendo)\b/i,
  },
  {
    categoryId: 'assinaturas',
    weight: 0.95,
    regex: /\b(netflix|spotify|amazon prime|prime video|hbo\b|max\b|disney|star\+|youtube premium|apple music|icloud|google storage|google one|chatgpt|openai|claude|deezer|globoplay|paramount|crunchyroll|microsoft 365|office 365|canva|github|assinatura)\b/i,
  },
  {
    categoryId: 'saude',
    weight: 0.95,
    regex: /\b(farmacia|drogaria|drogasil|droga raia|raia|pague menos|panvel|sao paulo drogaria|araujo|remedio|medicamento|medico|dentista|odontologia|oftalmo|consulta|exame|laboratorio|fleury|lavoisier|dasa|hospital|clinica|psicologo|terapia|fisioterapia)\b/i,
  },
  {
    categoryId: 'casa',
    weight: 0.90,
    regex: /\b(faxina|diarista|limpeza|produtos de limpeza|reforma|material de construcao|leroy merlin|leroy|c&c|telhanorte|eletricista|encanador|chaveiro|pintor|marceneiro|conserto|reparo|lampada|utensilios|tok&stok|camicado|etna|mobly|cassol)\b/i,
  },
];

export interface ClassificationResult {
  categoryId: string;
  confidence: number; // 0.0 to 1.0
  source: 'memory' | 'rules' | 'fallback';
  needsReview: boolean;
}

/**
 * 3-Tier Classification Engine:
 * 1. User/Group Memory (Weight: 1.0) - Learns from user's manual categorization
 * 2. High-Precision Token Engine (Weight: 0.90-0.95) - Word-boundary regex
 * 3. Fallback (Weight: 0.0) - Marks 'outros' and needsReview: true
 */
export function classifyExpense(
  rawDescription: string,
  learnedMemory?: Record<string, string> // sanitized_text -> categoryId
): ClassificationResult {
  if (!rawDescription || !rawDescription.trim()) {
    return { categoryId: DEFAULT_CATEGORY, confidence: 0, source: 'fallback', needsReview: true };
  }

  const clean = sanitizeTransactionDescription(rawDescription);
  if (!clean) {
    return { categoryId: DEFAULT_CATEGORY, confidence: 0, source: 'fallback', needsReview: true };
  }

  // Tier 1: Group Memory (User edits take absolute precedence)
  if (learnedMemory) {
    // Exact sanitized match
    if (learnedMemory[clean]) {
      return {
        categoryId: learnedMemory[clean],
        confidence: 1.0,
        source: 'memory',
        needsReview: false,
      };
    }

    // Tokenized word-level match from memory (if past entry is part of current or vice versa)
    for (const [pastKey, catId] of Object.entries(learnedMemory)) {
      if (pastKey.length >= 4 && (clean.includes(pastKey) || pastKey.includes(clean))) {
        return {
          categoryId: catId,
          confidence: 0.98,
          source: 'memory',
          needsReview: false,
        };
      }
    }
  }

  // Tier 2: Rules Engine
  for (const rule of TOKEN_RULES) {
    if (rule.regex.test(clean) || rule.regex.test(rawDescription)) {
      return {
        categoryId: rule.categoryId,
        confidence: rule.weight,
        source: 'rules',
        needsReview: false,
      };
    }
  }

  // Tier 3: Low confidence -> flag for user review or AI batch processing
  return {
    categoryId: DEFAULT_CATEGORY,
    confidence: 0.2,
    source: 'fallback',
    needsReview: true,
  };
}
