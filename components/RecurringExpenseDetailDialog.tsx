'use client';

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  RefreshCw,
  Pause,
  Play,
  Trash2,
  Pencil,
  X,
  Calendar,
  Check,
  Sliders,
  AlertTriangle,
  Info,
  CalendarDays,
} from 'lucide-react';
import {
  getRecurringExpenseDetails,
  toggleRecurringExpenseStatus,
  deleteRecurringExpense,
  updateRecurringExpense,
} from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/currency';

interface RecurringExpenseDetailDialogProps {
  isOpen: boolean;
  onClose: () => void;
  recurringExpenseId: string;
  expenseDescription: string;
  onEditExpense: () => void;
  onDataChanged: () => void;
  currentUserId?: string;
}

interface RecurringRule {
  id: string;
  amount: number;
  description: string;
  split_with: { id: string; name: string; splitAmount: number }[];
  created_by: string;
  interval_unit: 'month' | 'year';
  next_occurrence: string;
  total_installments: number | null;
  current_installment: number;
  active: boolean;
  created_at: string;
  currency?: string;
}

interface Installment {
  id: string;
  description: string;
  amount: number;
  created_at: string;
}

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const toISODateInputValue = (dateStr: string) => {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function RecurringExpenseDetailDialog({
  isOpen,
  onClose,
  recurringExpenseId,
  expenseDescription,
  onEditExpense,
  onDataChanged,
  currentUserId,
}: RecurringExpenseDetailDialogProps) {
  const { toast } = useToast();
  const [rule, setRule] = useState<RecurringRule | null>(null);
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Estados de edição de regras futuras
  const [isEditingRule, setIsEditingRule] = useState(false);
  const [editNextOccurrence, setEditNextOccurrence] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editDescription, setEditDescription] = useState('');

  // Estado de confirmação explícita de exclusão
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (isOpen && recurringExpenseId) {
      setLoading(true);
      setIsEditingRule(false);
      setShowDeleteConfirm(false);
      getRecurringExpenseDetails(recurringExpenseId).then(({ rule: fetchedRule, installments: fetchedInst }) => {
        const typedRule = fetchedRule as RecurringRule | null;
        setRule(typedRule);
        setInstallments(fetchedInst);
        if (typedRule) {
          setEditDescription(typedRule.description || '');
          setEditAmount(typedRule.amount.toString());
          setEditNextOccurrence(toISODateInputValue(typedRule.next_occurrence));
        }
        setLoading(false);
      });
    }
  }, [isOpen, recurringExpenseId]);

  if (!isOpen) return null;

  const totalInstallments = rule?.total_installments;
  const completedInstallments = installments.length;
  const isInstallment = totalInstallments !== null && totalInstallments !== undefined;
  const progressPercent = isInstallment && totalInstallments > 0
    ? Math.min((completedInstallments / totalInstallments) * 100, 100)
    : 0;
  const totalValue = isInstallment && rule ? rule.amount * totalInstallments : null;
  const remainingInstallments = isInstallment && totalInstallments ? totalInstallments - completedInstallments : null;

  // Extrair descrição limpa
  const cleanDescription = rule?.description || expenseDescription.replace(/\s*\(\d+\/\d+\)\s*$/, '');

  const handleToggleStatus = async () => {
    if (!rule) return;
    setActionLoading(true);
    const result = await toggleRecurringExpenseStatus(rule.id, !rule.active);
    if (result.success) {
      setRule({ ...rule, active: !rule.active });
      toast({
        title: rule.active ? 'Pausado ⏸️' : 'Reativado ▶️',
        description: rule.active
          ? 'Recorrência pausada. Novas cobranças não serão geradas.'
          : 'Recorrência reativada. Novas cobranças voltarão a ser geradas na data agendada.',
      });
      onDataChanged();
    }
    setActionLoading(false);
  };

  const handleConfirmDelete = async () => {
    if (!rule) return;
    setActionLoading(true);
    const result = await deleteRecurringExpense(rule.id);
    if (result.success) {
      toast({
        title: 'Recorrência cancelada',
        description: 'Cobranças futuras canceladas. Todas as parcelas anteriores continuam no extrato do grupo.',
      });
      onDataChanged();
      onClose();
    } else {
      toast({
        title: 'Erro ao excluir',
        description: result.error || 'Não foi possível cancelar a recorrência.',
        variant: 'destructive',
      });
    }
    setActionLoading(false);
  };

  const handleStartEditingRule = () => {
    if (rule) {
      setEditDescription(cleanDescription);
      setEditAmount(rule.amount.toString());
      setEditNextOccurrence(toISODateInputValue(rule.next_occurrence));
      setIsEditingRule(true);
      setShowDeleteConfirm(false);
    }
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rule) return;

    const parsedAmount = parseFloat(editAmount.replace(',', '.'));
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast({
        title: 'Valor inválido',
        description: 'Informe um valor maior que zero para as próximas cobranças.',
        variant: 'destructive',
      });
      return;
    }

    if (!editNextOccurrence) {
      toast({
        title: 'Data obrigatória',
        description: 'Informe a data da próxima cobrança.',
        variant: 'destructive',
      });
      return;
    }

    setActionLoading(true);
    const [year, month, day] = editNextOccurrence.split('-').map(Number);
    const nextDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

    const res = await updateRecurringExpense(rule.id, {
      description: editDescription.trim() || rule.description,
      amount: parsedAmount,
      nextOccurrence: nextDate.toISOString(),
    });

    if (res.success) {
      setRule({
        ...rule,
        description: editDescription.trim() || rule.description,
        amount: parsedAmount,
        next_occurrence: nextDate.toISOString(),
      });
      setIsEditingRule(false);
      toast({
        title: 'Recorrência atualizada! ✨',
        description: 'Próximas cobranças seguirão a nova data e valor. O histórico passado permanece intacto.',
      });
      onDataChanged();
    } else {
      toast({
        title: 'Erro ao atualizar',
        description: res.error || 'Não foi possível salvar as alterações.',
        variant: 'destructive',
      });
    }
    setActionLoading(false);
  };

  // Previsão das próximas parcelas
  const futureInstallments: { description: string; date: Date }[] = [];
  if (rule && isInstallment && totalInstallments && remainingInstallments && remainingInstallments > 0) {
    let nextDate = new Date(rule.next_occurrence);
    for (let i = 0; i < remainingInstallments; i++) {
      const instNum = completedInstallments + i + 1;
      futureInstallments.push({
        description: `${cleanDescription} (${instNum}/${totalInstallments})`,
        date: new Date(nextDate),
      });
      const newDate = new Date(nextDate);
      if (rule.interval_unit === 'year') {
        newDate.setFullYear(newDate.getFullYear() + 1);
      } else {
        newDate.setMonth(newDate.getMonth() + 1);
      }
      nextDate = newDate;
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md w-[calc(100vw-16px)] sm:w-full p-0 overflow-hidden border-0 rounded-2xl shadow-2xl [&>button]:hidden">
        {/* Header */}
        <DialogHeader className="bg-purple-600 text-white p-4 flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
              <RefreshCw size={18} className="text-white" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base sm:text-lg font-bold text-white leading-tight truncate">
                {isEditingRule ? 'Ajustar Cobranças Futuras' : cleanDescription}
              </DialogTitle>
              <p className="text-[11px] text-purple-200 font-medium">
                {isEditingRule ? 'Alterações aplicadas apenas aos próximos lançamentos' : 'Agendamento e histórico de parcelas'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
            <X size={20} />
          </button>
        </DialogHeader>

        <div className="p-4 sm:p-5 space-y-4 bg-white max-h-[80vh] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <RefreshCw size={24} className="text-purple-400 animate-spin" />
            </div>
          ) : rule ? (
            <>
              {/* MODAL / SEÇÃO DE CONFIRMAÇÃO DE EXCLUSÃO */}
              {showDeleteConfirm && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3 animate-in fade-in-50 duration-200">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="text-red-600 flex-shrink-0 mt-0.5" size={20} />
                    <div className="space-y-1">
                      <h4 className="text-sm font-bold text-red-900 leading-tight">
                        Cancelar agendamento futuro?
                      </h4>
                      <p className="text-xs text-red-700 leading-relaxed">
                        As cobranças automáticas futuras serão interrompidas. 
                        <strong> Todo o histórico das despesas já lançadas no grupo continuará 100% preservado</strong> nos saldos e extratos.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs font-semibold"
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={actionLoading}
                    >
                      Voltar
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 text-xs font-bold bg-red-600 hover:bg-red-700 text-white"
                      onClick={handleConfirmDelete}
                      disabled={actionLoading}
                    >
                      {actionLoading ? 'Cancelando...' : 'Sim, cancelar futuro'}
                    </Button>
                  </div>
                </div>
              )}

              {/* MODO DE EDIÇÃO DE REGRAS FUTURAS */}
              {isEditingRule ? (
                <form onSubmit={handleSaveRule} className="space-y-4">
                  {/* Banner de esclarecimento de escopo */}
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2.5">
                    <Info className="text-amber-600 flex-shrink-0 mt-0.5" size={16} />
                    <div className="text-xs text-amber-800 space-y-1">
                      <p className="font-bold">O que muda e o que não muda:</p>
                      <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-700">
                        <li><strong>Muda:</strong> A data e o valor dos próximos lançamentos automáticos.</li>
                        <li><strong>Não muda:</strong> Nenhuma despesa ou parcela que já foi registrada no passado.</li>
                      </ul>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-bold text-gray-700 block mb-1">
                        Nome / Descrição da recorrência
                      </label>
                      <Input
                        type="text"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        placeholder="Ex: Netflix, Aluguel, Parcela Sofá"
                        required
                        className="text-sm"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-bold text-gray-700 block mb-1">
                          Valor por parcela (R$)
                        </label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          placeholder="0,00"
                          required
                          className="text-sm font-semibold"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-gray-700 block mb-1">
                          Próxima cobrança
                        </label>
                        <Input
                          type="date"
                          value={editNextOccurrence}
                          onChange={(e) => setEditNextOccurrence(e.target.value)}
                          required
                          className="text-sm"
                        />
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-500">
                      O lançamento acontecerá na nova data informada e as parcelas seguintes continuarão no intervalo de {rule.interval_unit === 'year' ? '1 ano' : '1 mês'}.
                    </p>
                  </div>

                  <div className="flex gap-2 pt-2 border-t border-gray-100">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs font-semibold"
                      onClick={() => setIsEditingRule(false)}
                      disabled={actionLoading}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      className="flex-1 text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white"
                      disabled={actionLoading}
                    >
                      {actionLoading ? 'Salvando...' : 'Salvar cobranças futuras'}
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  {/* Badge de status */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {isInstallment ? (
                      <span className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 text-xs font-bold px-3 py-1 rounded-full border border-purple-100">
                        📦 Parcela {completedInstallments} de {totalInstallments}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-bold px-3 py-1 rounded-full border border-blue-100">
                        🔄 Recorrência {rule.interval_unit === 'month' ? 'mensal' : 'anual'}
                      </span>
                    )}
                    <span className={`inline-flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full border ${
                      rule.active 
                        ? 'bg-green-50 text-green-700 border-green-100' 
                        : 'bg-gray-100 text-gray-500 border-gray-200'
                    }`}>
                      {rule.active ? '🟢 Ativo' : '⏸️ Pausado'}
                    </span>
                  </div>

                  {/* Info Cards */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100 relative group">
                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Valor / parcela</p>
                      <p className="text-lg font-bold text-gray-900 mt-0.5">{formatCurrency(rule.amount, rule.currency || 'BRL')}</p>
                      <p className="text-[10px] text-gray-400 font-medium">/ {rule.interval_unit === 'month' ? 'mês' : 'ano'}</p>
                    </div>
                    {totalValue && (
                      <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Valor total</p>
                        <p className="text-lg font-bold text-gray-900 mt-0.5">{formatCurrency(totalValue, rule.currency || 'BRL')}</p>
                        <p className="text-[10px] text-gray-400 font-medium">{totalInstallments}x de {formatCurrency(rule.amount, rule.currency || 'BRL')}</p>
                      </div>
                    )}
                    {!totalValue && (
                      <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Cobranças feitas</p>
                        <p className="text-lg font-bold text-gray-900 mt-0.5">{completedInstallments}</p>
                        <p className="text-[10px] text-gray-400 font-medium">sem limite definido</p>
                      </div>
                    )}
                  </div>

                  {/* Progress Bar (se parcelado) */}
                  {isInstallment && totalInstallments && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-gray-600">Progresso</span>
                        <span className="text-xs font-bold text-purple-600">{completedInstallments}/{totalInstallments}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-purple-500 to-purple-600 h-full rounded-full transition-all duration-500"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      {remainingInstallments !== null && remainingInstallments > 0 && (
                        <p className="text-[10px] text-gray-400 font-medium">
                          Faltam {remainingInstallments} parcela{remainingInstallments > 1 ? 's' : ''}
                        </p>
                      )}
                      {remainingInstallments === 0 && (
                        <p className="text-[10px] text-green-600 font-bold">✅ Todas as parcelas geradas!</p>
                      )}
                    </div>
                  )}

                  {/* Card de Próxima Cobrança com Ação Rápida de Ajuste */}
                  {rule.active && remainingInstallments !== 0 && (
                    <div className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-xl p-3">
                      <div className="flex items-center gap-2.5">
                        <Calendar size={18} className="text-amber-600 flex-shrink-0" />
                        <div>
                          <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">Próxima cobrança</p>
                          <p className="text-xs font-bold text-amber-900">{formatDate(rule.next_occurrence)}</p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2.5 text-xs font-bold text-amber-800 hover:text-amber-900 hover:bg-amber-100/70 rounded-lg gap-1"
                        onClick={handleStartEditingRule}
                      >
                        <CalendarDays size={13} />
                        Alterar data
                      </Button>
                    </div>
                  )}

                  {/* Divisão da parcela */}
                  <div className="border border-gray-200 rounded-xl p-3 space-y-2">
                    <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wider">Divisão por parcela</h4>
                    {rule.split_with.map((member) => (
                      <div key={member.id} className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-700">
                          {member.id === currentUserId ? 'você' : member.name.split(' ')[0]}
                        </span>
                        <span className="text-xs font-bold text-gray-900">{formatCurrency(member.splitAmount, rule.currency || 'BRL')}</span>
                      </div>
                    ))}
                  </div>

                  {/* Timeline com aviso de histórico preservado */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wider">Histórico & Previsão</h4>
                      <span className="text-[10px] text-gray-400 font-medium">✓ Lançado | ◌ Futuro</span>
                    </div>
                    <div className="space-y-0 relative">
                      <div className="absolute left-[7px] top-3 bottom-3 w-[2px] bg-gray-100" />

                      {/* Parcelas já geradas (passado) */}
                      {installments.map((inst) => (
                        <div key={inst.id} className="flex items-center gap-3 py-1.5 relative">
                          <div className="w-4 h-4 rounded-full bg-purple-500 flex items-center justify-center flex-shrink-0 z-10 shadow-sm" title="Despesa registrada no extrato">
                            <Check size={10} className="text-white" strokeWidth={3} />
                          </div>
                          <div className="flex-grow flex items-center justify-between min-w-0">
                            <span className="text-xs font-semibold text-gray-700 truncate">{inst.description}</span>
                            <span className="text-[10px] text-gray-400 font-medium flex-shrink-0 ml-2">
                              {formatDate(inst.created_at)}
                            </span>
                          </div>
                        </div>
                      ))}

                      {/* Parcelas futuras (previsão) */}
                      {futureInstallments.map((fi, i) => (
                        <div key={`future-${i}`} className="flex items-center gap-3 py-1.5 relative opacity-45">
                          <div className="w-4 h-4 rounded-full bg-gray-200 border-2 border-dashed border-gray-300 flex-shrink-0 z-10" title="Previsão futura" />
                          <div className="flex-grow flex items-center justify-between min-w-0">
                            <span className="text-xs font-medium text-gray-500 truncate">{fi.description}</span>
                            <span className="text-[10px] text-gray-400 font-medium flex-shrink-0 ml-2">
                              {formatDate(fi.date.toISOString())}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-2 p-2.5 bg-gray-50 rounded-xl border border-gray-100 flex items-start gap-2">
                      <Info size={14} className="text-gray-400 flex-shrink-0 mt-0.5" />
                      <p className="text-[11px] text-gray-500 leading-snug">
                        As parcelas com check verde já estão salvas no histórico. Ao alterar datas, valores ou pausar, apenas os lançamentos futuros serão impactados.
                      </p>
                    </div>
                  </div>

                  {/* Barra de ações */}
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs font-bold gap-1.5 rounded-lg flex-1"
                      onClick={handleStartEditingRule}
                      title="Alterar data, valor ou descrição para as próximas cobranças"
                    >
                      <Sliders size={13} /> Ajustar futuro
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs font-bold gap-1.5 rounded-lg flex-1"
                      onClick={() => {
                        onClose();
                        onEditExpense();
                      }}
                      title="Editar a despesa que já foi lançada no extrato"
                    >
                      <Pencil size={13} /> Editar despesa
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`text-xs font-bold gap-1.5 rounded-lg ${
                        rule.active 
                          ? 'text-amber-600 border-amber-200 hover:bg-amber-50' 
                          : 'text-green-600 border-green-200 hover:bg-green-50'
                      }`}
                      onClick={handleToggleStatus}
                      disabled={actionLoading}
                    >
                      {rule.active ? <><Pause size={13} /> Pausar</> : <><Play size={13} /> Reativar</>}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs font-bold gap-1.5 rounded-lg text-red-500 border-red-200 hover:bg-red-50 px-2.5"
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={actionLoading}
                      title="Excluir regra futura"
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="text-center py-6">
              <p className="text-sm text-gray-500">Regra de recorrência não encontrada.</p>
              <p className="text-xs text-gray-400 mt-1">Esta despesa pode ter sido desvinculada da regra original.</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4 text-xs font-bold"
                onClick={() => {
                  onClose();
                  onEditExpense();
                }}
              >
                <Pencil size={13} className="mr-1.5" /> Editar despesa
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
