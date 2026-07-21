'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useOrganizationList, useUser } from '@clerk/nextjs';
import { Upload, FileText, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react';
import { importExpenses } from '../actions';
import { formatCurrency } from '@/lib/currency';

interface Organization {
  id: string;
  name: string;
}

interface ParsedExpense {
  date: string;
  description: string;
  category: string;
  cost: number;
  currency: string;
  payer: string;
  payerAmount: number;
  owes: { name: string; amount: number }[];
}

// Parse a single CSV line handling quoted values
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Parse the full CSV text
function parseCSV(text: string): { headers: string[]; rows: string[][]; personNames: string[] } {
  // Remove BOM if present
  const cleanText = text.replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/).filter((line) => line.trim() !== '');

  // Find header line (starts with "Data")
  const headerIndex = lines.findIndex((line) => line.startsWith('Data'));
  if (headerIndex === -1) throw new Error('Linha de cabeçalho não encontrada. O CSV deve começar com "Data,Descrição,..."');

  const headers = parseCSVLine(lines[headerIndex]);
  const personNames = headers.slice(5); // Person columns start at index 5

  if (personNames.length < 2) {
    throw new Error('O CSV deve ter pelo menos 2 colunas de pessoas após Data, Descrição, Categoria, Custo, Moeda.');
  }

  const rows = lines
    .slice(headerIndex + 1)
    .map((line) => parseCSVLine(line))
    .filter((row) => row.length >= headers.length && /^\d{4}-\d{2}-\d{2}$/.test(row[0]));

  return { headers, rows, personNames };
}

