'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { FileText, Calendar, Plus, X, Paperclip } from 'lucide-react';
import { addExpense, updateExpense, createRecurringExpense } from '@/app/actions';
import { formatCurrency, getCurrencySymbol, getSupportedCurrencies } from '@/lib/currency';

const formatAmount = (amount: number | string) => {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  return numAmount.toFixed(2);
};

interface Member {
  id: string;
  name: string;
}

interface SplitWithMember {
  id: string;
  name: string;
  splitAmount: number;
}

interface ExpenseToEdit {
  id: string;
  amount: number;
  description: string;
  created_by: string;
  created_by_name?: string;
  split_with: SplitWithMember[];
  created_at?: string;
  receipt_data?: string;
  receipt_type?: string;
  split_percentage?: number;
  currency?: string;
}

interface AddExpenseDialogProps {
  isOpen: boolean;
  onClose: () => void;
  groupId: string;
  members: Member[];
  currentUser: {
    id: string;
    fullName: string | null;
    firstName: string | null;
  } | null;
  onSuccess: () => void;
  expenseToEdit?: ExpenseToEdit | null;
}

export default function AddExpenseDialog({
  isOpen,
  onClose,
  groupId,
  members,
  currentUser,
  onSuccess,
  expenseToEdit,
}: AddExpenseDialogProps) {
  const { toast } = useToast();
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<Member[]>([]);
  const [payerId, setPayerId] = useState<string>('');
  const [splitType, setSplitType] = useState<'equal' | 'percentage'>('equal');
  const [splitMode, setSplitMode] = useState<'split' | 'you-owe-all' | 'they-owe-all'>('split');
  const [customPercentages, setCustomPercentages] = useState<{ [id: string]: string }>({});
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [receiptData, setReceiptData] = useState<string | null>(null);
  const [receiptType, setReceiptType] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>('BRL');
  
  const [showPayerDropdown, setShowPayerDropdown] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);

  // Recurring / Installments state
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceInterval, setRecurrenceInterval] = useState<'month' | 'year'>('month');
  const [isInstallment, setIsInstallment] = useState(false);
  const [installmentsCount, setInstallmentsCount] = useState('12');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      setReceiptData(reader.result as string);
      setReceiptType(file.type);
    };
  };

  // Initialize selected members to all group members by default
  useEffect(() => {
    if (!isOpen) {
      setHasInitialized(false);
      return;
    }

    if (isOpen && !hasInitialized) {
      setHasInitialized(true);
      if (expenseToEdit) {
        setDescription(expenseToEdit.description);
        setAmount(expenseToEdit.amount.toString());
        setSelectedMembers(
          members.filter((m) =>
            expenseToEdit.split_with.some((se: SplitWithMember) => se.id === m.id)
          )
        );
        setPayerId(expenseToEdit.created_by);
        
        // Detect custom percentages
        if (expenseToEdit.split_with && expenseToEdit.amount > 0) {
          const pcts: { [id: string]: string } = {};
          let isPercentageSplit = false;
          expenseToEdit.split_with.forEach((member: SplitWithMember) => {
            const pctVal = (member.splitAmount / expenseToEdit.amount) * 100;
            pcts[member.id] = pctVal.toFixed(2);
            const equalShare = expenseToEdit.amount / expenseToEdit.split_with.length;
            if (Math.abs(member.splitAmount - equalShare) > 0.05) {
              isPercentageSplit = true;
            }
          });
          setCustomPercentages(pcts);
          setSplitType(isPercentageSplit ? 'percentage' : 'equal');
        } else {
          setSplitType(expenseToEdit.split_percentage ? 'percentage' : 'equal');
          setCustomPercentages({});
        }

        setSplitMode('split');
        setDate(
          expenseToEdit.created_at
            ? new Date(expenseToEdit.created_at).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0]
        );
        setReceiptData(expenseToEdit.receipt_data || null);
        setReceiptType(expenseToEdit.receipt_type || null);
        setCurrency(expenseToEdit.currency || 'BRL');
      } else {
        setSelectedMembers(members);
        if (currentUser) {
          setPayerId(currentUser.id);
        } else if (members.length > 0) {
          setPayerId(members[0].id);
        }
        setDescription('');
        setAmount('');
        setSplitType('equal');
        setSplitMode('split');
        setCustomPercentages({});
        setDate(new Date().toISOString().split('T')[0]);
        setReceiptData(null);
        setReceiptType(null);
        setCurrency('BRL');
        setIsRecurring(false);
        setRecurrenceInterval('month');
        setIsInstallment(false);
        setInstallmentsCount('12');
      }
    }
  }, [isOpen, hasInitialized, members, currentUser, expenseToEdit]);

  const numAmount = parseFloat(amount) || 0;
  const isMe = (id: string) => currentUser && id === currentUser.id;

  const getMemberName = (id: string) => {
    if (isMe(id)) return 'você';
    const m = members.find((member) => member.id === id);
    if (!m) return 'Desconhecido';
    const parts = m.name.split(' ');
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : m.name;
  };

  const getPayerName = () => {
    return payerId === currentUser?.id ? 'você' : getMemberName(payerId);
  };

  const handleSave = async () => {
    if (!description.trim()) {
      toast({ title: 'Aviso', description: 'Por favor, insira uma descrição.', variant: 'destructive' });
      return;
    }
    if (numAmount <= 0) {
      toast({ title: 'Aviso', description: 'Por favor, insira um valor válido maior que zero.', variant: 'destructive' });
      return;
    }

    let finalSplitWith = selectedMembers;

    if (splitMode === 'you-owe-all') {
      const meMember = members.find((m) => isMe(m.id));
      if (!meMember) return;
      finalSplitWith = [meMember];
    } else if (splitMode === 'they-owe-all') {
      finalSplitWith = selectedMembers.filter((m) => !isMe(m.id));
    }

    if (finalSplitWith.length === 0) {
      toast({ title: 'Aviso', description: 'Selecione pelo menos uma pessoa para dividir.', variant: 'destructive' });
      return;
    }

    if (splitType === 'percentage' && splitMode === 'split') {
      const sum = Object.values(customPercentages).reduce((acc, val) => acc + (parseFloat(val) || 0), 0);
      if (Math.abs(sum - 100) > 0.01) {
        toast({ title: 'Aviso', description: 'A soma das porcentagens deve ser exatamente 100%.', variant: 'destructive' });
        return;
      }
    }

    // Calculate split amounts and map each member to SplitMember
    const splitWithWithAmounts = finalSplitWith.map((member) => {
      let memberSplitAmount = 0;
      if (splitMode === 'you-owe-all') {
        memberSplitAmount = isMe(member.id) ? numAmount : 0;
      } else if (splitMode === 'they-owe-all') {
        const othersCount = selectedMembers.filter(m => !isMe(m.id)).length;
        memberSplitAmount = !isMe(member.id) && othersCount > 0 ? numAmount / othersCount : 0;
      } else { // splitMode === 'split'
        if (splitType === 'equal') {
          memberSplitAmount = finalSplitWith.length > 0 ? numAmount / finalSplitWith.length : 0;
        } else { // percentage
          const pct = parseFloat(customPercentages[member.id]) || 0;
          memberSplitAmount = (numAmount * pct) / 100;
        }
      }
      return {
        id: member.id,
        name: member.name,
        splitAmount: memberSplitAmount,
      };
    });

    if (expenseToEdit) {
      const result = await updateExpense(expenseToEdit.id, {
        amount: numAmount,
        currency,
        description,
        splitPercentage: 100,
        splitWith: splitWithWithAmounts,
        createdBy: payerId,
        createdAt: new Date(date + 'T12:00:00').toISOString(),
      });

      if (result.success) {
        toast({ title: 'Sucesso! 🎉', description: 'Despesa atualizada com sucesso.' });
        onSuccess();
        onClose();
      } else {
        toast({ title: 'Erro', description: 'Falha ao atualizar despesa.', variant: 'destructive' });
      }
    } else {
      if (isRecurring) {
        const count = isInstallment ? (parseInt(installmentsCount) || 2) : 1;
        const finalAmount = isInstallment ? numAmount / count : numAmount;
        const totalInst = isInstallment ? count : null;
        const initialDescription = isInstallment ? `${description} (1/${count})` : description;

        // Calculate mapped split amount for first installment
        const firstSplitWith = splitWithWithAmounts.map(m => ({
          id: m.id,
          name: m.name,
          splitAmount: isInstallment ? m.splitAmount / count : m.splitAmount
        }));

        // 1. Set the next occurrence date
        const nextDate = new Date(date + 'T12:00:00');
        if (recurrenceInterval === 'year') {
          nextDate.setFullYear(nextDate.getFullYear() + 1);
        } else {
          nextDate.setMonth(nextDate.getMonth() + 1);
        }

        // 2. Create the recurrence rule FIRST to get the ID
        const ruleResult = await createRecurringExpense({
          groupId,
          amount: finalAmount,
          currency,
          description,
          splitPercentage: 100,
          splitWith: firstSplitWith,
          createdBy: payerId,
          intervalUnit: recurrenceInterval,
          nextOccurrence: nextDate.toISOString(),
          totalInstallments: totalInst,
        });

        if (!ruleResult.success || !ruleResult.id) {
          toast({ title: 'Erro', description: 'Falha ao agendar recorrência.', variant: 'destructive' });
          return;
        }

        // 3. Add the first occurrence linked to the rule
        const firstResult = await addExpense({
          amount: finalAmount,
          currency,
          description: initialDescription,
          groupId,
          splitPercentage: 100,
          splitWith: firstSplitWith,
          createdBy: payerId,
          createdAt: new Date(date + 'T12:00:00').toISOString(),
          receiptData: receiptData || undefined,
          receiptType: receiptType || undefined,
          recurringExpenseId: ruleResult.id,
        });

        if (firstResult.success) {
          toast({ title: 'Sucesso! 🎉', description: isInstallment ? 'Compra parcelada registrada com sucesso.' : 'Despesa recorrente agendada com sucesso.' });
          onSuccess();
          onClose();
        } else {
          toast({ title: 'Erro', description: 'Falha ao adicionar despesa inicial.', variant: 'destructive' });
        }
      } else {
        const result = await addExpense({
          amount: numAmount,
          currency,
          description,
          groupId,
          splitPercentage: 100, // 100% of expense total is split
          splitWith: splitWithWithAmounts,
          createdBy: payerId,
          createdAt: new Date(date + 'T12:00:00').toISOString(),
          receiptData: receiptData || undefined,
          receiptType: receiptType || undefined,
        });

        if (result.success) {
          toast({ title: 'Sucesso! 🎉', description: 'Despesa adicionada com sucesso.' });
          onSuccess();
          onClose();
        } else {
          toast({ title: 'Erro', description: 'Falha ao adicionar despesa.', variant: 'destructive' });
        }
      }
    }
  };

  const toggleMember = (member: Member) => {
    if (selectedMembers.some((m) => m.id === member.id)) {
      setSelectedMembers(selectedMembers.filter((m) => m.id !== member.id));
    } else {
      setSelectedMembers([...selectedMembers, member]);
    }
  };

  const activeMembersCount = selectedMembers.length;
  const amountPerPerson = activeMembersCount > 0 ? numAmount / activeMembersCount : 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md w-[calc(100vw-16px)] sm:w-full p-0 overflow-hidden border-0 rounded-xl shadow-2xl">
        {/* Header matching Splitwise's teal style */}
        <DialogHeader className="bg-teal-500 text-white p-4 flex flex-row items-center justify-between space-y-0">
          <DialogTitle className="text-xl font-bold text-white">
            {expenseToEdit ? 'Editar despesa' : 'Adicionar despesa'}
          </DialogTitle>
          <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </DialogHeader>

        <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 bg-white max-h-[80vh] sm:max-h-[85vh] overflow-y-auto">
          {/* Top Options matching Splitwise split modes */}
          <div className="flex flex-col gap-1.5 bg-gray-50 p-2.5 rounded-xl border border-gray-100">
            <button
              type="button"
              className={`w-full py-1.5 px-4 rounded-lg text-xs font-bold transition-all text-center ${
                splitMode === 'split'
                  ? 'bg-teal-500 text-white shadow-sm'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
              }`}
              onClick={() => {
                setSplitMode('split');
                setSelectedMembers(members);
              }}
            >
              Dividir despesa
            </button>
            <button
              type="button"
              className={`w-full py-1.5 px-4 rounded-lg text-xs font-bold transition-all text-center ${
                splitMode === 'you-owe-all'
                  ? 'bg-teal-500 text-white shadow-sm'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
              }`}
              onClick={() => {
                setSplitMode('you-owe-all');
                if (currentUser) {
                  // If YOU owe the full amount, someone ELSE paid
                  const otherMember = members.find((m) => !isMe(m.id));
                  setPayerId(otherMember ? otherMember.id : currentUser.id);
                  setSelectedMembers(members.filter((m) => isMe(m.id)));
                }
              }}
            >
              Você deve o valor total
            </button>
            <button
              type="button"
              className={`w-full py-1.5 px-4 rounded-lg text-xs font-bold transition-all text-center ${
                splitMode === 'they-owe-all'
                  ? 'bg-teal-500 text-white shadow-sm'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
              }`}
              onClick={() => {
                setSplitMode('they-owe-all');
                if (currentUser) {
                  setPayerId(currentUser.id);
                  setSelectedMembers(members.filter((m) => !isMe(m.id)));
                }
              }}
            >
              Eles devem o valor total
            </button>
          </div>

          {/* Chips Section */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
              <span className="font-semibold text-xs">Com você e:</span>
              {selectedMembers.filter(m => m.id !== currentUser?.id).map((member) => (
                <span
                  key={member.id}
                  className="inline-flex items-center gap-1 bg-gray-100 hover:bg-gray-200 transition-colors border text-gray-800 text-[11px] px-2.5 py-1 rounded-full cursor-pointer font-medium"
                  onClick={() => toggleMember(member)}
                >
                  {getMemberName(member.id)}
                  <X size={11} className="text-gray-500" />
                </span>
              ))}

              {/* Add Member Quick Selector */}
              {members.filter(m => !selectedMembers.some(sm => sm.id === m.id)).length > 0 && (
                <div className="relative inline-block group">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 bg-purple-50 text-purple-600 border border-purple-100 hover:bg-purple-100 text-[11px] px-2.5 py-1 rounded-full font-semibold transition-colors"
                  >
                    <Plus size={11} /> Adicionar
                  </button>
                  <div className="absolute hidden group-hover:block z-20 mt-1 left-0 bg-white border shadow-xl rounded-md py-1 max-h-32 overflow-y-auto w-40">
                    {members
                      .filter(m => !selectedMembers.some(sm => sm.id === m.id))
                      .map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-purple-50 text-gray-700 font-medium"
                          onClick={() => toggleMember(m)}
                        >
                          {m.name}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Description & Amount Input */}
          <div className="flex gap-4 items-center">
            <div className="w-14 h-14 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-center text-gray-400 flex-shrink-0">
              <FileText size={28} className="text-gray-500" />
            </div>
            <div className="flex-grow space-y-1">
              <input
                type="text"
                placeholder="Insira a descrição"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full border-b border-dashed border-gray-300 py-1 text-base font-semibold text-gray-900 focus:outline-none focus:border-teal-500 bg-transparent placeholder-gray-300"
                style={{ fontSize: '16px' }}
              />
              <div className="flex items-center gap-1">
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="bg-transparent text-xl font-bold text-gray-700 focus:outline-none cursor-pointer appearance-none pr-1"
                >
                  {getSupportedCurrencies().map(c => (
                    <option key={c.code} value={c.code}>
                      {c.flag} {c.code}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="0,00"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full text-2xl sm:text-3xl font-semibold text-gray-900 focus:outline-none bg-transparent placeholder-gray-200 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  style={{ fontSize: '24px' }}
                />
              </div>
            </div>
          </div>

          {/* Summary and Payer Line */}
          <div className="text-center text-xs text-gray-700 bg-gray-50 rounded-xl p-2.5 border border-gray-100 relative">
            <span>Pago por </span>
            <span
              className="text-teal-600 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-100 font-bold cursor-pointer inline-block"
              onClick={() => setShowPayerDropdown(!showPayerDropdown)}
            >
              {getPayerName()}
            </span>
            <span> e dividido </span>
            <span className="font-bold text-gray-900">
              {splitMode === 'split' ? (splitType === 'equal' ? 'igualmente' : 'personalizado') : 'integralmente'}
            </span>

            {/* Payer Dropdown */}
            {showPayerDropdown && (
              <div className="absolute left-1/2 -translate-x-1/2 mt-2 bg-white border shadow-2xl rounded-lg py-1 z-20 w-44">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold py-1 px-3">Quem pagou?</p>
                {members.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    className={`w-full text-left px-3 py-2 text-xs font-semibold hover:bg-teal-50 text-gray-700 ${payerId === member.id ? 'bg-teal-50/50 text-teal-600 font-bold' : ''}`}
                    onClick={() => {
                      setPayerId(member.id);
                      setShowPayerDropdown(false);
                    }}
                  >
                    {isMe(member.id) ? 'Você' : member.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Split checklist matching Splitwise design */}
          {splitMode === 'split' && (
            <div className="border border-gray-200 rounded-xl p-3.5 bg-white space-y-3.5 shadow-sm">
              <div className="flex justify-between items-center">
                <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Dividir {splitType === 'equal' ? 'igualmente' : 'por porcentagem'}
                </h4>
                
                {/* Horizontal toggle button group for Equal/Percentage */}
                <div className="flex border border-gray-200 rounded-md overflow-hidden bg-gray-50">
                  <button
                    type="button"
                    className={`px-3 py-1 text-xs font-bold transition-all ${
                      splitType === 'equal' ? 'bg-white text-teal-600 shadow-sm border-r border-l' : 'text-gray-500 hover:text-gray-700'
                    }`}
                    onClick={() => setSplitType('equal')}
                  >
                    =
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-1 text-xs font-bold transition-all ${
                      splitType === 'percentage' ? 'bg-white text-teal-600 shadow-sm border-r border-l' : 'text-gray-500 hover:text-gray-700'
                    }`}
                    onClick={() => setSplitType('percentage')}
                  >
                    %
                  </button>
                </div>
              </div>

              {/* Members Checklist */}
              <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
                {members.map((member) => {
                  const isSelected = selectedMembers.some((sm) => sm.id === member.id);
                  let displayShare = 0;
                  if (isSelected) {
                    if (splitType === 'equal') {
                      displayShare = amountPerPerson;
                    } else {
                      const pct = parseFloat(customPercentages[member.id]) || 0;
                      displayShare = (numAmount * pct) / 100;
                    }
                  }

                  return (
                    <div key={member.id} className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          id={`split-check-${member.id}`}
                          checked={isSelected}
                          onChange={() => toggleMember(member)}
                          className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                        />
                        <label
                          htmlFor={`split-check-${member.id}`}
                          className="text-xs font-bold text-gray-700 cursor-pointer"
                        >
                          {getMemberName(member.id)}
                        </label>
                      </div>

                      <div className="flex items-center gap-2">
                        {splitType === 'percentage' && isSelected && (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              placeholder="0"
                              value={customPercentages[member.id] || ''}
                              onChange={(e) => {
                                setCustomPercentages({
                                  ...customPercentages,
                                  [member.id]: e.target.value,
                                });
                              }}
                              className="w-12 border rounded bg-white py-0.5 px-1.5 text-right text-[11px] font-bold text-gray-900 focus:outline-none focus:ring-1 focus:ring-teal-500"
                            />
                            <span className="text-[11px] font-bold text-gray-400">%</span>
                          </div>
                        )}
                        <span className={`text-xs font-bold ${isSelected ? 'text-gray-900' : 'text-gray-300'}`}>
                          {formatCurrency(displayShare, currency)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Date Picker Pill & Receipt Upload */}
          <div className="flex justify-center gap-2 flex-wrap">
            <div className="relative inline-flex border bg-white shadow-sm hover:bg-gray-50 transition-colors py-1.5 px-4 rounded-full text-xs font-bold text-gray-600 cursor-pointer flex items-center gap-1.5">
              <Calendar size={14} className="text-gray-400" />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-transparent border-0 outline-none cursor-pointer focus:ring-0 p-0 text-xs font-semibold text-gray-700"
              />
            </div>
            
            <label className="relative inline-block border bg-white shadow-sm hover:bg-gray-50 transition-colors py-1.5 px-4 rounded-full text-xs font-bold text-gray-600 cursor-pointer flex items-center gap-1.5">
              <Paperclip size={14} className={receiptData ? "text-teal-500" : "text-gray-400"} />
              <span className={receiptData ? "text-teal-600" : "text-gray-700"}>
                {receiptData ? 'Recibo anexado' : 'Anexar Recibo'}
              </span>
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.pdf"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </div>

          {receiptData && (
            <div className="border rounded-lg p-2.5 bg-gray-50 flex items-center justify-between gap-3 shadow-inner">
              <div className="flex items-center gap-2 min-w-0">
                {receiptType?.includes('pdf') ? (
                  <div className="w-10 h-10 bg-red-100 text-red-700 rounded flex items-center justify-center font-bold text-xs flex-shrink-0 border border-red-200">
                    PDF
                  </div>
                ) : (
                  <img
                    src={receiptData}
                    alt="Receipt preview"
                    className="w-10 h-10 object-cover rounded border flex-shrink-0"
                  />
                )}
                <span className="text-[11px] font-semibold text-gray-500 truncate">
                  {receiptType?.includes('pdf') ? 'documento_recibo.pdf' : 'imagem_recibo.jpg'}
                </span>
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-[11px] text-teal-600 hover:text-teal-700 font-bold px-2.5 hover:bg-teal-50"
                  onClick={() => {
                    const win = window.open();
                    if (win) {
                      win.document.write(
                        receiptType?.includes('pdf')
                          ? `<iframe src="${receiptData}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`
                          : `<img src="${receiptData}" style="max-width: 100%; height: auto; display: block; margin: 0 auto;" />`
                      );
                    }
                  }}
                >
                  Visualizar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-gray-400 hover:text-red-500 hover:bg-red-50"
                  onClick={() => {
                    setReceiptData(null);
                    setReceiptType(null);
                  }}
                >
                  <X size={14} />
                </Button>
              </div>
            </div>
          )}

          {/* Recurring / Installments Section */}
          {!expenseToEdit && (
            <div className="border border-gray-200 rounded-xl p-3.5 bg-white space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-gray-700 cursor-pointer" htmlFor="recurring-toggle">
                  Esta despesa se repete? (Recorrente)
                </label>
                <input
                  type="checkbox"
                  id="recurring-toggle"
                  checked={isRecurring}
                  onChange={(e) => setIsRecurring(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                />
              </div>

              {isRecurring && (
                <div className="pt-2 border-t space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-gray-600">Frequência:</span>
                    <select
                      value={recurrenceInterval}
                      onChange={(e) => setRecurrenceInterval(e.target.value as 'month' | 'year')}
                      className="border rounded bg-white py-1 px-2 font-semibold text-gray-700 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    >
                      <option value="month">Mensalmente</option>
                      <option value="year">Anualmente</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-gray-700 cursor-pointer" htmlFor="installment-toggle">
                      É parcelado em parcelas fixas?
                    </label>
                    <input
                      type="checkbox"
                      id="installment-toggle"
                      checked={isInstallment}
                      onChange={(e) => setIsInstallment(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                    />
                  </div>

                  {isInstallment && (
                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="font-bold text-gray-600">Número de parcelas:</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min="2"
                          value={installmentsCount}
                          onChange={(e) => setInstallmentsCount(e.target.value)}
                          className="w-16 border rounded bg-white py-1 px-2 text-right font-bold text-gray-900 focus:outline-none focus:ring-1 focus:ring-teal-500"
                        />
                        <span className="font-semibold text-gray-400">vezes</span>
                      </div>
                    </div>
                  )}

                  {isInstallment && numAmount > 0 && (
                    <p className="text-[10px] text-gray-400 font-semibold text-right">
                      Serão geradas {installmentsCount} parcelas de {formatCurrency(numAmount / (parseInt(installmentsCount) || 2), currency)} cada.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Action buttons Cancel / Save */}
          <div className="flex gap-2 sm:gap-3 justify-end pt-2">
            <Button
              type="button"
              variant="outline"
              className="bg-white px-4 sm:px-6 rounded-lg text-gray-600 border border-gray-200 text-xs font-bold flex-1 sm:flex-none"
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="bg-teal-500 hover:bg-teal-600 text-white px-4 sm:px-6 rounded-lg text-xs font-bold flex-1 sm:flex-none"
              onClick={handleSave}
            >
              Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
