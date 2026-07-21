'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { addExpense } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/currency';

interface Balance {
  debtor: string;
  debtorId?: string;
  creditor: string;
  creditorId?: string;
  amount: number;
  currency?: string;
}

interface SettleUpDialogProps {
  balances: Balance[];
  groupId: string;
}

export default function SettleUpDialog({ balances, groupId }: SettleUpDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { user } = useUser();
  const { toast } = useToast();
  const router = useRouter();

  if (!user || balances.length === 0) return null;

  const normalizeStr = (str: string) => {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  };

  const isMe = (name: string, id?: string) => {
    if (id && id === user.id) return true;
    if (name === user.id) return true;
    
    const normalizedTarget = normalizeStr(name);
    if (user.fullName && normalizedTarget === normalizeStr(user.fullName)) return true;
    if (user.firstName && normalizedTarget.includes(normalizeStr(user.firstName))) return true;
    
    return false;
  };

  const shortName = (name: string, id?: string) => {
    if (isMe(name, id)) return 'você';
    const parts = name.split(' ');
    if (parts.length > 1) return `${parts[0]} ${parts[parts.length-1][0]}.`;
    return name;
  };

  // Find if current user owes anyone
  const myDebts = balances.filter(b => isMe(b.debtor, b.debtorId));

  const groupBalancesByCurrency = (bals: Balance[]) => {
    return bals.reduce((acc, b) => {
      const c = b.currency || 'BRL';
      if (!acc[c]) acc[c] = [];
      acc[c].push(b);
      return acc;
    }, {} as Record<string, Balance[]>);
  };

  const myDebtsByCurrency = groupBalancesByCurrency(myDebts);
  const otherBalances = balances.filter(b => !myDebts.includes(b));
  const otherBalancesByCurrency = groupBalancesByCurrency(otherBalances);

  const handleSettle = async (debt: Balance) => {
    setLoading(true);
    try {
      const expenseData = {
        amount: debt.amount,
        currency: debt.currency || 'BRL',
        description: 'Pagamento',
        groupId: groupId,
        splitPercentage: 100,
        splitWith: [{
          id: debt.creditorId || debt.creditor,
          name: debt.creditor,
        }],
        createdBy: debt.debtorId || debt.debtor,
      };

      const result = await addExpense(expenseData);
      
      if (result.success) {
        toast({ title: 'Sucesso', description: 'Pagamento registrado com sucesso!' });
        setIsOpen(false);
        router.refresh();
      } else {
        toast({ title: 'Erro', description: 'Falha ao registrar pagamento', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Erro', description: 'Ocorreu um erro inesperado', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-500 hover:bg-teal-600 text-white">
          Settle Up
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Acertar contas</DialogTitle>
          <DialogDescription>
            Registre um pagamento para quitar seus saldos.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {myDebts.length > 0 ? (
            Object.entries(myDebtsByCurrency).map(([currency, debts]) => (
              <div key={currency} className="space-y-3">
                {Object.keys(myDebtsByCurrency).length > 1 && (
                  <h4 className="text-sm font-semibold text-gray-600">{currency}</h4>
                )}
                {debts.map((debt, idx) => (
                  <div key={idx} className="flex items-center justify-between p-4 border rounded-lg bg-gray-50">
                    <div>
                      <p className="font-medium text-gray-900">Pagar {shortName(debt.creditor, debt.creditorId)}</p>
                      <p className="text-lg font-bold text-teal-600">{formatCurrency(debt.amount, debt.currency || 'BRL')}</p>
                    </div>
                    <Button 
                      onClick={() => handleSettle(debt)} 
                      disabled={loading}
                      className="bg-teal-500 hover:bg-teal-600"
                    >
                      {loading ? 'Processando...' : 'Registrar'}
                    </Button>
                  </div>
                ))}
              </div>
            ))
          ) : (
            <p className="text-center text-gray-500 py-4">Você não deve nada agora! 🎉</p>
          )}

          {myDebts.length === 0 && balances.length > 0 && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-sm text-gray-500 mb-2">Outros saldos pendentes no grupo:</p>
              {Object.entries(otherBalancesByCurrency).map(([currency, bals]) => (
                <div key={currency} className="mb-2">
                  {Object.keys(otherBalancesByCurrency).length > 1 && (
                    <h5 className="text-xs font-semibold text-gray-500 mt-1">{currency}</h5>
                  )}
                  {bals.map((b, idx) => (
                    <div key={idx} className="flex justify-between text-sm py-1">
                      <span>{shortName(b.debtor, b.debtorId)} deve a {shortName(b.creditor, b.creditorId)}</span>
                      <span className="font-medium">{formatCurrency(b.amount, b.currency || 'BRL')}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