// Map CSV rows to parsed expenses
function mapCSVToExpenses(
  rows: string[][],
  personNames: string[]
): ParsedExpense[] {
  return rows
    .map((row) => {
      const date = row[0];
      const description = row[1];
      const category = row[2];
      const cost = parseFloat(row[3]);
      const currency = row[4];

      if (isNaN(cost) || cost === 0) return null;

      const personAmounts = personNames.map((name, i) => ({
        name,
        amount: parseFloat(row[5 + i]) || 0,
      }));

      // Person with positive amount is the payer
      const payers = personAmounts.filter((p) => p.amount > 0);
      const debtors = personAmounts.filter((p) => p.amount < 0);

      if (payers.length === 0 || debtors.length === 0) return null;

      // Use the person with the highest positive amount as the primary payer
      const payer = payers.reduce((a, b) => (a.amount > b.amount ? a : b));

      return {
        date,
        description,
        category,
        cost,
        currency,
        payer: payer.name,
        payerAmount: payer.amount,
        owes: debtors.map((d) => ({ name: d.name, amount: Math.abs(d.amount) })),
      };
    })
    .filter((e): e is ParsedExpense => e !== null);
}

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [parsedExpenses, setParsedExpenses] = useState<ParsedExpense[]>([]);
  const [personNames, setPersonNames] = useState<string[]>([]);
  const [group, setGroup] = useState('');
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    count: number;
  } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user, isLoaded: isUserLoaded } = useUser();
  const { userMemberships, isLoaded: isOrgListLoaded } = useOrganizationList({
    userMemberships: true,
  });
  const { toast } = useToast();

  // Load organizations
  React.useEffect(() => {
    if (isOrgListLoaded && userMemberships.data) {
      const orgs = userMemberships.data.map((membership) => ({
        id: membership.organization.id,
        name: membership.organization.name,
      }));
      setOrganizations(orgs);
      if (orgs.length > 0 && !group) {
        setGroup(orgs[0].id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOrgListLoaded, userMemberships.data]);

  const processFile = useCallback((selectedFile: File) => {
    setFile(selectedFile);
    setParseError(null);
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const { rows, personNames: names } = parseCSV(text);
        const expenses = mapCSVToExpenses(rows, names);

        setPersonNames(names);
        setParsedExpenses(expenses);

        if (expenses.length === 0) {
          setParseError('Nenhuma despesa válida encontrada no arquivo CSV.');
        }
      } catch (err) {
        setParseError(
          err instanceof Error ? err.message : 'Erro ao processar o arquivo CSV.'
        );
        setParsedExpenses([]);
      }
    };
    reader.readAsText(selectedFile, 'UTF-8');
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      processFile(selectedFile);
    }
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile && (droppedFile.name.endsWith('.csv') || droppedFile.type === 'text/csv')) {
        processFile(droppedFile);
      } else {
        setParseError('Por favor, selecione um arquivo .csv');
      }
    },
    [processFile]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleImport = async () => {
    if (!user || !group || parsedExpenses.length === 0) return;

    setIsImporting(true);
    setImportResult(null);

    try {
      const expensesToImport = parsedExpenses.map((expense) => {
        const totalOwed = expense.owes.reduce((sum, o) => sum + o.amount, 0);
        const splitPercentage =
          expense.cost > 0 ? (totalOwed / expense.cost) * 100 : 0;

        return {
          amount: expense.cost,
          currency: expense.currency || 'BRL',
          description: expense.category
            ? `${expense.description} (${expense.category})`
            : expense.description,
          groupId: group,
          splitPercentage,
          createdBy: expense.payer,
          splitWith: expense.owes.map((o) => ({
            id: o.name.toLowerCase().replace(/\s+/g, '-'),
            name: o.name,
            splitAmount: o.amount,
          })),
          date: expense.date,
        };
      });

      const result = await importExpenses(expensesToImport);
      setImportResult(result);

      if (result.success) {
        toast({
          title: 'Importação concluída! 🎉',
          description: `${result.count} despesas importadas com sucesso.`,
        });
      } else {
        throw new Error('Falha na importação');
      }
    } catch (error) {
      console.error('Error importing:', error);
      toast({
        title: 'Erro na importação 😟',
        description: 'Não foi possível importar as despesas. Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleClear = () => {
    setFile(null);
    setParsedExpenses([]);
    setPersonNames([]);
    setParseError(null);
    setImportResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (!isUserLoaded || !isOrgListLoaded) {
    return <div>Loading...</div>;
  }

  // Date range summary
  const dateRange =
    parsedExpenses.length > 0
      ? {
          from: parsedExpenses[0].date,
          to: parsedExpenses[parsedExpenses.length - 1].date,
        }
      : null;

  const totalAmount = parsedExpenses.reduce((sum, e) => sum + e.cost, 0);

  return (
    <div className="container mx-auto px-4 py-8 sm:px-6 lg:px-8 max-w-4xl">
      <h1 className="text-2xl font-bold mb-2">Importar do Splitwise</h1>
      <p className="text-gray-600 mb-6">
        Importe seu histórico de despesas do Splitwise usando um arquivo CSV exportado.
      </p>

      {/* File Upload Area */}
      {!file && (
        <div
          className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
            isDragOver
              ? 'border-purple-500 bg-purple-50'
              : 'border-gray-300 hover:border-purple-400 hover:bg-gray-50'
          }`}
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <p className="text-lg font-medium text-gray-700 mb-1">
            Arraste o arquivo CSV aqui
          </p>
          <p className="text-sm text-gray-500 mb-4">ou clique para selecionar</p>
          <Button
            type="button"
            variant="outline"
            className="border-purple-500 text-purple-600 hover:bg-purple-50"
          >
            <FileText className="mr-2 h-4 w-4" />
            Selecionar arquivo CSV
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      )}

      {/* Parse Error */}
      {parseError && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium text-red-800">Erro ao processar arquivo</p>
            <p className="text-sm text-red-600">{parseError}</p>
          </div>
        </div>
      )}

      {/* Parsed Data Summary */}
      {file && parsedExpenses.length > 0 && (
        <div className="space-y-6">
          {/* File Info Bar */}
          <div className="flex items-center justify-between bg-gray-50 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-purple-600" />
              <div>
                <p className="font-medium text-gray-900">{file.name}</p>
                <p className="text-sm text-gray-500">
                  {parsedExpenses.length} despesas encontradas
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={handleClear}>
              <Trash2 className="h-4 w-4 mr-1" />
              Remover
            </Button>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border rounded-lg p-4">
              <p className="text-sm text-gray-500">Total de despesas</p>
              <p className="text-2xl font-bold text-gray-900">
                {parsedExpenses.length}
              </p>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <p className="text-sm text-gray-500">Valor total</p>
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(totalAmount, parsedExpenses[0]?.currency || 'BRL')}
              </p>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <p className="text-sm text-gray-500">Período</p>
              <p className="text-sm font-bold text-gray-900">
                {dateRange
                  ? `${dateRange.from} a ${dateRange.to}`
                  : '-'}
              </p>
            </div>
          </div>

          {/* People Detected */}
          <div className="bg-white border rounded-lg p-4">
            <p className="text-sm text-gray-500 mb-2">Pessoas detectadas</p>
            <div className="flex flex-wrap gap-2">
              {personNames.map((name) => (
                <span
                  key={name}
                  className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>

          {/* Group Selector */}
          <div>
            <Label
              htmlFor="importGroup"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Importar para qual grupo?
            </Label>
            {organizations.length > 0 ? (
              <Select onValueChange={setGroup} value={group}>
                <SelectTrigger id="importGroup" className="w-full">
                  <SelectValue placeholder="Selecione um grupo" />
                </SelectTrigger>
                <SelectContent>
                  {organizations.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-gray-500">
                Nenhum grupo disponível. Crie ou entre em um grupo primeiro.
              </p>
            )}
          </div>

          {/* Preview Table */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">
              Prévia das despesas (primeiras 20)
            </p>
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left p-3 font-medium text-gray-600">Data</th>
                    <th className="text-left p-3 font-medium text-gray-600">
                      Descrição
                    </th>
                    <th className="text-left p-3 font-medium text-gray-600">
                      Categoria
                    </th>
                    <th className="text-right p-3 font-medium text-gray-600">
                      Valor
                    </th>
                    <th className="text-left p-3 font-medium text-gray-600">
                      Pagou
                    </th>
                    <th className="text-left p-3 font-medium text-gray-600">Deve</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedExpenses.slice(0, 20).map((expense, index) => (
                    <tr key={index} className="border-b last:border-b-0 hover:bg-gray-50">
                      <td className="p-3 text-gray-700 whitespace-nowrap">{expense.date}</td>
                      <td className="p-3 text-gray-900">{expense.description}</td>
                      <td className="p-3 text-gray-500">{expense.category}</td>
                      <td className="p-3 text-gray-900 text-right whitespace-nowrap">
                        {formatCurrency(expense.cost, expense.currency || 'BRL')}
                      </td>
                      <td className="p-3 text-green-700 whitespace-nowrap">
                        {expense.payer.split(' ')[0]}
                      </td>
                      <td className="p-3 text-red-600 whitespace-nowrap">
                        {expense.owes
                          .map(
                            (o) =>
                              `${o.name.split(' ')[0]} (${formatCurrency(o.amount, expense.currency || 'BRL')})`
                          )
                          .join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsedExpenses.length > 20 && (
              <p className="text-sm text-gray-500 mt-2 text-center">
                ... e mais {parsedExpenses.length - 20} despesas
              </p>
            )}
          </div>

          {/* Import Button */}
          {!importResult?.success && (
            <Button
              onClick={handleImport}
              disabled={isImporting || !group}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white py-6 text-lg"
            >
              {isImporting ? (
                <>Importando...</>
              ) : (
                <>
                  <Upload className="mr-2 h-5 w-5" />
                  Importar {parsedExpenses.length} despesas
                </>
              )}
            </Button>
          )}

          {/* Success Message */}
          {importResult?.success && (
            <div className="p-6 bg-green-50 border border-green-200 rounded-lg flex items-center gap-4">
              <CheckCircle2 className="h-8 w-8 text-green-500 flex-shrink-0" />
              <div>
                <p className="font-bold text-green-800 text-lg">
                  Importação concluída com sucesso!
                </p>
                <p className="text-green-600">
                  {importResult.count} despesas foram importadas para o Mixiwise.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
