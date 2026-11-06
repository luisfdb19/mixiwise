'use client';

import React, { useState, useMemo, useTransition } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Tag,
  ChevronLeft,
  ChevronRight,
  Filter,
  PieChart,
  BarChart3,
  Layers,
  Award,
  Search,
} from 'lucide-react';
import { CATEGORY_LIST, getCategoryInfo } from '@/lib/categories';
import { formatCurrency } from '@/lib/currency';
import { batchAutoCategorizeExpenses, updateExpenseCategory } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';

interface SplitWithMember {
  id: string;
  name: string;
  splitAmount: number;
}

interface Expense {
  id: string;
  amount: number;
  description: string;
  created_by: string;
  created_by_name?: string;
  split_with: SplitWithMember[];
  created_at?: string;
  currency?: string;
  category?: string;
}

interface GroupReportsProps {
  expenses: Expense[];
  groupId: string;
  currentUserId?: string;
  onDataChanged: () => void;
}

type PeriodType = 'week' | 'month' | 'quarter' | 'year';
type ReportTab = 'dashboard' | 'timeline' | 'abc' | 'deepdive';

const MONTH_NAMES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
];

const FULL_MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

export default function GroupReports({
  expenses,
  groupId,
  onDataChanged,
}: GroupReportsProps) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [reportTab, setReportTab] = useState<ReportTab>('dashboard');
  const [periodType, setPeriodType] = useState<PeriodType>('month');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string | null>(null);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Date boundaries calculation
  const { startDate, endDate, periodLabel, activeYear } = useMemo(() => {
    const d = new Date(selectedDate);
    const year = d.getFullYear();

    if (periodType === 'week') {
      const day = d.getDay();
      const diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1);
      const start = new Date(d.setDate(diffToMonday));
      start.setHours(0, 0, 0, 0);

      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);

      const label = `Semana de ${start.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} a ${end.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}`;
      return { startDate: start, endDate: end, periodLabel: label, activeYear: year };
    }

    if (periodType === 'month') {
      const start = new Date(year, d.getMonth(), 1, 0, 0, 0);
      const end = new Date(year, d.getMonth() + 1, 0, 23, 59, 59, 999);
      const label = start.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      return {
        startDate: start,
        endDate: end,
        periodLabel: label.charAt(0).toUpperCase() + label.slice(1),
        activeYear: year,
      };
    }

    if (periodType === 'quarter') {
      const q = Math.floor(d.getMonth() / 3);
      const start = new Date(year, q * 3, 1, 0, 0, 0);
      const end = new Date(year, (q + 1) * 3, 0, 23, 59, 59, 999);
      const label = `${q + 1}º Trimestre de ${year} (${start.toLocaleDateString('pt-BR', { month: 'short' })} - ${end.toLocaleDateString('pt-BR', { month: 'short' })})`;
      return { startDate: start, endDate: end, periodLabel: label, activeYear: year };
    }

    // year
    const start = new Date(year, 0, 1, 0, 0, 0);
    const end = new Date(year, 11, 31, 23, 59, 59, 999);
    return { startDate: start, endDate: end, periodLabel: `Ano de ${year}`, activeYear: year };
  }, [selectedDate, periodType]);

  const handleNavigate = (direction: 'prev' | 'next') => {
    setSelectedDate((prev) => {
      const next = new Date(prev);
      const mult = direction === 'next' ? 1 : -1;

      if (periodType === 'week') next.setDate(next.getDate() + 7 * mult);
      else if (periodType === 'month') next.setMonth(next.getMonth() + 1 * mult);
      else if (periodType === 'quarter') next.setMonth(next.getMonth() + 3 * mult);
      else if (periodType === 'year') next.setFullYear(next.getFullYear() + 1 * mult);
      return next;
    });
  };

  // Expenses inside selected period
  const periodExpenses = useMemo(() => {
    return expenses.filter((e) => {
      if (!e.created_at) return false;
      const t = new Date(e.created_at).getTime();
      return t >= startDate.getTime() && t <= endDate.getTime();
    });
  }, [expenses, startDate, endDate]);

  // Expenses strictly for the entire current year (for Annual Deep Dive & Monthly Evolution)
  const fullYearExpenses = useMemo(() => {
    const yStart = new Date(activeYear, 0, 1, 0, 0, 0).getTime();
    const yEnd = new Date(activeYear, 11, 31, 23, 59, 59, 999).getTime();
    return expenses.filter((e) => {
      if (!e.created_at) return false;
      const t = new Date(e.created_at).getTime();
      return t >= yStart && t <= yEnd;
    });
  }, [expenses, activeYear]);

  // 1. Period Statistics using Integer Cents Arithmetic (GEMINI.md rule)
  const periodStats = useMemo(() => {
    let totalCents = 0;
    const catCentsMap: Record<string, number> = {};
    const payerCentsMap: Record<string, { cents: number; name: string }> = {};

    periodExpenses.forEach((e) => {
      const cents = Math.round(e.amount * 100);
      totalCents += cents;

      const cat = (e.category || 'outros').toLowerCase();
      catCentsMap[cat] = (catCentsMap[cat] || 0) + cents;

      const pId = e.created_by;
      const pName = e.created_by_name || 'Desconhecido';
      if (!payerCentsMap[pId]) {
        payerCentsMap[pId] = { cents: 0, name: pName };
      }
      payerCentsMap[pId].cents += cents;
    });

    const categoryBreakdown = Object.entries(catCentsMap)
      .map(([catId, cents]) => {
        const info = getCategoryInfo(catId);
        const amount = cents / 100;
        const percentage = totalCents > 0 ? (cents / totalCents) * 100 : 0;
        return {
          id: catId,
          name: info.name,
          color: info.color,
          bgLight: info.bgLight,
          textColor: info.textColor,
          borderColor: info.borderColor,
          amount,
          cents,
          percentage,
        };
      })
      .sort((a, b) => b.cents - a.cents);

    const topCategory = categoryBreakdown.length > 0 ? categoryBreakdown[0] : null;

    const days = Math.max(
      1,
      Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    );
    const dailyAverage = totalCents > 0 ? totalCents / days / 100 : 0;

    return {
      totalAmount: totalCents / 100,
      totalCents,
      count: periodExpenses.length,
      topCategory,
      dailyAverage,
      categoryBreakdown,
      payerBreakdown: Object.values(payerCentsMap).sort((a, b) => b.cents - a.cents),
    };
  }, [periodExpenses, startDate, endDate]);

  // 2. Classificação ABC (Curva de Pareto 80/20) por Categoria
  const abcAnalysis = useMemo(() => {
    const list = [...periodStats.categoryBreakdown];
    const total = periodStats.totalCents;

    let accumulatedCents = 0;
    const classifiedCategories = list.map((item) => {
      accumulatedCents += item.cents;
      const accumulatedPct = total > 0 ? (accumulatedCents / total) * 100 : 0;

      // Pareto Classes:
      // Classe A: até 80% do valor acumulado (Principais responsáveis pelo custo)
      // Classe B: de 80% a 95% (Custo intermediário)
      // Classe C: acima de 95% (Cauda longa)
      let abcClass: 'A' | 'B' | 'C' = 'C';
      if (accumulatedPct <= 80 || (item.percentage >= 15 && accumulatedPct <= 85)) {
        abcClass = 'A';
      } else if (accumulatedPct <= 95) {
        abcClass = 'B';
      }

      return {
        ...item,
        accumulatedPct,
        abcClass,
      };
    });

    const countA = classifiedCategories.filter((c) => c.abcClass === 'A').length;
    const totalAAmount = classifiedCategories
      .filter((c) => c.abcClass === 'A')
      .reduce((sum, c) => sum + c.cents, 0) / 100;
    const pctAAmount = total > 0 ? (totalAAmount * 100) / (total / 100) : 0;

    // Classificação ABC por despesas individuais (Top itens que dominam a conta)
    const sortedExpenses = [...periodExpenses]
      .map((e) => ({ ...e, cents: Math.round(e.amount * 100) }))
      .sort((a, b) => b.cents - a.cents);

    let accExpenseCents = 0;
    const classifiedExpenses = sortedExpenses.map((exp) => {
      accExpenseCents += exp.cents;
      const accPct = total > 0 ? (accExpenseCents / total) * 100 : 0;
      let abcClass: 'A' | 'B' | 'C' = 'C';
      if (accPct <= 80 || (exp.cents / total >= 0.1 && accPct <= 85)) {
        abcClass = 'A';
      } else if (accPct <= 95) {
        abcClass = 'B';
      }
      return {
        ...exp,
        accumulatedPct: accPct,
        abcClass,
      };
    });

    return {
      classifiedCategories,
      classifiedExpenses,
      countA,
      totalAAmount,
      pctAAmount,
    };
  }, [periodStats, periodExpenses]);

  // 3. Evolução Temporal Mês a Mês do Ano Inteiro (Time Series)
  const monthlyTimeline = useMemo(() => {
    const monthsData = Array.from({ length: 12 }, (_, i) => ({
      monthIndex: i,
      monthName: MONTH_NAMES[i],
      fullName: FULL_MONTH_NAMES[i],
      totalCents: 0,
      count: 0,
      topCatId: 'outros',
    }));

    const catByMonthMap: Record<number, Record<string, number>> = {};

    fullYearExpenses.forEach((e) => {
      if (!e.created_at) return;
      const d = new Date(e.created_at);
      const m = d.getMonth();
      const cents = Math.round(e.amount * 100);

      monthsData[m].totalCents += cents;
      monthsData[m].count += 1;

      if (!catByMonthMap[m]) catByMonthMap[m] = {};
      const cat = (e.category || 'outros').toLowerCase();
      catByMonthMap[m][cat] = (catByMonthMap[m][cat] || 0) + cents;
    });

    // Find top category per month
    monthsData.forEach((m) => {
      const cats = catByMonthMap[m.monthIndex];
      if (cats) {
        let maxCents = -1;
        let topId = 'outros';
        Object.entries(cats).forEach(([id, c]) => {
          if (c > maxCents) {
            maxCents = c;
            topId = id;
          }
        });
        m.topCatId = topId;
      }
    });

    const yearTotalCents = monthsData.reduce((acc, m) => acc + m.totalCents, 0);
    const activeMonths = monthsData.filter((m) => m.totalCents > 0);
    const monthlyAverageCents = activeMonths.length > 0
      ? yearTotalCents / activeMonths.length
      : 0;

    let peakMonth = monthsData[0];
    let lowestMonth: typeof monthsData[0] | null = null;

    activeMonths.forEach((m) => {
      if (m.totalCents > peakMonth.totalCents) peakMonth = m;
      if (!lowestMonth || m.totalCents < lowestMonth.totalCents) lowestMonth = m;
    });

    const maxMonthCents = Math.max(...monthsData.map((m) => m.totalCents), 1);

    return {
      monthsData,
      yearTotalAmount: yearTotalCents / 100,
      monthlyAverageAmount: monthlyAverageCents / 100,
      peakMonth,
      lowestMonth,
      maxMonthCents,
    };
  }, [fullYearExpenses]);

  // 4. Diagnóstico Anual Consolidado (Deep Dive Anual)
  const annualDeepDive = useMemo(() => {
    let yearTotalCents = 0;
    const catMap: Record<string, number> = {};

    fullYearExpenses.forEach((e) => {
      const cents = Math.round(e.amount * 100);
      yearTotalCents += cents;
      const cat = (e.category || 'outros').toLowerCase();
      catMap[cat] = (catMap[cat] || 0) + cents;
    });

    const sortedCats = Object.entries(catMap)
      .map(([id, cents]) => ({
        id,
        info: getCategoryInfo(id),
        cents,
        amount: cents / 100,
        pct: yearTotalCents > 0 ? (cents / yearTotalCents) * 100 : 0,
      }))
      .sort((a, b) => b.cents - a.cents);

    // Top 5 Largest single transactions of the year
    const topExpenses = [...fullYearExpenses]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    // Top 3 dominant categories percentage
    const top3Pct = sortedCats.slice(0, 3).reduce((sum, c) => sum + c.pct, 0);

    return {
      yearTotalAmount: yearTotalCents / 100,
      sortedCats,
      topExpenses,
      top3Pct,
      expenseCount: fullYearExpenses.length,
    };
  }, [fullYearExpenses]);

  // Uncategorized expenses counter
  const uncategorizedCount = useMemo(() => {
    return expenses.filter((e) => !e.category || e.category === 'outros').length;
  }, [expenses]);

  const handleBatchCategorize = () => {
    startTransition(async () => {
      const res = await batchAutoCategorizeExpenses(groupId);
      if (res.success) {
        toast({
          title: 'Classificação concluída! ✨',
          description: res.updatedCount > 0
            ? `${res.updatedCount} despesa(s) categorizada(s) automaticamente.`
            : 'Todas as despesas já estavam categorizadas.',
        });
        onDataChanged();
      } else {
        toast({
          title: 'Aviso',
          description: 'Não foi possível concluir a categorização em lote.',
          variant: 'destructive',
        });
      }
    });
  };

  const handleQuickCategoryChange = async (expenseId: string, newCategory: string) => {
    setEditingExpenseId(null);
    const res = await updateExpenseCategory(expenseId, newCategory, groupId);
    if (res.success) {
      toast({
        title: 'Categoria atualizada!',
        description: 'O sistema memorizou essa categoria para as próximas despesas.',
      });
      onDataChanged();
    }
  };

  // Filtered expenses list
  const displayedExpenses = useMemo(() => {
    let list = periodExpenses;
    if (selectedCategoryFilter) {
      list = list.filter(
        (e) => (e.category || 'outros').toLowerCase() === selectedCategoryFilter.toLowerCase()
      );
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (e) => e.description.toLowerCase().includes(q) || (e.created_by_name || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [periodExpenses, selectedCategoryFilter, searchTerm]);

  return (
    <div className="space-y-6 pb-12">
      {/* Global Controls & Period Selection */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Navigation Tabs for Reports */}
          <div className="inline-flex bg-gray-100 p-1 rounded-xl text-xs font-bold text-gray-600 overflow-x-auto max-w-full">
            <button
              onClick={() => setReportTab('dashboard')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap ${reportTab === 'dashboard' ? 'bg-white text-teal-600 shadow-xs' : 'hover:text-gray-900'
                }`}
            >
              <PieChart size={14} /> Visão Geral
            </button>
            <button
              onClick={() => setReportTab('timeline')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap ${reportTab === 'timeline' ? 'bg-white text-teal-600 shadow-xs' : 'hover:text-gray-900'
                }`}
            >
              <BarChart3 size={14} /> Evolução no Tempo
            </button>
            <button
              onClick={() => setReportTab('abc')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap ${reportTab === 'abc' ? 'bg-white text-teal-600 shadow-xs' : 'hover:text-gray-900'
                }`}
            >
              <Layers size={14} /> Curva ABC (80/20)
            </button>
            <button
              onClick={() => setReportTab('deepdive')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap ${reportTab === 'deepdive' ? 'bg-white text-teal-600 shadow-xs' : 'hover:text-gray-900'
                }`}
            >
              <Award size={14} /> Raio-X Anual
            </button>
          </div>

          {/* AI Auto-categorize Button */}
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={handleBatchCategorize}
            className="text-xs font-bold gap-1.5 text-purple-700 border-purple-200 hover:bg-purple-50 rounded-xl flex-shrink-0"
          >
            <Sparkles size={14} className={isPending ? 'animate-spin' : 'text-purple-600'} />
            <span>
              {isPending
                ? 'Classificando...'
                : uncategorizedCount > 0
                  ? `Classificar pendentes (${uncategorizedCount})`
                  : 'Reclassificar com IA'}
            </span>
          </Button>
        </div>

        {/* Period Selector (Only shown for period-dependent tabs) */}
        {reportTab !== 'deepdive' && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-gray-100">
            <div className="inline-flex bg-gray-50 border p-0.5 rounded-lg text-xs font-semibold text-gray-500 self-start">
              <button
                onClick={() => setPeriodType('week')}
                className={`px-2.5 py-1 rounded-md transition-all ${periodType === 'week' ? 'bg-white text-teal-600 font-bold shadow-xs' : 'hover:text-gray-900'}`}
              >
                Semanal
              </button>
              <button
                onClick={() => setPeriodType('month')}
                className={`px-2.5 py-1 rounded-md transition-all ${periodType === 'month' ? 'bg-white text-teal-600 font-bold shadow-xs' : 'hover:text-gray-900'}`}
              >
                Mensal
              </button>
              <button
                onClick={() => setPeriodType('quarter')}
                className={`px-2.5 py-1 rounded-md transition-all ${periodType === 'quarter' ? 'bg-white text-teal-600 font-bold shadow-xs' : 'hover:text-gray-900'}`}
              >
                Trimestral
              </button>
              <button
                onClick={() => setPeriodType('year')}
                className={`px-2.5 py-1 rounded-md transition-all ${periodType === 'year' ? 'bg-white text-teal-600 font-bold shadow-xs' : 'hover:text-gray-900'}`}
              >
                Anual
              </button>
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-2 flex-grow">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-gray-500 hover:bg-gray-100"
                onClick={() => handleNavigate('prev')}
              >
                <ChevronLeft size={18} />
              </Button>
              <h2 className="text-xs sm:text-sm font-bold text-gray-900 min-w-44 text-center">
                {periodLabel}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-gray-500 hover:bg-gray-100"
                onClick={() => handleNavigate('next')}
              >
                <ChevronRight size={18} />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ==================== TAB 1: VISÃO GERAL (DASHBOARD) ==================== */}
      {reportTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Top 3 KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            <Card className="border-0 ring-1 ring-gray-200 shadow-sm rounded-2xl bg-gradient-to-br from-white to-gray-50/50">
              <CardContent className="p-4 sm:p-5">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Total do Período</p>
                <p className="text-2xl font-black text-gray-900 mt-1">
                  {formatCurrency(periodStats.totalAmount)}
                </p>
                <p className="text-[11px] text-gray-500 font-medium mt-1">
                  Média de {formatCurrency(periodStats.dailyAverage)} / dia
                </p>
              </CardContent>
            </Card>

            <Card className="border-0 ring-1 ring-gray-200 shadow-sm rounded-2xl bg-gradient-to-br from-white to-gray-50/50">
              <CardContent className="p-4 sm:p-5">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Maior Centro de Custo</p>
                {periodStats.topCategory ? (
                  <>
                    <p className="text-xl font-black text-gray-900 mt-1 truncate">
                      {periodStats.topCategory.name}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[11px] font-bold text-gray-700">
                        {formatCurrency(periodStats.topCategory.amount)}
                      </span>
                      <span className="text-[10px] font-semibold text-gray-400">
                        ({periodStats.topCategory.percentage.toFixed(0)}% do período)
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-sm font-semibold text-gray-400 mt-2">Sem gastos</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-0 ring-1 ring-gray-200 shadow-sm rounded-2xl bg-gradient-to-br from-white to-gray-50/50">
              <CardContent className="p-4 sm:p-5">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Membros Pagadores</p>
                <p className="text-2xl font-black text-gray-900 mt-1">
                  {periodStats.payerBreakdown.length}
                </p>
                <p className="text-[11px] text-gray-500 font-medium mt-1">
                  {periodStats.count} transações registradas
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Category Breakdown Progress Bars */}
          <Card className="border-0 ring-1 ring-gray-200 shadow-sm rounded-2xl bg-white overflow-hidden">
            <CardContent className="p-4 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm sm:text-base font-bold text-gray-900 flex items-center gap-2">
                  <PieChart size={18} className="text-teal-600" />
                  Gastos por Categoria
                </h3>
                {selectedCategoryFilter && (
                  <button
                    onClick={() => setSelectedCategoryFilter(null)}
                    className="text-[11px] font-bold text-teal-600 hover:underline"
                  >
                    Limpar filtro
                  </button>
                )}
              </div>

              {periodStats.categoryBreakdown.length > 0 ? (
                <div className="space-y-3.5">
                  {periodStats.categoryBreakdown.map((cat) => {
                    const isSelected = selectedCategoryFilter === cat.id;
                    return (
                      <div
                        key={cat.id}
                        onClick={() => setSelectedCategoryFilter(isSelected ? null : cat.id)}
                        className={`p-2.5 rounded-xl transition-all cursor-pointer border ${isSelected
                          ? 'border-teal-400 bg-teal-50/30 ring-1 ring-teal-300'
                          : 'border-transparent hover:bg-gray-50'
                          }`}
                      >
                        <div className="flex justify-between items-center text-xs mb-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: cat.color }}
                            />
                            <span className="font-bold text-gray-800 truncate">{cat.name}</span>
                            {cat.id === 'outros' && (
                              <span className="text-[9px] font-bold px-1.5 py-0.2 bg-amber-50 text-amber-600 border border-amber-200 rounded-md">
                                pendente
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="font-extrabold text-gray-900">
                              {formatCurrency(cat.amount)}
                            </span>
                            <span className="text-[11px] text-gray-400 font-semibold w-12 text-right">
                              {cat.percentage.toFixed(1)}%
                            </span>
                          </div>
                        </div>

                        <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.min(cat.percentage, 100)}%`,
                              backgroundColor: cat.color,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400 text-xs">
                  Nenhuma despesa para exibir no período selecionado.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ==================== TAB 2: EVOLUÇÃO NO TEMPO (TIMELINE) ==================== */}
      {reportTab === 'timeline' && (
        <div className="space-y-6">
          <Card className="border-0 ring-1 ring-gray-200 shadow-sm rounded-2xl bg-white">
            <CardContent className="p-4 sm:p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-gray-900 flex items-center gap-2">
                    <BarChart3 size={18} className="text-teal-600" />
                    Evolução Mensal em {activeYear}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Total anual de {formatCurrency(monthlyTimeline.yearTotalAmount)} • Média mensal de {formatCurrency(monthlyTimeline.monthlyAverageAmount)}
                  </p>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 text-[11px] text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md font-bold">
                    <TrendingUp size={12} /> Pico: {monthlyTimeline.peakMonth.fullName} ({formatCurrency(monthlyTimeline.peakMonth.totalCents / 100)})
                  </span>
                </div>
              </div>

              {/* Responsive SVG Bar Chart */}
              <div className="pt-4 pb-2">
                <div className="flex items-end justify-between gap-1.5 sm:gap-3 h-48 sm:h-56 w-full px-1">
                  {monthlyTimeline.monthsData.map((m) => {
                    const heightPercent = m.totalCents > 0
                      ? Math.max(8, (m.totalCents / monthlyTimeline.maxMonthCents) * 100)
                      : 4;
                    const isPeak = m.monthIndex === monthlyTimeline.peakMonth.monthIndex && m.totalCents > 0;
                    const topCat = getCategoryInfo(m.topCatId);

                    return (
                      <div
                        key={m.monthIndex}
                        className="flex-1 flex flex-col items-center h-full justify-end group relative cursor-pointer"
                        onClick={() => {
                          setSelectedDate(new Date(activeYear, m.monthIndex, 1));
                          setPeriodType('month');
                          setReportTab('dashboard');
                        }}
                      >
                        {/* Hover Tooltip */}
                        <div className="absolute -top-14 hidden group-hover:flex flex-col items-center z-30 pointer-events-none min-w-28">
                          <div className="bg-gray-900 text-white text-[10px] rounded-lg px-2 py-1 shadow-xl text-center font-bold">
                            <p>{m.fullName}</p>
                            <p className="text-teal-300 font-black">{formatCurrency(m.totalCents / 100)}</p>
                            {m.count > 0 && <p className="text-[9px] text-gray-300">{topCat.name}</p>}
                          </div>
                          <div className="w-2 h-2 bg-gray-900 rotate-45 -mt-1" />
                        </div>

                        {/* Bar */}
                        <div className="w-full max-w-[32px] flex flex-col justify-end h-full">
                          <div
                            className={`w-full rounded-t-lg transition-all duration-500 ${isPeak
                              ? 'bg-gradient-to-t from-teal-600 to-teal-400 shadow-md'
                              : m.totalCents > 0
                                ? 'bg-gradient-to-t from-gray-300 to-gray-400 group-hover:from-teal-400 group-hover:to-teal-500'
                                : 'bg-gray-100'
                              }`}
                            style={{ height: `${heightPercent}%` }}
                          />
                        </div>

                        {/* Month Label */}
                        <span className={`text-[10px] sm:text-xs mt-2 font-bold ${isPeak ? 'text-teal-600' : 'text-gray-400'}`}>
                          {m.monthName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Monthly Summary Table */}
              <div className="pt-2 border-t border-gray-100">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="bg-gray-50 rounded-xl p-2.5">
                    <p className="text-[10px] text-gray-400 font-bold uppercase">Mês mais alto</p>
                    <p className="font-bold text-gray-800">{monthlyTimeline.peakMonth.fullName}</p>
                    <p className="font-extrabold text-teal-600">{formatCurrency(monthlyTimeline.peakMonth.totalCents / 100)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-2.5">
                    <p className="text-[10px] text-gray-400 font-bold uppercase">Mês mais econômico</p>
                    <p className="font-bold text-gray-800">{(monthlyTimeline.lowestMonth as { fullName?: string, totalCents?: number })?.fullName || '--'}</p>
                    <p className="font-extrabold text-gray-700">{formatCurrency(((monthlyTimeline.lowestMonth as { fullName?: string, totalCents?: number })?.totalCents || 0) / 100)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-2.5">
                    <p className="text-[10px] text-gray-400 font-bold uppercase">Média mensal</p>
                    <p className="font-bold text-gray-800">12 meses</p>
                    <p className="font-extrabold text-gray-700">{formatCurrency(monthlyTimeline.monthlyAverageAmount)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-2.5">
                    <p className="text-[10px] text-gray-400 font-bold uppercase">Total do Ano</p>
                    <p className="font-bold text-gray-800">{activeYear}</p>
                    <p className="font-extrabold text-teal-700">{formatCurrency(monthlyTimeline.yearTotalAmount)}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ==================== TAB 3: CURVA ABC (PARETO 80/20) ==================== */}
      {reportTab === 'abc' && (
        <div className="space-y-6">
          {/* Executive Summary of ABC */}
          <Card className="border-0 ring-1 ring-gray-200 shadow-sm rounded-2xl bg-gradient-to-r from-teal-500 to-teal-700 text-white">
            <CardContent className="p-5 sm:p-6 space-y-2">
              <div className="flex items-center gap-2">
                <span className="bg-white/20 px-2 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider">
                  Princípio de Pareto (80/20)
                </span>
              </div>
              <h3 className="text-xl sm:text-2xl font-black">
                {abcAnalysis.countA} categoria{abcAnalysis.countA > 1 ? 's' : ''} concentra{abcAnalysis.countA > 1 ? 'm' : ''} {abcAnalysis.pctAAmount.toFixed(0)}% de todo o custo
              </h3>
              <p className="text-xs sm:text-sm text-teal-100 max-w-2xl leading-relaxed">
                Na análise financeira ABC, os itens da <strong>Classe A</strong> são onde qualquer economia gera o maior impacto no bolso do grupo.
              </p>
            </CardContent>
          </Card>

          {/* ABC Legend / Methodology */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="border border-red-200 bg-red-50/50 rounded-2xl p-3.5 space-y-1">
              <span className="inline-block px-2 py-0.5 rounded-md bg-red-500 text-white font-black text-xs">
                Classe A • Crítico (~80%)
              </span>
              <p className="text-xs text-red-900 font-bold mt-1">Alta Prioridade</p>
              <p className="text-[11px] text-red-700">Responsáveis por ~80% do montante total gasto. Exigem atenção direta.</p>
            </div>

            <div className="border border-amber-200 bg-amber-50/50 rounded-2xl p-3.5 space-y-1">
              <span className="inline-block px-2 py-0.5 rounded-md bg-amber-500 text-white font-black text-xs">
                Classe B • Médio (~15%)
              </span>
              <p className="text-xs text-amber-900 font-bold mt-1">Prioridade Média</p>
              <p className="text-[11px] text-amber-700">Custos recorrentes moderados que compõem os 15% seguintes do orçamento.</p>
            </div>

            <div className="border border-blue-200 bg-blue-50/50 rounded-2xl p-3.5 space-y-1">
              <span className="inline-block px-2 py-0.5 rounded-md bg-blue-500 text-white font-black text-xs">
                Classe C • Cauda Longa (~5%)
              </span>
              <p className="text-xs text-blue-900 font-bold mt-1">Baixo Impacto</p>
              <p className="text-[11px] text-blue-700">Diversos pequenos gastos que juntos somam menos de 5% a 10% do total.</p>
            </div>
          </div>

          {/* Categories ABC Table */}
          <Card className="border-0 ring-1 ring-gray-200 shadow-sm rounded-2xl bg-white overflow-hidden">
            <CardContent className="p-4 sm:p-6 space-y-4">
              <h3 className="text-sm sm:text-base font-bold text-gray-900 flex items-center gap-2">
                <Layers size={18} className="text-teal-600" />
                Matriz ABC das Categorias ({periodLabel})
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b text-gray-400 font-bold uppercase text-[10px]">
                      <th className="py-2.5 px-3">Classe</th>
                      <th className="py-2.5 px-3">Categoria</th>
                      <th className="py-2.5 px-3 text-right">Valor</th>
                      <th className="py-2.5 px-3 text-right">% do Todo</th>
                      <th className="py-2.5 px-3 text-right">% Acumulada</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {abcAnalysis.classifiedCategories.map((c) => (
                      <tr key={c.id} className="hover:bg-gray-50/80 transition-colors">
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded font-black text-[11px] ${c.abcClass === 'A'
                              ? 'bg-red-100 text-red-700 border border-red-200'
                              : c.abcClass === 'B'
                                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                                : 'bg-blue-100 text-blue-700 border border-blue-200'
                              }`}
                          >
                            Classe {c.abcClass}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-bold text-gray-800 flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                          {c.name}
                        </td>
                        <td className="py-3 px-3 text-right font-black text-gray-900">
                          {formatCurrency(c.amount)}
                        </td>
                        <td className="py-3 px-3 text-right font-semibold text-gray-600">
                          {c.percentage.toFixed(1)}%
                        </td>
                        <td className="py-3 px-3 text-right font-extrabold text-teal-700">
                          {c.accumulatedPct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ==================== TAB 4: RAIO-X ANUAL (DEEP DIVE) ==================== */}
      {reportTab === 'deepdive' && (
        <div className="space-y-6">
          {/* Annual Banner */}
          <Card className="border-0 ring-1 ring-gray-200 shadow-sm rounded-2xl bg-white p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-[11px] font-bold text-purple-600 bg-purple-50 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                  Consolidado Anual
                </span>
                <h3 className="text-xl sm:text-2xl font-black text-gray-900 mt-1">
                  Raio-X de Custos de {activeYear}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Análise global de todos os {annualDeepDive.expenseCount} lançamentos efetuados no ano.
                </p>
              </div>

              <div className="text-right self-start sm:self-auto bg-gray-50 p-3 rounded-xl border border-gray-100">
                <p className="text-[10px] text-gray-400 font-bold uppercase">Gasto Total Acumulado</p>
                <p className="text-2xl font-black text-teal-600">{formatCurrency(annualDeepDive.yearTotalAmount)}</p>
              </div>
            </div>

            {/* Dominance card */}
            <div className="bg-teal-50 border border-teal-200/80 rounded-xl p-3.5 flex items-center gap-3">
              <Award size={24} className="text-teal-600 flex-shrink-0" />
              <p className="text-xs text-teal-900 font-medium">
                As 3 maiores categorias somam <strong>{annualDeepDive.top3Pct.toFixed(0)}%</strong> de todo o custo de {activeYear}. Controlar essas 3 categorias é suficiente para balancear as contas do ano.
              </p>
            </div>
          </Card>

          {/* Top 5 Single Expenses of the Year */}
          <Card className="border-0 ring-1 ring-gray-200 shadow-sm rounded-2xl bg-white overflow-hidden">
            <CardContent className="p-4 sm:p-6 space-y-3">
              <h4 className="text-sm sm:text-base font-bold text-gray-900 flex items-center gap-2">
                <TrendingDown size={18} className="text-red-500" />
                Top 5 Maiores Despesas Individuais de {activeYear}
              </h4>

              <div className="space-y-2">
                {annualDeepDive.topExpenses.map((exp, idx) => {
                  const cat = getCategoryInfo(exp.category);
                  return (
                    <div
                      key={exp.id}
                      className="flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-6 h-6 rounded-full bg-gray-900 text-white font-black text-xs flex items-center justify-center flex-shrink-0">
                          {idx + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-bold text-gray-900 truncate">{exp.description}</p>
                          <p className="text-[10px] text-gray-400">
                            {exp.created_at ? new Date(exp.created_at).toLocaleDateString('pt-BR') : '--'} • Pago por {exp.created_by_name || 'Membro'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cat.bgLight} ${cat.textColor} ${cat.borderColor}`}>
                          {cat.name}
                        </span>
                        <span className="text-sm font-black text-gray-900">
                          {formatCurrency(exp.amount, exp.currency || 'BRL')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ==================== EXPENSES TABLE (SEARCH & INTERACTION) ==================== */}
      <div className="space-y-3 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <h3 className="text-sm sm:text-base font-bold text-gray-800 flex items-center gap-2">
            <Filter size={15} className="text-gray-400" />
            Lançamentos do Período ({displayedExpenses.length})
          </h3>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* Search Input */}
            <div className="relative flex-grow sm:w-60">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar despesa..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>
          </div>
        </div>

        {displayedExpenses.length > 0 ? (
          <div className="space-y-2">
            {displayedExpenses.map((expense) => {
              const catInfo = getCategoryInfo(expense.category);
              const isEditing = editingExpenseId === expense.id;

              return (
                <Card
                  key={expense.id}
                  className="shadow-xs border-0 ring-1 ring-gray-200 rounded-xl overflow-hidden bg-white"
                >
                  <CardContent className="flex items-center justify-between p-3 sm:p-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex flex-col items-center justify-center w-9 sm:w-11 text-center flex-shrink-0">
                        <span className="text-[9px] sm:text-[10px] font-semibold text-gray-400 uppercase leading-none">
                          {expense.created_at
                            ? new Date(expense.created_at).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
                            : '--'}
                        </span>
                        <span className="text-sm sm:text-base font-bold text-gray-800 leading-tight">
                          {expense.created_at ? new Date(expense.created_at).getDate() : '--'}
                        </span>
                      </div>

                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-semibold text-gray-900 truncate">
                          {expense.description}
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          Pago por {expense.created_by_name || 'Alguém'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 flex-shrink-0">
                      {/* Interactive Category Badge */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setEditingExpenseId(isEditing ? null : expense.id)}
                          className={`text-[10px] sm:text-xs font-bold px-2.5 py-0.5 rounded-full border transition-all ${catInfo.bgLight} ${catInfo.textColor} ${catInfo.borderColor} hover:shadow-xs`}
                        >
                          <span className="flex items-center gap-1">
                            <Tag size={10} />
                            {catInfo.name}
                          </span>
                        </button>

                        {isEditing && (
                          <div className="absolute right-0 top-7 mt-1 bg-white border border-gray-200 shadow-xl rounded-xl p-1 z-30 w-52 grid grid-cols-1 gap-0.5 max-h-48 overflow-y-auto">
                            <p className="text-[9px] font-bold text-gray-400 px-2 py-1 uppercase">Trocar categoria:</p>
                            {CATEGORY_LIST.map((c) => (
                              <button
                                key={c.id}
                                onClick={() => handleQuickCategoryChange(expense.id, c.id)}
                                className="w-full text-left px-2 py-1.5 rounded-lg text-xs font-semibold hover:bg-gray-50 flex items-center gap-2 text-gray-700"
                              >
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                                <span className="truncate">{c.name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <span className="text-xs sm:text-sm font-bold text-gray-900">
                        {formatCurrency(expense.amount, expense.currency || 'BRL')}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-400 py-6 text-center">Nenhuma despesa para os filtros atuais.</p>
        )}
      </div>
    </div>
  );
}
