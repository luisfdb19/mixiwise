'use client';

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RefreshCw, Pause, Play, Trash2, Pencil, X, Calendar, Check } from 'lucide-react';
import { getRecurringExpenseDetails, toggleRecurringExpenseStatus, deleteRecurringExpense } from '@/app/actions';
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

  useEffect(() => {
    if (isOpen && recurringExpenseId) {
      setLoading(true);
      getRecurringExpenseDetails(recurringExpenseId).then(({ rule, installments }) => {
        setRule(rule as RecurringRule | null);
        setInstallments(installments);
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

  // Extract clean description (without installment suffix)
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
          ? 'Recorrência pausada. Novas parcelas não serão geradas.'
          : 'Recorrência reativada. Parcelas voltarão a ser geradas.',
      });
      onDataChanged();
    }
    setActionLoading(false);
  };

  const handleDelete = async () => {
    if (!rule) return;
    if (!window.confirm('Excluir a regra de recorrência? As parcelas já geradas serão mantidas.')) return;
    setActionLoading(true);
    const result = await deleteRecurringExpense(rule.id);
    if (result.success) {
      toast({ title: 'Excluída', description: 'Regra de recorrência excluída. Parcelas existentes foram mantidas.' });
      onDataChanged();
      onClose();
    }
    setActionLoading(false);
  };

  // Generate future installments preview
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
      <DialogContent className="max-w-md w-[calc(100vw-16px)] sm:w-full p-0 overflow-hidden border-0 rounded-xl shadow-2xl">
        {/* Header */}
        <DialogHeader className="bg-purple-600 text-white p-4 flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center">
              <RefreshCw size={18} className="text-white" />
            </div>
            <DialogTitle className="text-lg font-bold text-white leading-tight">
              {cleanDescription}
            </DialogTitle>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
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
              {/* Badge */}
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
                <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
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

              {/* Progress Bar (installments only) */}
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

              {/* Next Charge */}
              {rule.active && remainingInstallments !== 0 && (
                <div className="flex items-center gap-2.5 bg-amber-50 border border-amber-100 rounded-xl p-3">
                  <Calendar size={16} className="text-amber-500 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-amber-700">Próxima cobrança</p>
                    <p className="text-xs text-amber-600 font-medium">{formatDate(rule.next_occurrence)}</p>
                  </div>
                </div>
              )}

              {/* Divisão */}
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

              {/* Timeline */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wider">Timeline</h4>
                <div className="space-y-0 relative">
                  {/* Vertical connector line */}
                  <div className="absolute left-[7px] top-3 bottom-3 w-[2px] bg-gray-100" />

                  {/* Past / generated installments */}
                  {installments.map((inst) => (
                    <div key={inst.id} className="flex items-center gap-3 py-1.5 relative">
                      <div className="w-4 h-4 rounded-full bg-purple-500 flex items-center justify-center flex-shrink-0 z-10 shadow-sm">
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

                  {/* Future installments preview */}
                  {futureInstallments.map((fi, i) => (
                    <div key={`future-${i}`} className="flex items-center gap-3 py-1.5 relative opacity-40">
                      <div className="w-4 h-4 rounded-full bg-gray-200 border-2 border-dashed border-gray-300 flex-shrink-0 z-10" />
                      <div className="flex-grow flex items-center justify-between min-w-0">
                        <span className="text-xs font-medium text-gray-400 truncate">{fi.description}</span>
                        <span className="text-[10px] text-gray-300 font-medium flex-shrink-0 ml-2">
                          {formatDate(fi.date.toISOString())}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs font-bold gap-1.5 rounded-lg"
                  onClick={() => {
                    onClose();
                    onEditExpense();
                  }}
                >
                  <Pencil size={13} /> Editar parcela
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={`flex-1 text-xs font-bold gap-1.5 rounded-lg ${
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
                  className="text-xs font-bold gap-1.5 rounded-lg text-red-500 border-red-200 hover:bg-red-50"
                  onClick={handleDelete}
                  disabled={actionLoading}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
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
